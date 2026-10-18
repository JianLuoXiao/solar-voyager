/**
 * main.js — 装配与渲染循环
 * 渲染管线：场景 → HDR 半浮点缓冲 → UnrealBloom → ACES 色调映射 → sRGB
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import * as TEX from './textures.js';
import { buildDeepSky } from './deepsky.js';
import { buildSolarSystem } from './celestial.js';
import { createFlightControls } from './controls.js';
import { createUI } from './ui.js';
import { buildSurfaceWorld } from './surface.js';
import { SUN, SURFACES } from './data.js';

// 版本标记：用于确认浏览器实际执行的是哪一份模块（排查缓存问题）
window.__BUILD = 'C-surface1';

const canvas = document.getElementById('scene-view');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
 *  设备与画质
 * ========================================================== */
const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
/**
 * 是否触屏设备。
 * 用 maxTouchPoints 而不是 UA 字符串：UA 会撒谎（桌面 Chrome 开设备模拟也带
 * touch 能力），而 maxTouchPoints 反映的是这台设备真实报上来的触点数。
 * 再或上 (hover:none)+(pointer:coarse) 兜住"平板接鼠标"这种混合情况。
 */
const isTouch = (navigator.maxTouchPoints || 0) > 0 &&
  (window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches);
const memHint = navigator.deviceMemory || navigator.hardwareConcurrency || 4;
let quality = isCoarse ? 'medium' : (memHint >= 8 ? 'high' : 'medium');
const qualityCycle = ['low', 'medium', 'high'];

/* ============================================================
 *  渲染器 / 场景 / 相机
 * ========================================================== */
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: quality !== 'low', powerPreference: 'high-performance', stencil: false
});
renderer.setClearColor(0x03050b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;      // 由末端自定义 pass 统一处理
// 地表场景需要投影。这里一次性打开：轨道场景里没有任何 castShadow 的光源，
// 所以不会额外付出代价；反过来若等到进地表再开，会触发一轮全量 shader 重编译。
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// 手动复位渲染统计：默认每 pass 自动清零，__DEBUG 里就只能读到"最后一个 pass"的数字
renderer.info.autoReset = false;
renderer.setSize(window.innerWidth, window.innerHeight);

const pixelRatioBase = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.75 : 1.35);
renderer.setPixelRatio(pixelRatioBase);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 30000);
camera.position.set(0, 190, 560);
scene.add(camera);

/* ============================================================
 *  末端：ACES 色调映射 + sRGB 编码
 * ========================================================== */
const AcesPassShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1.0 },
    vignette: { value: 0.32 },
    grain: { value: 0.045 },
    /* ★ 电影感补充：轻色差 + 冷暖分级（阴影偏青、高光偏暖）。
       地表模式开，轨道模式关（星空不需要）。 */
    ca: { value: 0.0 },
    grade: { value: 0.0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float exposure; uniform float vignette; uniform float grain;
    uniform float ca; uniform float grade;
    varying vec2 vUv;
    vec3 aces(vec3 x){
      const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
      return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
    }
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 q = vUv - 0.5;
      /* 轻度色差：径向 RGB 分离，只在画面边缘起作用（q² 加权） */
      vec2 off = q * dot(q,q) * ca;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col = aces(col * exposure);
      // 冷暖分级：暗部压进青蓝、亮部推向暖橙 —— 概念图里的"逆光尘霾"色调
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.93, 1.0, 1.09), (1.0 - smoothstep(0.0, 0.45, l)) * grade);
      col = mix(col, col * vec3(1.07, 1.0, 0.90), smoothstep(0.55, 1.0, l) * grade);
      // 暗角
      float v = 1.0 - dot(q,q) * vignette * 2.2;
      col *= clamp(v, 0.0, 1.0);
      // 细微胶片颗粒，压掉大面积渐变的色带
      float g = (hash(vUv * 1024.0) - 0.5) * grain;
      col += g;
      // 线性 -> sRGB
      vec3 srgb = mix(col * 12.92, 1.055 * pow(max(col, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, col));
      gl_FragColor = vec4(srgb, 1.0);
    }
  `
};

/* ============================================================
 *  体积光束（God Rays）
 *  GPU Gems 3 的屏幕空间光散射简化版：从太阳的屏幕坐标向四周
 *  径向采样 20 次，只累计"亮于阈值"的像素（太阳本体与光晕），
 *  衰减权重让光束往远处淡出。尘埃大气里的光柱就是这么来的。
 * ========================================================== */
const CinemaPassShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.9) },
    uStrength: { value: 0.0 },
    uDecay: { value: 0.93 },
    uDensity: { value: 0.85 },
    uWeight: { value: 0.13 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uSunUv;
    uniform float uStrength, uDecay, uDensity, uWeight;
    varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength < 0.003) { gl_FragColor = base; return; }
      vec2 delta = (uSunUv - vUv) / 20.0 * uDensity;
      vec2 coord = vUv;
      float illum = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 20; i++) {
        coord += delta;
        vec3 s = texture2D(tDiffuse, clamp(coord, 0.0, 1.0)).rgb;
        float b = max(s.r, max(s.g, s.b));
        /* ★ 阈值必须高：尘霾天空本身在 HDR 域就有 0.6~1.0 的亮度，
           阈值低了 20 次采样会把整个天空累加成一片白（第一版就炸了）。
           只有真正接近太阳本体的高亮像素才允许贡献光束。 */
        acc += s * smoothstep(0.92, 1.55, b) * illum * uWeight;
        illum *= uDecay;
      }
      gl_FragColor = vec4(base.rgb + acc * uStrength, base.a);
    }
  `
};

let composer, bloomPass, acesPass, renderPass, cinemaPass;
const _sunW = new THREE.Vector3();
const _sunV = new THREE.Vector3();
function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8,    // strength
    0.5,    // radius
    0.72    // threshold —— 只让太阳、彗星与亮星泛光，星野保持锐利
  );
  composer.addPass(bloomPass);
  /* 体积光束：插在 bloom 之后、ACES 之前（在 HDR 线性域里叠光最自然） */
  cinemaPass = new ShaderPass(CinemaPassShader);
  composer.addPass(cinemaPass);
  acesPass = new ShaderPass(AcesPassShader);
  acesPass.renderToScreen = true;
  composer.addPass(acesPass);
}

/* ============================================================
 *  后视镜（右下角小窗）
 * ========================================================== */
const rear = {
  enabled: false,
  cam: new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 30000),
  rt: new THREE.WebGLRenderTarget(480, 270, { type: THREE.HalfFloatType }),
  scene: new THREE.Scene(),
  ortho: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
  ready: false
};
function setupRearView() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rear.rt.texture }, exposure: { value: 1.0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float exposure; varying vec2 vUv;
      vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
        return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
      void main(){
        vec3 col = aces(texture2D(tDiffuse, vUv).rgb * exposure);
        vec3 srgb = mix(col*12.92, 1.055*pow(max(col,vec3(0.0)),vec3(1.0/2.4))-0.055, step(0.0031308,col));
        gl_FragColor = vec4(srgb, 1.0);
      }`
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  rear.scene.add(mesh);
  // 边框
  const frameGeo = new THREE.EdgesGeometry(geo);
  const frame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.5 }));
  rear.scene.add(frame);
  rear.mesh = mesh; rear.frame = frame;
  layoutRearView();
}
function layoutRearView() {
  const w = 0.42, h = 0.42 * (9 / 16) * (window.innerWidth / window.innerHeight) * (16 / 9);
  const hh = 0.24, ww = hh * (270 / 480) * (9 / 16) * (16 / 9) * (window.innerWidth / window.innerHeight);
  // 以视口宽高比换算右下角小窗尺寸（NDC 空间）
  const aspect = window.innerWidth / window.innerHeight;
  const height = 0.30, width = height * (480 / 270) / aspect;
  const margin = 0.02;
  rear.mesh.scale.set(width, height, 1);
  rear.frame.scale.set(width, height, 1);
  const x = 1 - width / 2 - margin - 0.06;
  const y = -1 + height / 2 + margin + 0.075;
  rear.mesh.position.set(x, y, 0);
  rear.frame.position.set(x, y, 0);
  rear.ready = true;
}
const rearQ = new THREE.Quaternion();
const flipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
function renderRearView() {
  rear.cam.position.copy(camera.position);
  rearQ.copy(camera.quaternion).multiply(flipQ);
  rear.cam.quaternion.copy(rearQ);
  rear.cam.fov = 72; rear.cam.aspect = 480 / 270; rear.cam.updateProjectionMatrix();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rear.rt);
  renderer.clear();
  renderer.render(scene, rear.cam);
  renderer.setRenderTarget(prev);
}

/* ============================================================
 *  主流程
 * ========================================================== */
let api, sky, ui, controls;
let worldScale = 1;
let timeMul = 1;
let selectedEntry = null;
let labelEntries = [];

/**
 * 双表查询：labelEntries 只含太阳 + 行星，卫星单独放在 window.__moonEntries。
 * 少了这一步，查卫星会落空并退回 labelEntries[0]（恰好在原点的太阳）。
 */
const findAnyEntry = (id) =>
  labelEntries.find((x) => x.id === id) ||
  ((typeof window !== 'undefined' && window.__moonEntries) || []).find((x) => x.id === id);

async function boot() {
  // 简易进度器（真正的 UI 实例稍后才会创建）
  const setP = (p, m) => bootProgress(p, m);

  setP(2, '合成星尘与星系');
  await sleep(40);

  // 深空贴图（数量按画质裁剪）
  /* ★ 星点贴图从 128 提到 256：新版是"艾里斑 + 长晕 + 锥形绕射尖刺"，
     128px 画不下那圈柔晕和细尖刺，会被采样成模糊的一坨。
     星云/星系贴图同样提到 512（高画质），因为新版有对数螺线 + 尘埃带 +
     恒星颗粒这些高频细节，太小就糊成一片。 */
  const starSprite = TEX.starSprite(quality === 'high' ? 256 : 128, 0xffffff);
  setP(6, '点亮猎户悬臂');
  await sleep(20);
  const nebulaCount = quality === 'high' ? 7 : quality === 'medium' ? 5 : 3;
  const galaxyCount = quality === 'high' ? 10 : quality === 'medium' ? 7 : 4;
  const nebulae = [], galaxies = [];
  const nebulaPalettes = [
    [0x3a1f6e, 0x123a6a], [0x6e1f3a, 0x2a0a1e], [0x1f6e5a, 0x0a2438],
    [0x2a3a8a, 0x101838], [0x7a4a1f, 0x3a1a0a], [0x4a1f6e, 0x1a1040], [0x1f5a6e, 0x081828]
  ];
  const nebSize = quality === 'high' ? 384 : 192;
  for (let i = 0; i < nebulaCount; i++) {
    const [a, b] = nebulaPalettes[i % nebulaPalettes.length];
    nebulae.push(TEX.nebulaSprite(nebSize, 100 + i * 13, a, b));
    setP(6 + (i / nebulaCount) * 6, `注入星云 ${i + 1}/${nebulaCount}`);
    await sleep(10);
  }
  const galSize = quality === 'high' ? 512 : 256;
  for (let i = 0; i < galaxyCount; i++) {
    const tints = [
      [0xfff2cc, 0x9bb8ff, 0x2a1a3a],
      [0xffd8b0, 0xff9bb0, 0x3a1a2a],
      [0xe0f0ff, 0x7aa8ff, 0x1a2438],
      [0xffe8cc, 0xffc890, 0x3a2a1a]
    ];
    galaxies.push(TEX.galaxySprite(galSize, 200 + i * 17, tints[i % 4], i % 3 === 0 ? 2 : (i % 3 === 1 ? 4 : 3), 0.35 + (i % 5) * 0.16));
    setP(12 + (i / galaxyCount) * 5, `旋涡星系 ${i + 1}/${galaxyCount}`);
    await sleep(10);
  }

  setP(18, '铺设银河全景');
  sky = buildDeepSky(scene, { pixelRatio: pixelRatioBase, quality, starSpriteTex: starSprite });
  sky.addBillboards(nebulae, galaxies);
  /* 暴露深空层内部状态给自动化测试（getter 版，能反映异步加载结果） */
  window.__deepskyDebug = sky._debug;
  await sleep(30);

  // 早期进度：直接操作 DOM，避免重复创建 UI 实例
  api = await buildSolarSystem(scene, {
    quality,
    onProgress: (p, m) => bootProgress(18 + p * 0.74, m)
  });

  setP(94, '校准光学传感器');
  await sleep(30);

  setupComposer();
  setupRearView();

  // 构建 UI 数据
  labelEntries = [
    { id: 'sun', kind: 'sun', name: '太阳', en: 'SOL', data: SUN, holder: api.sun.group, radius: SUN.radius, moons: [] },
    ...api.bodies.map((b) => ({
      id: b.id, kind: 'planet', name: b.name, en: b.en, data: b.data,
      holder: b.holder, radius: b.radius,
      moons: b.moons.map((m) => ({ id: m.id, data: m.data, holder: m.pos, radius: m.data.radius }))
    }))
  ];
  const moonEntries = api.bodies.flatMap((b) =>
    b.moons.map((m) => ({
      id: m.id, kind: 'moon', name: m.data.name, en: m.data.en, data: m.data,
      holder: m.pos, radius: m.data.radius, moons: []
    }))
  );

  controls = createFlightControls(camera, canvas, {
    getWorldScale: () => worldScale,
    setWorldScale: (s) => { worldScale = s; api.root.scale.setScalar(s); syncScaleSlider(s); },
    onLockChange: (locked) => document.body.classList.toggle('locked', locked)
  });
  controls.setInitial(new THREE.Vector3(0, 150, 430), new THREE.Vector3(0, 0, 0));

  // UI 实例：全程只创建一次（重复创建会导致事件重复绑定）
  window.__moonEntries = moonEntries;
  ui = createUI({
    entries: labelEntries,
    handlers: {
      onLaunch: startSequence,
      onSelect: (e) => { selectedEntry = e; },
      onFollow: (e) => followEntry(e),
      onGoto: (e) => gotoEntry(e),
      onLand: (e) => landOnEntry(e),
      onReturn: () => returnToOrbit(),
      canLand: (id, strict) => {
        const c = SURFACES[id];
        if (!c) return false;
        return strict ? !!c.ready : true;
      }
    }
  });

  bindUI();

  setP(98, '生成首帧');
  await sleep(20);
  renderer.compile(scene, camera);
  composer.render();
  setTimeout(() => ui.ready(), 220);

  startLoop();
}

/* ============================================================
 *  导航
 * ========================================================== */
function entryToBody(e) {
  // 返回 { holder, radius } —— 供 controls 跟随
  return { holder: e.holder, radius: e.radius };
}
function followEntry(e) {
  controls.followBody(entryToBody(e), e.kind === 'sun' ? 6.5 : 5.2);
  ui.toast(`已进入 ${e.name} 轨道`);
}
function gotoEntry(e) {
  const body = entryToBody(e);
  const target = new THREE.Vector3();
  body.holder.getWorldPosition(target);
  const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
  if (dir.lengthSq() < 0.01) dir.set(0, 0.4, 1).normalize();
  const dest = target.clone().addScaledVector(dir, Math.max(body.radius * 6 * worldScale, 6));
  controls.flyTo(dest, target, 2.6);
  ui.toast(`正在前往 ${e.name}`);
}

/* ============================================================
 *  行星登陆 —— 白光闪入 / 地表行走 / 白光返航
 * ========================================================== */
let surfaceWorld = null;
let surfaceMode = false;
let surfaceBusy = false;
const orbitSaved = {
  pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
  near: 0.05, far: 30000, id: null
};

const flashEl = () => document.getElementById('flash');

/** 白幕：t=1 变白（覆盖），t=0 透明（揭开） */
function flashCover(seconds) {
  const el = flashEl();
  if (!el) return;
  el.classList.remove('burst');
  void el.offsetWidth;            // 强制重排，让 animation 能重新触发
  el.classList.add('burst');
  el.style.transition = `opacity ${seconds}s cubic-bezier(.55,.06,.68,.19)`;
  el.style.opacity = '1';
}
function flashReveal(seconds) {
  const el = flashEl();
  if (!el) return;
  el.style.transition = `opacity ${seconds}s cubic-bezier(.22,.61,.36,1)`;
  el.style.opacity = '0';
}

/** 登陆：先俯冲，再白光切场景 */
async function landOnEntry(entry) {
  const cfg = SURFACES[entry.id];
  if (!cfg || !cfg.ready) { ui.toast(`${entry.name} 地表仍在筹备中`); return; }
  if (surfaceBusy || surfaceMode) return;
  // 过场巡飞进行中不允许登陆 —— 否则两次转场会互相覆盖相机控制权
  if (controls.getMode() === 'transit') { ui.toast('巡航中，请稍候'); return; }
  surfaceBusy = true;

  orbitSaved.pos.copy(camera.position);
  orbitSaved.quat.copy(camera.quaternion);
  orbitSaved.near = camera.near;
  orbitSaved.far = camera.far;
  orbitSaved.id = entry.id;

  ui.toast(`正在进入 ${entry.name} 大气层`);

  // 阶段 1：朝星球表面俯冲
  const body = entryToBody(entry);
  const target = new THREE.Vector3();
  body.holder.getWorldPosition(target);
  const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
  if (dir.lengthSq() < 0.01) dir.set(0, 0.5, 1).normalize();
  const dest = target.clone().addScaledVector(dir, body.radius * 1.35 * worldScale + 1.5);
  controls.releaseToFree();
  controls.flyTo(dest, target, 1.15);
  await sleep(430);
  // 阶段 2：白光爆开
  flashCover(0.55);
  await sleep(560);

  // 阶段 3：在纯白掩护下换场景（构建开销被完全藏住）
  controls.setEnabled(false);
  try {
    /* ★ 火星：预载真实 HiRISE DEM 地表套件（几何+贴图同源）。
       白光掩护期正好用来加载；失败退回旧的正射拼合套件；
       再失败返回 null，surface.js 走程序化兜底 */
    let demSet = null, groundSet = null;
    if (cfg.id === 'mars') {
      try { demSet = await TEX.marsDemSet(); } catch (e) { demSet = null; }
      if (!demSet) {
        try { groundSet = await TEX.marsGroundSet(); } catch (e) { groundSet = null; }
      }
    }
    surfaceWorld = buildSurfaceWorld(cfg, { quality, groundSet, dem: demSet });
  } catch (err) {
    console.error('地表构建失败：', err);
    surfaceBusy = false;
    controls.setEnabled(true);
    flashReveal(0.5);
    ui.toast('地表构建失败，已返回轨道');
    return;
  }
  renderPass.scene = surfaceWorld.scene;
  camera.up.set(0, 1, 0);
  camera.near = 0.08;
  camera.far = 1600;
  camera.updateProjectionMatrix();
  // 地表光照角很小（黄昏低角度光），整体提一档曝光，否则地面黑成一团；
  // ACES 会自己压高光，所以天空不会跟着爆掉
  acesPass.uniforms.exposure.value = 1.5;
  surfaceMode = true;

  controls.enterWalk({
    spawn: surfaceWorld.spawn,
    yaw: surfaceWorld.yaw,
    pitch: -0.03,
    gravity: surfaceWorld.gravity,
    jump: surfaceWorld.jump,
    eye: surfaceWorld.eye,
    bound: surfaceWorld.bound,
    getHeight: surfaceWorld.heightAt
  });
  controls.setEnabled(true);
  document.body.classList.add('on-surface');
  ui.setSurfaceMode(true, cfg);
  document.getElementById('touch-ctl').classList.remove('hidden');
  window.__touchHint && window.__touchHint();

  await sleep(120);
  flashReveal(1.15);
  surfaceBusy = false;
  setTimeout(() => ui.toast(isTouch ? `${cfg.name} 地表 · 左摇杆行走` : `${cfg.name} 地表 · ESC 返航`), 700);
}

/** 返航：白光 -> 拆掉地表 -> 回到轨道并重新跟随该星球 */
async function returnToOrbit() {
  if (!surfaceMode || surfaceBusy) return;
  surfaceBusy = true;
  controls.setEnabled(false);
  flashCover(0.42);
  await sleep(440);

  const id = surfaceWorld ? surfaceWorld.id : orbitSaved.id;
  if (surfaceWorld) { surfaceWorld.dispose(); surfaceWorld = null; }
  renderPass.scene = scene;
  camera.near = orbitSaved.near;
  camera.far = orbitSaved.far;
  camera.updateProjectionMatrix();
  acesPass.uniforms.exposure.value = 1.0;
  surfaceMode = false;

  document.body.classList.remove('on-surface');
  ui.setSurfaceMode(false);
  document.getElementById('touch-ctl').classList.add('hidden');
  controls.setTouchMove(0, 0);
  controls.setTouchJump(false);

  camera.position.copy(orbitSaved.pos);
  camera.quaternion.copy(orbitSaved.quat);
  controls.releaseToFree();
  controls.setEnabled(true);

  flashReveal(1.0);
  surfaceBusy = false;

  const e = id ? findAnyEntry(id) : null;
  setTimeout(() => {
    if (e) { ui.select(e); followEntry(e); ui.toast(`已脱离 ${e.name} 地表`); }
    else ui.toast('已返回轨道');
  }, 260);
}

function startSequence() {
  // 入场：从深空缓缓切入内太阳系，太阳光球占据视野中心
  const from = new THREE.Vector3(90, 420, 1300);
  const to = new THREE.Vector3(-6, 34, 148);
  camera.position.copy(from);
  controls.setInitial(from, new THREE.Vector3(0, 0, 0));
  controls.flyTo(to, new THREE.Vector3(0, 0, 0), 5.2);
  ui.toast('推进器已就绪 · 祝你航行愉快');
  setTimeout(() => ui.toast('拖动鼠标环视四周 · 滚轮缩放空间'), 3600);
}

/* ============================================================
 *  交互绑定
 * ========================================================== */
let showLabels = true, showOrbits = true, showBelts = true;
const raycaster = new THREE.Raycaster();
raycaster.far = 20000;
const pointer = new THREE.Vector2();

function pickTargets() {
  const arr = [api.sun.mesh];
  for (const b of api.bodies) {
    arr.push(b.mesh);
    for (const m of b.moons) arr.push(m.mesh);
  }
  return arr;
}
let _targets = null;

function findEntryByMesh(mesh) {
  if (mesh === api.sun.mesh) return labelEntries[0];
  for (const b of api.bodies) {
    if (mesh === b.mesh) return labelEntries.find((e) => e.id === b.id);
    for (const m of b.moons) if (mesh === m.mesh) {
      return window.__moonEntries.find((e) => e.id === m.id);
    }
  }
  return null;
}

let downPos = null;
function bindUI() {
  canvas.addEventListener('pointerdown', (e) => { downPos = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    const quick = performance.now() - downPos.t < 420;
    downPos = null;
    if (moved > 6 || !quick) return;
    if (controls.isPointerLocked()) return;   // 锁定时用准星选择
    doPick(e.clientX, e.clientY);
  });
  canvas.addEventListener('dblclick', (e) => {
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) { ui.select(hit); followEntry(hit); }
  });
  canvas.addEventListener('click', () => {
    // 触屏没有指针锁定这回事，硬调 requestPointerLock 在移动端浏览器上
    // 要么被忽略、要么弹一个"全屏观看"的提示 —— 直接跳过
    if (isTouch) return;
    if (!controls.isPointerLocked() && controls.getMode() !== 'transit') {
      controls.requestLock();
    }
  });

  /* ---- 控制台 ---- */
  const sTime = document.getElementById('s-timescale');
  const sScale = document.getElementById('s-scale');
  const sBloom = document.getElementById('s-bloom');
  const vTime = document.getElementById('v-timescale');
  const vScale = document.getElementById('v-scale');
  const vBloom = document.getElementById('v-bloom');

  sTime.addEventListener('input', () => {
    const v = +sTime.value;
    timeMul = v <= 20 ? v / 20 : 1 + ((v - 20) / 80) * 19;
    vTime.textContent = timeMul.toFixed(1) + '×';
  });
  sScale.addEventListener('input', () => {
    const v = +sScale.value;
    const s = Math.pow(2, v / 50);
    worldScale = THREE.MathUtils.clamp(s, 0.12, 4.0);
    api.root.scale.setScalar(worldScale);
    vScale.textContent = worldScale.toFixed(2) + '×';
  });
  sBloom.addEventListener('input', () => {
    const s = +sBloom.value / 100;
    bloomPass.strength = s;
    vBloom.textContent = s.toFixed(2);
  });

  const tg = (id, fn, initial = true) => {
    const el = document.getElementById(id);
    el.addEventListener('click', () => {
      const on = !el.classList.contains('active');
      el.classList.toggle('active', on);
      fn(on);
    });
    fn(initial);
  };
  tg('tg-orbits', (v) => { showOrbits = v; api.setOrbitsVisible(v); });
  tg('tg-labels', (v) => { showLabels = v; });
  tg('tg-belt', (v) => { showBelts = v; api.setBeltsVisible(v); });
  tg('tg-rear', (v) => { rear.enabled = v; }, false);

  document.getElementById('btn-quality').addEventListener('click', (e) => {
    const i = qualityCycle.indexOf(quality);
    quality = qualityCycle[(i + 1) % 3];
    const pr = quality === 'high' ? 1.75 : quality === 'medium' ? 1.35 : 1.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr));
    sky.setQuality(renderer.getPixelRatio());
    bloomPass.resolution.set(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    e.target.textContent = '画质：' + (quality === 'high' ? '高' : quality === 'medium' ? '中' : '低');
    ui.toast('画质已切换为 ' + quality);
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    controls.releaseToFree();
    controls.flyTo(new THREE.Vector3(0, 150, 430), new THREE.Vector3(0, 0, 0), 2.2);
    worldScale = 1; api.root.scale.setScalar(1); syncScaleSlider(1);
    ui.toast('视角已重置');
  });

  /* ---- 键盘 ---- */
  window.addEventListener('keydown', (e) => {
    // 地表模式：ESC 是"返航"，其余飞行快捷键全部让位
    if (surfaceMode) {
      if (e.code === 'Escape' || e.code === 'KeyR') {
        e.preventDefault();
        returnToOrbit();
      }
      return;
    }
    if (e.code === 'Escape') {
      document.getElementById('help').classList.add('hidden');
      return;
    }
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'KeyH') { document.getElementById('help').classList.toggle('hidden'); return; }
    if (e.code === 'KeyO') { document.getElementById('tg-orbits').click(); return; }
    if (e.code === 'KeyL') { document.getElementById('tg-labels').click(); return; }
    if (e.code === 'KeyB') { document.getElementById('tg-belt').click(); return; }
    if (e.code === 'KeyR') { document.getElementById('btn-reset').click(); return; }
    if (e.code === 'KeyP') {
      const s = document.getElementById('s-timescale');
      s.value = s.value === '0' ? '20' : '0';
      s.dispatchEvent(new Event('input'));
      ui.toast(timeMul === 0 ? '时间暂停' : '时间恢复流动');
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      controls.releaseToFree();
      ui.toast('已脱离天体 · 自由巡航中');
      return;
    }
    const digit = e.code.match(/^Digit(\d)$/);
    if (digit) {
      const n = +digit[1];
      if (n === 0) { const e0 = labelEntries[0]; ui.select(e0); followEntry(e0); }
      else {
        const t = labelEntries.filter((x) => x.kind === 'planet')[n - 1];
        if (t) { ui.select(t); followEntry(t); }
      }
    }
  });

  /* ---- 触摸：双指捏合缩放空间 ----
   * 单指转视角由 controls.js 处理（绑在 window 捕获阶段，见那里的说明）。
   * 捏合同样要绑 window —— 绑 canvas 的话，手指落在档案抽屉上就捏不动。
   * 也不能走「合成一个 WheelEvent 再派发」那条老路：合成链路上
   * cancelable / passive 的状态很容易被搅乱，直接调 pinchZoom() 更可靠。
   *
   * 两个关键点（都是实测踩出来的）：
   *  1) 手指很少"同时"落下 —— 总是第一根先落、第二根再跟上。
   *     只监听 e.touches.length === 2 的 touchstart 会漏掉这种常见手势，
   *     所以 touchmove 里也要能"补上"基线。
   *  2) 屏幕上同时有 2 根手指时，必须按下"正在捏合"的标记，
   *     否则单指转视角的逻辑会把其中一根当成拖动，变成"边转边缩"。 */
  let pinchPrev = 0;
  const dist2 = (t) => (t.length < 2 ? 0 : Math.hypot(
    t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY));

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length >= 2) pinchPrev = dist2(e.touches);
  }, { passive: true, capture: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length < 2) { pinchPrev = 0; return; }
    const d = dist2(e.touches);
    // 基线还没建立（第二根手指刚落下）—— 这一下只记基线，不做缩放
    if (pinchPrev <= 0) { pinchPrev = d; return; }
    const dd = d - pinchPrev;
    if (Math.abs(dd) > 0.5) {
      // 手指张开 -> 空间放大。除以 6 是把像素差换算成 wheel 的"格"，
      // 让捏合和滚轮的手感量级接近
      controls.pinchZoom(dd / 6);
      pinchPrev = d;
    }
    if (e.cancelable) e.preventDefault();   // 别让浏览器接管成"缩放整个页面"
  }, { passive: false, capture: true });

  window.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchPrev = 0;
  }, { passive: true, capture: true });
  window.addEventListener('touchcancel', () => { pinchPrev = 0; }, { passive: true, capture: true });

  bindTouchControls();
}

/* ============================================================
 *  触屏操控层
 *  ------------------------------------------------------------
 *  三个部件：左侧虚拟摇杆（移动）、右侧跳跃/奔跑键、整屏拖动（转视角）。
 *  转视角本身由 controls.js 在捕获阶段处理，这里只管摇杆和按钮。
 * ========================================================== */
function bindTouchControls() {
  const pad = document.getElementById('tpad');
  const knob = document.getElementById('tpad-knob');
  const jumpBtn = document.getElementById('t-jump');
  const runBtn = document.getElementById('t-run');
  if (!pad || !knob) return;

  const R = 40;               // 摇杆最大位移（像素）
  let pid = null, cx = 0, cy = 0;

  const reset = () => {
    knob.style.transform = 'translate(0px, 0px)';
    pad.classList.remove('active');
    controls.setTouchMove(0, 0);
    pid = null;
  };

  pad.addEventListener('pointerdown', (e) => {
    pid = e.pointerId;
    pad.setPointerCapture && pad.setPointerCapture(pid);
    const r = pad.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    pad.classList.add('active');
    move(e);
    e.preventDefault();
  });
  function move(e) {
    if (e.pointerId !== pid) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    // 屏幕 y 向下为正，而"前进"是向上推 —— 所以前向取 -dy
    controls.setTouchMove(-dy / R, dx / R);
    e.preventDefault();
  }
  pad.addEventListener('pointermove', move);
  pad.addEventListener('pointerup', reset);
  pad.addEventListener('pointercancel', reset);
  window.addEventListener('pointerup', (e) => { if (e.pointerId === pid) reset(); });

  if (jumpBtn) {
    const down = (e) => { controls.setTouchJump(true); jumpBtn.classList.add('on'); e.preventDefault(); };
    const up = (e) => { controls.setTouchJump(false); jumpBtn.classList.remove('on'); if (e) e.preventDefault(); };
    jumpBtn.addEventListener('pointerdown', down);
    jumpBtn.addEventListener('pointerup', up);
    jumpBtn.addEventListener('pointercancel', up);
    jumpBtn.addEventListener('pointerleave', up);
  }

  if (runBtn) {
    // 点一下切换，不用一直按着 —— 手机上按住奔跑键会占掉一根手指
    runBtn.addEventListener('click', (e) => {
      const on = !runBtn.classList.contains('on');
      runBtn.classList.toggle('on', on);
      controls.setTouchRun(on);
      ui && ui.toast(on ? '奔跑模式 · 开' : '奔跑模式 · 关');
      e.preventDefault();
    });
  }

  // 进地表时把"拖动画面环视"的提示闪一下，几秒后自己消失
  window.__touchHint = () => {
    const h = document.getElementById('tlook-hint');
    if (!h) return;
    h.classList.remove('show');
    void h.offsetWidth;         // 强制重排，让动画能重播
    h.classList.add('show');
  };

  /* 把摇杆的屏幕坐标交出去，方便自动化测试直接往里打 pointer 事件。
   * 摇杆是 #touch-ctl 的子节点，而 #touch-ctl 整体 pointer-events:none
   * （只有摇杆和按钮自己恢复 auto），所以测试必须拿到真实屏幕坐标。 */
  window.__padCenter = () => {
    const r = pad.getBoundingClientRect();
    if (!r.width) return null;
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
  };
  window.__knobDelta = () => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(knob.style.transform || '');
    return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
  };
}

function syncScaleSlider(s) {
  const el = document.getElementById('s-scale');
  if (!el) return;
  const v = Math.round(Math.log2(s) * 50);
  el.value = THREE.MathUtils.clamp(v, -100, 100);
  document.getElementById('v-scale').textContent = s.toFixed(2) + '×';
}

function pickAt(x, y) {
  if (!api) return null;
  if (!_targets) _targets = pickTargets();
  pointer.x = (x / window.innerWidth) * 2 - 1;
  pointer.y = -(y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(_targets, false);
  if (!hits.length) return null;
  return findEntryByMesh(hits[0].object);
}
function doPick(x, y) {
  const e = pickAt(x, y);
  if (e) { ui.select(e); selectedEntry = e; }
}

/* ============================================================
 *  渲染循环
 * ========================================================== */
const clock = new THREE.Clock();
let elapsed = 0;
let frames = 0, fpsTime = 0, fps = 0;
let pickTick = 0;
const _tmp = new THREE.Vector3();

// 冒烟模式：无头软渲染环境下限帧，保证测试可在虚拟时间内完成
const SMOKE = /[?&]smoke\b/.test(location.search);
let smokeTick = 0;

function startLoop() { renderer.setAnimationLoop(tick); }

function tick() {
  if (SMOKE && (++smokeTick % 4 !== 0)) return;
  renderer.info.reset();
  const dt = Math.min(clock.getDelta(), SMOKE ? 0.42 : 0.05);
  elapsed += dt;

  // FPS
  frames++; fpsTime += dt;
  if (fpsTime > 0.5) { fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }

  // 先推进天体，再更新相机 —— 否则跟随相机永远追的是"上一帧"的天体位置，
  // 目标公转越快，画面里就越偏向一侧。
  if (surfaceMode) {
    // 地表模式：轨道计算与深空背景全部冻结，只推进地面上的东西
    if (surfaceWorld) surfaceWorld.update(dt, elapsed, camera);
  } else {
    if (api) api.update(elapsed, dt, timeMul);
    if (sky) sky.update(dt, elapsed, camera);
  }
  if (controls) controls.update(dt);
  // 相机是挂在轨道 scene 下的；渲染地表场景时，渲染器只更新「地表场景」这一棵树，
  // 相机的 matrixWorld 就没人刷新了 —— 画面会冻死在切入前最后一帧。必须自己补一刀。
  if (surfaceMode && camera.parent) camera.updateMatrixWorld(true);

  window.__DEBUG = {
    get triangles() { return renderer.info.render.triangles; },
    get calls() { return renderer.info.render.calls; },
    get memMB() {
      const m = performance.memory;
      return m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : -1;
    },
    get gpuGeo() { return renderer.info.memory.geometries; },
    get gpuTex() { return renderer.info.memory.textures; },
    get surfaceMode() { return surfaceMode; },
    bodies: api ? api.bodies.length : -1,
    ranFrames: smokeTick,
    /* 空间缩放倍率：捏合/滚轮调的就是它，直接读这个比读 HUD 读数准 */
    get worldScale() { return +worldScale.toFixed(4); },
    get mode() { return controls ? controls.getMode() : 'na'; },
    /* 当前视角朝向。转视角的断言该看这个 —— 相机位置会被怠速漂移影响 */
    get yaw() { return controls ? +controls.state.yaw.toFixed(4) : 'na'; },
    get pitch() { return controls ? +controls.state.pitch.toFixed(4) : 'na'; },
    get cameraPos() { return camera.position.toArray().map((v) => v.toFixed(1)).join(','); },
    /* 相机宽高比：旋转自适应是否真的生效，看这个最直接 */
    get cameraAspect() { return +camera.aspect.toFixed(4); },
    /* 当前视口尺寸（JS 实际用来算 aspect 的那两个数） */
    get viewportSize() { return camera.aspect ? measureViewport() : null; },
    get earth() {
      const e = labelEntries.find((x) => x.id === 'earth');
      if (!e || !e.world) return 'na';
      return e.world.toArray().map((v) => v.toFixed(1)).join(',') + '|dist=' + (e.world.distanceTo(camera.position)).toFixed(1);
    }
  };

  // 调试/测试接口：瞬移到某天体旁（正式页面同样可用，无副作用）
  window.__voyager = {
    /** 测试用：临时关掉怠速自动漂移，避免污染"视角有没有动"的断言 */
    setAutoCruise(on) { if (controls) controls.setAutoCruise(on); },
    followNow(id) {
      const e = findAnyEntry(id);
      if (!e || !controls) return;
      const w = new THREE.Vector3();
      e.holder.getWorldPosition(w);
      const off = new THREE.Vector3(e.radius * 3.4, e.radius * 1.5, e.radius * 4.8);
      controls.state.follow = { body: { holder: e.holder, radius: e.radius }, offset: off, minDist: 0.5, maxDist: 1e6 };
      controls.state.mode = 'follow';
      camera.position.copy(w).add(off);
      controls.state.vel.set(0, 0, 0);
    },
    /** 测试用：直接对准并定住（不走每帧 lerp）。默认站在"白天面"观察 */
    aimNow(id, daySide = true) {
      const e = findAnyEntry(id);
      if (!e || !controls) return 'no entry';
      const w = new THREE.Vector3();
      e.holder.getWorldPosition(w);
      let dir;
      if (daySide) {
        // 站到太阳与天体之间，确保看到被照亮的一面
        dir = w.lengthSq() > 0.001 ? w.clone().normalize() : new THREE.Vector3(0.45, 0.28, 1).normalize();
        dir = dir.negate();
      } else {
        dir = new THREE.Vector3(0.45, 0.28, 1).normalize();
      }
      dir.y = Math.max(dir.y, 0.22);
      dir.normalize();
      camera.position.copy(w).addScaledVector(dir, Math.max(e.radius * 5.5, 2.2));
      camera.up.set(0, 1, 0);
      // 必须用 Camera 代理求朝向：Object3D.lookAt 是 +Z 朝向，会让目标跑到背后
      const proxy = new THREE.PerspectiveCamera();
      proxy.position.copy(camera.position);
      proxy.up.copy(camera.up);
      proxy.lookAt(w);
      camera.quaternion.copy(proxy.quaternion);
      controls.state.follow = { body: { holder: e.holder, radius: e.radius }, offset: camera.position.clone().sub(w), minDist: 0.5, maxDist: 1e6 };
      controls.state.mode = 'follow';
      controls.state.yaw = 0; controls.state.pitch = 0;
      return 'ok@' + camera.position.toArray().map((v) => v.toFixed(1)).join(',');
    },
    /** 材质探针：把某天体强制变成发光体，验证 mesh 是否在渲染 */
    paint(id, hexColor) {
      const e = findAnyEntry(id);
      if (!e) return 'no entry';
      let mesh = null;
      if (id === 'sun') mesh = api.sun.mesh;
      for (const b of api.bodies) {
        if (b.id === id) mesh = b.mesh;
        for (const m of b.moons) if (m.id === id) mesh = m.mesh;
      }
      if (!mesh) return 'no mesh';
      mesh.material.emissive = new THREE.Color(hexColor || 0xff00ff);
      mesh.material.emissiveIntensity = 3;
      mesh.material.needsUpdate = true;
      return 'painted ' + id;
    },
    warpTo(pos, look) {
      controls.releaseToFree();
      controls.setInitial(new THREE.Vector3(...pos), new THREE.Vector3(...look));
    },
    /** 测试：冻结控制权（保持当前姿态，相机完全静止） */
    freeze() {
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      controls.state.yaw = e.y; controls.state.pitch = e.x; controls.state.roll = 0;
      controls.state.mode = 'free';
      controls.state.follow = null;
      controls.state.autoCruise = false;
      controls.state.vel.set(0, 0, 0);
      return 'frozen';
    },
    /** 测试：相机与目标的投影诊断 */
    diag(id) {
      const e = findAnyEntry(id) || labelEntries[0];
      const w = new THREE.Vector3();
      e.holder.getWorldPosition(w);
      const v = w.clone(); v.project(camera);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const f = controls.state.follow;
      return JSON.stringify({
        id: e.id,
        ndc: [v.x.toFixed(3), v.y.toFixed(3), v.z.toFixed(4)],
        tgt: w.toArray().map((x) => x.toFixed(1)),
        camFwd: fwd.toArray().map((x) => x.toFixed(2)),
        camPos: camera.position.toArray().map((x) => x.toFixed(1)),
        mode: controls.state.mode,
        follow: f ? { offLen: f.offset.length().toFixed(1), min: f.minDist.toFixed(1) } : null,
        dist: w.distanceTo(camera.position).toFixed(1)
      });
    },
    getMode: () => controls ? controls.state.mode : 'na',

    /** ★ 测试/调试：把相机放到天体的**晨昏线**上，让轮廓横贯画面中央。
     *  这是唯一能判断"地形位移是否真的可见"的视角 —— 正视球面时，
     *  位移只表现为明暗（法线贴图也能伪造），只有剪影骗不了人。
     *  θ=78° 偏白天一侧：既能看到晨昏线，又保留足够光照看陆地细节。 */
    limbView(id, distR = 2.6, thetaDeg = 78) {
      const e = findAnyEntry(id);
      if (!e || !controls) return 'no entry';
      const w = new THREE.Vector3();
      e.holder.getWorldPosition(w);
      const R = e.radius;
      // ŵ = 天体相对太阳（场景原点）的方向；日下点方向 = -ŵ
      const towardSun = w.lengthSq() > 1e-6
        ? w.clone().normalize().negate()
        : new THREE.Vector3(0.45, 0.28, 1).normalize().negate();
      // perp = ŵ × (0,1,0)：垂直于太阳连线，用来把相机挪到晨昏线上
      let perp = new THREE.Vector3().crossVectors(towardSun, new THREE.Vector3(0, 1, 0));
      if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
      perp.normalize();
      const th = thetaDeg * Math.PI / 180;
      const dir = new THREE.Vector3()
        .addScaledVector(towardSun, Math.cos(th))
        .addScaledVector(perp, Math.sin(th))
        .normalize();
      // 抬高一点，让轮廓稍微斜着看，起伏更容易辨认
      dir.y += 0.16; dir.normalize();
      camera.position.copy(w).addScaledVector(dir, R * distR);
      camera.up.set(0, 1, 0);
      const proxy = new THREE.PerspectiveCamera();
      proxy.position.copy(camera.position);
      proxy.up.copy(camera.up);
      proxy.lookAt(w);
      camera.quaternion.copy(proxy.quaternion);
      controls.state.follow = null;
      controls.state.mode = 'free';
      controls.state.autoCruise = false;
      controls.state.vel.set(0, 0, 0);
      const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      controls.state.yaw = eu.y; controls.state.pitch = eu.x; controls.state.roll = 0;
      return 'limb@' + camera.position.toArray().map((v) => v.toFixed(2)).join(',');
    },

    /* ---- 地表：给自动化测试和手动调试用 ---- */
    async land(id) {
      const e = findAnyEntry(id);
      if (!e) return 'no entry: ' + id;
      await landOnEntry(e);
      return surfaceMode ? 'landed:' + id : 'failed:' + id;
    },
    async rtb() {
      if (!surfaceMode) return 'not on surface';
      await returnToOrbit();
      return surfaceMode ? 'still on surface' : 'back to orbit';
    },
    surf() {
      if (!surfaceWorld) return JSON.stringify({ onSurface: false, surfaceMode });
      const w = controls && controls.getWalk ? controls.getWalk() : null;
      return JSON.stringify({
        onSurface: true, id: surfaceWorld.id,
        stats: surfaceWorld.stats,
        cam: camera.position.toArray().map((v) => +v.toFixed(2)),
        feet: w ? [+w.pos.x.toFixed(2), +w.y.toFixed(2), +w.pos.z.toFixed(2)] : null,
        ground: w ? +w.getHeight(w.pos.x, w.pos.z).toFixed(2) : null,
        onGround: w ? w.onGround : null,
        objects: surfaceWorld.scene.children.length,
        gpu: renderer.info.render.triangles
      });
    },
    /** 地表走一步：给自动化测试验证"脚踩在地上" */
    step(dx, dz) {
      const w = controls && controls.getWalk ? controls.getWalk() : null;
      if (!w) return 'no walk';
      w.pos.x += dx || 0; w.pos.z += dz || 0;
      const g = w.getHeight(w.pos.x, w.pos.z);
      return JSON.stringify({ x: +w.pos.x.toFixed(2), z: +w.pos.z.toFixed(2), ground: +g.toFixed(2) });
    },
    /** 地表抬头/低头（测试用，比如验证抬头能看到星空） */
    look(pitch, yaw) {
      const w = controls && controls.getWalk ? controls.getWalk() : null;
      if (!w) return 'no walk';
      if (typeof pitch === 'number') w.pitch = pitch;
      if (typeof yaw === 'number') w.yaw = yaw;
      return JSON.stringify({ pitch: +w.pitch.toFixed(2), yaw: +w.yaw.toFixed(2) });
    },
    /** 天穹 uniform 自检：确认渐变三段色真的传进去了 */
    surfSky() {
      if (!surfaceWorld) return 'not on surface';
      const sky = surfaceWorld.scene.children.find((o) => o.isMesh && o.material && o.material.uniforms);
      if (!sky) return 'no sky mesh';
      const u = sky.material.uniforms;
      const c = (v) => '#' + v.getHexString();
      return JSON.stringify({
        horizon: c(u.uHorizon.value), mid: c(u.uMid.value), zenith: c(u.uZenith.value),
        glow: u.uGlow.value, sharp: u.uSharp.value,
        domeR: sky.geometry.parameters.radius,
        camFar: camera.far, exposure: acesPass.uniforms.exposure.value
      });
    },
    /** 纹理审计：轨道场景图里能摸到的纹理数 vs GPU 实际登记数。
     *  若两者同步增长 -> 场景里多了东西；若只有 gpuTex 涨 -> 有"幽灵纹理"没被释放。 */
    texAudit() {
      const set = new Set();
      const seen = new Set();
      const walk = (o) => {
        if (!o || seen.has(o.uuid)) return;
        seen.add(o.uuid);
        const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        for (const m of mats) {
          if (!m) continue;
          for (const k in m) {
            const v = m[k];
            if (v && v.isTexture) set.add(v.uuid);
          }
        }
        o.children.forEach(walk);
      };
      walk(scene);
      return JSON.stringify({
        sceneTex: set.size,
        gpuTex: renderer.info.memory.textures,
        gpuGeo: renderer.info.memory.geometries,
        programs: renderer.info.programs.length
      });
    }
  };

  // 世界坐标刷新（标签 / 距离）
  for (const e of labelEntries) {
    e.holder.getWorldPosition(e.world || (e.world = new THREE.Vector3()));
  }
  for (const m of (window.__moonEntries || [])) {
    m.holder.getWorldPosition(m.world || (m.world = new THREE.Vector3()));
  }

  if (ui) {
    const labelList = [
      ...labelEntries.map((e) => ({ id: e.id, en: e.en, cn: e.name, pos: e.world })),
      ...(window.__moonEntries || []).map((e) => ({ id: e.id, en: e.en, cn: e.name, pos: e.world }))
    ];
    ui.updateLabels(null, camera, labelList, showLabels && !surfaceMode);
    ui.updateReadouts({
      scale: worldScale,
      speed: controls ? controls.state.vel.length() : 0,
      timeMul, fps
    });
  }

  // 准星瞄准（每 3 帧检测一次）—— 站在地表时没有可瞄准的天体，跳过
  if (!surfaceMode && ++pickTick % 3 === 0 && api && controls && controls.getMode() !== 'transit') {
    if (!_targets) _targets = pickTargets();
    _tmp.copy(controls.getRayDir(_tmp));
    raycaster.set(camera.position, _tmp);
    const hits = raycaster.intersectObjects(_targets, false);
    if (hits.length) {
      const e = findEntryByMesh(hits[0].object);
      if (e) ui.setFocus(e.name, Math.round(hits[0].distance) + ' u');
      else ui.setFocus(null);
    } else ui.setFocus(null);
  }

  /* ★ 电影后期每帧参数：体积光束要太阳的屏幕坐标；色差/分级只在
     地表开（轨道的星空要纯净，开了会起彩边） */
  if (cinemaPass) {
    if (surfaceMode && surfaceWorld && surfaceWorld.sunObj) {
      surfaceWorld.sunObj.getWorldPosition(_sunW);
      _sunV.copy(_sunW).project(camera);
      const behind = _sunV.z > 1 || !isFinite(_sunV.x) || !isFinite(_sunV.y);
      cinemaPass.uniforms.uSunUv.value.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5);
      /* 太阳在画面外太远时衰减到 0，避免边缘生硬。
         ★ 真实 DEM 地貌 + 低角度黄昏光：体积光束加到 0.42，
         岩壁缝隙里的光柱才够"电影"（上一版 0.28 偏含蓄） */
      const ux = cinemaPass.uniforms.uSunUv.value.x, uy = cinemaPass.uniforms.uSunUv.value.y;
      const off = Math.max(Math.abs(ux - 0.5) - 0.5, Math.abs(uy - 0.5) - 0.5);
      cinemaPass.uniforms.uStrength.value = behind ? 0 : 0.42 * (1 - Math.min(Math.max(off, 0), 1) * 2);
    } else {
      cinemaPass.uniforms.uStrength.value = 0;
    }
    const cine = surfaceMode ? 1 : 0;
    /* ca 是"边缘 RGB 偏移比例"：q·r²·ca 在角落约 r²≈0.5，
       0.02 → 偏移约 0.5% 屏宽（~6px@1280）——轻微的镜头感；
       0.9 那种量级会把 RGB 拆成三条画面（第一版的事故） */
    acesPass.uniforms.ca.value = 0.03 * cine;
    acesPass.uniforms.grade.value = 0.70 * cine;
  }

  if (rear.enabled && rear.ready && !surfaceMode) {
    renderRearView();
    composer.render();
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(rear.scene, rear.ortho);
    renderer.autoClear = true;
  } else {
    composer.render();
  }
}

/* ============================================================
 *  自适应
 * ========================================================== */
let _resizeTimer = 0;
let _settleTimer = 0;

/* 房间尺寸的"真实来源"。iOS Safari 在旋转过程中会同时存在三套尺寸：
 *   innerWidth/Height      —— 主视口，旋转瞬间往往还是旧值
 *   visualViewport         —— 真实可视区，但缩放时会变小
 *   documentElement.client —— 布局视口
 * 三者哪个先更新没有保证，所以取"较大且合理"的那个，并保证宽高比
 * 不出现 0 或负值。 */
function measureViewport() {
  const de = document.documentElement;
  const vv = window.visualViewport;

  let w = Math.max(window.innerWidth || 0, de ? de.clientWidth : 0);
  let h = Math.max(window.innerHeight || 0, de ? de.clientHeight : 0);

  /* visualViewport 只在它比另外两个都大时才采信：
     它小的时候通常是键盘弹起或双指缩放，不是我们要的整屏尺寸。 */
  if (vv) {
    if (vv.width > w) w = vv.width;
    if (vv.height > h) h = vv.height;
  }

  return { w: Math.round(w), h: Math.round(h) };
}

function applyViewportSize() {
  const { w, h } = measureViewport();
  if (!w || !h) return;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  /* 渲染分辨率跟 DPR 走，但横屏时像素总量翻倍，按长边限一下，
     免得手机在横屏下掉帧（横屏可视面积大，但没必要渲染到 3x）。 */
  const dpr = window.devicePixelRatio || 1;
  const cap = quality === 'high' ? 1.75 : 1.35;
  const maxPixels = 2.2e6;
  let pr = Math.min(dpr, cap);
  const total = w * h * pr * pr;
  if (total > maxPixels) pr = Math.sqrt(maxPixels / (w * h));
  renderer.setPixelRatio(Math.max(1, pr));

  if (composer) composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
  if (rear.ready) layoutRearView();
}

window.addEventListener('resize', () => {
  applyViewportSize();
  scheduleSettle();
});

/* 旋转屏幕：不能在 orientationchange 当下就量尺寸并完事。
 * 那一刻浏览器给的多半还是旋转前的值（iOS 尤其明显），
 * 于是算出来的宽高比是错的、画面看起来"没自适应"。
 * 做法：立刻量一次（响应快的设备当场就对了），再连续补测若干次，
 * 直到尺寸稳定为止 —— 这样不管浏览器什么时候才更新，最终一定收敛到正确值。 */
function onOrientationChange() {
  applyViewportSize();

  let last = measureViewport();
  let tries = 0;
  clearInterval(_resizeTimer);

  _resizeTimer = setInterval(() => {
    tries++;
    applyViewportSize();
    const cur = measureViewport();
    const stable = (cur.w === last.w && cur.h === last.h);
    last = cur;
    /* 连续两次量到同一个尺寸（或补测超过 1.6s）就收工 */
    if ((stable && tries >= 2) || tries > 16) clearInterval(_resizeTimer);
  }, 100);
}

/* resize 也做一次"稳定后补测"：手机上地址栏收放会连续触发多次 resize，
   最后一次才是有意义的尺寸。 */
function scheduleSettle() {
  clearTimeout(_settleTimer);
  _settleTimer = setTimeout(applyViewportSize, 260);
}

window.addEventListener('orientationchange', onOrientationChange);
if (window.screen && screen.orientation && screen.orientation.addEventListener) {
  screen.orientation.addEventListener('change', onOrientationChange);
}

/* 切回前台补测（iOS 从后台回来、分屏调整都会用到） */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    applyViewportSize();
    scheduleSettle();
  }
});
window.addEventListener('pageshow', () => { applyViewportSize(); scheduleSettle(); });

/* 兜底：iOS 上偶尔 orientationchange 不触发，靠尺寸轮询也能纠回来。
   只在尺寸真的变了时才动作，开销可以忽略。 */
(function watchViewport() {
  let lw = 0, lh = 0;
  setInterval(() => {
    const { w, h } = measureViewport();
    if (w !== lw || h !== lh) {
      lw = w; lh = h;
      applyViewportSize();
    }
  }, 400);
})();

/* ============================================================
 *  启动（加载舱阶段的进度显示不依赖 UI 实例）
 * ========================================================== */
const RING_LEN = 2 * Math.PI * 98;
function bootProgress(p, msg) {
  const pp = Math.max(0, Math.min(100, p));
  const pct = document.getElementById('mf-pct');
  const ring = document.getElementById('mf-ring-progress');
  const st = document.getElementById('mf-status');
  if (pct) pct.textContent = Math.round(pp) + '%';
  if (ring) { ring.style.strokeDasharray = RING_LEN; ring.style.strokeDashoffset = RING_LEN * (1 - pp / 100); }
  if (msg && st) st.textContent = msg;
}

(function () {
  window.addEventListener('error', (e) => {
    bootProgress(0, '错误：' + (e.message || '未知异常，请查看控制台'));
    console.error(e.error || e);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('unhandled rejection:', e.reason);
  });
  bootProgress(1, '系统自检中');
  setTimeout(boot, 120);
})();

/* ---------- 微信内置浏览器的分享提示 ----------
   背景：把链接发给朋友后常被反馈"打不开 / 显示网页无法打开"。
   实测（换 UA 请求线上地址）确认根因不在网站本身：
     微信 / 企业微信 UA  → HTTP 403 + 拦截页「请在浏览器中打开」
     Safari / Chrome / 钉钉 / QQ 浏览器 → HTTP 200 正常
   也就是说托管平台按 UA 拦掉了微信内置浏览器，这是平台安全策略，
   网页代码无法绕过。这里能做的是：检测到微信环境就弹一层提示，
   给出"复制链接 → 用手机浏览器打开"的明确指引，并附一键复制，
   免得朋友以为网站坏了。
   注意：平台自己也会返回拦截页（那种情况下本页根本加载不到），
   所以这段主要服务于"通过其他途径进来了"的场景，同时兜底。 */
(function () {
  const ua = navigator.userAgent || '';
  const isWx = /MicroMessenger|wxwork|WeChat/i.test(ua);
  const tip = document.getElementById('wx-tip');
  if (!isWx || !tip) return;

  const urlBox = document.getElementById('wx-url');
  const copyBtn = document.getElementById('wx-copy');
  const okMsg = document.getElementById('wx-ok');
  const href = location.href;

  if (urlBox) { urlBox.value = href; }
  tip.classList.remove('hidden');

  function done() {
    if (okMsg) {
      okMsg.classList.remove('hidden');
      setTimeout(() => okMsg.classList.add('hidden'), 2600);
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const txt = href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
      } else {
        fallbackCopy(txt, done);
      }
    });
  }
  /* 老内核（微信 X5 / 部分安卓 WebView）没有 clipboard API，
     用临时 textarea + select + execCommand 兜底。
     注意：headless / 无手势环境下 execCommand('copy') 会返回 false，
     这时不要再死磕"复制成功"的提示，直接把输入框选中让用户长按复制 ——
     反馈无论如何都要给，否则用户以为按钮没反应。 */
  function fallbackCopy(txt, cb) {
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, txt.length);
      ok = !!(document.execCommand && document.execCommand('copy'));
      document.body.removeChild(ta);
    } catch (e) {
      ok = false;
    }
    if (ok) {
      cb();
    } else if (urlBox) {
      // 复制不成 → 至少把链接选中，提示用户长按复制
      urlBox.focus();
      urlBox.select();
      if (okMsg) {
        okMsg.textContent = '长按上面的链接复制';
        okMsg.classList.remove('hidden');
        setTimeout(() => {
          okMsg.classList.add('hidden');
          okMsg.textContent = '已复制，去浏览器粘贴打开吧';
        }, 3000);
      }
    }
  }
})();
