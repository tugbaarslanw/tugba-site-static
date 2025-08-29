/*  Hero 3D Space Background — PREMIUM (WebGL, no libs)
    - Sadece HERO arka planında: gerçekçi hacimsel nebula + yıldız alanı
    - Raymarch volumetric nebula (fBM), parallax (mouse/touch), soft bloom hissi
    - Canvas, .hero-bg KATMANININ ÜSTÜNDE, .hero-inner'IN ALTINDA çalışır
    - prefers-reduced-motion: tek kare statik render
*/

(function () {
  // HERO kapsayıcıyı bul
  const hero =
    document.querySelector('[data-hero]') ||
    document.querySelector('header.hero') ||
    document.querySelector('#hero') ||
    document.querySelector('.hero');

  if (!hero) { console.warn('[Hero3D] Hero container not found'); return; }

  // Canvas oluştur: hero-bg ÜSTÜNE, hero-inner ALTINA yerleştir (görünsün)
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',            // <- kritik: hero-bg (z-index:0) üstüne
    pointerEvents: 'none'
  });

  // Layout bozmadan yalnızca HERO'yu relative yap
  const cs = getComputedStyle(hero);
  if (cs.position === 'static') hero.style.position = 'relative';
  if (cs.overflow === 'visible') hero.style.overflow = 'hidden';

  // hero-inner'dan ÖNCE ekle (hero-bg'den sonra)
  const inner = hero.querySelector('.hero-inner');
  if (inner) hero.insertBefore(canvas, inner);
  else hero.appendChild(canvas);

  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { console.error('[Hero3D] WebGL not supported'); return; }

  const prefersReduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = matchMedia('(max-width: 768px)').matches;

  // ---------- SHADERS ----------

  // Fullscreen quad (nebula)
  const nebulaVS = `
    attribute vec2 aPos; // clip-space
    varying vec2 vUV;
    void main() {
      vUV = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  // Volumetric nebula (fbm) with color grading
  const nebulaFS = `
    precision highp float;
    varying vec2 vUV;

    uniform vec2 uRes;
    uniform float uTime;
    uniform mat3 uRot;     // 3D rot from parallax
    uniform float uQuality; // steps scalar

    // Hash & value noise
    float hash(vec3 p){
      p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float vnoise(vec3 x){
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f*f*(3.0-2.0*f);
      float n000 = hash(p + vec3(0.0,0.0,0.0));
      float n100 = hash(p + vec3(1.0,0.0,0.0));
      float n010 = hash(p + vec3(0.0,1.0,0.0));
      float n110 = hash(p + vec3(1.0,1.0,0.0));
      float n001 = hash(p + vec3(0.0,0.0,1.0));
      float n101 = hash(p + vec3(1.0,0.0,1.0));
      float n011 = hash(p + vec3(0.0,1.0,1.0));
      float n111 = hash(p + vec3(1.0,1.0,1.0));
      float n00 = mix(n000, n100, f.x);
      float n10 = mix(n010, n110, f.x);
      float n01 = mix(n001, n101, f.x);
      float n11 = mix(n011, n111, f.x);
      float n0 = mix(n00, n10, f.y);
      float n1 = mix(n01, n11, f.y);
      return mix(n0, n1, f.z);
    }

    float fbm(vec3 p){
      float v=0.0, a=0.5;
      for(int i=0;i<6;i++){
        v += a * vnoise(p);
        p *= 2.02;
        a *= 0.53;
      }
      return v;
    }

    // Palette: deep space purple -> magenta -> cyan highlights
    vec3 palette(float t){
      // smooth multi-stop gradient
      vec3 c1 = vec3(0.15, 0.05, 0.35); // deep purple
      vec3 c2 = vec3(0.35, 0.10, 0.60); // nebula core
      vec3 c3 = vec3(0.68, 0.20, 0.85); // magenta
      vec3 c4 = vec3(0.25, 0.60, 0.95); // cyan highlight
      t = clamp(t, 0.0, 1.0);
      if (t < 0.33) {
        float k = smoothstep(0.0, 0.33, t);
        return mix(c1, c2, k);
      } else if (t < 0.66) {
        float k = smoothstep(0.33, 0.66, t);
        return mix(c2, c3, k);
      } else {
        float k = smoothstep(0.66, 1.0, t);
        return mix(c3, c4, k);
      }
    }

    // Tone mapping-ish curve
    vec3 toneMap(vec3 c){
      c = 1.0 - exp(-c * 1.6);
      return pow(c, vec3(1.0/1.15));
    }

    // Star glints in the nebula pass (very subtle speckles)
    float stars(vec3 p){
      // cheap hash sparkles
      float s = hash(floor(p*3.0));
      s = step(0.995, s) * 1.0; // sparse
      return s;
    }

    void main(){
      vec2 uv = (vUV * uRes - 0.5*uRes) / uRes.y; // keep FOV square
      // Camera & ray
      vec3 ro = vec3(0.0, 0.0, 2.1);
      vec3 rd = normalize(uRot * normalize(vec3(uv, -1.7)));

      // Raymarch
      float STEPS = mix(28.0, 56.0, uQuality); // mobile->desktop
      float tMax = 6.0;
      float t = 0.0;

      vec3 accum = vec3(0.0);
      float alpha = 0.0;

      // drift
      float time = uTime * 0.6;
      for (int i=0; i<64; i++){
        if (float(i) >= STEPS) break;
        vec3 pos = ro + rd * t;

        // Warp space gently
        vec3 q = pos;
        q.xy += 0.25 * sin(vec2(q.z, q.x) * 0.7 + time*0.3);
        q.z  += 0.20 * sin(q.x*0.8 + time*0.25);

        // Density from fbm ridges
        float d1 = fbm(q*1.4 + vec3(0.0, time*0.05, 0.0));
        float d2 = fbm(q*2.3 - vec3(time*0.03, 0.0, 0.0));
        float dens = smoothstep(0.45, 0.95, d1*0.7 + d2*0.6);

        // add subtle cellular break-up
        float detail = fbm(q*4.5 + time*0.02);
        dens = clamp(dens * (0.7 + 0.6*detail), 0.0, 1.0);

        // Color & lighting
        float glow = smoothstep(0.0, 1.2, dens) * (0.5 + 0.5*fbm(q*3.0));
        vec3 col = palette(dens);
        col *= 0.5 + 0.6*glow;

        // integrate (front-to-back alpha)
        float a = dens * 0.035; // step alpha
        a *= smoothstep(0.0, 0.2, (tMax - t)); // fade in distance
        a = clamp(a, 0.0, 1.0 - alpha);

        accum += col * a;
        alpha += a;

        // sparse stars in volume (very subtle)
        accum += vec3(1.2,1.2,1.3) * stars(q*2.5) * 0.02;

        if (alpha > 0.98) break;
        t += mix(0.06, 0.11, uQuality); // step size
        if (t > tMax) break;
      }

      // Vignette & tonemap
      float vig = smoothstep(1.0, 0.15, length(uv));
      accum *= mix(0.85, 1.15, vig);

      vec3 color = toneMap(accum * 1.6);
      gl_FragColor = vec4(color, 1.0); // opaque background for our layer
    }
  `;

  // Stars program (GL_POINTS), additive on top
  const starVS = `
    attribute vec3 position;
    attribute vec3 color;
    attribute float size;
    uniform mat4 uMVP;
    varying vec3 vColor;
    void main(){
      vec4 p = uMVP * vec4(position, 1.0);
      gl_Position = p;
      float s = size * (300.0 / -p.z);
      gl_PointSize = clamp(s, 1.0, 10.0);
      vColor = color;
    }
  `;

  const starFS = `
    precision mediump float;
    varying vec3 vColor;
    void main(){
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r = length(c);
      float a = smoothstep(1.0, 0.0, r);
      // soft core
      a *= 0.85 + 0.15 * smoothstep(0.3, 0.0, r);
      gl_FragColor = vec4(vColor, a);
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[Hero3D] Shader error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh); return null;
    }
    return sh;
  }
  function makeProgram(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[Hero3D] Program link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  const nebulaProg = makeProgram(nebulaVS, nebulaFS);
  const starProg = makeProgram(starVS, starFS);
  if (!nebulaProg || !starProg) return;

  // ---------- Fullscreen quad for nebula ----------
  const fsQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fsQuad);
  // big triangle (2D) for perfect fullscreen (or use quad triangle strip)
  const quad = new Float32Array([
    -1, -1,  3, -1,  -1, 3
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const nebulaPosLoc = gl.getAttribLocation(nebulaProg, 'aPos');

  const uRes = gl.getUniformLocation(nebulaProg, 'uRes');
  const uTime = gl.getUniformLocation(nebulaProg, 'uTime');
  const uRot = gl.getUniformLocation(nebulaProg, 'uRot');
  const uQuality = gl.getUniformLocation(nebulaProg, 'uQuality');

  // ---------- Stars geometry ----------
  function hsl2rgb(h, s, l) {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [r, g, b];
  }

  const STAR_COUNT_FAR  = isMobile ? 1800 : 3600;
  const STAR_COUNT_NEAR = isMobile ?  900 : 1800;

  function makeCloud(count, innerR, outerR, sizeMin, sizeMax, hueMin, hueMax){
    const positions = new Float32Array(count*3);
    const colors = new Float32Array(count*3);
    const sizes = new Float32Array(count);
    for (let i=0;i<count;i++){
      const u = Math.random();
      const r = innerR + Math.pow(u, 0.7) * (outerR - innerR);
      const theta = Math.random()*Math.PI*2;
      const v = Math.random()*2-1;
      const phi = Math.acos(v);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positions[i*3+0]=x; positions[i*3+1]=y; positions[i*3+2]=z;

      const h = hueMin + Math.random()*(hueMax-hueMin); // 0.58–0.70 purple-blue
      const s = 0.68;
      const l = 0.78 - Math.random()*0.25;
      const [rr,gg,bb] = hsl2rgb(h, s, l);
      colors[i*3+0]=rr; colors[i*3+1]=gg; colors[i*3+2]=bb;

      sizes[i] = sizeMin + Math.random()*(sizeMax-sizeMin);
    }
    return {positions, colors, sizes};
  }

  const far = makeCloud(STAR_COUNT_FAR, 450, 1400, isMobile?1.0:1.2, isMobile?1.8:2.2, 0.58, 0.70);
  const near = makeCloud(STAR_COUNT_NEAR, 140,  500, isMobile?1.6:2.0, isMobile?2.6:3.2, 0.58, 0.70);

  function makeBuf(data, loc, size){
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return buf;
  }

  const star_uMVP = gl.getUniformLocation(starProg, 'uMVP');
  const star_aPos = gl.getAttribLocation(starProg, 'position');
  const star_aCol = gl.getAttribLocation(starProg, 'color');
  const star_aSize= gl.getAttribLocation(starProg, 'size');

  function mat4Identity(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mat4Multiply(a,b){
    const o = new Array(16).fill(0);
    for(let r=0;r<4;r++) for(let c=0;c<4;c++)
      o[r*4+c]=a[r*4+0]*b[0*4+c]+a[r*4+1]*b[1*4+c]+a[r*4+2]*b[2*4+c]+a[r*4+3]*b[3*4+c];
    return o;
  }
  function mat4Perspective(fovy, aspect, near, far){
    const f = 1/Math.tan(fovy/2), nf=1/(near-far);
    return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];
  }
  function mat4Translate(m,x,y,z){
    const t=mat4Identity(); t[12]=x; t[13]=y; t[14]=z; return mat4Multiply(m,t);
  }
  function mat4RotateX(m,a){ const c=Math.cos(a),s=Math.sin(a);
    const r=[1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; return mat4Multiply(m,r); }
  function mat4RotateY(m,a){ const c=Math.cos(a),s=Math.sin(a);
    const r=[c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; return mat4Multiply(m,r); }

  // Resize
  function resize(){
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0,0,canvas.width, canvas.height);
  }
  const ro = new ResizeObserver(resize); ro.observe(hero); resize();

  // Parallax
  let tRX=0, tRY=0;
  function onPointerMove(e){
    const rect=hero.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x=(clientX-rect.left)/rect.width, y=(clientY-rect.top)/rect.height;
    tRY=(x-0.5)*0.16;
    tRX=(y-0.5)*-0.12;
  }
  hero.addEventListener('mousemove', onPointerMove, {passive:true});
  hero.addEventListener('touchmove', onPointerMove, {passive:true});

  let rx=0, ry=0, rot=0;

  function rotationMat3(rx, ry){
    const cx=Math.cos(rx), sx=Math.sin(rx);
    const cy=Math.cos(ry), sy=Math.sin(ry);
    // R = Ry * Rx
    return new Float32Array([
      cy,      sx*sy,   -cx*sy,
      0.0,     cx,       sx,
      sy,     -sx*cy,    cx*cy
    ]);
  }

  // Buffers for stars
  function bindStars(cloud){
    makeBuf(cloud.positions, star_aPos, 3);
    makeBuf(cloud.colors,   star_aCol, 3);
    makeBuf(cloud.sizes,    star_aSize,1);
  }

  // Render
  let t0 = performance.now();
  function frame(now){
    const dt = Math.min(33, now - t0); t0 = now;
    rx += (tRX - rx) * 0.05;
    ry += (tRY - ry) * 0.05;
    rot += 0.0002 * dt;

    // Clear
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ---------- NEBULA (background opaque for our layer) ----------
    gl.useProgram(nebulaProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, fsQuad);
    gl.enableVertexAttribArray(nebulaPosLoc);
    gl.vertexAttribPointer(nebulaPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, now*0.001);
    const rotNeb = rotationMat3(rx, ry + rot*0.5);
    gl.uniformMatrix3fv(uRot, false, rotNeb);
    gl.uniform1f(uQuality, isMobile ? 0.35 : 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---------- STARS (additive) ----------
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = mat4Perspective(60*Math.PI/180, aspect, 0.1, 3000);
    const view = mat4Translate(mat4RotateY(mat4RotateX(mat4Identity(), rx), ry + rot), 0, 0, -380);

    gl.useProgram(starProg);
    gl.uniformMatrix4fv(star_uMVP, false, new Float32Array(mat4Multiply(proj, view)));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    bindStars(far);
    gl.drawArrays(gl.POINTS, 0, far.sizes.length);

    bindStars(near);
    gl.drawArrays(gl.POINTS, 0, near.sizes.length);

    if (!prefersReduced) requestAnimationFrame(frame);
  }

  if (!prefersReduced) requestAnimationFrame(frame);
  else frame(performance.now());

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !prefersReduced) requestAnimationFrame(frame);
  });
})();
