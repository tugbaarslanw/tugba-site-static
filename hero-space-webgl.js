/* Premium Galaxy Fly-Through — performance tuned
   - WebGL başarılıysa: CSS arka plan katmanlarını (nebula, stars, twinkles, meteor, spot) otomatik gizler.
   - Wave SVG yerinde kalır (görsel geçiş korunur).
   - IntersectionObserver ile ekrandan çıkınca durur, görünür olunca devam eder.
   - prefers-reduced-motion'a saygı duyar.
   - Blue-noise (poisson) dağılım: çakışma ve simetri hissi yok.
*/

(function () {
  // ---- Target hero ----
  const hero =
    document.querySelector('[data-hero]') ||
    document.querySelector('header.hero') ||
    document.querySelector('#hero') ||
    document.querySelector('.hero');
  if (!hero) return;

  // ---- Canvas ----
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'none'
  });
  canvas.setAttribute('aria-hidden', 'true');

  const cs = getComputedStyle(hero);
  if (cs.position === 'static') hero.style.position = 'relative';
  if (cs.overflow === 'visible') hero.style.overflow = 'hidden';
  const inner = hero.querySelector('.hero-inner');
  if (inner) hero.insertBefore(canvas, inner); else hero.appendChild(canvas);

  // ---- WebGL ----
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  const prefersReduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!gl) { /* WebGL yoksa CSS arka plan devam etsin */ return; }

  // ---- CSS arka plan katmanlarını WebGL aktifken yumuşakça gizle ----
  const cssBgNodes = hero.querySelectorAll('.nebula-sky, .stars, .twinkles, .meteor, .hero-spot');
  function quietCssBackground() {
    cssBgNodes.forEach(el => {
      el.style.transition = 'opacity .35s ease';
      el.style.opacity = '0';
      // CPU tüketimini azaltmak için CSS animasyonlarını da durdur
      el.style.animation = 'none';
    });
  }
  function restoreCssBackground() {
    cssBgNodes.forEach(el => {
      el.style.opacity = '';
      el.style.animation = '';
      el.style.transition = '';
    });
  }

  // ---- Shaders ----
  const vs = `
    attribute vec3 aPos;
    attribute vec3 aCol;
    attribute float aSize;

    uniform mat4 uProj, uView;
    uniform float uTime, uSpeed, uZMin, uZRange, uSizeMax;

    varying vec3 vCol;
    varying float vFade;

    float pmod(float x, float y){ return x - y*floor(x/y); }

    void main(){
      float z = pmod(aPos.z - uTime * uSpeed, uZRange) + uZMin;
      vec4 eye = uView * vec4(aPos.xy, z, 1.0);
      float depth = -eye.z;

      float atten = mix(1.0, 220.0 / depth, 0.55);
      float ps = clamp(aSize * atten, 0.8, uSizeMax);
      gl_PointSize = ps;

      float nearF = smoothstep(uZMin + 12.0, uZMin + 70.0, depth);
      float farF  = 1.0 - smoothstep(uZMin + uZRange*0.90, uZMin + uZRange, depth);
      vFade = nearF * mix(1.0, 0.85, farF);

      float t = clamp((depth - uZMin) / uZRange, 0.0, 1.0);
      vCol = mix(aCol, vec3(0.72, 0.86, 1.0), t*0.18);

      gl_Position = uProj * eye;
    }
  `;
  const fs = `
    precision mediump float;
    varying vec3 vCol;
    varying float vFade;
    uniform float uIntensity;

    void main(){
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float r = length(q);
      float disk = smoothstep(1.0, 0.0, r);
      float core = smoothstep(0.30, 0.0, r);
      float alpha = (0.82 * disk + 0.18 * core) * vFade * uIntensity;
      gl_FragColor = vec4(vCol, alpha);
    }
  `;
  function shader(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ console.error(gl.getShaderInfoLog(s)); return null; } return s; }
  function program(vsSrc, fsSrc){
    const p=gl.createProgram(), v=shader(gl.VERTEX_SHADER,vsSrc), f=shader(gl.FRAGMENT_SHADER,fsSrc);
    if(!v||!f) return null; gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.linkStatus || 0)){} // noop for older browsers
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(p)); return null; } return p;
  }
  const prog = program(vs, fs); if (!prog) { restoreCssBackground(); return; }
  gl.useProgram(prog);

  // ---- Locations ----
  const aPos   = gl.getAttribLocation (prog, 'aPos');
  const aCol   = gl.getAttribLocation (prog, 'aCol');
  const aSize  = gl.getAttribLocation (prog, 'aSize');
  const uProj  = gl.getUniformLocation(prog, 'uProj');
  const uView  = gl.getUniformLocation(prog, 'uView');
  const uTime  = gl.getUniformLocation(prog, 'uTime');
  const uSpeed = gl.getUniformLocation(prog, 'uSpeed');
  const uZMin  = gl.getUniformLocation(prog, 'uZMin');
  const uZRange= gl.getUniformLocation(prog, 'uZRange');
  const uSizeMax=gl.getUniformLocation(prog, 'uSizeMax');
  const uIntensity=gl.getUniformLocation(prog, 'uIntensity');

  // ---- Helpers ----
  const isMobile = matchMedia('(max-width: 768px)').matches;
  function hsl2rgb(h,s,l){
    const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    let r,g,b; if(s===0){ r=g=b=l; } else { const q=l<.5?l*(1+s):l+s-l*s, p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); }
    return [r,g,b];
  }
  function poissonDisk(targetCount, minDist, R, k = 20){
    const cell = minDist / Math.SQRT2;
    const cols = Math.ceil((2*R) / cell);
    const rows = Math.ceil((2*R) / cell);
    const grid = new Array(cols * rows).fill(-1);
    const samples = [];
    const active = [];
    function gridIndex(x, y){
      const gx = Math.floor((x + R) / cell);
      const gy = Math.floor((y + R) / cell);
      return gy * cols + gx;
    }
    function inCircle(x,y){ return (x*x + y*y) <= R*R; }
    function farEnough(x,y){
      const gx = Math.floor((x + R) / cell);
      const gy = Math.floor((y + R) / cell);
      for(let yy = Math.max(0, gy-2); yy <= Math.min(rows-1, gy+2); yy++){
        for(let xx = Math.max(0, gx-2); xx <= Math.min(cols-1, gx+2); xx++){
          const idx = grid[yy*cols + xx];
          if(idx !== -1){
            const dx = x - samples[idx][0];
            const dy = y - samples[idx][1];
            if (dx*dx + dy*dy < minDist*minDist) return false;
          }
        }
      }
      return true;
    }
    function addSample(x,y){
      samples.push([x,y]); active.push([x,y]); grid[gridIndex(x,y)] = samples.length - 1;
    }
    const theta0 = Math.random()*Math.PI*2;
    addSample(Math.cos(theta0)*R*0.2, Math.sin(theta0)*R*0.2);
    while(active.length && samples.length < targetCount){
      const idx = (Math.random()*active.length)|0;
      const [ax, ay] = active[idx];
      let placed = false;
      for(let i=0;i<k;i++){
        const ang = Math.random()*Math.PI*2;
        const rad = minDist*(1.0 + Math.random());
        const x = ax + Math.cos(ang)*rad;
        const y = ay + Math.sin(ang)*rad;
        if (inCircle(x,y) && farEnough(x,y)){ addSample(x,y); placed = true; if (samples.length >= targetCount) break; }
      }
      if(!placed) active.splice(idx,1);
    }
    return samples;
  }
  function gaussian(mu=0, sigma=1){
    const u1 = Math.random(); const u2 = Math.random();
    const z0 = Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
    return mu + z0*sigma;
  }

  // ---- Field params ----
  const XY_RADIUS = 180.0;
  const Z_MIN = 60.0, Z_MAX = 900.0, Z_RANGE = Z_MAX - Z_MIN;

  const SIZE_MAX_STARS = isMobile ? 4.0 : 5.2;
  const SIZE_MAX_DUST  = isMobile ? 3.0 : 4.0;

  const SPEED_STARS = isMobile ? 18.0 : 26.0;
  const SPEED_DUST  = isMobile ? 10.0 : 15.0;

  const N_STARS = isMobile ? 900 : 1600;
  const N_DUST  = isMobile ? 1400: 2200;

  let MIN_DIST_STARS = isMobile ? 3.0 : 3.2;
  let MIN_DIST_DUST  = isMobile ? 2.2 : 2.6;

  function samplesFor(target, minDist, R){
    let s = poissonDisk(target, minDist, R);
    let tries = 0;
    while(s.length < target && tries < 3){
      minDist *= 0.9;
      s = poissonDisk(target, minDist, R);
      tries++;
    }
    return s;
  }

  // ---- Generate STARS ----
  const stars_xy = samplesFor(N_STARS, MIN_DIST_STARS, XY_RADIUS);
  const stars_pos = new Float32Array(N_STARS*3);
  const stars_col = new Float32Array(N_STARS*3);
  const stars_size= new Float32Array(N_STARS);
  for(let i=0;i<N_STARS;i++){
    const [x,y] = stars_xy[i] || [ (Math.random()*2-1)*XY_RADIUS, (Math.random()*2-1)*XY_RADIUS ];
    const z0 = Z_MIN + Math.random()*Z_RANGE;
    stars_pos[i*3+0]=x; stars_pos[i*3+1]=y; stars_pos[i*3+2]=z0;

    const h = 0.70 + gaussian(0, 0.06) - Math.random()*0.12;
    const s = 0.70;
    const l = 0.64 + Math.random()*0.20;
    const [rR,rG,rB]=hsl2rgb(Math.max(0,Math.min(1,h)), s, Math.min(1,l));
    stars_col[i*3+0]=rR; stars_col[i*3+1]=rG; stars_col[i*3+2]=rB;

    stars_size[i]= (isMobile?1.2:1.6) + Math.abs(gaussian(0, isMobile?0.4:0.6));
  }

  // ---- Generate DUST (swirl + blue-noise) ----
  const dust_xy = samplesFor(N_DUST, MIN_DIST_DUST, XY_RADIUS);
  const dust_pos = new Float32Array(N_DUST*3);
  const dust_col = new Float32Array(N_DUST*3);
  const dust_size= new Float32Array(N_DUST);

  const swirlK = 2.0 + Math.random()*1.0;
  const globalRot = Math.random()*Math.PI*2;
  function rotate(x,y,ang){ const c=Math.cos(ang), s=Math.sin(ang); return [x*c - y*s, x*s + y*c]; }

  for(let i=0;i<N_DUST;i++){
    let [x,y] = dust_xy[i] || [ (Math.random()*2-1)*XY_RADIUS, (Math.random()*2-1)*XY_RADIUS ];
    [x,y] = rotate(x,y, globalRot);
    const r = Math.hypot(x,y);
    const phi = swirlK * Math.log(1.0 + r*0.035) + (Math.random()-0.5)*0.30;
    [x,y] = rotate(x,y, phi);

    const z0 = Z_MIN + Math.random()*Z_RANGE;
    dust_pos[i*3+0]=x; dust_pos[i*3+1]=y; dust_pos[i*3+2]=z0;

    const h = 0.72 - Math.random()*0.14;
    const s = 0.55, l = 0.72 + Math.random()*0.20;
    const [rR,rB_,rG_] = hsl2rgb(h,s,l); // sıraya dikkat
    dust_col[i*3+0]=rR; dust_col[i*3+1]=rB_; dust_col[i*3+2]=rG_;

    dust_size[i]= (isMobile?0.9:1.0) + Math.abs(gaussian(0, isMobile?0.5:0.7));
  }

  // ---- Buffers ----
  function makeBuf(data, loc, comps){
    const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0); return b;
  }
  const stars_posBuf = makeBuf(stars_pos, aPos, 3);
  const stars_colBuf = makeBuf(stars_col, aCol, 3);
  const stars_sizBuf = makeBuf(stars_size,aSize,1);

  const dust_posBuf  = makeBuf(dust_pos,  aPos, 3);
  const dust_colBuf  = makeBuf(dust_col,  aCol, 3);
  const dust_sizBuf  = makeBuf(dust_size, aSize,1);

  // ---- Matrices & DPR ----
  function mat4Identity(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mat4Multiply(a,b){ const o=new Array(16).fill(0);
    for(let r=0;r<4;r++) for(let c=0;c<4;c++)
      o[r*4+c]=a[r*4+0]*b[0*4+c]+a[r*4+1]*b[1*4+c]+a[r*4+2]*b[2*4+c]+a[r*4+3]*b[3*4+c];
    return o;
  }
  function mat4Perspective(fovy, aspect, near, far){
    const f=1/Math.tan(fovy/2), nf=1/(near-far);
    return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];
  }
  function mat4Translate(m,x,y,z){ const t=mat4Identity(); t[12]=x; t[13]=y; t[14]=z; return mat4Multiply(m,t); }
  function mat4RotateX(m,a){ const c=Math.cos(a),s=Math.sin(a); const r=[1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; return mat4Multiply(m,r); }
  function mat4RotateY(m,a){ const c=Math.cos(a),s=Math.sin(a); const r=[c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; return mat4Multiply(m,r); }

  // Ekran çözünürlüğünü biraz kısıtla (performans)
  function currentDPR(){ return Math.min(window.devicePixelRatio || 1, 1.75); }

  function resize(){
    const rect = hero.getBoundingClientRect();
    const dpr = currentDPR();
    const w = Math.max(1, Math.floor(rect.width  * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h){
      canvas.width  = w;
      canvas.height = h;
      gl.viewport(0,0,w,h);
    }
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero);
  window.addEventListener('resize', resize, { passive:true });
  resize();

  // ---- Pointer parallax (low) ----
  let tRX=0, tRY=0;
  function onPointerMove(e){
    const rect=hero.getBoundingClientRect();
    const cx = e.touches?e.touches[0].clientX:e.clientX;
    const cy = e.touches?e.touches[0].clientY:e.clientY;
    const x=(cx-rect.left)/rect.width, y=(cy-rect.top)/rect.height;
    tRY = (x-0.5)*0.08;
    tRX = (y-0.5)*-0.06;
  }
  hero.addEventListener('mousemove',onPointerMove,{passive:true});
  hero.addEventListener('touchmove',onPointerMove,{passive:true});
  let rx=0, ry=0, auto=0;

  // ---- Render loop ----
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0,0,0,0);

  const t0 = performance.now();
  let rafId = null;
  function draw(now){
    const sec=(now - t0)/1000;
    rx += (tRX - rx)*0.06;
    ry += (tRY - ry)*0.06;
    auto += 0.002;

    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = mat4Perspective(60*Math.PI/180, aspect, 0.1, 5000);
    let view = mat4Identity();
    view = mat4Translate(view, 0, 0, -320);
    view = mat4RotateX(view, rx*0.9);
    view = mat4RotateY(view, ry + auto);

    gl.uniformMatrix4fv(uProj,false,new Float32Array(proj));
    gl.uniformMatrix4fv(uView,false,new Float32Array(view));
    gl.uniform1f(uZMin, Z_MIN);
    gl.uniform1f(uZRange, Z_RANGE);
    gl.uniform1f(uTime, sec);

    // DUST
    gl.bindBuffer(gl.ARRAY_BUFFER, dust_posBuf); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, dust_colBuf); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aCol);
    gl.bindBuffer(gl.ARRAY_BUFFER, dust_sizBuf); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aSize);
    gl.uniform1f(uSpeed, SPEED_DUST);
    gl.uniform1f(uSizeMax, SIZE_MAX_DUST);
    gl.uniform1f(uIntensity, 0.85);
    gl.drawArrays(gl.POINTS, 0, N_DUST);

    // STARS
    gl.bindBuffer(gl.ARRAY_BUFFER, stars_posBuf); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, stars_colBuf); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, stars_sizBuf); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0);
    gl.uniform1f(uSpeed, SPEED_STARS);
    gl.uniform1f(uSizeMax, SIZE_MAX_STARS);
    gl.uniform1f(uIntensity, 1.0);
    gl.drawArrays(gl.POINTS, 0, N_STARS);

    if (!prefersReduced) rafId = requestAnimationFrame(draw);
  }

  function startRAF(){ if (!rafId && !prefersReduced) rafId = requestAnimationFrame(draw); }
  function stopRAF(){ if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }

  // ---- Görünürlük yönetimi ----
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRAF(); else startRAF();
  });

  if ('IntersectionObserver' in window){
    const io = new IntersectionObserver(entries=>{
      const e = entries[0];
      if (e && e.isIntersecting && e.intersectionRatio > 0.1) startRAF();
      else stopRAF();
    }, { threshold:[0, 0.1, 0.2] });
    io.observe(hero);
  }

  // ---- Context olayları ----
  canvas.addEventListener('webglcontextlost', (e)=>{ e.preventDefault(); stopRAF(); restoreCssBackground(); }, false);
  canvas.addEventListener('webglcontextrestored', ()=>{ quietCssBackground(); startRAF(); }, false);

  // ---- Başlat ----
  quietCssBackground();
  if (!prefersReduced) startRAF(); else { // azaltılmış hareket: tek kare
    const now = performance.now(); draw(now);
  }
})();
