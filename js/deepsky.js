/**
 * deepsky.js — 深空背景层（真实感强化版）
 *
 * 相比旧版的三处关键升级：
 *
 *  1. **星点改为真正的 PSF 光斑**。旧版星点是一个硬边圆（`smoothstep(0.5,0.02,d)`），
 *     放大看就是一个个方块/圆片。真实恒星经过光学系统后是**艾里斑 + 十字星芒**，
 *     中心极亮、四周有平缓的晕、亮星还有绕射尖刺。这里用解析式 PSF 重建，
 *     并把 `gl_PointSize` 的上限放开到能容纳星芒。
 *
 *  2. **银河带从"离散点"改为"体积雾 + 星尘双层"**。旧版撒了 1.1 万个点当银河，
 *     点与点之间是黑的，远看像噪声不像云。现在改成：
 *       · 一层**连续体积雾**（在 fragment shader 里沿银道面解析积分密度）
 *       · 一层**暗星云 lane**（吸收不是叠加，才有真实的"尘埃带"）
 *       · 一层**致密星尘**（点，但只作为细节叠加在雾上）
 *
 *  3. **星云/星系 billboard 用真·程序纹理 + 分层**。旧版是若干张 sprite 随机摆，
 *     现在加了旋臂对数螺线、尘埃带遮挡、核心核球，并且按亮度分级排布。
 *
 * 这一层不参与太阳系缩放，始终以相机为中心 —— 制造"无限远"的错觉。
 */
import * as THREE from 'three';
import * as TEX from './textures.js';
import { Simplex3, fbm, ridged, mulberry32, hex2rgb } from './textures.js';

/* ============================================================
 *  星点着色器
 * ========================================================== */

/**
 * PSF（点扩散函数）星点。
 *
 * 真实恒星的点扩散函数近似为：
 *   I(r) = A·exp(-r²/2σ²)            高斯核心
 *        + B/(1 + r²/ρ²)              Moffat 长尾（大气/光学散射）
 *        + C·exp(-r/λ)·(星芒项)        绕射尖刺
 *
 * 星芒（diffraction spike）只在足够亮的星上才明显，
 * 所以用 aMag 控制尖刺强度，暗星只有圆晕。
 */
const STAR_VERT = /* glsl */`
  attribute float aSize;
  attribute float aPhase;
  attribute float aMag;        // 亮度等级 0..1，用于决定星芒强弱
  attribute vec3  aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uTwinkle;
  uniform float uSizeScale;
  varying vec3  vColor;
  varying float vBright;
  varying float vMag;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    /* 闪烁：只在亮星上明显（暗星肉眼也看不出闪）。
       真实闪烁是大气扰动造成的，频率低、不规则。 */
    float tw = 1.0 + uTwinkle * (0.18 + aMag * 0.5) * sin(uTime * 1.6 + aPhase * 6.2831);

    /* ★ 关键：随距离衰减。旧版 gl_PointSize 与距离无关，
       导致远处的星和近处的星一样大，缺乏纵深。 */
    float dist = -mv.z;
    float atten = 1.0 / (1.0 + dist * 0.00005);

    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uSizeScale * uPixelRatio * tw * atten;
    vColor  = aColor;
    vBright = tw;
    vMag    = aMag;
  }
`;

const STAR_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform float uUseMap;
  uniform float uSpike;        // 星芒强度总开关（可关闭）
  varying vec3  vColor;
  varying float vBright;
  varying float vMag;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);

    /* 丢掉最外圈，让形状自然收边 */
    if (d > 0.5) discard;

    float a;
    /* varying 在 fragment 里是只读的，不能直接改；用局部量承接颜色 */
    vec3 col = vColor;

    if (uUseMap > 0.5) {
      /* 亮星走贴图（贴图里已经画好星芒） */
      vec4 t = texture2D(uMap, gl_PointCoord);
      a = t.a;
      col = mix(col, t.rgb, 0.35);
    } else {
      /* ---- 解析式 PSF ---- */
      float r = d * 2.0;                       // 归一化到 0..1

      // ① 高斯核心：中心极亮
      float core = exp(-r * r * 14.0);

      // ② Moffat 长尾：让星点周围有一圈平缓的晕（旧版完全没有这层，
      //    所以星点看着"干"、像贴上去的圆片）
      float halo = 0.32 / (1.0 + r * r * 42.0);

      a = core + halo;

      // ③ 绕射星芒：十字 + 对角（亮星才给）
      if (uSpike > 0.5 && vMag > 0.30) {
        float sp = (vMag - 0.30) / 0.70;       // 0..1
        sp = clamp(sp, 0.0, 1.0);
        float th = atan(c.y, c.x);

        // 十字（0/90°）+ 对角（45/135°），对角更弱
        float s4  = pow(abs(cos(th * 2.0)), 9.0);
        float s8  = pow(abs(cos(th * 4.0)), 22.0) * 0.45;
        float ray = exp(-r * 5.2) * (s4 + s8);

        a += ray * sp * 1.35;
      }

      a *= smoothstep(1.0, 0.72, r);           // 外围柔化收边
    }

    if (a < 0.004) discard;
    gl_FragColor = vec4(col * vBright, a);
  }
`;

function makeStarMaterial(pixelRatio, useMap, spriteTex, sizeScale = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:       { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uSizeScale:  { value: sizeScale },
      uTwinkle:    { value: 1 },
      uSpike:      { value: 1 },
      uMap:        { value: spriteTex || null },
      uUseMap:     { value: useMap ? 1 : 0 }
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

/* ============================================================
 *  银河：体积雾着色器
 * ========================================================== */

/**
 * 银河雾是一整面"内翻球壳"，在 fragment shader 里沿视线解析积分密度。
 *
 * 这么做比撒点真实得多：点云之间是空洞，雾是连续的。
 * 密度函数 = 沿银道面的高斯剖面 × 沿银经的噪声调制 × 暗星云吸收。
 */
const MILKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    // 方向就是模型空间的顶点方向（球壳以相机为中心）
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MILKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;

  uniform vec3  uAxis;        // 银道面法线（盘轴方向）
  uniform vec3  uColorWarm;   // 银心暖色
  uniform vec3  uColorCool;   // 银盘冷色
  uniform float uIntensity;
  uniform float uTime;

  /* --- 3D simplex 噪声（与 textures.js 里的实现同源，这里内联一份，
         避免在着色器里无法 import） --- */
  vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm3(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * snoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 dir = normalize(vDir);

    // 到银道面的垂直距离（-1..1），以及沿银经的角度
    float h = dot(dir, normalize(uAxis));
    float lon = atan(dir.z, dir.x);

    /* ---- ① 银盘密度剖面 ----
       真实银河是薄盘 + 核球：薄盘用窄高斯，核球用更宽的、只在银心方向凸起。 */
    float thin  = exp(-(h * h) / (2.0 * 0.055 * 0.055));   // 薄盘
    float thick = exp(-(h * h) / (2.0 * 0.20  * 0.20));    // 厚盘

    // 银心方向（lon ≈ 0）额外增亮 —— 那是银河最亮的区域
    float toCenter = 0.5 + 0.5 * cos(lon);
    float bulge = pow(toCenter, 2.6) * exp(-(h * h) / (2.0 * 0.14 * 0.14));

    float dens = thin * 0.72 + thick * 0.26 + bulge * 0.55;

    /* ---- ② 沿银经的絮状结构 ----
       银河不是均匀光带，有大片明暗交错的分子云。 */
    vec3 np = vec3(cos(lon) * 2.2, h * 7.0, sin(lon) * 2.2);
    float cloud = fbm3(np) * 0.5 + 0.5;                     // 0..1
    cloud = pow(cloud, 1.5);

    // 大尺度臂段（让亮度沿银经有明显的强弱分段）
    float arm = fbm3(vec3(cos(lon) * 0.9, 0.0, sin(lon) * 0.9)) * 0.5 + 0.5;
    arm = 0.55 + 0.75 * arm;

    dens *= mix(0.42, 1.28, cloud) * arm;

    /* ---- ③ 暗星云 lane：吸收而不是发光 ----
       真实的"大裂缝"是尘埃挡住星光形成的暗带。
       这里把噪声阈值以上的区域密度直接削弱，形成暗纹。 */
    float laneNoise = fbm3(vec3(cos(lon) * 3.4, h * 22.0, sin(lon) * 3.4));
    float lane = smoothstep(0.02, 0.34, laneNoise);
    dens *= mix(1.0, 0.26, lane * (1.0 - abs(h) * 2.2));

    // 只在银道面附近才有银河
    dens *= smoothstep(0.62, 0.06, abs(h));

    if (dens < 0.002) discard;

    /* ---- ④ 配色 ----
       银心偏暖（老恒星多），旋臂偏冷蓝（年轻恒星 + 电离气体）。 */
    float warmMix = clamp(bulge * 2.4 + (1.0 - abs(h) * 3.0) * 0.28, 0.0, 1.0);
    vec3 col = mix(uColorCool, uColorWarm, warmMix);

    /* ---- ⑤ 细密星尘：叠一层高频颗粒，避免雾看起来"糊" ---- */
    float grain = snoise(dir * 420.0) * 0.5 + 0.5;
    col *= 0.88 + grain * 0.26;

    float alpha = dens * uIntensity;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

/* ============================================================
 *  主构建
 * ========================================================== */

/** 恒星色温谱：从蓝白巨星到红矮星（真实分布，M 型最多） */
const SPECTRAL = [
  { c: 0x9db4ff, w: 0.030 },   // O 蓝
  { c: 0xbfd4ff, w: 0.075 },   // B 蓝白
  { c: 0xdce8ff, w: 0.115 },   // A 白
  { c: 0xfff6ee, w: 0.150 },   // F 黄白
  { c: 0xfff2d6, w: 0.190 },   // G 黄（太阳型）
  { c: 0xffdfa8, w: 0.210 },   // K 橙
  { c: 0xffb98a, w: 0.170 },   // M 橙红
  { c: 0xff9c7a, w: 0.060 }    // 红矮/碳星
];
function pickSpectral(rnd) {
  let r = rnd(), acc = 0;
  for (const s of SPECTRAL) { acc += s.w; if (r <= acc) return s.c; }
  return 0xffffff;
}

export function buildDeepSky(scene, { pixelRatio = 1, quality = 'high', starSpriteTex = null } = {}) {
  const group = new THREE.Group();
  group.name = 'deepsky';
  group.matrixAutoUpdate = true;
  scene.add(group);

  const q = quality === 'high' ? 1 : quality === 'medium' ? 0.55 : 0.3;
  /* ★ 星数从 24000 提到 46000。原因：星野现在是**向银道面聚集**的，
     同样的点数摊在一条带上，带内密度反而下降，"星河"会显得稀疏。
     提到 1.9 倍后，带内密到能叠成连续的光带，带外仍留干净的黑。 */
  const STAR_COUNT  = Math.round(46000 * q);
  const MILKY_DUST  = Math.round(12000 * q);
  const SHELL       = 9000;

  /* ---------- 1. 均匀星野 ---------- */
  const rnd = mulberry32(20240921);
  const pos = new Float32Array(STAR_COUNT * 3);
  const col = new Float32Array(STAR_COUNT * 3);
  const siz = new Float32Array(STAR_COUNT);
  const pha = new Float32Array(STAR_COUNT);
  const mag = new Float32Array(STAR_COUNT);

  /* ★ 星野不再各向同性，而是**向银道面聚集**——这是"一眼看出是真实星空"
     最有效的一招。真实星空中银河带里的星密度比银极高出一个数量级。
     做法：先按银道坐标系生成方向（b 纬度用 |sin b| 的幂律压缩到赤道附近），
     再用同一个银道基（与第 3 节的银河雾共用 uAxis）转回世界坐标。
     这样"银河雾在哪、星就密在哪"，两者自然对齐，不会出现"雾带里没星"的穿帮。 */
  const galAxis = new THREE.Vector3(0.32, 0.82, -0.47).normalize();
  const galE1 = new THREE.Vector3(0, 0, 1).cross(galAxis).normalize();
  if (!isFinite(galE1.x) || galE1.lengthSq() < 0.5) galE1.set(1, 0, 0);
  const galE2 = new THREE.Vector3().crossVectors(galAxis, galE1).normalize();

  const brightIdx = [];
  const tmpV = new THREE.Vector3();
  for (let i = 0; i < STAR_COUNT; i++) {
    /* 银纬 b：把均匀分布按"赤道密、两极疏"往银道面压。
       ★ 必须**先定正负、再压幅度**，不能直接对 [-1,1] 取幂——
          pow(rnd(),3)*2-1 会让结果系统性偏向 -1（南天极），
          distribution 变成"南半球挤成一条带、北半球空荡荡"，一眼假。
       正确做法：符号由一次独立抽样定，幅度 |sin b| 走 pow(rnd(), 3)，
       这样南北严格对称，且 70% 落在 |b| < 25° 的带内。 */
    const sgn = rnd() < 0.5 ? -1 : 1;
    const sLat = sgn * Math.pow(rnd(), 3.0);          // sin(b) ∈ [-1,1]，围绕 0
    const lat = Math.asin(sLat);
    const lon = rnd() * Math.PI * 2;
    const cb = Math.cos(lat);
    tmpV.set(cb * Math.cos(lon), Math.sin(lat), cb * Math.sin(lon));
    /* 银道系 → 世界系 */
    const dir = new THREE.Vector3()
      .addScaledVector(galE1, tmpV.x)
      .addScaledVector(galAxis, tmpV.y)
      .addScaledVector(galE2, tmpV.z)
      .normalize();
    tmpV.copy(dir).multiplyScalar(SHELL * (0.82 + rnd() * 0.18));
    pos[i * 3] = tmpV.x; pos[i * 3 + 1] = tmpV.y; pos[i * 3 + 2] = tmpV.z;

    const c = hex2rgb(pickSpectral(rnd));

    /* ★ 星等分布：真实星表里星的**数目**随亮度是幂律增长，但最亮的那几颗
       远远甩开大部队。旧版 pow(rnd(),3.2) 让亮星尾巴太软，看上去"星星
       大小都差不多"。现在改成两段：
         · 92% 走陡幂律（大量微星，制造"星尘"质感）
         · 8% 走缓幂律（一支可观的亮星队伍，撑起画面层次）
       这直接决定了"星空的动态范围"，是真实感的关键。 */
    const isBright = rnd() < 0.08;
    const m = isBright
      ? 0.62 + Math.pow(rnd(), 1.5) * 0.38
      : Math.pow(rnd(), 4.2) * 0.62;
    mag[i] = m;

    /* 亮度：底噪 0.30 保证暗星可见，亮星顶到 2.4 倍以触发 Bloom */
    const bright = 0.30 + m * 2.10;

    col[i * 3]     = Math.min(1, (c[0] / 255) * bright);
    col[i * 3 + 1] = Math.min(1, (c[1] / 255) * bright);
    col[i * 3 + 2] = Math.min(1, (c[2] / 255) * bright);

    /* 星点尺寸：真实光学里亮星的 PSF 远比暗星"胖"，
       用 m^3 拉开更狠的动态范围（旧版是 m^2）。 */
    siz[i] = 0.85 + m * m * m * 9.0;
    pha[i] = rnd();
    if (m > 0.62) brightIdx.push(i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));

  const faintMat = makeStarMaterial(pixelRatio, false, null, 1.0);
  const stars = new THREE.Points(geo, faintMat);
  stars.frustumCulled = false;
  group.add(stars);

  /* ---------- 2. 亮星（贴图版，带完整星芒） ---------- */
  let brightPoints = null;
  if (brightIdx.length && starSpriteTex) {
    const n = brightIdx.length;
    const p2 = new Float32Array(n * 3), c2 = new Float32Array(n * 3);
    const s2 = new Float32Array(n), h2 = new Float32Array(n), m2 = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const i = brightIdx[k];
      p2[k * 3] = pos[i * 3]; p2[k * 3 + 1] = pos[i * 3 + 1]; p2[k * 3 + 2] = pos[i * 3 + 2];
      c2[k * 3]     = Math.min(1, col[i * 3] * 1.2);
      c2[k * 3 + 1] = Math.min(1, col[i * 3 + 1] * 1.2);
      c2[k * 3 + 2] = Math.min(1, col[i * 3 + 2] * 1.2);
      s2[k] = siz[i] * 2.4; h2[k] = pha[i]; m2[k] = mag[i];
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
    g2.setAttribute('aColor', new THREE.BufferAttribute(c2, 3));
    g2.setAttribute('aSize', new THREE.BufferAttribute(s2, 1));
    g2.setAttribute('aPhase', new THREE.BufferAttribute(h2, 1));
    g2.setAttribute('aMag', new THREE.BufferAttribute(m2, 1));
    const mm = makeStarMaterial(pixelRatio, true, starSpriteTex, 1.0);
    brightPoints = new THREE.Points(g2, mm);
    brightPoints.frustumCulled = false;
    group.add(brightPoints);
  }

  /* ---------- 2.5 ★ 真实银河天球（本次最大的升级） ----------
     NASA Deep Star Maps 2020（Gaia DR2 等 17 亿颗恒星），公有领域。
     程序化 fbm 永远长不出真实的丝状纤维、暗尘埃带遮挡、银心饱和核，
     这张图里全都有 —— 因为它本来就是照片。
     ★ buildDeepSky 是同步函数（改 async 会牵动调用方），所以这里
       用 .then() 异步加载：mesh 就绪后再挂进场景，并顺手关掉下面
       的程序化银河雾和星尘（真实图里已经有银河，再叠会重复穿帮）。
       加载失败则什么都不做，程序化层原样兜底。 */
  const axis = new THREE.Vector3(0.32, 0.82, -0.47).normalize();
  let realSkyMesh = null;
  let realSkySize = 0;
  TEX.skyGalaxySet().then((realSky) => {
    if (!realSky || !realSky.map) return;
    /* MeshBasicMaterial：天球是"背景"，自己不参与光照，
       颜色就是贴图颜色乘一个全局亮度。 */
    const skyMat = new THREE.MeshBasicMaterial({
      map: realSky.map,
      side: THREE.BackSide,          // 从球内看向外
      depthWrite: false,
      depthTest: false,
      color: 0xffffff
    });
    realSkyMesh = new THREE.Mesh(new THREE.SphereGeometry(SHELL * 0.985, 96, 64), skyMat);
    realSkyMesh.frustumCulled = false;
    /* ★ 银道面对齐：贴图是银道坐标，水平中线 = 银道面。
       把球体绕"从 Y 轴转到银河极"的四元数旋转，银河带就自然
       落到正确的位置上（和程序化雾用同一个 galAxis）。 */
    realSkyMesh.quaternion.copy(new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis));
    realSkyMesh.renderOrder = -25;   // 比 milkyShell(-20) 更早，作为最底层
    group.add(realSkyMesh);
    realSkySize = realSky.size;
    /* 真实银河到位：关掉会被它重复的程序化层 */
    milkyMat.uniforms.uIntensity.value = 0.0;
    if (milkyDust) milkyDust.visible = false;
    window.__realSkyLoaded = true;
  }).catch(() => {});

  /* ---------- 3. 银河：体积雾 ----------
     ★ 真实天球加载成功后这里会被调成 0（见上方 .then）。
        初始保持 0.155，这样加载期间/失败时画面都不空。 */
  const milkyIntensity = 0.155;
  const milkyMat = new THREE.ShaderMaterial({
    uniforms: {
      uAxis:      { value: axis.clone() },
      uColorWarm: { value: new THREE.Color(0xffd9a8) },   // 银心暖
      uColorCool: { value: new THREE.Color(0x9fb4e8) },   // 旋臂冷
      uIntensity: { value: milkyIntensity },
      uTime:      { value: 0 }
    },
    vertexShader: MILKY_VERT,
    fragmentShader: MILKY_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending
  });
  const milkyShell = new THREE.Mesh(new THREE.SphereGeometry(SHELL * 0.97, 64, 48), milkyMat);
  milkyShell.frustumCulled = false;
  milkyShell.renderOrder = -20;
  group.add(milkyShell);

  /* ---------- 4. 银河里的致密星尘（细节层，叠在雾上） ----------
     ★ 真实天球加载成功后整层会被隐藏（见上方 .then）：
       贴图里已经包含 Gaia 的无数暗星，再撒 1.2 万个随机点会
       和它"对不上号"，看起来像两套银河。 */
  const mp = [], mc = [], ms = [], mh = [], mmag = [];
  const mrnd = mulberry32(777001);
  const galV = new THREE.Vector3();
  const sx = new Simplex3(4242);
  let guard = 0;
  while (mp.length / 3 < MILKY_DUST && guard < MILKY_DUST * 60) {
    guard++;
    const u = mrnd() * 2 - 1, th = mrnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    galV.set(s * Math.cos(th), u, s * Math.sin(th));
    const h = galV.dot(axis);

    const dens = Math.exp(-(h * h) / (2.0 * 0.10 * 0.10));
    if (mrnd() > dens) continue;

    const lon = Math.atan2(galV.z, galV.x);
    const structure = 0.5 + 0.5 * (fbm(sx, Math.cos(lon) * 2.4, h * 9, Math.sin(lon) * 2.4, 4, 1.3) * 0.5 + 0.5);
    if (mrnd() > structure) continue;

    galV.multiplyScalar(SHELL * (0.9 + mrnd() * 0.1));
    mp.push(galV.x, galV.y, galV.z);

    const c = hex2rgb(pickSpectral(mrnd));
    const m = Math.pow(mrnd(), 2.4);
    const b = 0.24 + m * 0.62;
    mc.push((c[0] / 255) * b, (c[1] / 255) * b, (c[2] / 255) * b);
    ms.push(0.7 + Math.pow(mrnd(), 3) * 1.7);
    mh.push(mrnd());
    mmag.push(m);
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
  mg.setAttribute('aColor', new THREE.Float32BufferAttribute(mc, 3));
  mg.setAttribute('aSize', new THREE.Float32BufferAttribute(ms, 1));
  mg.setAttribute('aPhase', new THREE.Float32BufferAttribute(mh, 1));
  mg.setAttribute('aMag', new THREE.Float32BufferAttribute(mmag, 1));
  const milkyDustMat = makeStarMaterial(pixelRatio * 0.9, false, null, 1.0);
  milkyDustMat.uniforms.uTwinkle.value = 0.4;
  milkyDustMat.uniforms.uSpike.value = 0;
  const milkyDust = new THREE.Points(mg, milkyDustMat);
  milkyDust.frustumCulled = false;
  milkyDust.renderOrder = -19;
  group.add(milkyDust);

  /* ---------- 5. 星云与远景星系 billboard ---------- */
  const billboards = new THREE.Group();
  billboards.name = 'billboards';
  group.add(billboards);

  function addBillboards(nebulaTexes, galaxyTexes) {
    const nrnd = mulberry32(31337);

    nebulaTexes.forEach((tex) => {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0.26 + nrnd() * 0.30
      });
      const sp = new THREE.Sprite(mat);
      const u = nrnd() * 2 - 1, th = nrnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(s * Math.cos(th), u * 0.7, s * Math.sin(th)).normalize();
      sp.position.copy(dir.multiplyScalar(SHELL * (0.42 + nrnd() * 0.3)));
      const size = 1500 + nrnd() * 3400;
      sp.scale.set(size, size * (0.55 + nrnd() * 0.7), 1);
      sp.material.rotation = nrnd() * Math.PI * 2;
      sp.renderOrder = -10;
      billboards.add(sp);
    });

    galaxyTexes.forEach((tex) => {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, opacity: 0.5 + nrnd() * 0.42
      });
      const sp = new THREE.Sprite(mat);
      const u = nrnd() * 2 - 1, th = nrnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(s * Math.cos(th), u, s * Math.sin(th)).normalize();
      sp.position.copy(dir.multiplyScalar(SHELL * (0.55 + nrnd() * 0.4)));
      const size = 220 + nrnd() * 900;
      sp.scale.set(size, size * (0.4 + nrnd() * 0.6), 1);
      sp.material.rotation = nrnd() * Math.PI * 2;
      sp.renderOrder = -10;
      billboards.add(sp);
    });
  }

  /* ---------- 6. 星际尘埃（近景漂浮微粒） ---------- */
  const DUST = Math.round(2600 * q);
  const dv = new THREE.Vector3();
  const dpos = new Float32Array(DUST * 3);
  const dcol = new Float32Array(DUST * 3);
  const dsz = new Float32Array(DUST);
  const dph = new Float32Array(DUST);
  const dmag = new Float32Array(DUST);
  const drnd = mulberry32(9182736);
  for (let i = 0; i < DUST; i++) {
    const r = 180 + Math.pow(drnd(), 0.5) * 1400;
    const u = drnd() * 2 - 1, th = drnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    dv.set(s * Math.cos(th), u * 0.55, s * Math.sin(th)).multiplyScalar(r);
    dpos[i * 3] = dv.x; dpos[i * 3 + 1] = dv.y; dpos[i * 3 + 2] = dv.z;
    const b = 0.16 + drnd() * 0.3;
    dcol[i * 3] = b * 0.8; dcol[i * 3 + 1] = b * 0.9; dcol[i * 3 + 2] = b;
    dsz[i] = 0.7 + drnd() * 1.4;
    dph[i] = drnd();
    dmag[i] = drnd() * 0.3;
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dg.setAttribute('aColor', new THREE.BufferAttribute(dcol, 3));
  dg.setAttribute('aSize', new THREE.BufferAttribute(dsz, 1));
  dg.setAttribute('aPhase', new THREE.BufferAttribute(dph, 1));
  dg.setAttribute('aMag', new THREE.BufferAttribute(dmag, 1));
  const dustMat = makeStarMaterial(pixelRatio, false, null, 1.0);
  dustMat.uniforms.uTwinkle.value = 0.8;
  dustMat.uniforms.uSpike.value = 0;
  const dust = new THREE.Points(dg, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  return {
    group, dust, billboards, addBillboards,
    update(dt, t, camera) {
      group.position.copy(camera.position);
      faintMat.uniforms.uTime.value = t;
      if (brightPoints) brightPoints.material.uniforms.uTime.value = t;
      milkyDustMat.uniforms.uTime.value = t * 0.5;
      dustMat.uniforms.uTime.value = t * 1.4;
      milkyMat.uniforms.uTime.value = t;
      billboards.rotation.y = t * 0.0025;
    },
    setQuality(pr) {
      faintMat.uniforms.uPixelRatio.value = pr;
      if (brightPoints) brightPoints.material.uniforms.uPixelRatio.value = pr;
      milkyDustMat.uniforms.uPixelRatio.value = pr * 0.9;
      dustMat.uniforms.uPixelRatio.value = pr;
    },
    /** 供测试断言内部状态。
     *  ★ hasRealSky 必须用 getter：真实天球是异步加载的，
     *    对象字面量求值时还没加载完，普通属性会把 false 固化下来。 */
    _debug: {
      starCount: STAR_COUNT,
      milkyDustCount: mp.length / 3,
      brightCount: brightIdx.length,
      hasMilkyShell: true,
      get hasRealSky() { return !!realSkyMesh; },
      get realSkySize() { return realSkySize; }
    }
  };
}
