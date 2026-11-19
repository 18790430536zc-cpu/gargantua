/* ============================================================
 * GARGANTUA — Schwarzschild Black Hole Raytracer
 * 主程序：双通道渲染 / OrbitControls / 电影镜头 / HUD /
 * 21 项参数 / 调试视图 / 质量档 / 持久化 / 截图接口
 * ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { VERT, TRACE_FRAG, POST_FRAG } from './shaders.js';

/* ------------------------------------------------------------
 * 21 项参数定义（key 与着色器 uniform 对应）
 * ---------------------------------------------------------- */
const PARAM_DEFS = [
  { group: '黑洞',   key: 'mass',       label: '质量 (Rs)',     min: 0.6, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '黑洞',   key: 'ringBright', label: '光子环亮度',    min: 0.0, max: 4.0,  def: 0.4,  step: 0.01 },
  { group: '黑洞',   key: 'ringSharp',  label: '光子环锐度',    min: 4.0, max: 24.0, def: 13.0, step: 0.1  },
  { group: '吸积盘', key: 'diskIn',     label: '盘内缘 (Rs)',   min: 2.2, max: 6.0,  def: 3.0,  step: 0.05 },
  { group: '吸积盘', key: 'diskOut',    label: '盘外缘 (Rs)',   min: 5.0, max: 14.0, def: 5.5,  step: 0.1  },
  { group: '吸积盘', key: 'diskBright', label: '盘亮度',        min: 0.2, max: 2.4,  def: 1.0,  step: 0.01 },
  { group: '吸积盘', key: 'diskTemp',   label: '盘温度',        min: 0.4, max: 1.6,  def: 1.0,  step: 0.01 },
  { group: '吸积盘', key: 'turb',       label: '湍流强度',      min: 0.0, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '吸积盘', key: 'speed',      label: '轨道流速',      min: 0.0, max: 2.5,  def: 1.0,  step: 0.01 },
  { group: '吸积盘', key: 'doppler',    label: 'Doppler 增亮',  min: 0.0, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '吸积盘', key: 'redshift',   label: '引力红移',      min: 0.0, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '深空背景', key: 'starDens', label: '星空密度',      min: 0.0, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '深空背景', key: 'galaxy',   label: '银河亮度',      min: 0.0, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '镜头与后期', key: 'fov',    label: '焦距',          min: 0.16,max: 1.0,  def: 0.50, step: 0.01 },
  { group: '镜头与后期', key: 'bloom',  label: 'Bloom 强度',    min: 0.0, max: 2.0,  def: 1.0,  step: 0.01 },
  { group: '镜头与后期', key: 'bloomTh',label: 'Bloom 阈值',    min: 0.2, max: 1.2,  def: 0.55, step: 0.01 },
  { group: '镜头与后期', key: 'exposure',label:'曝光',          min: 0.4, max: 2.0,  def: 0.85, step: 0.01 },
  { group: '镜头与后期', key: 'grain',  label: '胶片颗粒',      min: 0.0, max: 1.5,  def: 0.55, step: 0.01 },
  { group: '镜头与后期', key: 'chroma', label: '色散',          min: 0.0, max: 2.0,  def: 0.6,  step: 0.01 },
  { group: '镜头与后期', key: 'vignette',label:'暗角',          min: 0.0, max: 1.0,  def: 0.5,  step: 0.01 },
];

const QUALITY = {
  standard:  { steps: 96,  pixelRatio: 1.0, label: 'Standard'  },
  high:      { steps: 160, pixelRatio: 1.5, label: 'High'      },
  cinematic: { steps: 256, pixelRatio: 2.0, label: 'Cinematic' },
};

const PRESETS = [
  { name: '标准轨道', pos: [8.90, 4.70, 9.80],  fov: 0.50 },  // dist ≈ 14 Rs（长焦盘外）
  { name: '侧视盘缘', pos: [13.30, 0.90, 4.40], fov: 0.42 },  // dist ≈ 14 Rs
  { name: '高俯角',   pos: [1.75, 13.20, 3.85], fov: 0.52 },  // dist ≈ 14 Rs
  { name: '逼近视界', pos: [2.20, 0.70, 1.50],  fov: 0.62 },  // dist ≈ 2.8 Rs（盘内缘之内）
];

const LS_KEY = 'gargantua-state-v1';
const qs = new URLSearchParams(location.search);

/* ------------------------------------------------------------
 * 状态：URL 参数 > localStorage > 默认值
 * ---------------------------------------------------------- */
const state = { params: {}, quality: 'high', preset: 0 };
for (const d of PARAM_DEFS) state.params[d.key] = d.def;

try {
  const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  if (saved && saved.params) {
    Object.assign(state.params, saved.params);
    if (QUALITY[saved.quality]) state.quality = saved.quality;
  }
} catch (_) { /* 损坏的存档直接忽略 */ }

if (qs.get('quality') && QUALITY[qs.get('quality')]) state.quality = qs.get('quality');
if (qs.get('preset') !== null && PRESETS[+qs.get('preset')]) state.preset = +qs.get('preset');
if (qs.get('params')) {
  try { Object.assign(state.params, JSON.parse(qs.get('params'))); } catch (_) {}
}

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ params: state.params, quality: state.quality }));
    } catch (_) {}
  }, 300);
}

/* ------------------------------------------------------------
 * 渲染器初始化（含 WebGL 错误处理与上下文丢失恢复）
 * ---------------------------------------------------------- */
const canvas = document.getElementById('scene');
const veil = document.getElementById('veil');
const veilText = veil.querySelector('p');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  veilText.textContent = 'WebGL 初始化失败：' + e.message;
  throw e;
}

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  veil.classList.remove('gone');
  veilText.textContent = 'GPU 上下文丢失，正在恢复 …';
});
canvas.addEventListener('webglcontextrestored', () => {
  veilText.textContent = '上下文已恢复，重新加载 …';
  setTimeout(() => location.reload(), 400);
});

/* HDR 渲染目标（半浮点；不支持时降级 8 位） */
const hdrOK = renderer.capabilities.isWebGL2
  ? !!renderer.extensions.get('EXT_color_buffer_float')
  : !!(renderer.extensions.get('OES_texture_half_float') && renderer.extensions.get('EXT_color_buffer_half_float'));
const rt = new THREE.WebGLRenderTarget(2, 2, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: hdrOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
  depthBuffer: false, stencilBuffer: false,
});

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeo = new THREE.PlaneGeometry(2, 2);

const traceUniforms = {
  uRes:      { value: new THREE.Vector2(1, 1) },
  uTime:     { value: 0 },
  uCamPos:   { value: new THREE.Vector3() },
  uCamRight: { value: new THREE.Vector3() },
  uCamUp:    { value: new THREE.Vector3() },
  uCamFwd:   { value: new THREE.Vector3() },
  uFov:      { value: state.params.fov },
  uMass:     { value: state.params.mass },
  uDiskIn:   { value: state.params.diskIn },
  uDiskOut:  { value: state.params.diskOut },
  uDiskBright:{ value: state.params.diskBright },
  uDiskTemp: { value: state.params.diskTemp },
  uTurb:     { value: state.params.turb },
  uSpeed:    { value: state.params.speed },
  uDoppler:  { value: state.params.doppler },
  uRedshift: { value: state.params.redshift },
  uRingBright:{ value: state.params.ringBright },
  uRingSharp:{ value: state.params.ringSharp },
  uStarDens: { value: state.params.starDens },
  uGalaxy:   { value: state.params.galaxy },
  uSteps:    { value: QUALITY[state.quality].steps },
  uDebug:    { value: qs.get('debug') !== null ? +qs.get('debug') : 0 },
};
const postUniforms = {
  tScene:    { value: rt.texture },
  uRes:      { value: new THREE.Vector2(1, 1) },
  uTime:     { value: 0 },
  uBloom:    { value: state.params.bloom },
  uBloomTh:  { value: state.params.bloomTh },
  uExposure: { value: state.params.exposure },
  uGrain:    { value: state.params.grain },
  uChroma:   { value: state.params.chroma },
  uVignette: { value: state.params.vignette },
  uDebug:    { value: traceUniforms.uDebug.value },
};

function makePass(frag, uniforms) {
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false,
  }));
  quad.frustumCulled = false;
  scene.add(quad);
  return scene;
}
const traceScene = makePass(TRACE_FRAG, traceUniforms);
const postScene = makePass(POST_FRAG, postUniforms);

/* ------------------------------------------------------------
 * 观测相机 + OrbitControls
 * ---------------------------------------------------------- */
const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 2.4;
controls.maxDistance = 22;
controls.zoomSpeed = 0.9;

function applyPreset(i) {
  const p = PRESETS[i];
  state.preset = i;
  camera.position.set(...p.pos);
  camera.lookAt(0, 0, 0);
  setParam('fov', p.fov);
  controls.update();
  document.querySelectorAll('.preset-btn').forEach((b, j) =>
    b.classList.toggle('active', j === i));
}
/* 注意：初始 applyPreset 在 setParam 定义之后调用（见文件底部附近） */

/* ------------------------------------------------------------
 * 参数面板（DOM 由 PARAM_DEFS 生成）
 * ---------------------------------------------------------- */
const panelBody = document.getElementById('panel-body');
const sliderRefs = {};
let currentGroup = null;
for (const d of PARAM_DEFS) {
  if (d.group !== currentGroup) {
    currentGroup = d.group;
    const h = document.createElement('div');
    h.className = 'group-title';
    h.textContent = d.group;
    panelBody.appendChild(h);
  }
  const row = document.createElement('div');
  row.className = 'ctl';
  row.innerHTML = `<label>${d.label}<output>${state.params[d.key].toFixed(2)}</output></label>`;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = d.min; input.max = d.max; input.step = d.step;
  input.value = state.params[d.key];
  input.setAttribute('aria-label', d.label);
  row.appendChild(input);
  panelBody.appendChild(row);
  sliderRefs[d.key] = { input, out: row.querySelector('output'), def: d };

  input.addEventListener('input', () => {
    setParam(d.key, parseFloat(input.value));
    persist();
  });
  paintSlider(input);
}
function paintSlider(input) {
  const pct = (input.value - input.min) / (input.max - input.min) * 100;
  input.style.setProperty('--fill', pct + '%');
}

const UNIFORM_MAP = {
  fov: ['trace', 'uFov'], mass: ['trace', 'uMass'],
  diskIn: ['trace', 'uDiskIn'], diskOut: ['trace', 'uDiskOut'],
  diskBright: ['trace', 'uDiskBright'], diskTemp: ['trace', 'uDiskTemp'],
  turb: ['trace', 'uTurb'], speed: ['trace', 'uSpeed'],
  doppler: ['trace', 'uDoppler'], redshift: ['trace', 'uRedshift'],
  ringBright: ['trace', 'uRingBright'], ringSharp: ['trace', 'uRingSharp'],
  starDens: ['trace', 'uStarDens'], galaxy: ['trace', 'uGalaxy'],
  bloom: ['post', 'uBloom'], bloomTh: ['post', 'uBloomTh'],
  exposure: ['post', 'uExposure'], grain: ['post', 'uGrain'],
  chroma: ['post', 'uChroma'], vignette: ['post', 'uVignette'],
};
function setParam(key, val) {
  state.params[key] = val;
  const m = UNIFORM_MAP[key];
  if (m) (m[0] === 'trace' ? traceUniforms : postUniforms)[m[1]].value = val;
  const ref = sliderRefs[key];
  if (ref) {
    if (document.activeElement !== ref.input) ref.input.value = val;
    ref.out.textContent = val.toFixed(2);
    paintSlider(ref.input);
  }
}

/* ------------------------------------------------------------
 * 质量档 / 面板开关 / 音乐 / 电影镜头
 * ---------------------------------------------------------- */
function setQuality(q) {
  state.quality = q;
  traceUniforms.uSteps.value = QUALITY[q].steps;
  resize();
  persist();
  document.querySelectorAll('.q-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.q === q));
  hudDirty.quality = true;
}
document.querySelectorAll('.q-btn').forEach(b =>
  b.addEventListener('click', () => setQuality(b.dataset.q)));

const panel = document.getElementById('panel');
document.getElementById('panel-toggle').addEventListener('click', () => {
  panel.classList.toggle('collapsed');
  document.getElementById('panel-toggle').textContent =
    panel.classList.contains('collapsed') ? '展开参数' : '收起参数';
});

const audio = document.getElementById('ambient');
let musicOn = false;
function toggleMusic() {
  musicOn = !musicOn;
  if (musicOn) {
    audio.volume = 0.55;
    audio.play().catch(() => { musicOn = false; updateMusicBtn(); });
  } else audio.pause();
  updateMusicBtn();
}
function updateMusicBtn() {
  document.getElementById('b-music').classList.toggle('active', musicOn);
}
document.getElementById('b-music').addEventListener('click', toggleMusic);

/* 电影镜头：闭合的慢速环绕 + 呼吸式距离与倾角 */
let cinematic = qs.get('cinematic') === '1';
let cineTheta = Math.atan2(camera.position.z, camera.position.x);
function toggleCinematic(force) {
  cinematic = force !== undefined ? force : !cinematic;
  controls.enabled = !cinematic;
  document.getElementById('b-cine').classList.toggle('active', cinematic);
  if (cinematic) cineTheta = Math.atan2(camera.position.z, camera.position.x);
}
document.getElementById('b-cine').addEventListener('click', () => toggleCinematic());
toggleCinematic(cinematic);

document.getElementById('b-reset').addEventListener('click', () => {
  for (const d of PARAM_DEFS) setParam(d.key, d.def);
  applyPreset(0);
  persist();
});

/* ------------------------------------------------------------
 * 快捷键
 *   1-4 视角预设 | D + 0-9 调试视图 | C 电影镜头 | M 音乐
 *   H HUD | F 全屏 | R 重置 | Esc 退出调试
 * ---------------------------------------------------------- */
let debugArmed = false;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  if (debugArmed && /^[0-9]$/.test(k)) {
    traceUniforms.uDebug.value = +k;
    postUniforms.uDebug.value = +k;
    hudDirty.debug = true;
    if (+k === 0) debugArmed = false;
    return;
  }
  if (k >= '1' && k <= '4') return applyPreset(+k - 1);
  switch (k) {
    case 'd':
      debugArmed = !debugArmed;
      if (!debugArmed) {
        traceUniforms.uDebug.value = 0;
        postUniforms.uDebug.value = 0;
      }
      hudDirty.debug = true;
      break;
    case 'c': toggleCinematic(); break;
    case 'm': toggleMusic(); break;
    case 'h': document.body.classList.toggle('hide-hud'); break;
    case 'r': document.getElementById('b-reset').click(); break;
    case 'f':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
      break;
    case 'escape':
      debugArmed = false;
      traceUniforms.uDebug.value = 0;
      postUniforms.uDebug.value = 0;
      hudDirty.debug = true;
      break;
  }
});

/* ------------------------------------------------------------
 * HUD
 * ---------------------------------------------------------- */
const hudDirty = { quality: true, debug: true };
const el = (id) => document.getElementById(id);
const DEBUG_NAMES = ['正常', '步数热力', '最近接近', '穿越次数', '仅星空',
                     '仅吸积盘', '光子环', '视界掩码', '偏折角', '原始HDR'];

/* ------------------------------------------------------------
 * URL 截图自动化接口
 *   ?shot=1&t=30&preset=2&quality=cinematic&debug=0
 *   渲染稳定后 window.__SHOT_READY__ = true, title 置为 GARGANTUA_READY
 * ---------------------------------------------------------- */
const SHOT = qs.get('shot') === '1';
const FREEZE_T = qs.get('t') !== null ? parseFloat(qs.get('t')) : null;
let framesRendered = 0;

/* ------------------------------------------------------------
 * 主循环
 * ---------------------------------------------------------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, QUALITY[state.quality].pixelRatio);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  const pw = canvas.width, ph = canvas.height;
  rt.setSize(pw, ph);
  traceUniforms.uRes.value.set(pw, ph);
  postUniforms.uRes.value.set(pw, ph);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
applyPreset(state.preset);
resize();

const start = performance.now();
let fpsLast = start, fpsFrames = 0, fps = 0;
let veilLifted = false;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();

function frame(now) {
  const t = FREEZE_T !== null ? FREEZE_T : (now - start) / 1000;
  traceUniforms.uTime.value = t;
  postUniforms.uTime.value = t;

  if (cinematic) {
    cineTheta += 0.0012;
    const T = t * 0.06;
    const dist = 8.2 + 3.4 * Math.sin(T * 0.9);
    const phi = 0.32 + 0.42 * Math.sin(T * 0.7 + 1.3);
    camera.position.set(
      dist * Math.cos(phi) * Math.cos(cineTheta),
      dist * Math.sin(phi),
      dist * Math.cos(phi) * Math.sin(cineTheta)
    );
    camera.lookAt(0, 0, 0);
  } else {
    controls.update();
  }

  camera.getWorldDirection(fwd);
  right.crossVectors(fwd, camera.up).normalize();
  up.crossVectors(right, fwd);
  traceUniforms.uCamPos.value.copy(camera.position);
  traceUniforms.uCamFwd.value.copy(fwd);
  traceUniforms.uCamRight.value.copy(right);
  traceUniforms.uCamUp.value.copy(up);

  renderer.setRenderTarget(rt);
  renderer.render(traceScene, quadCam);
  renderer.setRenderTarget(null);
  renderer.render(postScene, quadCam);

  /* HUD 刷新（每 10 帧） */
  fpsFrames++;
  if (now - fpsLast > 500) {
    fps = 1000 * fpsFrames / (now - fpsLast);
    fpsFrames = 0; fpsLast = now;
  }
  if (fpsFrames % 10 === 0) {
    const dist = camera.position.length();
    const incl = 90 - Math.asin(Math.min(1, Math.abs(camera.position.y) / dist)) * 180 / Math.PI;
    el('h-dist').textContent = dist.toFixed(2);
    el('h-incl').textContent = incl.toFixed(1);
    el('h-fps').textContent = fps.toFixed(0);
    if (hudDirty.quality) {
      el('h-quality').textContent = QUALITY[state.quality].label + ' · ' + QUALITY[state.quality].steps + ' 步';
      hudDirty.quality = false;
    }
    if (hudDirty.debug) {
      el('h-debug').textContent = debugArmed || traceUniforms.uDebug.value > 0
        ? DEBUG_NAMES[traceUniforms.uDebug.value] : '关';
      hudDirty.debug = false;
    }
  }

  if (!veilLifted) {
    veilLifted = true;
    veil.classList.add('gone');
    setQuality(state.quality);
  }

  framesRendered++;
  if (SHOT && framesRendered === 45) {
    window.__SHOT_READY__ = true;
    document.title = 'GARGANTUA_READY';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
