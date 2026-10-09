// Adapted from the user-provided ocean simulation reference (su/index.html).
(() => {
'use strict';

// =====================================================================
//  Parameters & UI
// =====================================================================
const P = {
  wind: 12, windDir: 30, fetch: 220, swell: 0.4, amp: 1.0, chop: 1.0, foam: 0.55,
  sunElev: 17, sunAz: 205, clouds: 0.38, fog: 0.22,
  exposure: 1.0, bloom: 0.35, timeScale: 1.0,
};

const SLIDERS = [
  ['Deniz'],
  ['wind',     'Rüzgâr hızı',             1,   32,  0.1,  ' m/s', 'spec'],
  ['windDir',  'Rüzgâr yönü',             0,  360,  1,    '°',    'spec'],
  ['fetch',    'Rüzgâr mesafesi (fetch)', 5,  800,  1,    ' km',  'spec'],
  ['swell',    'Soluğan (uzak dalga)',    0,  1.5,  0.01, '',     'spec'],
  ['amp',      'Dalga yüksekliği',        0.2,  2,  0.01, '×',    'spec'],
  ['chop',     'Dalga keskinliği',        0,  1.6,  0.01, '',     ''],
  ['foam',     'Köpük',                   0,    1,  0.01, '',     ''],
  ['Gökyüzü'],
  ['sunElev',  'Güneş yüksekliği',       -4,   89,  0.1,  '°',    'sky'],
  ['sunAz',    'Güneş yönü',              0,  360,  1,    '°',    'sky'],
  ['clouds',   'Bulut örtüsü',            0,    1,  0.01, '',     ''],
  ['fog',      'Pus',                     0,    1,  0.01, '',     'sky'],
  ['Görüntü'],
  ['exposure', 'Pozlama',                 0.2,  4,  0.01, '',     ''],
  ['bloom',    'Parlama',                 0,    1,  0.01, '',     ''],
  ['timeScale','Zaman akışı',             0,    2,  0.01, '×',    ''],
];

const PRESETS = {
  'Açık Deniz':  { wind: 12,  windDir: 30,  fetch: 220, swell: 0.4,  amp: 1.0, chop: 1.0,  foam: 0.55, sunElev: 17,  sunAz: 205, clouds: 0.38, fog: 0.22, exposure: 1.0, aim: -1.0 },
  'Sakin Sabah': { wind: 4.5, windDir: 60,  fetch: 60,  swell: 0.75, amp: 1.0, chop: 0.8,  foam: 0.3,  sunElev: 7,   sunAz: 110, clouds: 0.18, fog: 0.4,  exposure: 1.0 },
  'Gün Batımı':  { wind: 8,   windDir: 200, fetch: 150, swell: 0.6,  amp: 1.0, chop: 0.95, foam: 0.4,  sunElev: 2.2, sunAz: 250, clouds: 0.42, fog: 0.3,  exposure: 1.0 },
  'Fırtına':     { wind: 26,  windDir: 20,  fetch: 500, swell: 0.8,  amp: 1.0, chop: 1.15, foam: 0.8,  sunElev: 28,  sunAz: 160, clouds: 0.94, fog: 0.72, exposure: 1.5, aim: 2.7 },
};

let dirtySpec = true, dirtySky = true;
const $ = s => document.querySelector(s);
const inputs = {};
{
  const box = $('#controls');
  for (const s of SLIDERS) {
    if (s.length === 1) {
      const h = document.createElement('div'); h.className = 'sec'; h.textContent = s[0]; box.appendChild(h); continue;
    }
    const [key, label, min, max, step, unit, kind] = s;
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="top"><label for="s-${key}">${label}</label><span class="val"></span></div><input type="range" id="s-${key}" min="${min}" max="${max}" step="${step}">`;
    const inp = row.querySelector('input'), val = row.querySelector('.val');
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    const upd = () => {
      const v = parseFloat(inp.value); P[key] = v;
      val.textContent = v.toFixed(dec) + unit;
      inp.style.setProperty('--p', ((v - min) / (max - min) * 100) + '%');
      if (kind === 'spec') dirtySpec = true;
      if (kind === 'sky') dirtySky = true;
      clearPresetMark();
    };
    inp.addEventListener('input', upd);
    inp.value = P[key];
    inputs[key] = { inp, upd };
    box.appendChild(row);
  }
}
const presetBtns = {};
function clearPresetMark() { if (!applyingPreset) for (const k in presetBtns) presetBtns[k].classList.remove('on'); }
let applyingPreset = false;
function syncUI() { for (const k in inputs) { inputs[k].inp.value = P[k]; inputs[k].upd(); } }
{
  const box = $('#presets');
  for (const name in PRESETS) {
    const b = document.createElement('button'); b.textContent = name;
    b.onclick = () => applyPreset(name, true);
    presetBtns[name] = b; box.appendChild(b);
  }
}

// =====================================================================
//  WebGL2 setup
// =====================================================================
const canvas = $('#c');
function fail(msg) { const e = $('#err'); e.textContent = msg; e.style.display = 'block'; throw new Error(msg); }
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
if (!gl) fail('Bu tarayıcı WebGL2 desteklemiyor. Güncel bir Chrome, Edge veya Firefox deneyin.');
if (!gl.getExtension('EXT_color_buffer_float')) fail('EXT_color_buffer_float desteklenmiyor (kayan noktalı render hedefleri gerekli).');
gl.getExtension('OES_texture_float_linear');
const extAniso = gl.getExtension('EXT_texture_filter_anisotropic');
const maxAniso = extAniso ? gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;

const N = 256;           // FFT resolution per cascade
const ENV = 256;         // environment cubemap size
const ATMO = 128;        // atmosphere cubemap size
const PROBES = 8;
const TAU = Math.PI * 2;

// three cascades with non-overlapping wavenumber bands
// (each cascade owns wavenumbers from 6 of its own fundamental up to 6 of the next one's)
const CASC = [{ L: 1000 }, { L: 100 }, { L: 14 }, { L: 3.5 }];
CASC.forEach((c, i) => {
  c.kLow = i === 0 ? 1e-4 : CASC[i - 1].kHigh;
  c.kHigh = i === CASC.length - 1 ? 1e5 : 12 * Math.PI / CASC[i + 1].L;
});

function numbered(src) { return src.split('\n').map((l, i) => String(i + 1).padStart(4) + '  ' + l).join('\n'); }
function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) fail('Shader derleme hatası:\n' + gl.getShaderInfoLog(s) + '\n\n' + numbered(src));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail('Program bağlama hatası:\n' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}
function use(pr) { gl.useProgram(pr.p); return pr; }
function uf(pr, n, a, b, c, d) {
  const l = pr.u[n]; if (!l) return;
  if (d !== undefined) gl.uniform4f(l, a, b, c, d);
  else if (c !== undefined) gl.uniform3f(l, a, b, c);
  else if (b !== undefined) gl.uniform2f(l, a, b);
  else gl.uniform1f(l, a);
}
function uv3(pr, n, v) { const l = pr.u[n]; if (l) gl.uniform3f(l, v[0], v[1], v[2]); }
function ui(pr, n, v) { const l = pr.u[n]; if (l) gl.uniform1i(l, v); }
function tex(pr, n, t, unit, target = gl.TEXTURE_2D) {
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t);
  const l = pr.u[n]; if (l) gl.uniform1i(l, unit);
}

function makeTex(w, h, ifmt, o = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const levels = o.mip ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, ifmt, w, h);
  const lin = o.mip || o.linear;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mip ? gl.LINEAR_MIPMAP_LINEAR : lin ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
  const wrap = o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (o.aniso && extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, maxAniso));
  return t;
}
function makeCube(size, ifmt) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, Math.log2(size) + 1, ifmt, size, size);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_CUBE_MAP, p, gl.CLAMP_TO_EDGE);
  return t;
}
function checkFB(what) {
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) fail('Framebuffer eksik (' + what + '): 0x' + st.toString(16));
}
function makeFBO(texs) {
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  checkFB('mrt' + texs.length);
  return f;
}
function cubeFBOs(cube) {
  const out = [];
  for (let f = 0; f < 6; f++) {
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, cube, 0);
    checkFB('cube'); out.push(fb);
  }
  return out;
}

// deterministic PRNG
function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function gaussTex(seed) {
  const r = mulberry32(seed), d = new Float32Array(N * N * 2);
  for (let i = 0; i < N * N; i++) {
    const u1 = Math.max(r(), 1e-9), u2 = r(), m = Math.sqrt(-2 * Math.log(u1));
    d[2 * i] = m * Math.cos(TAU * u2); d[2 * i + 1] = m * Math.sin(TAU * u2);
  }
  const t = makeTex(N, N, gl.RG32F);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RG, gl.FLOAT, d);
  return t;
}
// tileable foam pattern: cellular bubble walls + fbm streaks
function foamTexture() {
  const S = 256, C = 14, r = mulberry32(4242);
  const pts = []; for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) pts.push([(i + r()) / C, (j + r()) / C]);
  const hash = (i, j, k) => { let h = (i * 374761393 + j * 668265263 + k * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vn = (u, v, Pp, k) => {
    const x = u * Pp, y = v * Pp, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const h = (i, j) => hash(((i % Pp) + Pp) % Pp, ((j % Pp) + Pp) % Pp, k);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
  const data = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, ci = Math.floor(u * C), cj = Math.floor(v * C);
    let f1 = 9, f2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ci + di, jj = cj + dj, wi = ((ii % C) + C) % C, wj = ((jj % C) + C) % C;
      const p = pts[wj * C + wi];
      const px = p[0] + Math.floor(ii / C), py = p[1] + Math.floor(jj / C);
      const d = Math.hypot(px - u, py - v) * C;
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const edge = 1 - Math.min(1, Math.max(0, (f2 - f1) / 0.35));
    let n = 0, a = 0.5;
    for (let o = 0; o < 4; o++) { n += a * vn(u, v, 4 << o, o); a *= 0.5; }
    const val = Math.min(1, Math.max(0, 0.55 * edge * edge + 1.25 * (n - 0.28)));
    data[y * S + x] = Math.round(val * 255);
  }
  const t = makeTex(S, S, gl.R8, { mip: true, repeat: true, aniso: true });
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S, S, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

// =====================================================================
//  Shaders
// =====================================================================
const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
`;

const VS_QUAD = HEAD + `
out vec2 v_uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// --- initial spectrum h0(k), conj(h0(-k)) ---------------------------------
const FS_INIT = HEAD + `
uniform sampler2D u_noise;
uniform float u_N, u_L, u_kLow, u_kHigh;
uniform float u_U, u_F, u_windAng, u_spread, u_swell, u_swellAng, u_amp, u_fade;
out vec4 o;
const float G = 9.81;
const float ST = 7.4e-5;   // surface tension / density (capillary waves)
const float PI = 3.14159265359;
float wrapA(float a){ return mod(a + PI, 2.0 * PI) - PI; }
float peakW(){ return 22.0 * pow(G * G / (u_U * u_F), 1.0 / 3.0); }
float jonswap(float w, float wp){
  float alpha = 0.076 * pow(u_U * u_U / (u_F * G), 0.22);
  float sg = w <= wp ? 0.07 : 0.09;
  float r = exp(-(w - wp) * (w - wp) / (2.0 * sg * sg * wp * wp));
  return alpha * G * G / pow(w, 5.0) * exp(-1.25 * pow(wp / w, 4.0)) * pow(3.3, r);
}
float dbBeta(float x){
  if (x < 0.95) return 2.61 * pow(x, 1.3);
  if (x < 1.6) return 2.28 * pow(x, -1.3);
  float p = -0.4 + 0.8393 * exp(-0.567 * log(x * x));
  return pow(10.0, p);
}
float donelan(float th, float w, float wp){
  float b = dbBeta(w / wp);
  float s = 1.0 / cosh(b * th);
  return b / (2.0 * tanh(b * PI)) * s * s;
}
vec2 h0At(ivec2 id){
  int n = int(u_N);
  if (id.x == n / 2 || id.y == n / 2) return vec2(0.0);
  vec2 m = vec2(id);
  m -= u_N * step(u_N * 0.5, m);
  float dk = 2.0 * PI / u_L;
  vec2 k = m * dk;
  float kl = length(k);
  if (kl < u_kLow || kl >= u_kHigh || kl < 1e-6) return vec2(0.0);
  float w = sqrt(G * kl + ST * kl * kl * kl);
  float dwdk = (G + 3.0 * ST * kl * kl) / (2.0 * w);
  float th = atan(k.y, k.x);
  float wp = peakW();
  float S = jonswap(w, wp) * mix(donelan(wrapA(th - u_windAng), w, wp), 1.0 / (2.0 * PI), u_spread);
  if (u_swell > 0.0) {
    const float wps = 0.57;
    float sg = w <= wps ? 0.07 : 0.09;
    float rr = exp(-(w - wps) * (w - wps) / (2.0 * sg * sg * wps * wps));
    float Ss = 2.2e-4 * G * G / pow(w, 5.0) * exp(-1.25 * pow(wps / w, 4.0)) * pow(5.0, rr);
    float a = wrapA(th - u_swellAng);
    const float sd = 0.26;
    S += u_swell * Ss * exp(-a * a / (2.0 * sd * sd)) / (sqrt(2.0 * PI) * sd);
  }
  S *= exp(-kl * kl * u_fade * u_fade);
  float Sk = S * dwdk / kl;
  float amp = 0.5 * dk * sqrt(max(Sk, 0.0)) * u_amp;
  return texelFetch(u_noise, id, 0).xy * amp;
}
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  int n = int(u_N);
  ivec2 nid = (ivec2(n) - id) % n;
  vec2 a = h0At(id);
  vec2 b = h0At(nid);
  o = vec4(a, b.x, -b.y);
}`;

// --- time evolution + packing of 8 real fields into 4 complex ------------
const FS_TIME = HEAD + `
uniform sampler2D u_h0;
uniform float u_N, u_L, u_time;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
const float G = 9.81;
const float ST = 7.4e-5;
const float PI = 3.14159265359;
const float W0 = 2.0 * PI / 1000.0;   // repeat period 1000 s
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec2 m = vec2(id); m -= u_N * step(u_N * 0.5, m);
  vec2 k = m * (2.0 * PI / u_L);
  float kl = max(length(k), 1e-6);
  float wn = floor(sqrt(G * kl + ST * kl * kl * kl) / W0);
  float ph = 2.0 * PI * fract(wn * u_time / 1000.0);
  vec2 e = vec2(cos(ph), sin(ph));
  vec4 h0 = texelFetch(u_h0, id, 0);
  vec2 h = cmul(h0.xy, vec2(e.x, -e.y)) + cmul(h0.zw, e);
  vec2 ih = vec2(-h.y, h.x);
  vec2 kn = k / kl;
  vec2 dx = ih * kn.x, dz = ih * kn.y;
  vec2 dyx = ih * k.x, dyz = ih * k.y;
  vec2 dxx = -h * k.x * kn.x, dzz = -h * k.y * kn.y, dxz = -h * k.x * kn.y;
  o0 = vec4(dx.x - dz.y, dx.y + dz.x, h.x - dxz.y, h.y + dxz.x);
  o1 = vec4(dyx.x - dyz.y, dyx.y + dyz.x, dxx.x - dzz.y, dxx.y + dzz.x);
}`;

// --- Stockham radix-2 inverse FFT pass --------------------------------------
const FS_FFT = HEAD + `
uniform sampler2D u_in0, u_in1;
uniform int u_sub, u_N, u_horizontal;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
const float PI = 3.14159265359;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  bool hz = u_horizontal == 1;
  int idx = hz ? p.x : p.y;
  int hs = u_sub / 2;
  int ev = (idx / u_sub) * hs + (idx % hs);
  int od = ev + u_N / 2;
  ivec2 pe = hz ? ivec2(ev, p.y) : ivec2(p.x, ev);
  ivec2 po = hz ? ivec2(od, p.y) : ivec2(p.x, od);
  float ang = 2.0 * PI * float(idx % u_sub) / float(u_sub);
  vec2 tw = vec2(cos(ang), sin(ang));
  vec4 a0 = texelFetch(u_in0, pe, 0), b0 = texelFetch(u_in0, po, 0);
  vec4 a1 = texelFetch(u_in1, pe, 0), b1 = texelFetch(u_in1, po, 0);
  o0 = vec4(a0.xy + cmul(tw, b0.xy), a0.zw + cmul(tw, b0.zw));
  o1 = vec4(a1.xy + cmul(tw, b1.xy), a1.zw + cmul(tw, b1.zw));
}`;

// --- assemble displacement / derivatives / slope moments + foam memory ----
const FS_ASM = HEAD + `
uniform sampler2D u_fft0, u_fft1, u_prev;
uniform float u_lambda, u_dt;
layout(location = 0) out vec4 oDisp;
layout(location = 1) out vec4 oDer;
layout(location = 2) out vec4 oMom;
void main(){
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(u_fft0, id, 0);   // Dx, Dz, Dy, Dxz
  vec4 b = texelFetch(u_fft1, id, 0);   // Dyx, Dyz, Dxx, Dzz
  float lam = u_lambda;
  float dxx = lam * b.z, dzz = lam * b.w, dxz = lam * a.w;
  float J = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  float prev = texelFetch(u_prev, id, 0).w;
  float turb = min(J, prev + u_dt * 0.5 / max(J, 0.5));
  oDisp = vec4(lam * a.x, a.z, lam * a.y, turb);
  oDer  = vec4(b.x, b.y, dxx, dzz);
  oMom  = vec4(b.x * b.x, b.y * b.y, b.x * b.y, 0.0);
}`;

// --- shared: cube face directions ------------------------------------------
const CUBE_FN = `
vec3 faceDir(int f, vec2 uv){
  if (f == 0) return normalize(vec3( 1.0, -uv.y, -uv.x));
  if (f == 1) return normalize(vec3(-1.0, -uv.y,  uv.x));
  if (f == 2) return normalize(vec3( uv.x,  1.0,  uv.y));
  if (f == 3) return normalize(vec3( uv.x, -1.0, -uv.y));
  if (f == 4) return normalize(vec3( uv.x, -uv.y,  1.0));
  return normalize(vec3(-uv.x, -uv.y, -1.0));
}`;

// --- shared: procedural cloud layer ----------------------------------------
const CLOUD_FN = `
uniform float u_cloudCover;
uniform vec2 u_cloudOff;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5;
  mat2 R = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * vnoise(p); p = R * p + vec2(3.1, 1.7); a *= 0.5; }
  return s;
}
float cloudDensity(vec2 p, int oct){
  float n = fbm(p, oct);
  float th = mix(0.74, 0.06, u_cloudCover);
  return smoothstep(th, th + 0.3, n);
}
float overcastF(){ return smoothstep(0.55, 1.0, u_cloudCover); }
vec3 applyOvercast(vec3 sky, vec3 amb, vec3 dir){
  float oc = overcastF();
  float l = dot(amb, vec3(0.3, 0.55, 0.15));
  vec3 grey = vec3(l) * vec3(0.93, 0.98, 1.04) * (1.2 - 0.4 * clamp(dir.y, 0.0, 1.0)) * mix(1.4, 0.8, oc);
  return mix(sky, grey, oc * 0.92);
}
vec4 cloudLayer(vec3 dir, vec3 sky, vec3 amb, vec3 sunDir, vec3 sunCol){
  if (dir.y < 0.003 || u_cloudCover < 0.001) return vec4(0.0);
  float t = min(2500.0 / dir.y, 80000.0);
  vec2 p = dir.xz * t * 0.00018 + u_cloudOff;
  float d = cloudDensity(p, 7);
  if (d < 0.001) return vec4(0.0);
  vec2 sd = sunDir.xz / max(length(sunDir.xz), 1e-3);
  float ds = cloudDensity(p + sd * 0.09, 5);
  float light = exp(-ds * 1.8) * (0.4 + 0.6 * (1.0 - d * 0.7));
  float mu = max(dot(dir, sunDir), 0.0);
  float phase = 0.55 + 1.6 * pow(mu, 10.0) + 0.35 * mu * mu;
  float oc = overcastF();
  vec3 col = sunCol * 0.03 * light * phase * (1.0 - 0.9 * oc) + amb * (1.15 - 0.5 * d);
  col *= mix(1.0, 0.34, oc * d);
  float fade = exp(-t / 50000.0);
  col = mix(sky, col, fade);
  float a = d * smoothstep(0.003, 0.08, dir.y);
  return vec4(col, a);
}`;

// --- physically based atmosphere (single scattering, Rayleigh+Mie+ozone) ---
const FS_ATMO = HEAD + `
uniform int u_face;
uniform float u_size, u_sunI, u_boost, u_mie;
uniform vec3 u_sunDir;
out vec4 o;
const float PI = 3.14159265359;
const float RP = 6371e3, RA = 6471e3;
const vec3 BR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
#define BM u_mie
const vec3 BO = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float HR = 8e3, HM = 1.2e3, GM = 0.758;
` + CUBE_FN + `
vec2 rsi(vec3 r0, vec3 rd, float sr){
  float b = dot(rd, r0);
  float lr = length(r0);
  float c = (lr - sr) * (lr + sr);
  float d = b * b - c;
  if (d < 0.0) return vec2(-1e9);   // miss: both roots 'behind'
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
float ozone(float h){ return max(0.0, 1.0 - abs(h - 25e3) / 15e3); }
vec3 atmosphere(vec3 rd){
  vec3 r0 = vec3(0.0, RP + 10.0, 0.0);
  float tmax = rsi(r0, rd, RA).y;
  vec2 pl = rsi(r0, rd, RP);
  if (pl.x > 0.0) tmax = min(tmax, pl.x);
  const int IS = 24;
  const int JS = 8;
  float ds = tmax / float(IS);
  float mu = dot(rd, u_sunDir), mumu = mu * mu, gg = GM * GM;
  float pR = 3.0 / (16.0 * PI) * (1.0 + mumu);
  float pM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * GM, 1.5) * (2.0 + gg));
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  for (int i = 0; i < IS; i++){
    vec3 pos = r0 + rd * (ds * (float(i) + 0.5));
    float h = length(pos) - RP;
    float dR = exp(-h / HR) * ds, dM = exp(-h / HM) * ds, dO = ozone(h) * ds;
    odR += dR; odM += dM; odO += dO;
    vec2 ps = rsi(pos, u_sunDir, RP);
    if (ps.x > 0.0) continue;
    float lt = rsi(pos, u_sunDir, RA).y;
    float lds = lt / float(JS);
    float lR = 0.0, lM = 0.0, lO = 0.0;
    for (int j = 0; j < JS; j++){
      vec3 lp = pos + u_sunDir * (lds * (float(j) + 0.5));
      float lh = length(lp) - RP;
      lR += exp(-lh / HR) * lds; lM += exp(-lh / HM) * lds; lO += ozone(lh) * lds;
    }
    vec3 att = exp(-(BR * (odR + lR) + BM * 1.1 * (odM + lM) + BO * (odO + lO)));
    sR += dR * att; sM += dM * att;
  }
  return u_sunI * (pR * BR * sR + pM * BM * sM);
}
void main(){
  vec2 uv = gl_FragCoord.xy / u_size * 2.0 - 1.0;
  vec3 d = faceDir(u_face, uv);
  // soft elevation floor: single scattering over-reddens the exact horizon
  float y = min(sqrt(max(d.y, 0.0) * max(d.y, 0.0) + 0.0012), 1.0);
  vec2 h = normalize(d.xz + vec2(1e-6));
  d = vec3(h * sqrt(max(1.0 - y * y, 0.0)), y).xzy;
  o = vec4(atmosphere(d) * u_boost, 1.0);
}`;

// --- environment cubemap (atmosphere + clouds) for reflections -------------
const FS_ENV = HEAD + `
uniform samplerCube u_atmo;
uniform int u_face;
uniform float u_size;
uniform vec3 u_sunDir, u_sunColor;
out vec4 o;
` + CUBE_FN + CLOUD_FN + `
void main(){
  vec2 uv = gl_FragCoord.xy / u_size * 2.0 - 1.0;
  vec3 d = faceDir(u_face, uv);
  d = normalize(vec3(d.x, max(d.y, 0.0), d.z) + vec3(0.0, 1e-4, 0.0));
  vec3 amb = textureLod(u_atmo, vec3(0.0, 1.0, 0.0), 8.0).rgb;
  vec3 sky = applyOvercast(texture(u_atmo, d).rgb, amb, d);
  vec4 c = cloudLayer(d, sky, amb, u_sunDir, u_sunColor);
  o = vec4(mix(sky, c.rgb, c.a), 1.0);
}`;

// --- background sky ---------------------------------------------------------
const FS_SKY = HEAD + `
in vec2 v_uv;
uniform vec3 u_camF, u_camR, u_camU;
uniform vec2 u_tan;
uniform samplerCube u_atmo;
uniform vec3 u_sunDir, u_sunColor;
uniform float u_sunVis;
out vec4 o;
` + CLOUD_FN + `
void main(){
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 dir = normalize(u_camF + ndc.x * u_tan.x * u_camR + ndc.y * u_tan.y * u_camU);
  vec3 d = normalize(vec3(dir.x, max(dir.y, 0.0), dir.z) + vec3(0.0, 1e-4, 0.0));
  vec3 amb = textureLod(u_atmo, vec3(0.0, 1.0, 0.0), 8.0).rgb;
  vec3 sky = applyOvercast(texture(u_atmo, d).rgb, amb, d);
  float ang = length(cross(dir, u_sunDir));
  float disk = dot(dir, u_sunDir) > 0.0 ? 1.0 - smoothstep(0.0086, 0.0098, ang) : 0.0;
  float limb = 1.0 - 0.55 * pow(clamp(ang / 0.0098, 0.0, 1.0), 2.0);
  vec3 sun = u_sunColor * disk * limb * 1100.0 * u_sunVis * smoothstep(-0.004, 0.004, dir.y);
  vec4 c = cloudLayer(d, sky, amb, u_sunDir, u_sunColor);
  vec3 col = mix(sky, c.rgb, c.a) + sun * (1.0 - c.a) * (1.0 - c.a);
  o = vec4(min(col, vec3(30000.0)), 1.0);
}`;

// --- ocean surface -----------------------------------------------------------
const VS_OCEAN = HEAD + `
layout(location = 0) in vec2 a_pos;
uniform mat4 u_vp;
uniform vec3 u_cam;
uniform vec4 u_L;
uniform float u_ang;
uniform sampler2D u_disp0, u_disp1, u_disp2, u_disp3;
out vec2 v_xz;
out vec3 v_pos;
out float v_h;
void main(){
  vec2 xz = u_cam.xz + a_pos;
  float r = length(a_pos);
  float sp = max(r * u_ang, 0.06);
  vec3 d = vec3(0.0);
  d += textureLod(u_disp0, xz / u_L.x, max(log2(sp / (u_L.x / 256.0)), 0.0)).xyz;
  d += textureLod(u_disp1, xz / u_L.y, max(log2(sp / (u_L.y / 256.0)), 0.0)).xyz;
  d += textureLod(u_disp2, xz / u_L.z, max(log2(sp / (u_L.z / 256.0)), 0.0)).xyz;
  d += textureLod(u_disp3, xz / u_L.w, max(log2(sp / (u_L.w / 256.0)), 0.0)).xyz;
  vec3 p = vec3(xz.x, 0.0, xz.y) + d;
  vec2 rel = p.xz - u_cam.xz;
  p.y -= dot(rel, rel) / (2.0 * 6371000.0);
  v_xz = xz; v_pos = p; v_h = d.y;
  gl_Position = u_vp * vec4(p, 1.0);
}`;

const FS_OCEAN = HEAD + `
in vec2 v_xz;
in vec3 v_pos;
in float v_h;
uniform vec3 u_cam, u_sunDir, u_sunColor;
uniform vec4 u_L;
uniform sampler2D u_der0, u_der1, u_der2, u_der3, u_mom0, u_mom1, u_mom2, u_mom3, u_disp0, u_disp1, u_disp2, u_disp3, u_foamTex;
uniform samplerCube u_env;
uniform float u_foamThresh, u_foamGain, u_fogDensity, u_sunVis, u_baseVar, u_waveH;
uniform vec3 u_waterColor, u_sssColor;
out vec4 o;
const float PI = 3.14159265359;
` + CLOUD_FN + `
float erfc_(float x){ return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x)); }
float smithL(float c, float s2){
  c = clamp(c, 0.001, 0.9999);
  float v = c / sqrt((1.0 - c * c) * 2.0 * s2);
  return max(0.0, (exp(-v * v) - v * sqrt(PI) * erfc_(v)) / (2.0 * v * sqrt(PI)));
}
// Bruneton et al. 2010: sun reflected off a Gaussian slope distribution
float sunSpec(vec3 L, vec3 V, vec3 N, vec3 Tx, vec3 Ty, vec2 s2){
  vec3 H = normalize(L + V);
  float zH = max(dot(H, N), 0.01);
  float zx = dot(H, Tx) / zH, zy = dot(H, Ty) / zH;
  float p = exp(-0.5 * (zx * zx / s2.x + zy * zy / s2.y)) / (2.0 * PI * sqrt(s2.x * s2.y));
  vec2 vp = vec2(dot(V, Tx), dot(V, Ty)); float cv = vp.x * vp.x / max(dot(vp, vp), 1e-6);
  vec2 lp = vec2(dot(L, Tx), dot(L, Ty)); float cl = lp.x * lp.x / max(dot(lp, lp), 1e-6);
  float sV = s2.x * cv + s2.y * (1.0 - cv), sL = s2.x * cl + s2.y * (1.0 - cl);
  float zL = dot(L, N), zV = dot(V, N);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  float Gs = 1.0 / (1.0 + smithL(zL, sL) + smithL(zV, sV));
  return F * p * Gs / (4.0 * max(zV, 0.01) * zH * zH * zH * zH) * smoothstep(-0.05, 0.05, zL);
}
void main(){
  vec3 toCam = u_cam - v_pos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 uv0 = v_xz / u_L.x, uv1 = v_xz / u_L.y, uv2 = v_xz / u_L.z, uv3 = v_xz / u_L.w;
  vec4 d0 = texture(u_der0, uv0), d1 = texture(u_der1, uv1), d2 = texture(u_der2, uv2), d3 = texture(u_der3, uv3);
  vec4 D = d0 + d1 + d2 + d3;
  vec2 slope = vec2(D.x / max(1.0 + D.z, 0.25), D.y / max(1.0 + D.w, 0.25));
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));

  // slope variance lost to mip filtering (LEAN mapping) + unresolved ripples
  vec4 m0 = texture(u_mom0, uv0), m1 = texture(u_mom1, uv1), m2 = texture(u_mom2, uv2), m3 = texture(u_mom3, uv3);
  vec2 s2 = max(m0.xy - d0.xy * d0.xy, 0.0) + max(m1.xy - d1.xy * d1.xy, 0.0) + max(m2.xy - d2.xy * d2.xy, 0.0) + max(m3.xy - d3.xy * d3.xy, 0.0);
  s2 += u_baseVar;

  float nv = dot(N, V);
  if (nv < 0.03) { N = normalize(N + V * (0.03 - nv)); nv = dot(N, V); }
  vec3 L = u_sunDir;

  // cloud shadows
  float cs = 1.0;
  if (L.y > 0.01 && u_cloudCover > 0.001) {
    vec2 q = v_pos.xz + L.xz * ((2500.0 - v_pos.y) / L.y);
    cs = 1.0 - 0.8 * cloudDensity(q * 0.00018 + u_cloudOff, 4);
  }
  vec3 sunC = u_sunColor * u_sunVis * cs;
  vec3 amb = textureLod(u_env, vec3(0.0, 1.0, 0.0), 10.0).rgb;

  // sky reflection
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  float sig = sqrt(0.5 * (s2.x + s2.y));
  vec3 refl = textureLod(u_env, R, log2(max(sig * 327.0, 1.0))).rgb;
  float F = 0.02 + 0.98 * pow(1.0 - clamp(nv, 0.0, 1.0), 5.0);

  // sun glitter
  vec3 Ty = normalize(cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 Tx = cross(Ty, N);
  vec3 spec = sunC * sunSpec(L, V, N, Tx, Ty, s2) * smoothstep(-0.02, 0.03, L.y);

  // water body: upwelling light + subsurface glow through wave crests
  float hN = clamp(v_h / u_waveH, -1.0, 1.5);
  float k1 = max(hN + 0.25, 0.0) * pow(clamp(dot(L, -V), 0.0, 1.0), 4.0) * pow(0.5 - 0.5 * dot(L, N), 3.0);
  float k2 = pow(max(nv, 0.0), 2.0);
  vec3 Ein = sunC * max(L.y, 0.0) + amb * PI;
  vec3 body = u_waterColor * Ein * (0.55 + 0.45 * k2) * (1.0 + 0.35 * max(hN, 0.0));
  body += u_sssColor * sunC * k1 * 2.2;
  body += u_sssColor * sunC * pow(max(dot(N, L), 0.0), 2.0) * 0.08 * max(hN + 0.4, 0.0);

  vec3 col = body * (1.0 - F) + refl * F + spec;

  // foam from surface compression (Jacobian memory)
  float T = texture(u_disp0, uv0).w + texture(u_disp1, uv1).w + texture(u_disp2, uv2).w + texture(u_disp3, uv3).w - 3.0;
  float fm = clamp((u_foamThresh - T) * u_foamGain, 0.0, 1.0);
  float pat = texture(u_foamTex, v_xz * 0.13).r * 0.6 + texture(u_foamTex, v_xz * 0.041 + 0.37).r * 0.4;
  float foam = clamp(fm * mix(0.15, 1.6, pat) + fm * fm * 0.35, 0.0, 1.0);
  vec3 foamCol = vec3(0.9, 0.93, 0.95) * (sunC * max(dot(N, L) * 0.8 + 0.2, 0.0) + amb * PI) / PI;
  col = mix(col, foamCol, foam);

  // aerial perspective
  vec3 vd = -V;
  vec3 fogCol = textureLod(u_env, normalize(vec3(vd.x, 0.02, vd.z)), 3.0).rgb;
  col = mix(fogCol, col, exp(-dist * u_fogDensity));
  o = vec4(min(col, vec3(30000.0)), 1.0);
}`;

// --- height probes (GPU -> CPU readback for camera / boat) -----------------
const FS_PROBE = HEAD + `
uniform vec2 u_probes[${PROBES}];
uniform vec4 u_L;
uniform sampler2D u_disp0, u_disp1, u_disp2, u_disp3;
out vec4 o;
vec3 dispAt(vec2 p){
  return textureLod(u_disp0, p / u_L.x, 0.0).xyz + textureLod(u_disp1, p / u_L.y, 0.0).xyz
       + textureLod(u_disp2, p / u_L.z, 0.0).xyz + textureLod(u_disp3, p / u_L.w, 0.0).xyz;
}
void main(){
  int i = int(gl_FragCoord.x);
  vec2 target = u_probes[i];
  vec2 p = target;
  for (int k = 0; k < 5; k++){ vec3 d = dispAt(p); p = target - d.xz; }
  vec3 d = dispAt(p);
  o = vec4(d.y, d.x, d.z, 1.0);
}`;

// --- bloom ------------------------------------------------------------------
const FS_DOWN = HEAD + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform int u_first;
out vec4 o;
vec3 S(vec2 off){ return min(texture(u_src, v_uv + off * u_texel).rgb, vec3(20000.0)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec3 a = S(vec2(-2.0, 2.0)), b = S(vec2(0.0, 2.0)), c = S(vec2(2.0, 2.0));
  vec3 d = S(vec2(-2.0, 0.0)), e = S(vec2(0.0, 0.0)), f = S(vec2(2.0, 0.0));
  vec3 g = S(vec2(-2.0, -2.0)), h = S(vec2(0.0, -2.0)), i = S(vec2(2.0, -2.0));
  vec3 j = S(vec2(-1.0, 1.0)), k = S(vec2(1.0, 1.0)), l = S(vec2(-1.0, -1.0)), m = S(vec2(1.0, -1.0));
  vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  vec3 r;
  if (u_first == 1) {
    float w0 = 0.5 / (1.0 + luma(g0)), w1 = 0.125 / (1.0 + luma(g1)), w2 = 0.125 / (1.0 + luma(g2)), w3 = 0.125 / (1.0 + luma(g3)), w4 = 0.125 / (1.0 + luma(g4));
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    r = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
  }
  o = vec4(r, 1.0);
}`;
const FS_UP = HEAD + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o;
void main(){
  vec2 t = u_texel;
  vec3 s = texture(u_src, v_uv).rgb * 4.0;
  s += (texture(u_src, v_uv + vec2(t.x, 0.0)).rgb + texture(u_src, v_uv - vec2(t.x, 0.0)).rgb
      + texture(u_src, v_uv + vec2(0.0, t.y)).rgb + texture(u_src, v_uv - vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(u_src, v_uv + t).rgb + texture(u_src, v_uv - t).rgb
     + texture(u_src, v_uv + vec2(t.x, -t.y)).rgb + texture(u_src, v_uv + vec2(-t.x, t.y)).rgb;
  o = vec4(s / 16.0, 1.0);
}`;

// --- final: bloom mix, exposure, ACES, sRGB, dithering -----------------------
const FS_FINAL = HEAD + `
in vec2 v_uv;
uniform sampler2D u_hdr, u_bloom;
uniform float u_exposure, u_bloomStr, u_time;
out vec4 o;
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){ return clamp(ACES_OUT * rrt(ACES_IN * c), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texture(u_hdr, v_uv).rgb;
  vec3 b = texture(u_bloom, v_uv).rgb;
  c = mix(c, b, u_bloomStr);
  c *= u_exposure;
  vec2 q = v_uv - 0.5;
  c *= 1.0 - 0.45 * dot(q, q);
  c = toSRGB(aces(c));
  c += (hash(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;

const progInit  = program(VS_QUAD, FS_INIT);
const progTime  = program(VS_QUAD, FS_TIME);
const progFFT   = program(VS_QUAD, FS_FFT);
const progAsm   = program(VS_QUAD, FS_ASM);
const progAtmo  = program(VS_QUAD, FS_ATMO);
const progEnv   = program(VS_QUAD, FS_ENV);
const progSky   = program(VS_QUAD, FS_SKY);
const progOcean = program(VS_OCEAN, FS_OCEAN);
const progProbe = program(VS_QUAD, FS_PROBE);
const progDown  = program(VS_QUAD, FS_DOWN);
const progUp    = program(VS_QUAD, FS_UP);
const progFinal = program(VS_QUAD, FS_FINAL);

// =====================================================================
//  Resources
// =====================================================================
const quadVAO = gl.createVertexArray();
function drawQuad() { gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }

CASC.forEach((c, i) => {
  c.noise = gaussTex(1234 + i * 977);
  c.h0 = makeTex(N, N, gl.RGBA32F); c.h0fb = makeFBO([c.h0]);
  c.fft = [0, 1].map(() => { const t = [makeTex(N, N, gl.RGBA32F), makeTex(N, N, gl.RGBA32F)]; return { tex: t, fb: makeFBO(t) }; });
  const mo = { mip: true, repeat: true, aniso: true };
  c.disp = [makeTex(N, N, gl.RGBA16F, mo), makeTex(N, N, gl.RGBA16F, mo)];
  c.der = makeTex(N, N, gl.RGBA16F, mo);
  c.mom = makeTex(N, N, gl.RGBA16F, mo);
  c.asmFB = [makeFBO([c.disp[0], c.der, c.mom]), makeFBO([c.disp[1], c.der, c.mom])];
  c.cur = 0;
  for (const f of c.asmFB) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]); }
});
const foamTex = foamTexture();

const atmoCube = makeCube(ATMO, gl.RGBA16F), atmoFB = cubeFBOs(atmoCube);
const envCube = makeCube(ENV, gl.RGBA16F), envFB = cubeFBOs(envCube);

// probe readback
const probe = { tex: makeTex(PROBES, 1, gl.RGBA32F), slots: [], data: new Float32Array(PROBES * 4), h: new Float32Array(PROBES), valid: false, issued: 0, got: -1 };
probe.fb = makeFBO([probe.tex]);
for (let i = 0; i < 3; i++) {
  const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, PROBES * 16, gl.STREAM_READ);
  probe.slots.push({ buf: b, fence: null, id: 0 });
}
gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

// ocean mesh: camera-centred polar grid, exponential ring spacing out to 100 km
const SEG = 360, ANG = TAU / SEG;
const mesh = (() => {
  const radii = [0]; let r = 0;
  while (r < 100000) { r += Math.max(0.06, r * ANG); radii.push(r); }
  const R = radii.length, cols = SEG + 1;
  const pos = new Float32Array(R * cols * 2);
  for (let j = 0; j < R; j++) for (let i = 0; i < cols; i++) {
    const a = i * ANG, k = (j * cols + i) * 2;
    pos[k] = Math.cos(a) * radii[j]; pos[k + 1] = Math.sin(a) * radii[j];
  }
  const idx = new Uint32Array((R - 1) * SEG * 6); let n = 0;
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < SEG; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: idx.length, rings: R };
})();

// render targets (MSAA HDR scene + bloom chain)
let W = 0, H = 0, scene = null, bloom = [];
const msaa = (() => {
  const s = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
  return s && s.length ? Math.min(4, s[0]) : 0;
})();
function freeTargets() {
  if (scene) {
    gl.deleteFramebuffer(scene.msFB); gl.deleteFramebuffer(scene.resFB);
    gl.deleteRenderbuffer(scene.colorRB); gl.deleteRenderbuffer(scene.depthRB); gl.deleteTexture(scene.hdr);
  }
  for (const b of bloom) { gl.deleteFramebuffer(b.fb); gl.deleteTexture(b.tex); }
  bloom = [];
}
function createTargets(w, h) {
  freeTargets();
  const colorRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, colorRB);
  if (msaa > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaa, gl.RGBA16F, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA16F, w, h);
  const depthRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
  if (msaa > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaa, gl.DEPTH_COMPONENT24, w, h); else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  const msFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, msFB);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, colorRB);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
  checkFB('scene');
  const hdr = makeTex(w, h, gl.RGBA16F, { linear: true });
  const resFB = makeFBO([hdr]);
  scene = { colorRB, depthRB, msFB, hdr, resFB };
  let bw = w >> 1, bh = h >> 1;
  for (let i = 0; i < 6 && bw >= 2 && bh >= 2; i++) {
    const t = makeTex(bw, bh, gl.RGBA16F, { linear: true });
    bloom.push({ tex: t, fb: makeFBO([t]), w: bw, h: bh });
    bw >>= 1; bh >>= 1;
  }
}
// dynamic resolution keeps integrated GPUs smooth
let resScale = 1, fastChecks = 0;
function adaptResolution(fps) {
  if (fps < 40 && resScale > 0.5) { resScale = Math.max(0.5, resScale * 0.87); fastChecks = 0; }
  else if (fps > 57) { if (++fastChecks >= 4 && resScale < 1) { resScale = Math.min(1, resScale * 1.08); fastChecks = 0; } }
  else fastChecks = 0;
}
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * resScale;
  const w = Math.max(2, Math.round(innerWidth * dpr)), h = Math.max(2, Math.round(innerHeight * dpr));
  if (w === W && h === H) return;
  W = w; H = h; canvas.width = w; canvas.height = h;
  createTargets(w, h);
}

// =====================================================================
//  Sun / atmosphere helpers (CPU)
// =====================================================================
const BR = [5.5e-6, 13.0e-6, 22.4e-6], BO = [0.65e-6, 1.881e-6, 0.085e-6];
const mieCoef = () => 3e-6 + 30e-6 * P.fog;
const SUN_I = 22;
function transmittance(dir) {
  const RP = 6371e3, RA = 6471e3, o = [0, RP + 10, 0];
  const rsi = (d, R) => {
    const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], lo = Math.hypot(o[0], o[1], o[2]);
    const disc = b * b - (lo - R) * (lo + R); if (disc < 0) return null;
    const s = Math.sqrt(disc); return [-b - s, -b + s];
  };
  const pl = rsi(dir, RP); if (pl && pl[0] > 0) return [0, 0, 0];
  const t = rsi(dir, RA)[1], n = 96, ds = t / n;
  let r = 0, m = 0, z = 0;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * ds, p = [o[0] + dir[0] * s, o[1] + dir[1] * s, o[2] + dir[2] * s];
    const h = Math.hypot(p[0], p[1], p[2]) - RP;
    r += Math.exp(-h / 8e3) * ds; m += Math.exp(-h / 1.2e3) * ds; z += Math.max(0, 1 - Math.abs(h - 25e3) / 15e3) * ds;
  }
  const BM = mieCoef();
  return [0, 1, 2].map(i => Math.exp(-(BR[i] * r + BM * 1.1 * m + BO[i] * z)));
}
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const LUM_ZENITH = 0.8;
const sun = { dir: [0, 1, 0], color: [1, 1, 1], autoExp: 1 };
function updateSun() {
  const e = P.sunElev * Math.PI / 180, a = P.sunAz * Math.PI / 180;
  sun.dir = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
  const T = transmittance(sun.dir);
  const edge = Math.min(1, Math.max(0, (P.sunElev + 0.6) / 0.9));
  sun.color = T.map(v => v * SUN_I * edge);
  sun.autoExp = Math.pow(Math.max(lum(T) / LUM_ZENITH, 0.012), -0.45);
}

// sea state estimates (for UI + shading)
const G = 9.81;
function seaState() {
  const U = Math.max(P.wind, 0.5), F = P.fetch * 1000;
  const Feff = Math.min(F, U * U / 5.76e-4);
  const wp = 22 * Math.cbrt(G * G / (U * Feff));
  const hsWind = 0.0016 * U * Math.sqrt(Feff / G) * P.amp;
  const hsSwell = 1.2 * P.swell * P.amp;
  return { Feff, Tp: TAU / wp, Hs: Math.sqrt(hsWind * hsWind + hsSwell * hsSwell) };
}

// =====================================================================
//  Passes
// =====================================================================
function initSpectrum() {
  const st = seaState();
  const wa = P.windDir * Math.PI / 180, sa = wa + 0.61;
  use(progInit);
  gl.viewport(0, 0, N, N);
  uf(progInit, 'u_N', N); uf(progInit, 'u_U', Math.max(P.wind, 0.5)); uf(progInit, 'u_F', st.Feff);
  uf(progInit, 'u_windAng', Math.atan2(Math.cos(wa), Math.sin(wa)));
  uf(progInit, 'u_swellAng', Math.atan2(Math.cos(sa), Math.sin(sa)));
  uf(progInit, 'u_spread', 0.08); uf(progInit, 'u_swell', P.swell); uf(progInit, 'u_amp', P.amp); uf(progInit, 'u_fade', 0.01);
  for (const c of CASC) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, c.h0fb);
    tex(progInit, 'u_noise', c.noise, 0);
    uf(progInit, 'u_L', c.L); uf(progInit, 'u_kLow', c.kLow); uf(progInit, 'u_kHigh', c.kHigh);
    drawQuad();
  }
}

function bakeAtmo() {
  use(progAtmo);
  gl.viewport(0, 0, ATMO, ATMO);
  uf(progAtmo, 'u_size', ATMO); uv3(progAtmo, 'u_sunDir', sun.dir); uf(progAtmo, 'u_sunI', SUN_I); uf(progAtmo, 'u_boost', 1.35); uf(progAtmo, 'u_mie', mieCoef());
  for (let f = 0; f < 6; f++) { gl.bindFramebuffer(gl.FRAMEBUFFER, atmoFB[f]); ui(progAtmo, 'u_face', f); drawQuad(); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, atmoCube); gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
}

const cloudOff = [0, 0];
function setCloudUniforms(pr) { uf(pr, 'u_cloudCover', P.clouds); uf(pr, 'u_cloudOff', cloudOff[0], cloudOff[1]); }
function sunVis() { const oc = Math.min(1, Math.max(0, (P.clouds - 0.55) / 0.45)); return 1 - 0.95 * oc * oc * (3 - 2 * oc); }

function bakeEnv() {
  use(progEnv);
  gl.viewport(0, 0, ENV, ENV);
  tex(progEnv, 'u_atmo', atmoCube, 0, gl.TEXTURE_CUBE_MAP);
  uf(progEnv, 'u_size', ENV); uv3(progEnv, 'u_sunDir', sun.dir); uv3(progEnv, 'u_sunColor', sun.color);
  setCloudUniforms(progEnv);
  for (let f = 0; f < 6; f++) { gl.bindFramebuffer(gl.FRAMEBUFFER, envFB[f]); ui(progEnv, 'u_face', f); drawQuad(); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCube); gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
}

function simulate(t, dt) {
  gl.viewport(0, 0, N, N);
  for (const c of CASC) {
    use(progTime);
    gl.bindFramebuffer(gl.FRAMEBUFFER, c.fft[0].fb);
    tex(progTime, 'u_h0', c.h0, 0);
    uf(progTime, 'u_N', N); uf(progTime, 'u_L', c.L); uf(progTime, 'u_time', t);
    drawQuad();

    use(progFFT);
    ui(progFFT, 'u_N', N);
    let src = 0;
    for (let dir = 0; dir < 2; dir++) {
      ui(progFFT, 'u_horizontal', dir === 0 ? 1 : 0);
      for (let sub = 2; sub <= N; sub *= 2) {
        const dst = 1 - src;
        gl.bindFramebuffer(gl.FRAMEBUFFER, c.fft[dst].fb);
        tex(progFFT, 'u_in0', c.fft[src].tex[0], 0);
        tex(progFFT, 'u_in1', c.fft[src].tex[1], 1);
        ui(progFFT, 'u_sub', sub);
        drawQuad();
        src = dst;
      }
    }

    const next = 1 - c.cur;
    use(progAsm);
    gl.bindFramebuffer(gl.FRAMEBUFFER, c.asmFB[next]);
    tex(progAsm, 'u_fft0', c.fft[src].tex[0], 0);
    tex(progAsm, 'u_fft1', c.fft[src].tex[1], 1);
    tex(progAsm, 'u_prev', c.disp[c.cur], 2);
    uf(progAsm, 'u_lambda', P.chop); uf(progAsm, 'u_dt', dt);
    drawQuad();
    c.cur = next;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (const c of CASC) {
    for (const t2 of [c.disp[c.cur], c.der, c.mom]) { gl.bindTexture(gl.TEXTURE_2D, t2); gl.generateMipmap(gl.TEXTURE_2D); }
  }
}

function bindDisp(pr, base) {
  tex(pr, 'u_disp0', CASC[0].disp[CASC[0].cur], base);
  tex(pr, 'u_disp1', CASC[1].disp[CASC[1].cur], base + 1);
  tex(pr, 'u_disp2', CASC[2].disp[CASC[2].cur], base + 2);
  tex(pr, 'u_disp3', CASC[3].disp[CASC[3].cur], base + 3);
  uf(pr, 'u_L', CASC[0].L, CASC[1].L, CASC[2].L, CASC[3].L);
}

function probeCollect() {
  for (const s of probe.slots) {
    if (!s.fence) continue;
    if (gl.getSyncParameter(s.fence, gl.SYNC_STATUS) !== gl.SIGNALED) continue;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, probe.data);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(s.fence); s.fence = null;
    if (s.id <= probe.got) continue;
    for (let i = 0; i < PROBES; i++) probe.h[i] = probe.data[i * 4];
    probe.got = s.id; probe.valid = true;
  }
}
function probeIssue(points) {
  const s = probe.slots.find(x => !x.fence); if (!s) return;
  const flat = new Float32Array(PROBES * 2);
  points.forEach((p, i) => { flat[i * 2] = p[0]; flat[i * 2 + 1] = p[1]; });
  use(progProbe);
  gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fb);
  gl.viewport(0, 0, PROBES, 1);
  bindDisp(progProbe, 0);
  gl.uniform2fv(progProbe.u.u_probes, flat);
  drawQuad();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.buf);
  gl.readPixels(0, 0, PROBES, 1, gl.RGBA, gl.FLOAT, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  s.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  s.id = ++probe.issued;
}

// =====================================================================
//  Camera
// =====================================================================
const cam = { pos: [0, 7, 0], baseY: 7, yaw: 0, pitch: -0.07, fov: 0.95, mode: 'free', roll: 0 };
const boat = { speed: 4, y: 0, pitch: 0, roll: 0 };
let waterH = 0;
const v3 = {
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
function basis(yaw, pitch, roll) {
  const f = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  let r = v3.norm(v3.cross(f, [0, 1, 0]));
  let u = v3.cross(r, f);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const r2 = [r[0] * c + u[0] * s, r[1] * c + u[1] * s, r[2] * c + u[2] * s];
    const u2 = [u[0] * c - r[0] * s, u[1] * c - r[1] * s, u[2] * c - r[2] * s];
    r = r2; u = u2;
  }
  return { f, r, u };
}
function viewProj(eye, b, fov, aspect, near, far) {
  const { f, r, u } = b;
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -v3.dot(r, eye), -v3.dot(u, eye), v3.dot(f, eye), 1];
  const t = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  const Pm = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  const M = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    let s = 0; for (let k = 0; k < 4; k++) s += Pm[k * 4 + rr] * V[c * 4 + k];
    M[c * 4 + rr] = s;
  }
  return M;
}

const keys = {};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function updateCamera(dt) {
  const fast = (keys.ShiftLeft || keys.ShiftRight) ? 6 : 1;
  const fw = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const st = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const up = (keys.KeyE || keys.Space ? 1 : 0) - (keys.KeyQ || keys.KeyC ? 1 : 0);
  const k = 1 - Math.exp(-dt * 6);
  if (probe.valid) waterH += (probe.h[0] - waterH) * k;

  if (cam.mode === 'free') {
    const b = basis(cam.yaw, cam.pitch, 0);
    const sp = 14 * fast * Math.max(1, cam.baseY / 40) * dt;
    cam.pos[0] += (b.f[0] * fw + b.r[0] * st) * sp;
    cam.pos[2] += (b.f[2] * fw + b.r[2] * st) * sp;
    cam.baseY = clamp(cam.baseY + (b.f[1] * fw + up) * sp, 0.5, 4000);
    cam.pos[1] = Math.max(cam.baseY, waterH + 1.2);
    cam.roll = 0;
    return [[cam.pos[0], cam.pos[2]]];
  }
  // boat: ride the swell, steer with A/D, throttle with W/S
  cam.yaw -= st * 0.6 * dt;
  boat.speed = clamp(boat.speed + fw * 4 * dt, 0, 16);
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  cam.pos[0] += fx * boat.speed * dt; cam.pos[2] += fz * boat.speed * dt;
  if (probe.valid) {
    const h = probe.h;
    const ty = (h[0] * 2 + h[1] + h[2] + h[3] + h[4]) / 6;
    const tp = Math.atan2(h[1] - h[2], 8), tr = Math.atan2(h[4] - h[3], 4);
    const ky = 1 - Math.exp(-dt * 3.5), kr = 1 - Math.exp(-dt * 2.5);
    boat.y += (ty - boat.y) * ky; boat.pitch += (tp - boat.pitch) * kr; boat.roll += (tr - boat.roll) * kr;
  }
  cam.pos[1] = boat.y + 2.3;
  cam.roll = boat.roll * 0.85;
  const x = cam.pos[0], z = cam.pos[2];
  return [[x, z], [x + fx * 4, z + fz * 4], [x - fx * 4, z - fz * 4], [x - rx * 2, z - rz * 2], [x + rx * 2, z + rz * 2]];
}

// =====================================================================
//  Frame
// =====================================================================
let simTime = 0, last = performance.now(), paused = false, shotReq = false;
let fpsAcc = 0, fpsN = 0, fpsShown = 0, statT = 0;
const statsEl = $('#stats');

function frame(now) {
  const rdt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
  resize();
  const ts = paused ? 0 : P.timeScale;
  const dt = rdt * ts;
  simTime += dt;

  // clouds drift with the wind
  const wa = P.windDir * Math.PI / 180;
  cloudOff[0] += Math.sin(wa) * (3 + P.wind * 0.6) * 0.00018 * dt;
  cloudOff[1] += Math.cos(wa) * (3 + P.wind * 0.6) * 0.00018 * dt;

  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  probeCollect();
  if (dirtySky) { updateSun(); bakeAtmo(); dirtySky = false; }
  if (dirtySpec) { initSpectrum(); dirtySpec = false; }
  bakeEnv();
  simulate(simTime % 1000, dt);

  const probePts = updateCamera(rdt);
  probeIssue(probePts);

  const pitch = cam.mode === 'boat' ? cam.pitch + boat.pitch * 0.85 : cam.pitch;
  const b = basis(cam.yaw, pitch, cam.roll);
  const aspect = W / H;
  const vp = viewProj(cam.pos, b, cam.fov, aspect, 0.25, 150000);
  const tanH = Math.tan(cam.fov / 2);
  const sv = sunVis();
  const st = seaState();

  // --- scene ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, scene.msFB);
  gl.viewport(0, 0, W, H);
  gl.depthMask(true);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  use(progSky);
  tex(progSky, 'u_atmo', atmoCube, 0, gl.TEXTURE_CUBE_MAP);
  uv3(progSky, 'u_camF', b.f); uv3(progSky, 'u_camR', b.r); uv3(progSky, 'u_camU', b.u);
  uf(progSky, 'u_tan', tanH * aspect, tanH);
  uv3(progSky, 'u_sunDir', sun.dir); uv3(progSky, 'u_sunColor', sun.color); uf(progSky, 'u_sunVis', sv);
  setCloudUniforms(progSky);
  drawQuad();

  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
  use(progOcean);
  gl.uniformMatrix4fv(progOcean.u.u_vp, false, vp);
  uv3(progOcean, 'u_cam', cam.pos); uf(progOcean, 'u_ang', ANG);
  bindDisp(progOcean, 8);
  CASC.forEach((c, i) => { tex(progOcean, 'u_der' + i, c.der, i); tex(progOcean, 'u_mom' + i, c.mom, 4 + i); });
  tex(progOcean, 'u_foamTex', foamTex, 12);
  tex(progOcean, 'u_env', envCube, 13, gl.TEXTURE_CUBE_MAP);
  uv3(progOcean, 'u_sunDir', sun.dir); uv3(progOcean, 'u_sunColor', sun.color); uf(progOcean, 'u_sunVis', sv);
  uf(progOcean, 'u_foamThresh', 0.3 + 0.7 * P.foam); uf(progOcean, 'u_foamGain', 2.6);
  uf(progOcean, 'u_fogDensity', 0.00001 + P.fog * P.fog * 0.0006);
  uf(progOcean, 'u_baseVar', 0.0012 + 0.00022 * P.wind);
  uf(progOcean, 'u_waveH', Math.max(0.4, st.Hs * 0.5));
  uf(progOcean, 'u_waterColor', 0.0011, 0.0052, 0.0098);
  uf(progOcean, 'u_sssColor', 0.004, 0.030, 0.026);
  setCloudUniforms(progOcean);
  gl.bindVertexArray(mesh.vao);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  gl.bindVertexArray(null);
  gl.disable(gl.DEPTH_TEST);

  // --- resolve MSAA ---
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, scene.msFB);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, scene.resFB);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  // --- bloom ---
  use(progDown);
  let srcT = scene.hdr, sw = W, sh = H;
  bloom.forEach((lv, i) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fb); gl.viewport(0, 0, lv.w, lv.h);
    tex(progDown, 'u_src', srcT, 0); uf(progDown, 'u_texel', 1 / sw, 1 / sh); ui(progDown, 'u_first', i === 0 ? 1 : 0);
    drawQuad(); srcT = lv.tex; sw = lv.w; sh = lv.h;
  });
  use(progUp);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  for (let i = bloom.length - 1; i > 0; i--) {
    const dst = bloom[i - 1], src = bloom[i];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
    tex(progUp, 'u_src', src.tex, 0); uf(progUp, 'u_texel', 1 / src.w, 1 / src.h);
    drawQuad();
  }
  gl.disable(gl.BLEND);

  // --- final ---
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  use(progFinal);
  tex(progFinal, 'u_hdr', scene.hdr, 0);
  tex(progFinal, 'u_bloom', bloom.length ? bloom[0].tex : scene.hdr, 1);
  uf(progFinal, 'u_exposure', 1.15 * P.exposure * sun.autoExp);
  uf(progFinal, 'u_bloomStr', P.bloom * 0.14 / Math.max(1, bloom.length) * 2.0);
  uf(progFinal, 'u_time', now / 1000);
  drawQuad();

  if (shotReq) {
    shotReq = false;
    canvas.toBlob(bl => {
      if (!bl) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(bl);
      a.download = 'okyanus-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }

  // stats
  fpsAcc += rdt; fpsN++; statT += rdt;
  if (statT > 0.5) {
    fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; statT = 0;
    if (!document.hidden) adaptResolution(fpsShown);
    statsEl.textContent = `Hs ≈ ${st.Hs.toFixed(1)} m · Tp ≈ ${st.Tp.toFixed(1)} s · ${fpsShown} fps` + (resScale < 0.99 ? ` · çözünürlük %${Math.round(resScale * 100)}` : '') + (cam.mode === 'boat' ? ` · tekne ${(boat.speed * 1.944).toFixed(0)} knot` : '') + (paused ? ' · duraklatıldı' : '');
  }
  if (!canvas.classList.contains('ready')) canvas.classList.add('ready');
  requestAnimationFrame(frame);
}

// =====================================================================
//  Input
// =====================================================================
let drag = null;
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag'); canvas.focus(); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  const s = 0.0034 * cam.fov;
  cam.yaw -= dx * s; cam.pitch = clamp(cam.pitch - dy * s, -1.45, 1.45);
});
const endDrag = () => { drag = null; canvas.classList.remove('drag'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', e => { e.preventDefault(); cam.fov = clamp(cam.fov * Math.exp(e.deltaY * 0.001), 0.22, 1.7); }, { passive: false });

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyH') togglePanel();
  if (e.code === 'KeyB') setMode(cam.mode === 'free' ? 'boat' : 'free');
  if (e.code === 'KeyP') togglePause();
  if (e.code === 'KeyF') toggleFS();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const panelEl = $('#panel'), showBtn = $('#showPanel');
function togglePanel() { const h = panelEl.classList.toggle('hidden'); showBtn.classList.toggle('vis', h); }
$('#hidePanel').onclick = togglePanel; showBtn.onclick = togglePanel;
function setMode(m) {
  cam.mode = m;
  $('#modeBtn').classList.toggle('on', m === 'boat');
  if (m === 'boat') { boat.y = waterH; boat.pitch = 0; boat.roll = 0; cam.pitch = Math.min(cam.pitch, 0.1); }
  else { cam.baseY = Math.max(cam.pos[1], 3); }
}
$('#modeBtn').onclick = () => setMode(cam.mode === 'free' ? 'boat' : 'free');
function togglePause() { paused = !paused; $('#pauseBtn').classList.toggle('on', paused); $('#pauseBtn').textContent = paused ? 'Devam' : 'Duraklat'; }
$('#pauseBtn').onclick = togglePause;
$('#shotBtn').onclick = () => { shotReq = true; };
function toggleFS() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
$('#fsBtn').onclick = toggleFS;
setTimeout(() => $('#help').classList.add('fade'), 14000);

function applyPreset(name, aim) {
  applyingPreset = true;
  Object.assign(P, PRESETS[name]);
  syncUI();
  applyingPreset = false;
  for (const k in presetBtns) presetBtns[k].classList.toggle('on', k === name);
  dirtySpec = dirtySky = true;
  if (aim) { cam.yaw = P.sunAz * Math.PI / 180 + (PRESETS[name].aim ?? -0.22); cam.pitch = -0.06; }
}

// start
applyPreset('Açık Deniz', true);
resize();
requestAnimationFrame(frame);

// small debug hook for automated checks
window.__ocean = { P, cam, applyPreset, get probe() { return probe; } };
})();
