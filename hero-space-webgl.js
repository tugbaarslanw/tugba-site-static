/* Ultra-Light Premium Hero Space (WebGL, no libs)
   - Fly-through galaxy: yıldızlar derinden öne akıyor (yakınlaşma).
   - Tüm hareket shader'da; buffer'lar tek sefer oluşturulur (yüksek FPS).
   - Parallax (mouse/touch), soft auto-rotate, additive "bloom" hissi.
   - Hiçbir başka bölüme dokunmaz; sadece HERO arka planı.
*/

(function () {
  // HERO kapsayıcı
  const hero =
    document.querySelector('[data-hero]') ||
    document.querySelector('header.hero') ||
    document.querySelector('#hero') ||
    document.querySelector('.hero');

  if (!hero) return;

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1',        // .hero-bg (0) üstünde, .hero-inner (2) altında
    pointerEvents: 'none'
  });

  const cs = getComputedStyle(hero);
  if (cs.position === 'static') hero.style.position = 'relative';
  if (cs.overflow === 'visible') hero.style.overflow = 'hidden';

  // hero-inner'dan önce ekle (arka planın üstünde, içerikten aşağıda)
  const inner = hero.querySelector('.hero-inner');
  if (inner) hero.insertBefore(canvas, inner); else hero.appendChild(canvas);

  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) { console.warn('[Hero3D] WebGL not supported'); return; }

  const prefersReduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = matchMedia('(max-width: 768px)').matches;

  // ---------- SHADERS ----------
  // Vertex: Z'i zamanla ileri sarar (fly-through). Parallax için view rotasyonunu uygular.
  const vs = `
    attribute vec3 aPos;     // (x,y,z0) — z0: başlangıç derinliği
    attribute vec3 aCol;     // renk
    attribute float aSize;    // baz boyut

    uniform mat4 uProj;
    uniform mat4 uView;
    uniform float uTime;      // saniye
    uniform float uSpeed;     // birim/s
    uniform float uZMin;
    uniform float uZRange;    // zMax - zMin

    varying vec3 vCol;

    // pozitif mod
    float pmod(float x, float y){ return x - y*floor(x/y); }

    void main(){
      // derinlik akışı: z = z0 - time*speed  (range içinde wrap)
      float z = pmod(aPos.z - uTime * uSpeed, uZRange) + uZMin;

      // perspektif hesabı için eye-space koordinatı
      vec4 eye = uView * vec4(aPos.xy, z, 1.0);

      // Derine göre yıldız parlaklığı ve boyutu ufakça artar
      float depth = -eye.z; // positive
      float size = aSize * clamp(280.0 / depth, 1.0, 12.0);

      gl_PointSize = size;
      gl_Position = uProj * eye;

      // Renk: derine doğru hafifçe mavi-cyana kaydır
      float t = clamp((depth - uZMin) / (uZRange), 0.0, 1.0);
      vCol = mix(aCol, vec3(0.70, 0.85, 1.0), t*0.25);
    }
  `;

  // Fragment: yumuşak disk + çekirdek, additive blend
  const fs = `
    precision mediump float;
    varying vec3 vCol;
    void main(){
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float r = length(q);
      // yumuşak disk + hafif core
      float alpha = smoothstep(1.0, 0.0, r);
      alpha *= 0.85 + 0.15 * smoothstep(0.25, 0.0, r);
      gl_FragColor = vec4(vCol, alpha);
    }
  `;

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s)); return null;
    }
    return s;
  }
  function prog(vsSrc, fsSrc) {
    const p = gl.createProgram();
    const v = sh(gl.VERTEX_SHADER, vsSrc);
    const f = sh(gl.FRAGMENT_SHADER, fsSrc);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p)); return null;
    }
    return p;
  }

  const program = prog(vs, fs);
  if (!program) return;
  gl.useProgram(program);

  // ---------- ATTR/UNIF ----------
  const aPos = gl.getAttribLocation(program, 'aPos');
  const aCol = gl.getAttribLocation(program, 'aCol');
  const aSize = gl.getAttribLocation(program, 'aSize');

  const uProj = gl.getUniformLocation(program, 'uProj');
  const uView = gl.getUniformLocation(program, 'uView');
  const uTime = gl.getUniformLocation(program, 'uTime');
  const uSpeed = gl.getUniformLocation(program, 'uSpeed');
  const uZMin = gl.getUniformLocation(program, 'uZMin');
  const uZRange = gl.getUniformLocation(program, 'uZRange');

  // ---------- STAR FIELD DATA (static buffers) ----------
  const STAR_COUNT = isMobile ? 1100 : 2200;
  const XY_RADIUS = 180.0;      // yıldız bulutunun yarıçapı (görsel yoğunluk)
  const Z_MIN = 60.0;           // en yakın
  const Z_MAX = 900.0;          // en uzak
  const Z_RANGE = Z_MAX - Z_MIN;

  // hız: mobilde daha düşük
  const SPEED = isMobile ? 22.0 : 30.0; // birim/s

  function hsl2rgb(h, s, l) {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
  }

  // Noktaları dairesel dağıt (merkez yoğun), z0 rastgele
  const pos = new Float32Array(STAR_COUNT * 3);
  const col = new Float32Array(STAR_COUNT * 3);
  const size = new Float32Array(STAR_COUNT);

  for (let i = 0; i < STAR_COUNT; i++) {
    // XY: merkez yakın daha yoğun (sqrt dağılım)
    const u = Math.random();
    const r = Math.sqrt(u) * XY_RADIUS;
    const theta = Math.random() * Math.PI * 2;
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    const z0 = Z_MIN + Math.random() * Z_RANGE;

    pos[i * 3 + 0] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z0;

    // Renk paleti: mor -> eflatun -> camgöbeği (premium)
    const h = 0.72 - Math.random() * 0.18; // 0.54–0.72 arası (mavi-mor)
    const s = 0.70;
    const l = 0.65 + Math.random() * 0.20;
    const [rR, rG, rB] = hsl2rgb(h, s, l);
    col[i * 3 + 0] = rR;
    col[i * 3 + 1] = rG;
    col[i * 3 + 2] = rB;

    // boyut
    size[i] = isMobile ? (1.2 + Math.random() * 1.4) : (1.6 + Math.random() * 2.2);
  }

  function makeBuffer(data, loc, sizeComp) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, sizeComp, gl.FLOAT, false, 0, 0);
    return buf;
  }

  const posBuf = makeBuffer(pos, aPos, 3);
  const colBuf = makeBuffer(col, aCol, 3);
  const sizeBuf = makeBuffer(size, aSize, 1);

  // ---------- MATRİSLER ----------
  function mat4Identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mat4Multiply(a, b) {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
      o[r * 4 + c] = a[r * 4 + 0] * b[0 * 4 + c] + a[r * 4 + 1] * b[1 * 4 + c] + a[r * 4 + 2] * b[2 * 4 + c] + a[r * 4 + 3] * b[3 * 4 + c];
    return o;
  }
  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mat4Translate(m, x, y, z) {
    const t = mat4Identity(); t[12] = x; t[13] = y; t[14] = z; return mat4Multiply(m, t);
  }
  function mat4RotateX(m, a) {
    const c = Math.cos(a), s = Math.sin(a);
    const r = [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; return mat4Multiply(m, r);
  }
  function mat4RotateY(m, a) {
    const c = Math.cos(a), s = Math.sin(a);
    const r = [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; return mat4Multiply(m, r);
  }

  // Boyutlandırma
  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero);
  window.addEventListener('orientationchange', resize);
  resize();

  // Parallax
  let tRX = 0, tRY = 0; // hedef rotasyon
  function onPointerMove(e) {
    const rect = hero.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    tRY = (x - 0.5) * 0.16;
    tRX = (y - 0.5) * -0.12;
  }
  hero.addEventListener('mousemove', onPointerMove, { passive: true });
  hero.addEventListener('touchmove', onPointerMove, { passive: true });

  let rx = 0, ry = 0, auto = 0;

  // ---------- RENDER ----------
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
  gl.clearColor(0, 0, 0, 0);

  const t0 = performance.now();
  function draw(now) {
    const sec = (now - t0) / 1000;
    rx += (tRX - rx) * 0.05;
    ry += (tRY - ry) * 0.05;
    auto += 0.02 * (isMobile ? 0.6 : 1.0); // yumuşak oto-rotate

    gl.clear(gl.COLOR_BUFFER_BIT);

    // Projeksiyon & View (kamera)
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = mat4Perspective(60 * Math.PI / 180, aspect, 0.1, 4000);
    let view = mat4Identity();
    view = mat4Translate(view, 0, 0, -320);        // kamera geri
    view = mat4RotateX(view, rx * 0.9);
    view = mat4RotateY(view, ry + auto * 0.0025);  // çok hafif auto-rotate

    gl.uniformMatrix4fv(uProj, false, new Float32Array(proj));
    gl.uniformMatrix4fv(uView, false, new Float32Array(view));
    gl.uniform1f(uTime, sec);
    gl.uniform1f(uSpeed, SPEED);
    gl.uniform1f(uZMin, Z_MIN);
    gl.uniform1f(uZRange, Z_RANGE);

    // attrib buffer'lar zaten bağlı (static)
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf);
    gl.enableVertexAttribArray(aSize);
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, STAR_COUNT);

    if (!prefersReduced) requestAnimationFrame(draw);
  }

  if (!prefersReduced) requestAnimationFrame(draw);
  else draw(performance.now());

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !prefersReduced) requestAnimationFrame(draw);
  });
})();
