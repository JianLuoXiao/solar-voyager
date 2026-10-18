/**
 * surface.js — 行星地表第一人称场景
 *
 * 设计约束（很重要）：
 * 1. 同一时刻只存在一个地表实例，返航时必须 dispose()，显存/内存不累积。
 * 2. 全部贴图运行时 Canvas 合成，零外部资源：整个地表模块不引入任何 png/jpg。
 * 3. 地形高度用「同一份网格数据」三角面插值采样，保证玩家脚底与渲染出来的
 *    地面严格贴合（不会因为近似公式产生"陷进地里 / 悬空"的穿帮）。
 * 4. 场景尺度按「米」来算：eye 高 1.72 m，行走 4.4 m/s，火星重力 3.72 m/s²。
 */
import * as THREE from 'three';
import * as TEX from './textures.js';
import { TAR, POLY, tarSin, polyCrack, flatFromSlope } from './mars_features.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** sRGB(0~1) -> 线性：顶点色是直接参与光照计算的，必须先转线性空间 */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * 无缝平铺的细颗粒噪声画布。
 * 做法：把噪声采样点摆在一个「环面」上（u 绕大圆、v 绕小圆），
 *       u/v 各自走满 2π 后必然回到原点 —— 这就天然实现上下左右都无缝。
 */
function granularCanvas(size, seed, freq, oct, power, crackle) {
  const sx = new TEX.Simplex3(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const R = 3.0, r = 1.0;
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    const cy = Math.cos(v), sy = Math.sin(v);
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const ring = R + r * cy;
      const nx = ring * Math.cos(u), ny = r * sy, nz = ring * Math.sin(u);
      let n = TEX.fbm(sx, nx * freq, ny * freq, nz * freq, oct, 1, 2.07, 0.55);
      if (crackle > 0) {
        const rd = TEX.ridged(sx, nx * freq * 3.3, ny * freq * 3.3, nz * freq * 3.3, 3, 1);
        n += Math.pow(Math.abs(rd - 0.5) * 2, 3) * crackle;
      }
      // 这张图会拿去当 albedo 的乘法细节层：必须围绕 1.0 波动（0.66 ~ 0.92），
      // 若围绕 0.5 波动，等于把整张地表的反照率砍半，画面会黑成一团。
      const t = clamp01(0.79 + n * power * 0.55);
      const g = Math.round(t * 255);
      const o = (y * size + x) * 4;
      d[o] = g; d[o + 1] = g; d[o + 2] = g; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function canvasTexture(cv, srgb, repeat) {
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 把灰度高度图转成**可无缝平铺**的法线贴图（Sobel 梯度）。
 *
 * 关键点：地面贴图是 RepeatWrapping 的，法线贴图必须同样无缝 ——
 * 所以采样时 x/y 都做环绕取模，绝不能钳制到边界（钳制会在每块贴图交界
 * 处留下一条可见的直线接缝）。
 */
function normalCanvasFromHeight(hCanvas, strength = 1.5) {
  const W = hCanvas.width, H = hCanvas.height;
  const src = hCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(W, H);
  const od = oimg.data;

  /* 环绕采样：上下左右都绕回另一侧，保证平铺无缝 */
  const at = (x, y) => {
    const xx = ((x % W) + W) % W;
    const yy = ((y % H) + H) % H;
    return src[(yy * W + xx) * 4] / 255;
  };

  const K = strength * 2.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));

      let nx = -gx * K, ny = -gy * K, nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;

      const o = (y * W + x) * 4;
      od[o] = (nx * 0.5 + 0.5) * 255;
      od[o + 1] = (ny * 0.5 + 0.5) * 255;
      od[o + 2] = (nz * 0.5 + 0.5) * 255;
      od[o + 3] = 255;
    }
  }
  octx.putImageData(oimg, 0, 0);
  return out;
}

/**
 * 构建一颗行星的地表世界
 * @param {object} cfg  来自 SURFACES 表的参数
 * @param {object} opts { quality }
 */
export function buildSurfaceWorld(cfg, opts = {}) {
  const quality = opts.quality || 'medium';
  const size = cfg.size ?? 300;
  /* ★ 网格密度：176 时格子边长 1.7 m，站在地面上近处的起伏会被插值抹平。
     DEM 模式下几何精度就是一切 —— 真实高程网格 0.59 m，high 档提到 320
     （格子 0.94 m，102k 顶点 / 205k 三角形，桌面端一次性构建无压力），
     否则真实岩层的细脊会被采样网格抹掉一半。 */
  const seg = cfg.seg ?? (quality === 'high' ? 320 : quality === 'medium' ? 176 : 112);
  const playR = cfg.playRadius ?? 58;

  const scene = new THREE.Scene();
  const disposables = [];
  const track = (o) => { if (o) disposables.push(o); return o; };

  const sx = new TEX.Simplex3(cfg.seed);
  const sx2 = new TEX.Simplex3(cfg.seed * 7 + 91);

  /* ============================================================
   *  1. 地形高度场
   *  ★ 真实 DEM 路径（opts.dem）：高度直接取自 HiRISE 立体测量高程，
   *    贴图/法线/AO 与几何同源 —— 这是从"像火星"到"就是火星"的一步。
   *    程序化路径保留：DEM 缺失时的兜底。
   * ========================================================== */
  const R = cfg.relief;
  const dem = (opts.dem && opts.dem.h) ? opts.dem : null;
  const demN = dem ? dem.meta.N : 0;
  const demH = dem ? dem.h : null;
  const demSize = dem ? (dem.meta.size_m || size) : 0;
  const demHalf = demSize / 2;
  /* vScale：真实起伏 → 场景起伏。烘焙端已按"最高 ~15 m"给出建议值；
     玩家眼高 1.72 m，15 m 的岩壁已经是压得人抬头的尺度 */
  const demVScale = dem ? (dem.meta.vScale ?? Math.min(0.55, Math.max(0.18, 15 / Math.max(dem.meta.relief_m, 0.5)))) : 1;

  /** 双线性采样 DEM 高程（米）。UV 约定与 PlaneGeometry 一致：
      v=0（bin 第 0 行）→ z=+half，v=1 → z=-half。 */
  function demSample(x, z) {
    const fu = clamp01(x / demSize + 0.5) * (demN - 1);
    const fv = clamp01(0.5 - z / demSize) * (demN - 1);
    const x0 = Math.floor(fu), y0 = Math.floor(fv);
    const x1 = Math.min(x0 + 1, demN - 1), y1 = Math.min(y0 + 1, demN - 1);
    const tx = fu - x0, ty = fv - y0;
    const i00 = y0 * demN + x0, i10 = y0 * demN + x1;
    const i01 = y1 * demN + x0, i11 = y1 * demN + x1;
    return (demH[i00] * (1 - tx) + demH[i10] * tx) * (1 - ty)
         + (demH[i01] * (1 - tx) + demH[i11] * tx) * ty;
  }

  /* ------------------------------------------------------------
   *  火星标志性地貌叠加（只在真实 DEM 地表生效）
   *  参数与形状函数在 js/mars_features.js —— 几何（这里）和反照率
   *  贴图（textures.js）必须逐点一致，所以只共享这一份。
   *  ① TAR 横向风成沙脊：脊线垂直风向、波长十几米，只堆在平地；
   *  ② 多边形热收缩裂纹网：尘埃壳上的浅槽，同样只在平地。
   * ------------------------------------------------------------ */

  /** DEM 坡度（|∇h|，即 tan 坡角，场景单位）。中心差分，步长取一个 DEM 像素。 */
  const demPx = dem ? (demSize / (demN - 1)) : 1;
  function demSlope(x, z) {
    const gx = (demSample(x + demPx, z) - demSample(x - demPx, z)) * demVScale / (2 * demPx);
    const gz = (demSample(x, z + demPx) - demSample(x, z - demPx)) * demVScale / (2 * demPx);
    return Math.hypot(gx, gz);
  }

  const rimStart = playR + (dem ? 26 : 8);   // 真实地形让它晚点出现，别压住岩壁
  const rimCap = dem ? 13 : (R.rimCap ?? 26);

  function rawHeight(x, z) {
    let h;
    if (dem) {
      /* ---- 真实高程 ---- */
      h = demSample(x, z) * demVScale;
      /* 网格是 1.17 m，DEM 是 0.59 m：补一点亚网格微起伏，
         幅度压在厘米级，避免"鞋面以上全是塑料感" */
      h += TEX.fbm(sx, x * 0.42, 31.7, z * 0.42, 3, 1, 2.05, 0.5) * 0.055;
      h += TEX.fbm(sx, x * 1.35, 57.3, z * 1.35, 2, 1, 2.05, 0.5) * 0.020;
      /* ---- TAR 横向沙脊：只落在平坦处 ---- */
      const sl = demSlope(x, z);
      const fmTar = flatFromSlope(sl, TAR.band);
      if (fmTar > 0.001) h += tarSin(x, z) * TAR.amp * fmTar;
      /* ---- 多边形热收缩裂纹网：同样只在平坦的尘埃壳上 ---- */
      const fmPoly = flatFromSlope(sl, POLY.band);
      if (fmPoly > 0.001) h -= polyCrack(x, z) * POLY.amp * fmPoly;
    } else {
      /* ---- 程序化兜底（原逻辑不动） ---- */
      h = TEX.fbm(sx, x * R.freq, 1.7, z * R.freq, 5, 1, 2.03, 0.5) * R.amp;
      h += TEX.fbm(sx, x * 0.0035, 13.7, z * 0.0035, 2, 1, 2.0, 0.5) * R.basin;
      if (R.ridge) h += (TEX.ridged(sx, x * R.ridge.freq, 5.1, z * R.ridge.freq, 4, 1) - 0.55) * R.ridge.amp;
      if (R.dune) {
        const w = TEX.fbm(sx, x * 0.006, 9.3, z * 0.006, 3, 1, 2.1, 0.5);
        h += Math.sin((x * 0.707 + z * 0.707) * R.dune.freq + w * R.dune.warp) * R.dune.amp;
      }
      if (R.detail) h += TEX.fbm(sx, x * R.detail.freq, 3.3, z * R.detail.freq, 3, 1, 2.1, 0.5) * R.detail.amp;
      h += TEX.fbm(sx, x * 0.42, 31.7, z * 0.42, 3, 1, 2.05, 0.5) * (R.amp * 0.055);
      h += TEX.fbm(sx, x * 1.35, 57.3, z * 1.35, 2, 1, 2.05, 0.5) * (R.amp * 0.020);
    }

    // 外圈隆起成一圈环形山脊：既把玩家"圈"在里面，又把平面边界藏起来。
    // 注意必须封顶！k*k 无限增长的话，地形边缘(150m)处会堆出 240m 高墙，
    // 被雾一染就成了"假天空"，抬头看星空会看到一整片橙色的墙。
    const rr = Math.hypot(x, z);
    if (rr > rimStart) {
      const k = rr - rimStart;
      const grow = k * k * R.rim;
      h += rimCap * (1 - Math.exp(-grow / rimCap)) * (0.75 + 0.5 * TEX.fbm(sx, x * 0.02, 21.3, z * 0.02, 3, 1, 2.1, 0.5));
      /* 环形山脊上再叠一层侵蚀沟壑，否则那圈墙看起来太"橡胶" */
      h += TEX.ridged(sx, x * 0.055, 63.1, z * 0.055, 3, 1) * rimCap * 0.10 *
           clamp01((rr - rimStart) / 12);
    }
    // 出生点抹平，保证落地即站得住（半径 5 m 内全平，19 m 外恢复全部起伏）
    const d0 = Math.hypot(x, z);
    return h * smooth(clamp01((d0 - 5) / 14));
  }

  const geo = track(new THREE.PlaneGeometry(size, size, seg, seg));
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position;
  const N = seg + 1;
  const H = new Float32Array(N * N);
  let minH = Infinity, maxH = -Infinity;

  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const i = iy * N + ix;
      const h = rawHeight(posAttr.getX(i), posAttr.getZ(i));
      H[i] = h;
      posAttr.setY(i, h);
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const hSpan = Math.max(0.001, maxH - minH);

  /**
   * 三角面插值取高度 —— 与渲染用的三角形完全对齐。
   * PlaneGeometry 每个格子拆成两个三角形：(a,b,d) 覆盖 fx+fz<=1，(b,c,d) 覆盖 fx+fz>1。
   */
  const step = size / seg;
  const half = size / 2;
  function heightAt(x, z) {
    const gx = (x + half) / step;
    const gz = (z + half) / step;
    let ix = clamp(Math.floor(gx), 0, seg - 1);
    let iz = clamp(Math.floor(gz), 0, seg - 1);
    const fx = clamp(gx - ix, 0, 1), fz = clamp(gz - iz, 0, 1);
    const h00 = H[iz * N + ix];
    const h10 = H[iz * N + ix + 1];
    const h01 = H[(iz + 1) * N + ix];
    const h11 = H[(iz + 1) * N + ix + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    const hx = h10 + (h11 - h10) * fz;
    const hz = h01 + (h11 - h01) * fx;
    return hx + hz - h11;
  }

  /* ---- 顶点色：高度分层 + 坡度露岩 + 颗粒抖动 ---- */
  const colArr = new Float32Array(posAttr.count * 3);
  const rockRGB = TEX.hex2rgb(cfg.ground.rock);
  const rockLin = [srgbToLinear(rockRGB[0] / 255), srgbToLinear(rockRGB[1] / 255), srgbToLinear(rockRGB[2] / 255)];

  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const i = iy * N + ix;
      const h = H[i];
      const t = clamp01((h - minH) / hSpan);
      let c = TEX.ramp(cfg.ground.stops, t);

      // 坡度（用邻域差分近似）
      const hl = H[iy * N + Math.max(0, ix - 1)];
      const hr = H[iy * N + Math.min(N - 1, ix + 1)];
      const hd = H[Math.max(0, iy - 1) * N + ix];
      const hu = H[Math.min(N - 1, iy + 1) * N + ix];
      const slope = Math.hypot((hr - hl) / (2 * step), (hu - hd) / (2 * step));
      const sm = clamp01((slope - 0.28) / 0.55);
      c = [lerp(c[0], rockRGB[0], sm), lerp(c[1], rockRGB[1], sm), lerp(c[2], rockRGB[2], sm)];

      const o = i * 3;
      const jitter = 1 + TEX.fbm(sx2, ix * 0.09, 4.2, iy * 0.09, 2, 1, 2.0, 0.5) * 0.16;
      colArr[o] = srgbToLinear(clamp01((c[0] / 255) * jitter));
      colArr[o + 1] = srgbToLinear(clamp01((c[1] / 255) * jitter));
      colArr[o + 2] = srgbToLinear(clamp01((c[2] / 255) * jitter));
    }
  }
  void rockLin;
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  geo.computeVertexNormals();

  /* ---- 地表材质：真实 DEM 套件 > 旧烘焙正射 > 程序化兜底 ----
     ★ opts.dem（marsDemSet）：几何与贴图同源的真实高程数据，
       ORM 打包（R=AO G=粗糙 B=金属），r160 的 aoMap 走 uv1 通道。
     ★ opts.groundSet 是 tools/bake_mars_ground.py 拼合的**非重复**
       虚拟正射影像（2048²，整块地面只用一次，不存在平铺重复）。
       程序化的 granular 噪声保留为 bumpMap 微起伏层——
       真实照片的宏观结构 + 程序化的厘米级颗粒，两者互补。 */
  const granCV = granularCanvas(512, cfg.seed + 3, 2.6, 5, 0.42, cfg.crackle ?? 0.25);
  const bumpTex = track(canvasTexture(granCV, false, cfg.detailRepeat ?? 34));
  let groundMat;
  if (opts.dem && opts.dem.albedo) {
    const g = opts.dem;
    /* r160：aoMap 默认读 uv1 —— PlaneGeometry 只有 uv，复制一份即可 */
    geo.setAttribute('uv1', geo.attributes.uv);
    groundMat = track(new THREE.MeshStandardMaterial({
      map: g.albedo,
      normalMap: g.normal || null,
      normalScale: new THREE.Vector2(cfg.normalScale ?? 1.0, cfg.normalScale ?? 1.0),
      /* ORM 打包：一张贴图同时喂 AO / 粗糙度 / 金属度三个插槽 */
      aoMap: g.orm || null,
      aoMapIntensity: 1.0,
      roughnessMap: g.orm || null,
      metalnessMap: g.orm || null,
      roughness: 1.0,          // 实际值 = 纹理 G 通道 × roughness
      metalness: 1.0,          // 实际值 = 纹理 B 通道（烘焙为 0）
      /* 保留很轻的 bump 做近景厘米级颗粒（1 m/px 正射放大后的软化靠它补） */
      bumpMap: bumpTex,
      bumpScale: 0.12,
      dithering: true
    }));
  } else if (opts.groundSet && opts.groundSet.albedo) {
    const g = opts.groundSet;
    groundMat = track(new THREE.MeshStandardMaterial({
      map: g.albedo,
      normalMap: g.normal || null,
      normalScale: new THREE.Vector2(cfg.normalScale ?? 1.0, cfg.normalScale ?? 1.0),
      roughnessMap: g.rough || null,
      roughness: 1.0,
      metalness: 0.02,
      /* 保留很轻的 bump 做近景厘米级颗粒（repeat 高频平铺在这个尺度不可见） */
      bumpMap: bumpTex,
      bumpScale: 0.16,
      dithering: true
    }));
  } else {
    const detailTex = track(canvasTexture(granCV, true, cfg.detailRepeat ?? 34));
    const normalTex = track(canvasTexture(
      normalCanvasFromHeight(granCV, cfg.normalStrength ?? 1.5),
      false, cfg.detailRepeat ?? 34
    ));
    groundMat = track(new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detailTex,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(cfg.normalScale ?? 1.0, cfg.normalScale ?? 1.0),
      bumpMap: bumpTex,
      bumpScale: cfg.bumpScale ?? 0.35,
      roughness: cfg.ground.rough ?? 0.96,
      metalness: cfg.ground.metal ?? 0.02,
      dithering: true
    }));
  }
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  /* ============================================================
   *  2. 天穹（渐变 + 太阳方向的低空辉光）
   * ========================================================== */
  const sunDir = new THREE.Vector3(...cfg.sky.sunDir).normalize();

  const skyUniforms = {
    uHorizon: { value: new THREE.Color(cfg.sky.horizon) },
    uMid: { value: new THREE.Color(cfg.sky.mid) },
    uZenith: { value: new THREE.Color(cfg.sky.zenith) },
    uSunDir: { value: sunDir.clone() },
    uSunCol: { value: new THREE.Color(cfg.sky.sunColor ?? 0xffd6a0) },
    uGlow: { value: cfg.sky.glow ?? 1.35 },
    uSharp: { value: cfg.sky.sharp ?? 24.0 },
    uHaze: { value: cfg.sky.haze ?? 0.55 },
    uHazeCol: { value: new THREE.Color(cfg.sky.hazeColor ?? cfg.sky.horizon) }
  };
  const skyMat = track(new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHorizon, uMid, uZenith, uSunDir, uSunCol, uHazeCol;
      uniform float uGlow, uSharp, uHaze;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        // 用仰角直接分段：地平线附近是一条窄亮带，往上快速压暗 ——
        // 若按 d.y*0.5+0.5 线性映射，抬头 30 度还全是地平线色，星空根本露不出来
        float y = max(d.y, 0.0);
        vec3 c = mix(uHorizon, uMid, smoothstep(0.015, 0.20, y));
        c = mix(c, uZenith, smoothstep(0.16, 0.58, y));
        // 贴近地平线的尘埃带
        c = mix(c, uHazeCol, pow(1.0 - min(abs(d.y) * 3.2, 1.0), 3.0) * uHaze);
        // 太阳方向的辉光
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        c += uSunCol * pow(sd, uSharp) * uGlow;
        c += uSunCol * pow(sd, 3.0) * 0.10 * uGlow;
        gl_FragColor = vec4(c, 1.0);
      }`
  }));
  const skyGeo = track(new THREE.SphereGeometry(900, 40, 24));
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -10;
  scene.add(skyDome);

  /* ---- 星空：头顶的银河与星野，缓慢自转模拟行星自转 ---- */
  const starTex = track(TEX.starSprite(64, 0xffffff));
  const starGroup = new THREE.Group();
  scene.add(starGroup);
  function makeStars(count, radius, size, opacity, seed) {
    const g = track(new THREE.BufferGeometry());
    const arr = new Float32Array(count * 3);
    const rnd = TEX.mulberry32(seed);
    for (let i = 0; i < count; i++) {
      // 只铺上半球，且向天顶略微加密（符合真实星野的视觉密度）
      const u = rnd() * Math.PI * 2;
      const v = Math.pow(rnd(), 0.65);
      const alt = Math.acos(1 - v * 1.02);
      const r = Math.sin(alt) * radius;
      arr[i * 3] = Math.cos(u) * r;
      arr[i * 3 + 1] = Math.cos(alt) * radius;
      arr[i * 3 + 2] = Math.sin(u) * r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const m = track(new THREE.PointsMaterial({
      size, map: starTex, transparent: true, opacity,
      sizeAttenuation: false, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    const p = new THREE.Points(g, m);
    p.renderOrder = -9;
    starGroup.add(p);
    return p;
  }
  const starDim = makeStars(cfg.stars?.dim ?? 1500, 820, 2.0, 0.85, cfg.seed + 11);
  const starBright = makeStars(cfg.stars?.bright ?? 160, 820, 4.2, 1.0, cfg.seed + 23);
  void starDim; void starBright;
  starGroup.rotation.z = cfg.stars?.tilt ?? 0.5;

  /* ---- 太阳本体：低悬的一颗亮星 ---- */
  const sunGroup = new THREE.Group();
  scene.add(sunGroup);
  const sunDiskMat = track(new THREE.MeshBasicMaterial({
    color: new THREE.Color(cfg.sky.diskColor ?? 0xfff2d8).multiplyScalar(cfg.sky.diskPower ?? 2.6),
    fog: false, toneMapped: false
  }));
  const sunDiskGeo = track(new THREE.SphereGeometry(7.5, 20, 14));
  const sunDisk = new THREE.Mesh(sunDiskGeo, sunDiskMat);
  sunDisk.position.copy(sunDir).multiplyScalar(760);
  sunDisk.renderOrder = -8;
  sunGroup.add(sunDisk);

  const sunGlowTex = track(TEX.glowSprite(256, cfg.sky.glowColor ?? 0xffc98a, 2.4));
  const sunGlowMat = track(new THREE.SpriteMaterial({
    map: sunGlowTex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, fog: false,
    color: new THREE.Color(cfg.sky.glowColor ?? 0xffc98a)
  }));
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.position.copy(sunDisk.position);
  sunGlow.scale.setScalar(320);
  sunGlow.renderOrder = -7;
  sunGroup.add(sunGlow);

  /* ============================================================
   *  3. 光照
   * ========================================================== */
  const L = cfg.light;
  const sun = new THREE.DirectionalLight(new THREE.Color(L.sun), L.intensity);
  // 太阳放得离场景远一些：低角度光的阴影要拉得很长，影子相机太近会截断
  sun.position.copy(sunDir).multiplyScalar(340);
  sun.castShadow = quality !== 'low';
  if (sun.castShadow) {
    const S = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(S, S);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 900;
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.6;
  }
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new THREE.HemisphereLight(new THREE.Color(L.hemiSky), new THREE.Color(L.hemiGround), L.hemi));
  scene.add(new THREE.AmbientLight(new THREE.Color(L.ambientColor ?? 0x604030), L.ambient ?? 0.18));

  /* 全局指数雾：负责"远处的山被霾吃掉"这层远景效果 */
  scene.fog = new THREE.FogExp2(new THREE.Color(cfg.fog.color), cfg.fog.density);

  /* ★ 贴地雾层（地面灰霾 / 扬尘）——
     全局 FogExp2 是按视线距离均匀衰减的，做不出"低处雾浓、抬头就散"的层次，
     而这恰恰是荒芜行星地表最有辨识度的一笔。
     做法：一层薄薄的水平面片，在 fragment 里按高度和视线仰角算密度，
     相机走到哪跟到哪，所以永远不会被走出边界。 */
  {
    const fogCol = new THREE.Color(cfg.fog.groundColor ?? cfg.fog.color);
    const groundFogMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uColor:    { value: fogCol },
        uOpacity:  { value: cfg.fog.groundOpacity ?? 0.42 },
        uHeight:   { value: cfg.fog.groundHeight ?? 14.0 },  // 雾层厚度（米）
        uBaseY:    { value: 0.0 },                            // 跟随相机的高度
        uSunDir:   { value: sunDir.clone() },
        uSunCol:   { value: new THREE.Color(cfg.sky.sunColor ?? 0xffd6a0) }
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        varying vec3 vToCam;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vToCam = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform vec3  uColor, uSunDir, uSunCol;
        uniform float uOpacity, uHeight, uBaseY;
        varying vec3  vWorld;
        varying vec3  vToCam;
        void main() {
          // 相对雾层底面的高度
          float h = vWorld.y - uBaseY;
          // 密度：贴着地面最浓，到 uHeight 处基本消失
          float dens = exp(-max(h, 0.0) / max(uHeight, 0.001));
          // 视线越平（掠射）穿过的雾越厚 —— 这一条让"地平线附近的霾"自然出现
          float graze = 1.0 - abs(vToCam.y);
          dens *= mix(0.35, 1.0, pow(graze, 1.6));
          // 太阳方向的散射，让雾在向阳侧更亮
          float sd = max(dot(normalize(vToCam), normalize(uSunDir)), 0.0);
          vec3 c = uColor + uSunCol * pow(sd, 3.0) * 0.35;
          float a = dens * uOpacity;
          if (a < 0.004) discard;
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    }));

    /* 一块很大的水平面，跟着相机水平移动，所以覆盖范围永远够用 */
    const gfGeo = track(new THREE.PlaneGeometry(600, 600, 1, 1));
    gfGeo.rotateX(-Math.PI / 2);
    const groundFog = new THREE.Mesh(gfGeo, groundFogMat);
    groundFog.renderOrder = 5;
    groundFog.frustumCulled = false;
    scene.add(groundFog);

    /* 用 update 把雾面钉在相机脚下 */
    var groundFogRef = { mesh: groundFog, mat: groundFogMat };
  }

  /* ============================================================
   *  4. 碎石（InstancedMesh）+ 接触阴影 + 细砾
   * ========================================================== */
  const rockRnd = TEX.mulberry32(cfg.seed + 77);
  const rockCfg = cfg.rocks;

  /* ★ 岩石形状库：旧版 260 块石头全用同一个二十面体，走近了立刻
     穿帮（复制粘贴感）。现在 3 种由噪声扰变的形状轮着用。 */
  function rockGeo(seedOff, detail) {
    const g = track(new THREE.IcosahedronGeometry(1, detail));
    const rnd = TEX.mulberry32(cfg.seed + seedOff);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    const seen = new Map();   // 同一位置的重复顶点必须同样扰动，否则面会裂开
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const key = v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3);
      let s = seen.get(key);
      if (s === undefined) {
        s = 1 + (TEX.fbm(sx, v.x * 1.1 + seedOff * 3.1, v.y * 1.1, v.z * 1.1, 3, 1, 2.1, 0.5) - 0.5) * 0.6;
        s *= 1 + (rnd() - 0.5) * 0.14;
        seen.set(key, s);
      }
      v.multiplyScalar(s);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  let rocks = null;
  const placements = [];
  if (rockCfg.count > 0) {
    const mm = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const ee = new THREE.Euler();
    const pp = new THREE.Vector3();
    const ss = new THREE.Vector3();
    let placedN = 0, guardN = 0;
    while (placedN < rockCfg.count && guardN < rockCfg.count * 30) {
      guardN++;
      const a = rockRnd() * Math.PI * 2;
      const rr = lerp(rimStart * 0.12, playR + 16, Math.sqrt(rockRnd()));
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (Math.hypot(x, z) < 8.5) continue;          // 出生点留空
      const s = lerp(rockCfg.min, rockCfg.max, Math.pow(rockRnd(), 2.1));
      pp.set(x, heightAt(x, z) - s * 0.34, z);
      ee.set(rockRnd() * 6.28, rockRnd() * 6.28, rockRnd() * 6.28);
      qq.setFromEuler(ee);
      const rx = s * lerp(0.7, 1.4, rockRnd());
      const rz = s * lerp(0.7, 1.4, rockRnd());
      ss.set(rx, s * lerp(0.45, 0.85, rockRnd()), rz);
      mm.compose(pp, qq, ss);
      placements.push({ m: mm.clone(), x, z, rx, rz });
      placedN++;
    }

    /* 3 个 InstancedMesh 各拿一种形状，材质亮度轻微错开 */
    const geos = [rockGeo(11, 1), rockGeo(23, 1), rockGeo(37, 0)];
    const mats = geos.map((_, i) => track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(rockCfg.color).multiplyScalar(0.88 + 0.12 * i),
      roughness: rockCfg.rough ?? 0.92, flatShading: true
    })));
    const buckets = [[], [], []];
    placements.forEach((pl, i) => buckets[i % 3].push(pl));
    buckets.forEach((bucket, bi) => {
      if (!bucket.length) return;
      const im = new THREE.InstancedMesh(geos[bi], mats[bi], bucket.length);
      im.castShadow = quality !== 'low';
      im.receiveShadow = true;
      bucket.forEach((pl, i) => im.setMatrixAt(i, pl.m));
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
      if (!rocks) rocks = im;
    });

    /* ★ 接触阴影：旧版岩石"浮"在沙上。每块石头脚下贴一张径向渐变
       暗斑，跟随地形坡向——廉价但极其有效的"坐进沙里"感 */
    {
      const sc = document.createElement('canvas');
      sc.width = sc.height = 64;
      const c2 = sc.getContext('2d');
      const grd = c2.createRadialGradient(32, 32, 2, 32, 32, 31);
      grd.addColorStop(0, 'rgba(0,0,0,0.72)');
      grd.addColorStop(0.55, 'rgba(0,0,0,0.36)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c2.fillStyle = grd;
      c2.fillRect(0, 0, 64, 64);
      const shTex = track(new THREE.CanvasTexture(sc));
      const shMat = track(new THREE.MeshBasicMaterial({
        map: shTex, transparent: true, depthWrite: false, opacity: 0.5,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      }));
      const shGeo = track(new THREE.PlaneGeometry(1, 1));
      shGeo.rotateX(-Math.PI / 2);
      const shMesh = new THREE.InstancedMesh(shGeo, shMat, placements.length);
      const up = new THREE.Vector3(0, 1, 0);
      const nrm = new THREE.Vector3();
      const q2 = new THREE.Quaternion();
      const mm2 = new THREE.Matrix4();
      const pp2 = new THREE.Vector3();
      const ss2 = new THREE.Vector3();
      const eps = 0.9;
      placements.forEach((pl, i) => {
        nrm.set(
          heightAt(pl.x - eps, pl.z) - heightAt(pl.x + eps, pl.z),
          2 * eps,
          heightAt(pl.x, pl.z - eps) - heightAt(pl.x, pl.z + eps)
        ).normalize();
        q2.setFromUnitVectors(up, nrm);
        pp2.set(pl.x, heightAt(pl.x, pl.z) + 0.05, pl.z);
        ss2.set(pl.rx * 2.6, 1, pl.rz * 2.6);
        mm2.compose(pp2, q2, ss2);
        shMesh.setMatrixAt(i, mm2);
      });
      shMesh.instanceMatrix.needsUpdate = true;
      scene.add(shMesh);
    }

    /* ★ 细砾：近景颗粒感的关键一层——大量厘米级小石头把"空旷的
       平面"变成"碎石场"，这正是参考照片近景的质感来源 */
    {
      const gravelCount = quality === 'high' ? 560 : quality === 'medium' ? 340 : 150;
      const gravGeo = rockGeo(53, 0);
      const gravMat = track(new THREE.MeshStandardMaterial({
        color: new THREE.Color(rockCfg.color).multiplyScalar(0.82),
        roughness: 0.95, flatShading: true
      }));
      const gravel = new THREE.InstancedMesh(gravGeo, gravMat, gravelCount);
      const mm3 = new THREE.Matrix4();
      const qq3 = new THREE.Quaternion();
      const ee3 = new THREE.Euler();
      const pp3 = new THREE.Vector3();
      const ss3 = new THREE.Vector3();
      let gn = 0, gguard = 0;
      while (gn < gravelCount && gguard < gravelCount * 30) {
        gguard++;
        const a = rockRnd() * Math.PI * 2;
        const rr = lerp(rimStart * 0.08, playR + 10, Math.sqrt(rockRnd()));
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (Math.hypot(x, z) < 3.0) continue;        // 出生点脚下留空
        const s = lerp(0.05, 0.17, Math.pow(rockRnd(), 1.5));
        pp3.set(x, heightAt(x, z) - s * 0.3, z);
        ee3.set(rockRnd() * 6.28, rockRnd() * 6.28, rockRnd() * 6.28);
        qq3.setFromEuler(ee3);
        ss3.set(s, s * lerp(0.5, 0.8, rockRnd()), s);
        mm3.compose(pp3, qq3, ss3);
        gravel.setMatrixAt(gn++, mm3);
      }
      gravel.count = gn;
      gravel.instanceMatrix.needsUpdate = true;
      gravel.receiveShadow = true;
      scene.add(gravel);
    }
  }

  /* ============================================================
   *  5. 远景地貌剪影（一圈低模山丘，负责把地平线撑起来）
   * ========================================================== */
  const silRnd = TEX.mulberry32(cfg.seed + 313);
  const silCfg = cfg.silhouettes;
  let silhouettes = null;
  if (silCfg && silCfg.count > 0) {
    /* ★ 形状支持 shape:'mesa'（平顶台地）——火星参考图（好奇号/毅力号
       全景）远处的标准地貌：底部有风蚀倒角坡、岩壁近垂直、顶面平坦。
       LatheGeometry 用 9 条母线段 + flatShading，转出来就是有棱角的
       风蚀岩壁，而不是光滑圆锥。 */
    let silGeo;
    if (silCfg.shape === 'mesa') {
      /* 母线：缓坡裙 → 内凹风蚀壁 → 出檐顶缘 → 平顶。
         中段故意内凹（0.90<0.94→1.00 的连线），模拟风沙掏蚀的束腰；
         11 条母线段 + flatShading → 有棱角但不至于方正得像积木。 */
      const prof = [
        new THREE.Vector2(0.03, 0.00),
        new THREE.Vector2(0.52, 0.00),   // 接地
        new THREE.Vector2(0.80, 0.07),   // 底部倒角坡（风蚀堆积裙）
        new THREE.Vector2(0.95, 0.38),   // 岩壁下部
        new THREE.Vector2(0.90, 0.62),   // ★ 风蚀束腰（内凹）
        new THREE.Vector2(1.00, 0.80),
        new THREE.Vector2(0.92, 0.94),   // 顶缘出檐
        new THREE.Vector2(0.64, 1.00),   // 平顶
        new THREE.Vector2(0.02, 1.00)
      ];
      silGeo = track(new THREE.LatheGeometry(prof, 11));
    } else {
      silGeo = track(new THREE.IcosahedronGeometry(1, 0));
    }
    const sm = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(silCfg.color), roughness: 1.0, metalness: 0, flatShading: true
    }));
    silhouettes = new THREE.InstancedMesh(silGeo, sm, silCfg.count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let i = 0; i < silCfg.count; i++) {
      const a = (i / silCfg.count) * Math.PI * 2 + silRnd() * 0.09;
      const rr = lerp(silCfg.rMin, silCfg.rMax, silRnd());
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const w = lerp(silCfg.wMin, silCfg.wMax, silRnd());
      const hgt = lerp(silCfg.hMin, silCfg.hMax, Math.pow(silRnd(), 1.6));
      p.set(x, heightAt(x, z) + hgt * 0.18, z);
      e.set(silRnd() * 0.4, silRnd() * 6.28, silRnd() * 0.4);
      q.setFromEuler(e);
      sc.set(w, hgt, w * lerp(0.6, 1.1, silRnd()));
      m.compose(p, q, sc);
      silhouettes.setMatrixAt(i, m);
    }
    silhouettes.instanceMatrix.needsUpdate = true;
    scene.add(silhouettes);
  }

  /* ============================================================
   *  6. 着陆舱（给场景一个尺度参照物 + 叙事锚点）
   * ========================================================== */
  const landerGroup = new THREE.Group();
  const metalMat = track(new THREE.MeshStandardMaterial({ color: 0xcfd6dc, roughness: 0.42, metalness: 0.75 }));
  const darkMat = track(new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.7, metalness: 0.4 }));
  {
    const body = track(new THREE.CylinderGeometry(0.62, 0.78, 1.15, 12));
    const b = new THREE.Mesh(body, metalMat); b.castShadow = true; b.position.y = 1.05; landerGroup.add(b);
    const top = track(new THREE.ConeGeometry(0.66, 0.5, 12));
    const t = new THREE.Mesh(top, metalMat); t.castShadow = true; t.position.y = 1.86; landerGroup.add(t);
    const legGeo = track(new THREE.CylinderGeometry(0.055, 0.055, 1.25, 6));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(Math.cos(a) * 0.62, 0.52, Math.sin(a) * 0.62);
      leg.rotation.z = Math.cos(a) * 0.34;
      leg.rotation.x = -Math.sin(a) * 0.34;
      leg.castShadow = true;
      landerGroup.add(leg);
    }
    const beaconGeo = track(new THREE.SphereGeometry(0.13, 10, 8));
    const beaconMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a2a), toneMapped: false, fog: false }));
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.y = 2.2;
    landerGroup.add(beacon);
    landerGroup.userData.beaconMat = beaconMat;
    const panelGeo = track(new THREE.BoxGeometry(1.5, 0.04, 0.5));
    const panelMat = track(new THREE.MeshStandardMaterial({ color: 0x22406b, roughness: 0.25, metalness: 0.5 }));
    for (let i = 0; i < 2; i++) {
      const pn = new THREE.Mesh(panelGeo, panelMat);
      pn.position.set(i ? 1.15 : -1.15, 1.05, 0);
      pn.rotation.y = i ? -0.5 : 0.5;
      pn.castShadow = true;
      landerGroup.add(pn);
    }
  }
  const lx = cfg.lander?.x ?? -6.5, lz = cfg.lander?.z ?? 4.2;
  landerGroup.position.set(lx, heightAt(lx, lz), lz);
  landerGroup.rotation.y = cfg.lander?.ry ?? 0.7;
  scene.add(landerGroup);

  /* ============================================================
   *  7. 天气：飘尘
   * ========================================================== */
  let dust = null;
  const D = cfg.dust;
  if (D && D.count > 0) {
    const n = D.count;
    const positions = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const rnd = TEX.mulberry32(cfg.seed + 555);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = (rnd() - 0.5) * D.box;
      positions[i * 3 + 1] = rnd() * D.height;
      positions[i * 3 + 2] = (rnd() - 0.5) * D.box;
      seeds[i] = rnd();
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustCV = document.createElement('canvas');
    dustCV.width = dustCV.height = 32;
    {
      const c2 = dustCV.getContext('2d');
      const grd = c2.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = grd; c2.fillRect(0, 0, 32, 32);
    }
    const dustTex = track(canvasTexture(dustCV, true, 1));
    dustTex.repeat.set(1, 1);
    const m = track(new THREE.PointsMaterial({
      size: D.size, map: dustTex, transparent: true, opacity: D.opacity ?? 0.55,
      depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
      color: new THREE.Color(D.color)
    }));
    dust = new THREE.Points(g, m);
    dust.frustumCulled = false;
    scene.add(dust);
    dust.userData = { seeds, wind: new THREE.Vector3(...D.wind), box: D.box, height: D.height };
  }

  /* ============================================================
   *  8. 特色天气：尘卷风（cfg.devils）
   * ========================================================== */
  const devils = [];
  const DC = cfg.devils;
  if (DC && DC.count > 0) {
    const devilCV = document.createElement('canvas');
    devilCV.width = devilCV.height = 32;
    {
      const c2 = devilCV.getContext('2d');
      const grd = c2.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.42)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = grd; c2.fillRect(0, 0, 32, 32);
    }
    const devilTex = track(canvasTexture(devilCV, true, 1));
    devilTex.repeat.set(1, 1);

    for (let k = 0; k < DC.count; k++) {
      const rnd = TEX.mulberry32(cfg.seed + 900 + k * 17);
      const n = DC.particles;
      const arr = new Float32Array(n * 3);
      const base = new Float32Array(n * 2);   // [初始半径, 初始相位]
      const hr = new Float32Array(n);         // 高度比 0~1

      for (let i = 0; i < n; i++) {
        const hRatio = Math.pow(rnd(), 0.72);
        const rad = lerp(0.5, DC.radius, hRatio) * lerp(0.55, 1.3, rnd());
        hr[i] = hRatio;
        base[i * 2] = rad;
        base[i * 2 + 1] = rnd() * Math.PI * 2;
        arr[i * 3] = Math.cos(base[i * 2 + 1]) * rad;
        arr[i * 3 + 1] = hRatio * DC.height;
        arr[i * 3 + 2] = Math.sin(base[i * 2 + 1]) * rad;
      }

      const g = track(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const m = track(new THREE.PointsMaterial({
        size: DC.size, map: devilTex, transparent: true, opacity: DC.opacity ?? 0.5,
        depthWrite: false, sizeAttenuation: true, blending: THREE.AdditiveBlending,
        color: new THREE.Color(DC.color ?? D?.color ?? 0xd9a271)
      }));
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;

      const group = new THREE.Group();
      group.add(pts);
      const az0 = rnd() * Math.PI * 2;
      group.position.set(Math.cos(az0) * DC.dist, 0, Math.sin(az0) * DC.dist);
      group.position.y = heightAt(group.position.x, group.position.z);
      scene.add(group);

      pts.userData = {
        n, base, hr,
        height: DC.height,
        omega: lerp(1.5, 2.6, rnd()) * (rnd() > 0.5 ? 1 : -1),
        rise: lerp(0.05, 0.1, rnd()),
        t: rnd() * 10,
        cx: group.position.x, cz: group.position.z,
        wanderR: lerp(6, 18, rnd()),
        wanderW: lerp(0.02, 0.055, rnd()) * (rnd() > 0.5 ? 1 : -1),
        phase: rnd() * 6.28
      };
      group.userData = { home: new THREE.Vector3(group.position.x, 0, group.position.z) };
      devils.push({ group, pts });
    }
  }

  /* ============================================================
   *  9. 头顶的卫星
   * ========================================================== */
  const moons = [];
  (cfg.skyMoons || []).forEach((md) => {
    const g = track(new THREE.IcosahedronGeometry(md.size, 1));
    const mat = track(new THREE.MeshStandardMaterial({
      color: new THREE.Color(md.color), roughness: 0.94, flatShading: true, fog: false
    }));
    const mesh = new THREE.Mesh(g, mat);
    const alt = md.alt, az = md.az;
    mesh.position.set(
      Math.cos(alt) * Math.cos(az) * md.dist,
      Math.sin(alt) * md.dist,
      Math.cos(alt) * Math.sin(az) * md.dist
    );
    mesh.renderOrder = -8;
    scene.add(mesh);
    moons.push(mesh);
  });

  /* ============================================================
   *  10. 每帧更新
   * ========================================================== */
  const _d = new THREE.Vector3();
  let t = 0;

  function update(dt, elapsed, camera) {
    t += dt;
    void elapsed;

    // 星空缓慢自转 —— 这是"这颗星球在自转"最省钱的表达方式
    starGroup.rotation.y = t * (cfg.stars?.spin ?? 0.035);

    /* 贴地雾层：水平跟着相机走（避免走出 600m 面片），
       垂直钉在相机脚下方一点，这样抬头时雾在下方、不会被穿到上面。 */
    if (typeof groundFogRef !== 'undefined' && groundFogRef) {
      const gf = groundFogRef.mesh;
      gf.position.x = camera.position.x;
      gf.position.z = camera.position.z;
      const baseY = camera.position.y - 1.2;
      gf.position.y = baseY;
      groundFogRef.mat.uniforms.uBaseY.value = baseY;
    }

    // 着陆舱信标呼吸
    const bm = landerGroup.userData.beaconMat;
    if (bm) {
      const k = 1.1 + Math.sin(t * 2.6) * 1.05;
      bm.color.setRGB(0.35 * k + 0.35, 0.09 * k, 0.05 * k);
    }

    // 飘尘：随风漂移 + 以相机为中心做周期性折返（保证永远有 dust 在身边）
    if (dust) {
      const arr = dust.geometry.attributes.position.array;
      const u = dust.userData;
      const cx = camera.position.x, cz = camera.position.z;
      const halfBox = u.box * 0.5;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += u.wind.x * dt;
        arr[i + 1] += u.wind.y * dt + Math.sin(t * 0.7 + u.seeds[i / 3] * 6.28) * 0.12 * dt;
        arr[i + 2] += u.wind.z * dt;
        if (arr[i + 1] > u.height) arr[i + 1] -= u.height;
        else if (arr[i + 1] < 0) arr[i + 1] += u.height;
        let dx = arr[i] - cx;
        if (dx > halfBox) arr[i] -= u.box; else if (dx < -halfBox) arr[i] += u.box;
        let dz = arr[i + 2] - cz;
        if (dz > halfBox) arr[i + 2] -= u.box; else if (dz < -halfBox) arr[i + 2] += u.box;
      }
      dust.geometry.attributes.position.needsUpdate = true;
      _d.set(0, 0, 0);
    }

    // 太阳随曲线的微小抖动，避免低分辨率下落日显得死板
    sunDisk.position.copy(sunDir).multiplyScalar(760 + Math.sin(t * 0.21) * 3);

    // 尘卷风：粒子沿螺旋上升 —— 半径随高度张开，角速度随高度变慢
    for (const dv of devils) {
      const u = dv.pts.userData;
      u.t += dt;
      const arr = dv.pts.geometry.attributes.position.array;
      for (let i = 0; i < u.n; i++) {
        const r0 = u.base[i * 2], a0 = u.base[i * 2 + 1];
        let rising = (u.hr[i] + u.t * u.rise) % 1;
        if (rising < 0) rising += 1;
        const rad = r0 * lerp(0.22, 1.0, rising);
        const a = a0 + u.t * u.omega * (1.7 - rising * 0.9);
        arr[i * 3] = Math.cos(a) * rad;
        arr[i * 3 + 1] = rising * u.height;
        arr[i * 3 + 2] = Math.sin(a) * rad;
      }
      dv.pts.geometry.attributes.position.needsUpdate = true;
      // 整条风柱在地面上慢慢游荡
      const home = dv.group.userData.home;
      const px = home.x + Math.cos(u.t * u.wanderW + u.phase) * u.wanderR;
      const pz = home.z + Math.sin(u.t * u.wanderW * 1.3 + u.phase) * u.wanderR;
      dv.group.position.set(px, heightAt(px, pz), pz);
    }
  }

  /* ============================================================
   *  11. 释放
   * ========================================================== */
  function disposeObject(obj) {
    obj.traverse((o) => {
      // 灯光要单独 dispose —— DirectionalLight.dispose() 会释放它的阴影贴图
      // （一张 RenderTarget），不释放的话每进一次地表就漏一张纹理。
      if (typeof o.dispose === 'function' && (o.isLight || o.isCamera)) o.dispose();
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const mm of mats) {
        for (const key of Object.keys(mm)) {
          const v = mm[key];
          if (v && v.isTexture) v.dispose();
        }
        mm.dispose();
      }
    });
  }
  function dispose() {
    disposeObject(scene);
    for (const d of disposables) { if (d.dispose) d.dispose(); }
    disposables.length = 0;
    scene.fog = null;
    scene.clear();
  }

  const spawnY = heightAt(0, 0);
  return {
    id: cfg.id,
    name: cfg.name,
    scene,
    /* ★ 给体积光束 pass 用：太阳本体的世界坐标（每帧投影成屏幕坐标） */
    sunObj: sunDisk,
    spawn: new THREE.Vector3(0, spawnY, cfg.spawnZ ?? 6),
    yaw: cfg.spawnYaw ?? 0.35,
    gravity: cfg.gravity ?? -3.72,
    jump: cfg.jump ?? 3.7,
    eye: cfg.eye ?? 1.72,
    bound: playR,
    heightAt,
    update,
    dispose,
    stats: {
      verts: posAttr.count,
      tris: (seg * seg * 2),
      objects: scene.children.length
    }
  };
}
