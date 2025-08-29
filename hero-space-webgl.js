/*  Hero 3D Space Background (WebGL, no external libs)
    - SADECE Hero arka planına canvas ekler ve 3D yıldız alanı çizer.
    - Parallax (mouse/touch) + çok hafif oto-rotation.
    - prefers-reduced-motion'a saygı duyar.
    - Mevcut içerik, stil ve düzen bozulmaz.
*/

(function(){
  // Hangi kapsayıcı? Önce data-hero, sonra #hero, sonra .hero sırayla denenir.
  const target =
    document.querySelector('[data-hero]') ||
    document.querySelector('#hero') ||
    document.querySelector('.hero') ||
    document.querySelector('header.hero') ||
    document.querySelector('section.hero');

  if(!target){ console.warn('[Hero3D] Hero kapsayıcısı bulunamadı.'); return; }

  const prefersReduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Canvas oluştur ve en alta yerleştir
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden','true');
  // Yalnızca canvas için gerekli stilleri inline veriyoruz (diğer ayarlara dokunmuyoruz)
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.zIndex = '0';
  canvas.style.pointerEvents = 'none';

  // Kapsayıcı "relative" değilse sadece Hero üzerinde relative yapıyoruz (layout'u bozmaz)
  const cs = getComputedStyle(target);
  if (cs.position === 'static') target.style.position = 'relative';
  // Taşmaların görünmemesi için yalnızca Hero'da gizleme
  if (cs.overflow === 'visible') target.style.overflow = 'hidden';

  // En alta ekle
  target.prepend(canvas);

  // WebGL
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if(!gl){ console.error('[Hero3D] WebGL desteklenmiyor.'); return; }

  // Shader kaynakları
  const vertSrc = `
    attribute vec3 position;
    attribute vec3 color;
    attribute float size;
    uniform mat4 uMVP;
    varying vec3 vColor;
    void main(){
      vec4 p = uMVP * vec4(position, 1.0);
      gl_Position = p;
      float s = size * (300.0 / -p.z);
      gl_PointSize = clamp(s, 1.0, 8.0);
      vColor = color;
    }
  `;
  const fragSrc = `
    precision mediump float;
    varying vec3 vColor;
    void main(){
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r = length(c);
      float alpha = smoothstep(1.0, 0.0, r);
      alpha *= 0.85 + 0.15 * smoothstep(0.3, 0.0, r);
      gl_FragColor = vec4(vColor, alpha);
    }
  `;

  function compile(type, src){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      console.error('[Hero3D] Shader hata:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh); return null;
    }
    return sh;
  }
  function createProgram(vs, fs){
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
      console.error('[Hero3D] Program link hata:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  if(!vs || !fs) return;
  const prog = createProgram(vs, fs);
  if(!prog) return;
  gl.useProgram(prog);

  const aPos = gl.getAttribLocation(prog, 'position');
  const aCol = gl.getAttribLocation(prog, 'color');
  const aSize = gl.getAttribLocation(prog, 'size');
  const uMVP = gl.getUniformLocation(prog, 'uMVP');

  // HSL -> RGB yardımcı
  function hsl2rgb(h,s,l){
    function hue2rgb(p, q, t){
      if (t < 0.0) t += 1.0;
      if (t > 1.0) t -= 1.0;
      if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
      if (t < 1.0/2.0) return q;
      if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
      return p;
    }
    let r,g,b;
    if(s === 0){ r=g=b=l; }
    else{
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [r,g,b];
  }

  const isMobile = matchMedia('(max-width: 768px)').matches;
  const STAR_COUNT_FAR  = isMobile ? 1200 : 2400;
  const STAR_COUNT_NEAR = isMobile ?  600 : 1200;

  function makeCloud(count, innerR, outerR, sizeMin, sizeMax, hueMin, hueMax){
    const positions = new Float32Array(count*3);
    const colors = new Float32Array(count*3);
    const sizes = new Float32Array(count);
    for(let i=0;i<count;i++){
      const u = Math.random();
      const r = innerR + Math.pow(u, 0.7) * (outerR - innerR);
      const theta = Math.random()*Math.PI*2.0;
      const v = Math.random()*2.0-1.0;
      const phi = Math.acos(v);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positions[i*3+0]=x; positions[i*3+1]=y; positions[i*3+2]=z;

      const h = hueMin + Math.random()*(hueMax-hueMin);
      const s = 0.65;
      const l = 0.80 - Math.random()*0.20;
      const [rr,gg,bb] = hsl2rgb(h, s, l);
      colors[i*3+0]=rr; colors[i*3+1]=gg; colors[i*3+2]=bb;

      sizes[i] = sizeMin + Math.random()*(sizeMax-sizeMin);
    }
    return {positions, colors, sizes};
  }

  const far  = makeCloud(STAR_COUNT_FAR,  450.0, 1200.0, 0.8, 1.4, 0.58, 0.70);
  const near = makeCloud(STAR_COUNT_NEAR, 120.0,  450.0, 1.4, 2.6, 0.58, 0.70);

  function makeBuffer(data, attribLoc, size, type=gl.FLOAT){
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribLoc);
    gl.vertexAttribPointer(attribLoc, size, type, false, 0, 0);
    return buf;
  }
  function bindCloud(cloud){
    makeBuffer(cloud.positions, aPos, 3);
    makeBuffer(cloud.colors,   aCol, 3);
    makeBuffer(cloud.sizes,    aSize, 1);
  }

  // Basit matris yardımcıları
  function mat4Identity(){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mat4Multiply(a,b){
    const out = new Array(16).fill(0);
    for(let r=0;r<4;r++){
      for(let c=0;c<4;c++){
        out[r*4+c]=a[r*4+0]*b[0*4+c]+a[r*4+1]*b[1*4+c]+a[r*4+2]*b[2*4+c]+a[r*4+3]*b[3*4+c];
      }
    }
    return out;
  }
  function mat4Perspective(fovy, aspect, near, far){
    const f = 1.0 / Math.tan(fovy/2);
    const nf = 1/(near-far);
    return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,(2*far*near)*nf,0];
  }
  function mat4Translate(m, x,y,z){
    const t = mat4Identity(); t[12]=x; t[13]=y; t[14]=z;
    return mat4Multiply(m,t);
  }
  function mat4RotateX(m, a){
    const c=Math.cos(a), s=Math.sin(a);
    const r=[1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1];
    return mat4Multiply(m,r);
  }
  function mat4RotateY(m, a){
    const c=Math.cos(a), s=Math.sin(a);
    const r=[c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
    return mat4Multiply(m,r);
  }

  // Boyutlandırma
  function resize(){
    const rect = target.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0,0,canvas.width, canvas.height);
  }
  const ro = new ResizeObserver(resize); ro.observe(target); resize();

  // Parallax
  let tRX = 0, tRY = 0; // hedef rotasyon
  function onPointerMove(e){
    const rect = target.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    tRY = (x - 0.5) * 0.15;
    tRX = (y - 0.5) * -0.12;
  }
  target.addEventListener('mousemove', onPointerMove, {passive:true});
  target.addEventListener('touchmove', onPointerMove, {passive:true});

  let rx = 0, ry = 0, rotY = 0;

  function drawCloud(cloud, viewProj, baseRotSpeed){
    rx += (tRX - rx) * 0.05;
    ry += (tRY - ry) * 0.05;
    rotY += baseRotSpeed;

    const model = mat4RotateY(mat4RotateX(mat4Identity(), rx), ry + rotY);
    const mvp = mat4Multiply(viewProj, model);
    gl.uniformMatrix4fv(uMVP, false, new Float32Array(mvp));
    gl.drawArrays(gl.POINTS, 0, cloud.sizes.length);
  }

  function render(){
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = mat4Perspective(60.0*Math.PI/180.0, aspect, 0.1, 2500.0);
    const view = mat4Translate(mat4Identity(), 0, 0, -350.0);

    // UZAK katman
    bindCloud(far);
    drawCloud(far, mat4Multiply(proj, view), 0.00012);

    // YAKIN katman
    bindCloud(near);
    drawCloud(near, mat4Multiply(proj, view), 0.00024);

    if(!prefersReduced) requestAnimationFrame(render);
  }

  if(!prefersReduced) requestAnimationFrame(render);
  else { render(); }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !prefersReduced) requestAnimationFrame(render);
  });
})();
