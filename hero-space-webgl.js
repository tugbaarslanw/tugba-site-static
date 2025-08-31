/* Premium Galaxy Fly-Through (Perf-aware, Anti-Clump, Non-Symmetric)
   - Blue-noise (Poisson) XY dağılımı, swirl alanı: yapay simetri yok.
   - Fly-through: Z döngüsü + yakın planda yumuşatılmış büyüme (double-vision hissini azaltır).
   - Adaptif performans: FPS düşünce LOD↓ ve DPR↓; toparlayınca LOD↑ ve DPR↑.
   - Prefers-reduced-motion: tek kare statik.
*/

(function () {
  const hero =
    document.querySelector('[data-hero]') ||
    document.querySelector('header.hero') ||
    document.querySelector('#hero') ||
    document.querySelector('.hero');
  if (!hero) return;

  // ---------- Canvas ----------
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',
    pointerEvents: 'none'
  });
  canvas.setAttribute('aria-hidden', 'true');

  const cs = getComputedStyle(hero);
  if (cs.position === 'static') hero.style.position = 'relative';
  if (cs.overflow === 'visible') hero.style.overflow = 'hidden';
  const inner = hero.querySelector('.hero-inner');
  if (inner) hero.insertBefore(canvas, inner); else hero.appendChild(canvas);

  const gl = canvas.getContext('webgl', {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false
  });
  if (!gl) { console.warn('[Hero3D] WebGL not supported'); return; }

  const prefersReduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = matchMedia('(max-width: 768px)').matches;

  // ---------- Shaders ----------
  const VS = `
    attribute vec3 aPos;    // (x, y, z0)
    attribute vec3 aCol;    // renk
    attribute float aSize;  // baz boyut

    uniform mat4 uProj, uView;
    uniform float uTime, uSpeed, uZMin, uZRange, uSizeMax;

    varying vec3 vCol;
    varying float vFade;

    float pmod(float x, float y){ return x - y*floor(x/y); }

    void main(){
      // Z boyunca akış (fly-through)
      float z = pmod(aPos.z - uTime * uSpeed, uZRange) + uZMin;

      // Hafif, per-pixel olmayan "nefes" hareketi (çok az)
      float wob = sin( (aPos.x + aPos.y) * 0.015 + uTime * 0.5 ) * 0.6;
      vec4 eye = uView * vec4(aPos.xy + vec2(wob*0.15, -wob*0.12), z, 1.0);

      float depth = -eye.z;

      // Yakında aşırı büyümeyi sınırlayan non-linear atten
      float atten = mix(1.0, 190.0 / max(depth, 1.0), 0.55);
      float ps = clamp(aSize * atten, 0.9, uSizeMax);
      // Kamera çok yakınına gelenlerin kenar aliasing'ini azalt
      ps = mix(ps, min(ps, 3.5), smoothstep(14.0, 70.0, depth));

      gl_PointSize = ps;

      // Derinliğe göre yumuşak fade (yakın ve çok uzak kırpma)
      float nearF = smoothstep(uZMin + 10.0, uZMin + 80.0, depth);
      float farF  = 1.0 - smoothstep(uZMin + uZRange*0.92, uZMin + uZRange, depth);
      vFade = nearF * mix(1.0, 0.8, farF);

      // Paleti derinlikte camgöbeğine doğru çok hafif kaydır
      float t = clamp((depth - uZMin) / uZRange, 0.0, 1.0);
      vCol = mix(aCol, vec3(0.72, 0.86, 1.0), t*0.15);

      gl_Position = uProj * eye;
    }
  `;

  const FS = `
    precision mediump float;
    varying vec3 vCol;
    varying float vFade;
    uniform float uIntensity;

    void main(){
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float r = length(q);
      // Yumuşak çekirdekli "glow" disk
      float disk = smoothstep(1.0, 0.0, r);
      float core = smoothstep(0.30, 0.0, r);
      float alpha = (0.82 * disk + 0.18 * core) * vFade * uIntensity;
      gl_FragColor = vec4(vCol, alpha);
    }
  `;

  function makeShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[Hero3D] shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }
  function makeProgram(vsSrc, fsSrc){
    const p = gl.createProgram();
    const v = makeShader(gl.VERTEX_SHADER, vsSrc);
    const f = makeShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[Hero3D] program:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  const prog = makeProgram(VS, FS); if (!prog) return;
  gl.useProgram(prog);

  // ---------- Locations ----------
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

  // ---------- Utils ----------
  function hsl2rgb(h,s,l){
    const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6.)return p+(q-p)*6.*t; if(t<1/2.)return q; if(t<2/3.)return p+(q-p)*(2./3.-t)*6.; return p; };
    let r,g,b; if(s===0){ r=g=b=l; } else { const q=l<.5?l*(1+s):l+s-l*s, p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); }
    return [r,g,b];
  }

  // Poisson disk (Bridson) — daire içinde blue-noise örnekleme
  function poissonDisk(targetCount, minDist, R, k = 20){
    const cell = minDist / Math.SQRT2;
    const cols = Math.ceil((2*R) / cell);
    const rows = Math.ceil((2*R) / cell);
    const grid = new Array(cols * rows).fill(-1);
    const samples = [];
    const active = [];

    function idxOf(x,y){
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
          const gi = grid[yy*cols + xx];
          if(gi !== -1){
            const dx = x - samples[gi][0];
            const dy = y - samples[gi][1];
            if (dx*dx + dy*dy < minDist*minDist) return false;
          }
        }
      }
      return true;
    }
    function add(x,y){ samples.push([x,y]); active.push([x,y]); grid[idxOf(x,y)] = samples.length - 1; }

    // merkezden yakın bir tohum
    const t0 = Math.random()*Math.PI*2;
    add(Math.cos(t0)*R*0.2, Math.sin(t0)*R*0.2);

    while(active.length && samples.length < targetCount){
      const pick = (Math.random()*active.length)|0;
      const [ax, ay] = active[pick];
      let placed = false;
      for(let i=0;i<k;i++){
        const ang = Math.random()*Math.PI*2;
        const rad = minDist*(1.0 + Math.random());
        const x = ax + Math.cos(ang)*rad;
        const y = ay + Math.sin(ang)*rad;
        if (inCircle(x,y) && farEnough(x,y)){ add(x,y); placed = true; if(samples.length>=targetCount)break; }
      }
      if(!placed) active.splice(pick,1);
    }
    return samples;
  }

  function gaussian(mu=0, sigma=1){
    const u1 = Math.random(); const u2 = Math.random();
    const z0 = Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
    return mu + z0*sigma;
  }
  function rotate(x,y,ang){ const c=Math.cos(ang), s=Math.sin(ang); return [x*c - y*s, x*s + y*c]; }

  // ---------- Field Params ----------
  const XY_RADIUS = 180.0;
  const Z_MIN = 60.0, Z_MAX = 900.0, Z_RANGE = Z_MAX - Z_MIN;

  // Ekran yoğunluğu / hız
  const SIZE_MAX_STARS = isMobile ? 4.0 : 5.0;
  const SIZE_MAX_DUST  = isMobile ? 3.0 : 4.0;

  const SPEED_STARS = isMobile ? 16.0 : 22.0;
  const SPEED_DUST  = isMobile ? 9.0  : 14.0;

  const N_STARS = isMobile ? 800 : 1500;
  const N_DUST  = isMobile ? 1200: 2000;

  // Blue-noise minimum komşu mesafesi (ekranda çakışmayı azaltır)
  let MIN_DIST_STARS = isMobile ? 3.0 : 3.2;
  let MIN_DIST_DUST  = isMobile ? 2.2 : 2.6;

  // Hedefe ulaşamazsa minDist'i biraz gevşet
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

  // ---------- Generate STARS ----------
  const stars_xy = samplesFor(N_STARS, MIN_DIST_STARS, XY_RADIUS);
  const stars_pos = new Float32Array(N_STARS*3);
  const stars_col = new Float32Array(N_STARS*3);
  const stars_size= new Float32Array(N_STARS);
  for(let i=0;i<N_STARS;i++){
    const [x0,y0] = stars_xy[i] || [ (Math.random()*2-1)*XY_RADIUS, (Math.random()*2-1)*XY_RADIUS ];
    // Hafif yönlü jitter (simetrik hissi kırar)
    const angJ = (Math.random()-0.5)*0.25;
    const radJ = (Math.random()-0.5)*1.2;
    const [xJ,yJ] = rotate(x0 + radJ, y0 + radJ*0.4, angJ);

    const z0 = Z_MIN + Math.random()*Z_RANGE;
    stars_pos[i*3+0]=xJ; stars_pos[i*3+1]=yJ; stars_pos[i*3+2]=z0;

    // Premium palet: mor → mavi → camgöbeği
    const h = 0.68 + gaussian(0, 0.05) - Math.random()*0.08; // ~0.58–0.75
    const s = 0.70;
    const l = 0.62 + Math.random()*0.18;
    const [r,g,b]=hsl2rgb(Math.max(0,Math.min(1,h)), s, Math.min(1,l));
    stars_col[i*3+0]=r; stars_col[i*3+1]=g; stars_col[i*3+2]=b;

    stars_size[i]= (isMobile?1.1:1.6) + Math.abs(gaussian(0, isMobile?0.35:0.55));
  }

  // ---------- Generate DUST (blue-noise + swirl) ----------
  const dust_xy = samplesFor(N_DUST, MIN_DIST_DUST, XY_RADIUS);
  const dust_pos = new Float32Array(N_DUST*3);
  const dust_col = new Float32Array(N_DUST*3);
  const dust_size= new Float32Array(N_DUST);

  const swirlK = 2.0 + Math.random()*1.0;  // kıvrım gücü
  const globalRot = Math.random()*Math.PI*2; // tüm alanın yönelimi

  for(let i=0;i<N_DUST;i++){
    let [x,y] = dust_xy[i] || [ (Math.random()*2-1)*XY_RADIUS, (Math.random()*2-1)*XY_RADIUS ];
    [x,y] = rotate(x,y, globalRot);
    const r = Math.hypot(x,y);
    const phi = swirlK * Math.log(1.0 + r*0.035) + (Math.random()-0.5)*0.30;
    [x,y] = rotate(x,y, phi);

    const z0 = Z_MIN + Math.random()*Z_RANGE;
    dust_pos[i*3+0]=x; dust_pos[i*3+1]=y; dust_pos[i*3+2]=z0;

    const h = 0.72 - Math.random()*0.14;
    const s = 0.55, l = 0.70 + Math.random()*0.20;
    const [rR,rG,rB]=hsl2rgb(h,s,l);
    dust_col[i*3+0]=rR; dust_col[i*3+1]=rG; dust_col[i*3+2]=rB;

    dust_size[i]= (isMobile?0.9:1.0) + Math.abs(gaussian(0, isMobile?0.45:0.65));
  }

  // ---------- Buffers & LOD ----------
  function makeBuf(data, loc, comps){
    const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0); return b;
  }
  function thinArray(src, factor){ // factor=2 -> yarı yoğunluk
    if (factor<=1) return src;
    if (src instanceof Float32Array){
      const comps = (src.length % 3 === 0) ? 3 : 1; // pos/col=3, size=1
      const count = Math.floor((src.length / comps) / factor);
      const out = new Float32Array(count * comps);
      let oi=0;
      for(let i=0;i<count;i++){
        const si = i*factor*comps;
        for(let c=0;c<comps;c++) out[oi++] = src[si+c];
      }
      return out;
    }
    return src;
  }

  const stars_pos_hi = stars_pos,   stars_col_hi = stars_col,   stars_siz_hi = stars_size;
  const dust_pos_hi  = dust_pos,    dust_col_hi  = dust_col,    dust_siz_hi  = dust_size;

  const stars_pos_lo = thinArray(stars_pos_hi, 2);
  const stars_col_lo = thinArray(stars_col_hi, 2);
  const stars_siz_lo = thinArray(stars_siz_hi, 2);

  const dust_pos_lo  = thinArray(dust_pos_hi,  2);
  const dust_col_lo  = thinArray(dust_col_hi,  2);
  const dust_siz_lo  = thinArray(dust_siz_hi,  2);

  let LOD_HIGH = true;

  function bindCloud(pos, col, siz){
    const bPos = makeBuf(pos, aPos, 3);
    const bCol = makeBuf(col, aCol, 3);
    const bSiz = makeBuf(siz, aSize, 1);
    return { bPos, bCol, bSiz, count: siz.length };
  }

  // Başlangıç: yüksek LOD
  let dustBuf = bindCloud(dust_pos_hi, dust_col_hi, dust_siz_hi);
  let starBuf = bindCloud(stars_pos_hi, stars_col_hi, stars_siz_hi);

  function switchLOD(high){
    if (LOD_HIGH === high) return;
    LOD_HIGH = high;
    // Yeni bufferlara geç
    dustBuf = high ? bindCloud(dust_pos_hi, dust_col_hi, dust_siz_hi)
                   : bindCloud(dust_pos_lo, dust_col_lo, dust_siz_lo);
    starBuf = high ? bindCloud(stars_pos_hi, stars_col_hi, stars_siz_hi)
                   : bindCloud(stars_pos_lo, stars_col_lo, stars_siz_lo);
  }

  // ---------- Matrices ----------
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

  // ---------- Resize & DPR ----------
  let DPR_CAP = 1.75; // iyi makinelerde 1.75'e kadar
  function resize(){
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio||1, DPR_CAP);
    canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero); resize();

  // ---------- Parallax ----------
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

  // ---------- GL State ----------
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0,0,0,0);

  // ---------- Render & Perf Adapt ----------
  const t0 = performance.now();
  let lastFpsCheck = t0, frames = 0, avgFps = 60;

  function draw(now){
    const sec=(now - t0)/1000;

    // FPS ölçümü
    frames++;
    if (now - lastFpsCheck > 1000){
      avgFps = frames * 1000 / (now - lastFpsCheck);
      frames = 0; lastFpsCheck = now;

      // Adaptif LOD ve DPR
      if (avgFps < 48){
        switchLOD(false);          // Low LOD
        DPR_CAP = 1.25;            // DPR kıs
        resize();
      } else if (avgFps > 56 && !prefersReduced){
        switchLOD(true);           // High LOD
        DPR_CAP = 1.75;            // DPR yükselt
        resize();
      }
    }

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

    // DUST (arka katman)
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.bPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.bCol); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aCol);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.bSiz); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aSize);
    gl.uniform1f(uSpeed, SPEED_DUST);
    gl.uniform1f(uSizeMax, SIZE_MAX_DUST);
    gl.uniform1f(uIntensity, 0.85);
    gl.drawArrays(gl.POINTS, 0, dustBuf.count);

    // STARS (ön)
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf.bPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf.bCol); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf.bSiz); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0);
    gl.uniform1f(uSpeed, SPEED_STARS);
    gl.uniform1f(uSizeMax, SIZE_MAX_STARS);
    gl.uniform1f(uIntensity, 1.0);
    gl.drawArrays(gl.POINTS, 0, starBuf.count);

    if(!prefersReduced) requestAnimationFrame(draw);
  }

  if(!prefersReduced) requestAnimationFrame(draw); else {
    // Statik kare
    const now = performance.now();
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = mat4Perspective(60*Math.PI/180, aspect, 0.1, 5000);
    let view = mat4Identity();
    view = mat4Translate(view, 0, 0, -320);
    gl.uniformMatrix4fv(uProj,false,new Float32Array(proj));
    gl.uniformMatrix4fv(uView,false,new Float32Array(view));
    gl.uniform1f(uZMin, Z_MIN);
    gl.uniform1f(uZRange, Z_RANGE);
    gl.uniform1f(uTime, (now - t0)/1000);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.bPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.bCol); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aCol);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf.bSiz); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aSize);
    gl.uniform1f(uSpeed, 0.0); gl.uniform1f(uSizeMax, SIZE_MAX_DUST); gl.uniform1f(uIntensity, 0.85);
    gl.drawArrays(gl.POINTS, 0, dustBuf.count);

    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf.bPos); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf.bCol); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf.bSiz); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0);
    gl.uniform1f(uSpeed, 0.0); gl.uniform1f(uSizeMax, SIZE_MAX_STARS); gl.uniform1f(uIntensity, 1.0);
    gl.drawArrays(gl.POINTS, 0, starBuf.count);
  }

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && !prefersReduced) requestAnimationFrame(draw);
  });
})();
