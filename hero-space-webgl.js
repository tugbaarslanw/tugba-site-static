/* Premium Galaxy Fly-Through — tuned for comfort/performance
   - Yıldızlar/dust sana doğru akıyor (fly-through), parallax çok hafif.
   - "Üst üste ayrılma" hissini azaltmak için: düşük parallax, sınırlı boyut,
     yakın mesafede yumuşak fade, iki ayrı katman (STARS + DUST) tek programla.
   - Buffer'lar tek sefer oluşturulur (yüksek FPS). Başka hiçbir şeye dokunmaz.
*/

(function () {
  const hero =
    document.querySelector('[data-hero]') ||
    document.querySelector('header.hero') ||
    document.querySelector('#hero') ||
    document.querySelector('.hero');
  if (!hero) return;

  // Canvas katman: .hero-bg (0) üstünde, .hero-inner (2) altında.
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

  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { console.warn('[Hero3D] WebGL not supported'); return; }

  const prefersReduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = matchMedia('(max-width: 768px)').matches;

  // ---------- Shaders ----------
  const vs = `
    attribute vec3 aPos;    // (x,y,z0)
    attribute vec3 aCol;    // renk
    attribute float aSize;  // baz boyut

    uniform mat4 uProj, uView;
    uniform float uTime, uSpeed, uZMin, uZRange, uSizeMax;

    varying vec3 vCol;
    varying float vFade;

    float pmod(float x, float y){ return x - y*floor(x/y); }

    void main(){
      float z = pmod(aPos.z - uTime * uSpeed, uZRange) + uZMin;

      vec4 eye = uView * vec4(aPos.xy, z, 1.0);
      float depth = -eye.z; // > 0

      // Boyut attenuasyonu: aşırı büyümeyi engelle
      float atten = mix(1.0, 220.0 / depth, 0.55);
      float ps = clamp(aSize * atten, 0.8, uSizeMax);
      gl_PointSize = ps;

      // Yakında yumuşak fade; çok uzakta hafif fade
      float nearF = smoothstep(uZMin + 12.0, uZMin + 70.0, depth);
      float farF  = 1.0 - smoothstep(uZMin + uZRange*0.90, uZMin + uZRange, depth);
      vFade = nearF * mix(1.0, 0.85, farF);

      // Derinliğe göre çok hafif cyan kaydırma (premium hissi)
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
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(p)); return null; } return p;
  }

  const prog = program(vs, fs); if (!prog) return;
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

  // ---------- Helpers ----------
  function hsl2rgb(h,s,l){
    const hue2rgb=(p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    let r,g,b; if(s===0){ r=g=b=l; } else { const q=l<.5?l*(1+s):l+s-l*s, p=2*l-q; r=hue2rgb(p,q,h+1/3); g=hue2rgb(p,q,h); b=hue2rgb(p,q,h-1/3); }
    return [r,g,b];
  }
  function makeBuf(data, loc, comps){
    const b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0); return b;
  }

  // ---------- Field params ----------
  const XY_RADIUS = 180.0;
  const Z_MIN = 60.0, Z_MAX = 900.0, Z_RANGE = Z_MAX - Z_MIN;

  // Boyut tavanı (göz yormasın)
  const SIZE_MAX_STARS = isMobile ? 4.0 : 5.5;
  const SIZE_MAX_DUST  = isMobile ? 3.0 : 4.0;

  // Hızlar (yakınlaşma etkisi)
  const SPEED_STARS = isMobile ? 18.0 : 26.0;
  const SPEED_DUST  = isMobile ? 10.0 : 15.0;

  // Sayılar (performans dostu)
  const N_STARS = isMobile ? 900 : 1600;
  const N_DUST  = isMobile ? 1400: 2200;

  // ---------- Generate STARS (rasgele bulut) ----------
  const stars_pos = new Float32Array(N_STARS*3);
  const stars_col = new Float32Array(N_STARS*3);
  const stars_size= new Float32Array(N_STARS);
  for(let i=0;i<N_STARS;i++){
    const u = Math.random();                    // merkezde daha yoğun
    const r = Math.sqrt(u) * XY_RADIUS;
    const th= Math.random()*Math.PI*2;
    const x = r * Math.cos(th), y = r * Math.sin(th);
    const z0= Z_MIN + Math.random()*Z_RANGE;

    stars_pos[i*3+0]=x; stars_pos[i*3+1]=y; stars_pos[i*3+2]=z0;

    const h = 0.70 - Math.random()*0.16; // mor-mavi aralığı
    const s = 0.70, l = 0.62 + Math.random()*0.22;
    const [rR,rG,rB]=hsl2rgb(h,s,l);
    stars_col[i*3+0]=rR; stars_col[i*3+1]=rG; stars_col[i*3+2]=rB;

    stars_size[i]= (isMobile?1.2:1.6) + Math.random()*(isMobile?1.4:2.2);
  }

  // ---------- Generate DUST (spiral galaksi tozu) ----------
  const arms = 3, spiralK = 2.2; // kol sayısı & kıvrım
  const dust_pos = new Float32Array(N_DUST*3);
  const dust_col = new Float32Array(N_DUST*3);
  const dust_size= new Float32Array(N_DUST);
  for(let i=0;i<N_DUST;i++){
    const arm = i % arms;
    const baseAngle = (arm / arms) * (Math.PI*2);
    const rr = Math.pow(Math.random(), 0.72) * XY_RADIUS;         // merkez yoğun
    const theta = baseAngle + spiralK * Math.log(1.0 + rr*0.03) + (Math.random()-0.5)*0.55; // kol genişliği
    const x = rr * Math.cos(theta);
    const y = rr * Math.sin(theta);
    const z0= Z_MIN + Math.random()*Z_RANGE;

    dust_pos[i*3+0]=x; dust_pos[i*3+1]=y; dust_pos[i*3+2]=z0;

    // tozlar daha yumuşak, açık renk
    const h = 0.72 - Math.random()*0.14;
    const s = 0.55, l = 0.72 + Math.random()*0.20;
    const [rR,rG,rB]=hsl2rgb(h,s,l);
    dust_col[i*3+0]=rR; dust_col[i*3+1]=rG; dust_col[i*3+2]=rB;

    dust_size[i]= (isMobile?0.9:1.0) + Math.random()*(isMobile?1.2:1.6);
  }

  // ---------- Buffers (tek sefer) ----------
  const stars_posBuf = makeBuf(stars_pos, aPos, 3);
  const stars_colBuf = makeBuf(stars_col, aCol, 3);
  const stars_sizBuf = makeBuf(stars_size,aSize,1);

  const dust_posBuf  = makeBuf(dust_pos,  aPos, 3);
  const dust_colBuf  = makeBuf(dust_col,  aCol, 3);
  const dust_sizBuf  = makeBuf(dust_size, aSize,1);

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

  // ---------- Resize ----------
  function resize(){
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero); resize();

  // ---------- Parallax (düşük yoğunluk) ----------
  let tRX=0, tRY=0; // hedef
  function onPointerMove(e){
    const rect=hero.getBoundingClientRect();
    const cx = e.touches?e.touches[0].clientX:e.clientX;
    const cy = e.touches?e.touches[0].clientY:e.clientY;
    const x=(cx-rect.left)/rect.width, y=(cy-rect.top)/rect.height;
    tRY = (x-0.5)*0.10;     // önceki sürümden daha düşük
    tRX = (y-0.5)*-0.07;
  }
  hero.addEventListener('mousemove',onPointerMove,{passive:true});
  hero.addEventListener('touchmove',onPointerMove,{passive:true});
  let rx=0, ry=0, auto=0;

  // ---------- Render ----------
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0,0,0,0);

  const t0 = performance.now();
  function draw(now){
    const sec=(now - t0)/1000;
    rx += (tRX - rx)*0.06;
    ry += (tRY - ry)*0.06;
    auto += 0.002; // ultra düşük oto-rotate (göz yormaz)

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

    // DUST (önce) — daha düşük hız, daha küçük boyut, düşük yoğunluk
    gl.bindBuffer(gl.ARRAY_BUFFER, dust_posBuf); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, dust_colBuf); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aCol);
    gl.bindBuffer(gl.ARRAY_BUFFER, dust_sizBuf); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0); gl.enableVertexAttribArray(aSize);
    gl.uniform1f(uSpeed, SPEED_DUST);
    gl.uniform1f(uSizeMax, SIZE_MAX_DUST);
    gl.uniform1f(uIntensity, 0.85); // daha soft
    gl.drawArrays(gl.POINTS, 0, N_DUST);

    // STARS — biraz daha hızlı, biraz daha parlak
    gl.bindBuffer(gl.ARRAY_BUFFER, stars_posBuf); gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, stars_colBuf); gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, stars_sizBuf); gl.vertexAttribPointer(aSize,1,gl.FLOAT,false,0,0);
    gl.uniform1f(uSpeed, SPEED_STARS);
    gl.uniform1f(uSizeMax, SIZE_MAX_STARS);
    gl.uniform1f(uIntensity, 1.0);
    gl.drawArrays(gl.POINTS, 0, N_STARS);

    if(!prefersReduced) requestAnimationFrame(draw);
  }

  if(!prefersReduced) requestAnimationFrame(draw); else draw(performance.now());
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && !prefersReduced) requestAnimationFrame(draw); });

})();
