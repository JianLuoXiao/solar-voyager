/**
 * textures.js — 运行时程序化天体贴图引擎
 * 全部纹理在浏览器端用 Canvas + Simplex 噪声现场合成，零外部资源依赖。
 * 采用球面三维采样（而非平面 UV 采样），因此赤道接缝与极区畸变天然消除。
 */
import * as THREE from 'three';
import { TAR, POLY, tarSin, polyCrack, flatFromSlope, initMarsFeatures } from './mars_features.js';

/* ============================================================
 *  1. 随机数 & Simplex 噪声
 * ========================================================== */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];
const F3 = 1 / 3, G3 = 1 / 6;

export class Simplex3 {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }
  noise3(x, y, z) {
    const perm = this.perm, pm12 = this.permMod12;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const gi0 = pm12[perm[ii + perm[jj + perm[kk]]]];
    const gi1 = pm12[perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]];
    const gi2 = pm12[perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]];
    const gi3 = pm12[perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]];
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0 + GRAD3[gi0][2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1 + GRAD3[gi1][2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2 + GRAD3[gi2][2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { t3 *= t3; n3 = t3 * t3 * (GRAD3[gi3][0] * x3 + GRAD3[gi3][1] * y3 + GRAD3[gi3][2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
}

/** 分形叠加噪声 */
export function fbm(sx, x, y, z, oct = 5, freq = 1, lac = 2, gain = 0.5) {
  let f = freq, amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * sx.noise3(x * f, y * f, z * f);
    norm += amp; f *= lac; amp *= gain;
  }
  return sum / norm;
}

/* 把 Simplex3 注入 mars_features（几何与贴图共用的火星地貌噪声实例） */
initMarsFeatures(Simplex3);

/** 脊状噪声 —— 用于冰壳裂纹、地形褶皱 */
export function ridged(sx, x, y, z, oct = 5, freq = 1) {
  let f = freq, amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(sx.noise3(x * f, y * f, z * f));
    sum += amp * n * n; norm += amp; f *= 2.03; amp *= 0.5;
  }
  return sum / norm;
}

/* ============================================================
 *  2. 颜色工具
 * ========================================================== */

export function hex2rgb(h) {
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
/** GLSL 同名函数的 JS 版：e0→e1 之间平滑过渡。
 *  注意是"从 e0 到 e1"，e0 > e1 时方向反转（用于 1→0 的收边）。 */
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};

/** 色带查表：stops = [[位置0~1, 0xRRGGBB], ...] */
export function ramp(stops, t) {
  t = clamp01(t);
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const k = smooth((t - p0) / (p1 - p0 || 1));
      const a = hex2rgb(c0), b = hex2rgb(c1);
      return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
    }
  }
  const last = hex2rgb(stops[stops.length - 1][1]);
  return [last[0], last[1], last[2]];
}

/* ============================================================
 *  3. 球面贴图渲染器
 * ========================================================== */

function makeTexture(canvas, { srgb = true, wrap = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 逐像素遍历球面。回调返回 [r,g,b]（0~255）。
 * cb(nx, ny, nz, u, v, lat01) -> [r,g,b]
 */
function paintSphere(width, height, cb) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const phi = v * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const th = u * Math.PI * 2;
      const nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      const c = cb(nx, ny, nz, u, v, Math.abs(cp));
      const o = (y * width + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 生成陨坑法线图/高度扰动场 */
function craterField(seed, count, sizeMin, sizeMax, depth) {
  const rnd = mulberry32(seed);
  const list = [];
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    list.push({
      x: r * Math.cos(th), y: z, z: r * Math.sin(th),
      r: lerp(sizeMin, sizeMax, rnd() * rnd()),
      d: depth * (0.5 + rnd() * 0.5)
    });
  }
  return (nx, ny, nz) => {
    let h = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const dot = c.x * nx + c.y * ny + c.z * nz;
      if (dot <= 0) continue;
      const ang = Math.acos(dot > 1 ? 1 : dot);
      if (ang > c.r) continue;
      const k = ang / c.r;                       // 0 中心 -> 1 边缘
      const bowl = k < 0.75 ? -(0.75 - k) * 0.6 : (k - 0.75) * 1.9; // 碗底 + 环形隆起
      h += c.d * bowl;
    }
    return h;
  };
}

/* ============================================================
 *  4. 岩质行星贴图
 * ========================================================== */

/**
 * @param {object} o
 *  size   分辨率
 *  seed   随机种子
 *  ramp   色带 stops
 *  oct    噪声阶数 / freq 基频
 *  craters {count,min,max,depth} 陨坑参数
 *  bands  0~1 水平方向的低频明暗带强度
 *  polar  极冠色 0xRRGGBB（null 关闭）
 */
export function rocky(o) {
  const { size = 512, seed = 1, stops, oct = 6, freq = 2.2, contrast = 1.25,
    craters = null, polar = null, polarSize = 0.14, veins = 0, veinColor = 0x000000 } = o;
  const sx = new Simplex3(seed);
  const cf = craters ? craterField(seed * 7 + 3, craters.count, craters.min, craters.max, craters.depth) : null;
  const pc = polar ? hex2rgb(polar) : null;
  const vc = hex2rgb(veinColor);

  const canvas = paintSphere(size, size / 2, (nx, ny, nz, u, v, lat) => {
    let h = fbm(sx, nx, ny, nz, oct, freq);
    h += 0.45 * fbm(sx, nx, ny, nz, 3, freq * 5.1);
    let t = 0.5 + h * contrast * 0.5;
    if (cf) t += cf(nx, ny, nz) * 1.1;

    let c = ramp(stops, clamp01(t));

    // 极冠：向两极做平滑混合
    if (pc && lat > 1 - polarSize) {
      const k = smooth((lat - (1 - polarSize)) / polarSize);
      c = mix3(c, pc, k * 0.95);
    }

    if (veins > 0) {
      const rg = ridged(sx, nx * 1.4 + 11, ny * 1.4, nz * 1.4, 4, freq * 1.7);
      const m = Math.pow(clamp01(1 - Math.abs(rg - 0.55) * 9), 3) * veins;
      c[0] = lerp(c[0], vc[0], m); c[1] = lerp(c[1], vc[1], m); c[2] = lerp(c[2], vc[2], m);
    }
    return c;
  });
  return makeTexture(canvas);
}

function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 由同一套参数产出高度图（灰度 bump） */
export function bumpFrom(o) {
  const { size = 512, seed = 1, oct = 6, freq = 2.2, craters = null } = o;
  const sx = new Simplex3(seed);
  const cf = craters ? craterField(seed * 7 + 3, craters.count, craters.min, craters.max, craters.depth) : null;
  const canvas = paintSphere(size, size / 2, (nx, ny, nz) => {
    let h = 0.5 + fbm(sx, nx, ny, nz, oct, freq) * 0.5;
    if (cf) h = clamp01(h + cf(nx, ny, nz) * 0.9);
    const g = h * 255;
    return [g, g, g];
  });
  return makeTexture(canvas, { srgb: false });
}

/**
 * 由高度噪声生成**切线空间法线贴图**（RGB 编码 xyz）。
 *
 * 相比 bumpMap 的优势：bump 是逐像素算梯度、只在光照模型里扰动法线，
 * 且对低顶点球体几乎无效；法线贴图是真正的纹理采样，
 * 和顶点密度解耦 —— 球体哪怕只有 72×48 个顶点，
 * 只要贴图分辨率够，表面依然能呈现出细密的凹凸。
 *
 * 做法：在球面坐标 (u,v) 上对高度场做中心差分求梯度，
 * 再叉乘出切线空间法线，最后从 [-1,1] 映射到 [0,255]。
 *
 * @param {object} o 与 bumpFrom 同参，另加：
 *   strength —— 凹凸强度（越大越"立体"，1.0 约等于深度 1 个像素）
 *   detail   —— 附加的细粒度噪声层数（0~2），补足大尺度之间的空隙
 */
export function normalFrom(o) {
  const { size = 512, seed = 1, oct = 6, freq = 2.2, craters = null,
    strength = 1.6, detail = 1 } = o;
  const sx = new Simplex3(seed);
  const cf = craters
    ? craterField(seed * 7 + 3, craters.count, craters.min, craters.max, craters.depth)
    : null;

  /* 高度采样函数：与 bumpFrom 完全一致，保证两张图能对齐 */
  const H = (nx, ny, nz) => {
    let h = 0.5 + fbm(sx, nx, ny, nz, oct, freq) * 0.5;
    if (detail > 0) {
      // 多尺度细节层：频率递增、幅度递减，制造"近看还有东西"的层次
      h += 0.16 * fbm(sx, nx * 3.7 + 21, ny * 3.7, nz * 3.7 + 21, 3, freq * 2.6);
    }
    if (detail > 1) {
      h += 0.09 * fbm(sx, nx * 9.1, ny * 9.1 + 13, nz * 9.1, 2, freq * 6.2);
    }
    if (cf) h = clamp01(h + cf(nx, ny, nz) * 0.9);
    return h;
  };

  const canvas = paintSphere(size, size / 2, (nx, ny, nz, u, v) => {
    /* 在球面参数域上求梯度。
       步长随分辨率变化，所以必须把差分**除以步长**还原成真正的斜率导数，
       否则同一份 height 参数在 256 / 512 / 1024 下会得到三种凹凸强度。 */
    const e = 2.0 / size;                       // 参数域步长
    const u1 = u + e, u0 = u - e;
    const v1 = Math.min(v + e, 1), v0 = Math.max(v - e, 0);

    /* 把参数 (u,v) 还原成球面点再采样，避免在极点附近出现拉伸伪影。
       约定必须与 paintSphere 完全一致：
         phi = v·π,  nx = sin(phi)·cos(θ),  ny = cos(phi),  nz = sin(phi)·sin(θ) */
    const pt = (uu, vv) => {
      const phi = vv * Math.PI;
      const th = uu * Math.PI * 2;
      const sp = Math.sin(phi);
      return [sp * Math.cos(th), Math.cos(phi), sp * Math.sin(th)];
    };

    const a0 = pt(u1, v), a1 = pt(u0, v);
    const b0 = pt(u, v1), b1 = pt(u, v0);

    /* 中心差分 → 真实斜率（除以 2e，因为 u1-u0 = 2e）。
       0.11 是标定系数：fbm 的高度场斜率大致是 O(1)，
       乘这个系数后平均 |nX| 落在 0.2~0.35，观感上"有凹凸但不糙"。 */
    const K = 0.11;
    const hx = (H(a0[0], a0[1], a0[2]) - H(a1[0], a1[1], a1[2])) / (2 * e) * K;
    const hy = (H(b0[0], b0[1], b0[2]) - H(b1[0], b1[1], b1[2])) / (2 * e) * K;

    /* 切线空间法线 = normalize(-dh/du * strength, -dh/dv * strength, 1) */
    let nX = -hx * strength;
    let nY = -hy * strength;
    let nZ = 1.0;
    const len = Math.sqrt(nX * nX + nY * nY + nZ * nZ) || 1;
    nX /= len; nY /= len; nZ /= len;

    return [(nX * 0.5 + 0.5) * 255, (nY * 0.5 + 0.5) * 255, (nZ * 0.5 + 0.5) * 255];
  });

  /* 法线贴图存的是方向向量，必须走线性空间，不能做 sRGB 转换 */
  return makeTexture(canvas, { srgb: false });
}

/* ============================================================
 *  5. 气态巨行星贴图（纬向条带 + 湍流 + 风暴）
 * ========================================================== */

export function gasGiant(o) {
  const {
    size = 1024, seed = 1, stops, bandFreq = 5.5, turbulence = 0.55,
    spiral = 0.45, storms = [], bandContrast = 1.0
  } = o;
  const sx = new Simplex3(seed);
  const canvas = paintSphere(size, size / 2, (nx, ny, nz, u, v) => {
    const lat = ny;                                   // -1 南 -> 1 北
    // 纬向基础条带
    let base = Math.sin(lat * Math.PI * bandFreq) * 0.5;
    base += 0.35 * Math.sin(lat * Math.PI * bandFreq * 2.7 + 1.3);
    base += 0.22 * Math.sin(lat * Math.PI * bandFreq * 6.1 + 2.7);
    base *= bandContrast;

    // 湍流：沿纬向拉伸的噪声（y 高频、xz 低频）
    const t1 = fbm(sx, nx * 0.55, ny * 5.2, nz * 0.55, 5, 2.0);
    const swirl = fbm(sx, nx * 1.3 + 40, ny * 1.1, nz * 1.3 + 40, 4, 1.4);
    let t = 0.5 + base * 0.34 + t1 * turbulence * 0.5 + swirl * spiral * 0.22;

    const col = ramp(stops, clamp01(t));

    // 风暴（大红斑等）：在经纬坐标上做椭圆衰减
    for (let i = 0; i < storms.length; i++) {
      const s = storms[i];
      const sLat = Math.asin(clamp01(Math.abs(ny)) * (ny < 0 ? -1 : 1)); // 当前纬度
      const lon = Math.atan2(nz, nx);
      let dLon = lon - s.lon;
      while (dLon > Math.PI) dLon -= Math.PI * 2;
      while (dLon < -Math.PI) dLon += Math.PI * 2;
      const du = dLon / s.w;                       // 经度方向归一化
      const dv = (sLat - s.lat) / s.h;             // 纬度方向归一化
      const r2 = du * du + dv * dv;
      if (r2 < 2.56) {
        const m = Math.pow(clamp01(1 - Math.sqrt(r2) / 1.6), 1.4) * s.strength;
        const sc = hex2rgb(s.color);
        const vortex = 0.72 + 0.55 * (fbm(sx, nx * 5, ny * 5, nz * 5, 3, 3) * 0.5 + 0.5);
        col[0] = lerp(col[0], sc[0] * vortex, m);
        col[1] = lerp(col[1], sc[1] * vortex, m);
        col[2] = lerp(col[2], sc[2] * vortex, m);
      }
    }
    return col;
  });
  return makeTexture(canvas);
}

/* ============================================================
 *  6. 地球专属：昼面 / 夜面灯光 / 云层 / 高光掩码
 * ========================================================== */

export function earthSet(size = 1024) {
  const seed = 20240;
  const sx = new Simplex3(seed);
  const W = size, H = size / 2;

  const dayCanvas = document.createElement('canvas');
  dayCanvas.width = W; dayCanvas.height = H;
  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = W; nightCanvas.height = H;
  const specCanvas = document.createElement('canvas');
  specCanvas.width = W; specCanvas.height = H;
  /* ★ 新增：地形起伏高度场。用和 day 图完全相同的 elev 公式算，
     这样山脉走向和贴图上的雪线/岩石色严格对齐。 */
  const reliefCanvas = document.createElement('canvas');
  reliefCanvas.width = W; reliefCanvas.height = H;

  const dctx = dayCanvas.getContext('2d');
  const nctx = nightCanvas.getContext('2d');
  const sctx = specCanvas.getContext('2d');
  const rctx = reliefCanvas.getContext('2d');
  const dimg = dctx.createImageData(W, H), nimg = nctx.createImageData(W, H), simg = sctx.createImageData(W, H);
  const rimg = rctx.createImageData(W, H);
  const dd = dimg.data, nd = nimg.data, sd = simg.data, rd = rimg.data;

  const deep = hex2rgb(0x0a2a5e), shallow = hex2rgb(0x1d6fa5), sand = hex2rgb(0xc2b280);
  const grass = hex2rgb(0x2f6b34), forest = hex2rgb(0x1d4a26), rock = hex2rgb(0x6b6455), snow = hex2rgb(0xf2f6fa);

  /* 高度场单独抽成函数，day 图和 relief 图共用同一份定义 */
  const elevAt = (nx, ny, nz) => {
    const cont = fbm(sx, nx, ny, nz, 7, 1.55);
    const detail = fbm(sx, nx * 2.7 + 5, ny * 2.7, nz * 2.7, 4, 4.1);
    let elev = cont + detail * 0.32;
    elev -= Math.pow(Math.abs(ny), 3.2) * 0.22;
    return elev;
  };

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H, phi = v * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, th = u * Math.PI * 2;
      const nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      const o = (y * W + x) * 4;

      const cont = fbm(sx, nx, ny, nz, 7, 1.55);
      const detail = fbm(sx, nx * 2.7 + 5, ny * 2.7, nz * 2.7, 4, 4.1);
      let elev = cont + detail * 0.32;
      const latAbs = Math.abs(ny);
      elev -= Math.pow(latAbs, 3.2) * 0.22;                  // 极地陆地略抬升成冰盖

      let col, spec = 0;
      if (elev < 0.02) {
        const k = smooth(clamp01((elev + 0.35) / 0.37));
        col = mix3(deep, shallow, k * k);
        spec = 90;
      } else {
        const k = clamp01((elev - 0.02) / 0.42);
        let land = mix3(sand, grass, smooth(k * 1.6));
        land = mix3(land, forest, clamp01(detail * 1.1 + 0.2) * k);
        if (latAbs > 0.86) land = mix3(land, rock, smooth((latAbs - 0.86) / 0.14) * 0.7);
        if (latAbs > 0.93 && elev > 0.05) land = mix3(land, snow, smooth((latAbs - 0.93) / 0.07));
        if (elev > 0.34) land = mix3(land, rock, clamp01((elev - 0.34) / 0.22));
        if (elev > 0.42) land = mix3(land, snow, clamp01((elev - 0.42) / 0.18));
        col = land; spec = 12;
      }
      dd[o] = col[0]; dd[o + 1] = col[1]; dd[o + 2] = col[2]; dd[o + 3] = 255;

      // ---- 夜线城市灯光：沿海岸线 + 温带聚集 ----
      if (elev > 0.02) {
        const coast = 1 - Math.abs(elev - 0.05) * 9;          // 靠海岸更亮
        const popNoise = fbm(sx, nx * 3.1 + 40, ny * 3.1, nz * 3.1, 4, 6.5);
        const sprinkle = fbm(sx, nx * 9 + 90, ny * 9, nz * 9, 3, 22);
        let lum = clamp01(0.42 + coast * 0.5 + popNoise * 0.55) * clamp01(1 - Math.pow(latAbs, 2.2) * 0.75);
        lum *= Math.pow(clamp01(sprinkle + 0.62), 5.5);
        if (latAbs > 0.9) lum = 0;
        const g = lum * 255;
        nd[o] = g; nd[o + 1] = g * 0.82; nd[o + 2] = g * 0.52; nd[o + 3] = 255;
      } else {
        nd[o] = nd[o + 1] = nd[o + 2] = 0; nd[o + 3] = 255;
      }

      sd[o] = sd[o + 1] = sd[o + 2] = spec; sd[o + 3] = 255;

      /* ---- 地形起伏高度场 ----
         海洋压平成 0（水面是平的），陆地按 elev 起高。
         再用一层高频噪声加山脉纹理，否则陆地会像一块平滑的橡皮泥。 */
      let hR;
      if (elev < 0.02) {
        hR = 0.5;                                  // 水面：中性高度，不产生凹凸
      } else {
        const land = clamp01((elev - 0.02) / 0.46);
        const ridge = fbm(sx, nx * 5.3 + 70, ny * 5.3, nz * 5.3, 4, 9.0);
        hR = clamp01(0.52 + land * 0.34 + ridge * 0.14);
      }
      const hg = hR * 255;
      rd[o] = rd[o + 1] = rd[o + 2] = hg; rd[o + 3] = 255;
    }
  }
  dctx.putImageData(dimg, 0, 0); nctx.putImageData(nimg, 0, 0); sctx.putImageData(simg, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  /* 高度场 → 法线贴图（在 canvas 上做一次 Sobel，比逐像素重算 elev 快得多） */
  const nrmCanvas = normalsFromHeightCanvas(reliefCanvas, 1.0);

  return {
    map: makeTexture(dayCanvas),
    emissive: makeTexture(nightCanvas),
    roughness: makeTexture(specCanvas, { srgb: false }),
    normal: makeTexture(nrmCanvas, { srgb: false })
  };
}

/**
 * 从一张灰度高度图直接算法线贴图（Sobel 梯度）。
 *
 * 相比 normalFrom 的高度函数版，这条路子适合"高度已经渲染成图"的场景：
 * 不用重算噪声，在像素上做一次 3×3 卷积即可，1024 宽的图也很快。
 *
 * @param {HTMLCanvasElement} hCanvas 灰度高度图
 * @param {number} strength 凹凸强度
 */
function normalsFromHeightCanvas(hCanvas, strength = 1.0) {
  const W = hCanvas.width, H = hCanvas.height;
  const src = hCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const oimg = octx.createImageData(W, H);
  const od = oimg.data;

  const at = (x, y) => {
    // 水平方向环绕（经度是闭合的），垂直方向钳制
    const xx = (x + W) % W;
    const yy = y < 0 ? 0 : (y >= H ? H - 1 : y);
    return src[(yy * W + xx) * 4] / 255;
  };

  /** Sobel 3×3 */
  const K = strength * 2.6;
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

/** 云层：透明 alpha 贴图 */
export function cloudLayer(size = 1024, seed = 777) {
  const sx = new Simplex3(seed);
  const sxw = new Simplex3(seed + 91);        // 域扭曲用的独立噪声
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size / 2;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size / 2);
  const d = img.data;
  for (let y = 0; y < size / 2; y++) {
    const v = (y + 0.5) / (size / 2), phi = v * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const lat = Math.abs(cp);                  // |sin(纬度)|，0 在赤道
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size, th = u * Math.PI * 2;
      const nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      const o = (y * size + x) * 4;

      /* ★ 域扭曲（domain warping）——真实云最重要的特征。
         直接对 fbm 取阈值只能得到"硬边白斑"（上一版就是这个问题，
         放大看是一块块棉花糖）。真实云的边界是**分形的、丝缕状的**，
         做法是先用一层低频噪声把采样坐标本身推歪，再采主噪声。
         视觉上立刻从"块状"变成"絮状、有卷曲的边"。 */
      const w1 = fbm(sxw, nx * 1.5, ny * 2.2, nz * 1.5, 3, 2.0);
      const w2 = fbm(sxw, nx * 2.7 + 4.3, ny * 3.9 + 1.7, nz * 2.7, 3, 2.0);
      const WARP = 0.28;
      const warpX = nx + (w1 - 0.5) * WARP;
      const warpY = ny + (w2 - 0.5) * WARP * 0.55;   // 经向扭曲给弱一点，免得纬带被打散
      const warpZ = nz + (w2 - 0.5) * WARP;

      /* 主体：高频细节 + 低频团块两个尺度叠加，模拟"云团 + 云絮" */
      const big  = fbm(sx, warpX * 1.15, warpY * 3.2, warpZ * 1.15, 5, 2.15);
      const fine = fbm(sx, warpX * 3.6 + 11.2, warpY * 5.1 - 7.4, warpZ * 3.6, 4, 2.4);
      let c = big * 0.70 + fine * 0.30;

      /* ★ 纬向环流带（真实地球云系的大尺度结构）：
           · 赤道辐合带 ITCZ —— 约 |lat|<8° 一条浓密云带
           · 副热带高压带 —— 约 ±20~32° 干燥少云（撒哈拉、太平洋高压）
           · 中纬气旋带 —— 约 ±45~65° 另一条多云带
         用两个高斯凸起 + 一个凹陷表达，比上一版纯 sin 更贴合真实分布。 */
      const g = (m, s) => Math.exp(-((lat - m) * (lat - m)) / (2 * s * s));
      const band = 0.26 * g(0.06, 0.10)            // ITCZ
                 + 0.24 * g(0.62, 0.16)            // 中纬气旋带
                 - 0.30 * g(0.34, 0.10);           // 副热带干区
      c += band;

      /* ★ 平滑的 alpha 斜坡，去掉硬阈值。
         上一版 clamp01((c-0.02)*2.3) 斜率太陡，等价于二值化。
         改成 remap 到 [0.40, 0.90] 区间做 smoothstep，边缘有自然的浓淡过渡。
         下界 0.40 保证副热带干区真的"干净"（alpha→0），上界 0.90 让 ITCZ
         不会糊成一条实心白带。 */
      let a = (c - 0.40) / (0.90 - 0.40);
      a = clamp01(a);
      a = a * a * (3 - 2 * a);                   // smoothstep
      /* 两极稍微收一点：真实极区云量中等，且几何上会被压缩得更密 */
      a *= 0.78 + 0.22 * (1 - Math.pow(lat, 3));

      const gcol = 255;
      d[o] = gcol; d[o + 1] = gcol; d[o + 2] = gcol;
      d[o + 3] = Math.pow(clamp01(a), 1.05) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return makeTexture(canvas);
}

/* ============================================================
 *  7. 冰质卫星
 * ========================================================== */

export function icy(o) {
  const { size = 512, seed = 1, stops, freq = 2.6, crackColor = 0x8a4a3a, crack = 0.6, craters = null } = o;
  const sx = new Simplex3(seed);
  const cf = craters ? craterField(seed * 13 + 1, craters.count, craters.min, craters.max, craters.depth) : null;
  const cc = hex2rgb(crackColor);
  const canvas = paintSphere(size, size / 2, (nx, ny, nz) => {
    let h = fbm(sx, nx, ny, nz, 6, freq) * 0.5 + 0.5;
    if (cf) h = clamp01(h + cf(nx, ny, nz) * 0.8);
    let col = ramp(stops, h);
    if (crack > 0) {
      const rg = ridged(sx, nx * 1.1 + 3, ny * 1.1, nz * 1.1, 5, freq * 0.9);
      const m = Math.pow(clamp01(1 - Math.abs(rg - 0.62) * 11), 2.2) * crack;
      col = mix3(col, cc, m);
    }
    return col;
  });
  return makeTexture(canvas);
}

/* ============================================================
 *  8. 行星环 / 云带 / 精灵贴图
 * ========================================================== */

/** 土星环：沿半径方向绘制明暗条纹 + 缝隙 */
export function ringTexture(width = 1024, gapSeeds = [0.0, 0.62, 0.66, 0.82], palette = [[0, 0x6b5a44], [0.4, 0xc9b38c], [1, 0xe6dcc4]], seed = 99) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = 8;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, 8);
  const d = img.data;
  const sx = new Simplex3(seed);
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    let a = 1;
    for (const g of gapSeeds) {
      const dd = Math.abs(t - g);
      if (dd < 0.028) a *= smooth(dd / 0.028) * 0.75 + 0.12;
    }
    // 细密纹理
    const fine = 0.62 + 0.38 * fbm(sx, t * 220, 0, 0, 3, 1);
    a *= 0.42 + 0.58 * fine;
    if (t < 0.06) a *= smooth(t / 0.06);                 // 内缘渐隐
    if (t > 0.94) a *= smooth((1 - t) / 0.06);           // 外缘渐隐
    const c = ramp(palette, t);
    for (let y = 0; y < 8; y++) {
      const o = (y * width + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = clamp01(a) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return makeTexture(canvas);
}

/** 径向渐变光斑：用于太阳日冕、星芒、引擎光、星系核心 */
export function glowSprite(size = 256, color = 0xffd9a0, power = 2.6) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const c = hex2rgb(color);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half, dy = (y - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.pow(clamp01(1 - r), power);
      const o = (y * size + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return makeTexture(canvas, { wrap: false });
}

/**
 * 亮星贴图：艾里斑 + 绕射星芒。
 *
 * 真实望远镜拍的亮星长这样：
 *   · 中心一个极亮的小圆核（艾里斑主极大）
 *   · 外面一圈平缓的晕（Moffat 长尾 / 大气散射）
 *   · 四条（或六条）细长的绕射尖刺 —— 来自光圈的直边
 *   · 尖刺之间还有更弱的次级尖刺
 *
 * 旧版只有"核心 + 十字"，而且十字衰减太快、晕太弱，
 * 放大看就是个发光的十字贴纸。这里把三层分量分别建模，
 * 并让尖刺有"根部粗、末端细"的锥形收束，才像真的。
 */
export function starSprite(size = 256, color = 0xffffff) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const c = hex2rgb(color);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half, dy = (y - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const o = (y * size + x) * 4;
      if (r > 1) { d[o + 3] = 0; continue; }

      /* ① 艾里斑主极大：窄高斯，决定"点"的锐度 */
      const core = Math.exp(-(r * r) / (2 * 0.045 * 0.045));

      /* ② Moffat 长尾：让星点周围有一圈柔晕，这是"真实感"的关键。
             没有这层，星点就是贴上去的硬圆。 */
      const halo = 0.30 / (1 + (r * r) / (0.055 * 0.055));

      /* ③ 绕射尖刺：十字 + 对角，各自带锥形收束 */
      const th = Math.atan2(dy, dx);
      const ax = Math.abs(Math.cos(th)), ay = Math.abs(Math.sin(th));
      // 十字：沿 0°/90°。用高次幂把能量压到极窄的方向上
      const cross = Math.pow(Math.max(ax, ay), 26.0);
      // 对角：45°/135°，强度只有十字的 ~35%（真实光圈常见）
      const diagTh = Math.abs(Math.cos(th * 2.0));
      const diag = Math.pow(Math.abs(Math.sin(th * 2.0)), 30.0) * 0.35;
      // 尖刺沿半径衰减：根部亮、末端淡，且整体比核心长得多
      const spikeFall = Math.exp(-r * 6.2);
      const spike = (cross + diag) * spikeFall;

      let a = core + halo * 0.55 + spike * 0.95;

      // 外缘柔化收边
      a *= smoothstep(1.0, 0.80, r);

      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
      d[o + 3] = clamp01(a) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return makeTexture(canvas, { wrap: false });
}

/**
 * 远景星系：对数螺线旋臂 + 核球 + 尘埃带 + 恒星颗粒。
 *
 * 相比旧版的改进：
 *   · 旋臂改用**对数螺线**（真实旋涡星系的等密度线是 log 螺线，不是正弦）
 *   · 加**核球**（bulge）—— 中心一片偏黄的高密度椭球
 *   · 加**尘埃带**：沿旋臂内侧的暗纹，用"吸收"而非"发光"来表现
 *   · 叠一层**恒星颗粒**，避免看起来像糊掉的贴纸
 */
export function galaxySprite(size = 256, seed = 5, tint = [0xfff2cc, 0x9bb8ff, 0x2a1a3a], arms = 2, ellipse = 0.55) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const core = hex2rgb(tint[0]), mid = hex2rgb(tint[1]), edge = hex2rgb(tint[2]);
  const half = size / 2;
  const dustN = new Simplex3(seed + 7);
  const grainN = new Simplex3(seed + 31);

  // 对数螺线参数：pitch 决定缠绕松紧，真实星系大约 10~20°
  const pitch = 0.22 + (arms % 3) * 0.05;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half, dy = (y - half) / half;
      const r = Math.sqrt(dx * dx + (dy * dy) / (ellipse * ellipse));
      const o = (y * size + x) * 4;
      if (r > 1) { d[o + 3] = 0; continue; }

      const th = Math.atan2(dy, dx * ellipse);

      /* ---- ① 对数螺线密度 ----
         armPhase = arms·θ + ln(r)/tan(pitch)
         取 cos 后做高次幂 → 细而亮的旋臂 */
      const rr = Math.max(r, 0.012);
      const armPhase = arms * th + Math.log(rr) / Math.tan(pitch);
      const armRaw = Math.cos(armPhase) * 0.5 + 0.5;
      const armDens = Math.pow(armRaw, 3.2);

      /* ---- ② 径向包络：内密外疏 ----
         真实的盘面亮度是 exp(-r/h) 的指数盘 */
      const disk = Math.exp(-r * 2.3) * (0.35 + r * 1.5);

      /* ---- ③ 核球：中心偏黄椭球 ----
         核球比盘更"鼓"，用更陡的高斯 */
      const bulge = Math.pow(clamp01(1 - r * 2.9), 2.4);

      /* ---- ④ 尘埃带：沿旋臂内侧的暗纹 ----
         用噪声扰动螺线相位，做出"被撕碎"的尘埃条 */
      const dust = fbm(dustN, dx * 5.5, dy * 5.5, seed * 0.17, 4, 2.1) * 0.5 + 0.5;
      // 尘埃集中在旋臂附近（armRaw 高的地方）
      const laneMask = Math.pow(armRaw, 1.2) * Math.pow(clamp01(r * 3.2), 0.7);
      const absorption = clamp01(dust * laneMask * 1.35);

      /* ---- ⑤ 恒星颗粒：高频点缀，做出"由星组成"的质感 ---- */
      const grain = fbm(grainN, dx * 26, dy * 26, seed * 0.41, 3, 2.4) * 0.5 + 0.5;
      const starGrain = Math.pow(clamp01(grain * 1.6 - 0.25), 1.4);

      let density = armDens * disk * (0.42 + dust * 0.85);
      density *= (1 - absorption * 0.72);          // 尘埃吸收
      density += bulge * 0.85;
      density += starGrain * disk * 0.42;          // 颗粒点缀

      const a = clamp01(density * 1.55);

      /* ---- 配色：核黄 → 盘蓝 → 外缘紫 ---- */
      let c = mix3(edge, mid, smooth(clamp01(1 - r * 1.15)));
      c = mix3(c, core, Math.pow(clamp01(1 - r * 1.75), 1.9));
      // 尘埃带偏红褐（消光会让星光变红）
      c = [
        c[0] * (1 - absorption * 0.25) + 90 * absorption * 0.25,
        c[1] * (1 - absorption * 0.40),
        c[2] * (1 - absorption * 0.55)
      ];

      d[o] = Math.min(255, c[0]);
      d[o + 1] = Math.min(255, c[1]);
      d[o + 2] = Math.min(255, c[2]);
      d[o + 3] = a * 255 * clamp01(1 - r * 0.18);
    }
  }
  ctx.putImageData(img, 0, 0);
  return makeTexture(canvas, { wrap: false });
}

/** 星云团：柔和 irregular blob */
export function nebulaSprite(size = 256, seed = 3, colorA = 0x4a2a7a, colorB = 0x1a4a6a) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const sx = new Simplex3(seed);
  const a = hex2rgb(colorA), b = hex2rgb(colorB);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half, dy = (y - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r > 1) continue;
      const n = fbm(sx, dx * 2.2, dy * 2.2, seed * 0.7, 5, 1.6) * 0.5 + 0.5;
      const rr = r * (0.62 + n * 0.75);
      let alpha = Math.pow(clamp01(1 - rr), 2.4) * clamp01(n * 1.5) * 0.85;
      const c = mix3(a, b, clamp01(n * 1.3 - 0.15));
      const o = (y * size + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return makeTexture(canvas, { wrap: false });
}

/** 陨石/小行星岩石纹理（低分辨率即可） */
export function asteroidTexture(seed = 12, size = 256) {
  return rocky({
    size, seed, freq: 3.4, oct: 5, contrast: 1.5,
    stops: [[0, 0x241d18], [0.45, 0x4a4038], [0.72, 0x6d6157], [1, 0x9a8d7e]],
    craters: { count: 26, min: 0.05, max: 0.22, depth: 0.5 }
  });
}


/* ============================================================
 *  ★ 真实卫星数据贴图（assets/baked/）
 *
 *  上面所有函数都是程序化生成；这一节改成加载**真实遥感数据**，
 *  由 tools/bake_earth.py 从 NASA Blue Marble + GEBCO 高程烘焙而来。
 *
 *  设计原则：
 *    · 全部走 async，加载失败**静默回退**到程序化版本，
 *      保证离线/缺文件时页面照常可用（不白屏）。
 *    · 法线/粗糙度等**数据类**贴图必须 srgb:false —— 它们存的是
 *      物理量而非颜色，走 sRGB 解码会算错。
 * ========================================================== */

const ASSET_BASE = 'assets/baked/';
const _assetCache = new Map();

/** 加载一张贴图。data=false 时按线性数据处理（法线/粗糙度/高程）。 */
export function loadAsset(file, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const key = file + '|' + srgb + '|' + repeat;
  if (_assetCache.has(key)) return _assetCache.get(key);

  const p = new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      ASSET_BASE + file,
      (tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        if (repeat) tex.repeat.set(repeat[0], repeat[1]);
        tex.anisotropy = aniso;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => {
        /* 失败：返回 null，调用方回退到程序化贴图 */
        resolve(null);
      }
    );
  });
  _assetCache.set(key, p);
  return p;
}

/** 尝试加载整套地球真实贴图；关键成员失败就返回 null（整体回退）。
 *  夜灯贴图是**可选**的：失败只意味着夜面不亮灯，不回退整套。 */
export async function earthRealSet(opts = {}) {
  const [mapBase, normal, rough, spec, elev, night] = await Promise.all([
    /* ★ 首选鲜艳版 albedo（饱和度 +30%，参考图那种鲜绿大陆/深蓝海洋）；
       加载失败退回原版。loadAsset 缓存按 key 区分，双调用无额外开销。 */
    loadAsset('earth_albedo_vivid_2048.jpg', { srgb: true }),
    loadAsset('earth_normal_2048.png', { srgb: false }),
    loadAsset('earth_rough_1024.png', { srgb: false }),
    loadAsset('earth_spec_1024.png', { srgb: false }),
    loadAsset('earth_elev_2048.png', { srgb: false }),
    /* 夜面城市灯光（tools/bake_earth_night.py 从海岸距离+植被代理合成） */
    loadAsset('earth_night_2048.jpg', { srgb: true })
  ]);
  const map = mapBase || await loadAsset('earth_albedo_2048.jpg', { srgb: true });
  if (!map || !normal) return null;
  return {
    map, normal,
    roughness: rough,
    specular: spec,
    /* ★ 高程图给顶点位移用。它是线性数据，绝不能走 sRGB。 */
    elevation: elev,
    /* 夜灯可能为 null（文件缺失/加载失败），使用方必须判空 */
    night: night || null,
    real: true
  };
}

/** 火星地表烘焙贴图集（tools/bake_mars_ground.py 从真实参考照片拼合的
 *  非重复虚拟正射影像）。只在降落时加载，失败返回 null（走程序化兜底）。 */
export async function marsGroundSet() {
  const [albedo, normal, rough] = await Promise.all([
    loadAsset('mars_ground_albedo_2048.jpg', { srgb: true }),
    loadAsset('mars_ground_normal_1024.png', { srgb: false }),
    loadAsset('mars_ground_rough_1024.png', { srgb: false })
  ]);
  if (!albedo) return null;
  /* ★ 这是一整张非重复正射影像，绝不能平铺：Clamp + repeat 1，
     让 PlaneGeometry 自带的 0~1 UV 把它完整铺在 300×300 米地面上 */
  const clamp1 = (t) => {
    if (t) {
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.set(1, 1);
    }
    return t;
  };
  return { albedo: clamp1(albedo), normal: clamp1(normal), rough: clamp1(rough), real: true };
}

/* ============================================================
 *  ★ 真实 HiRISE DEM 地表集（textures/mars_dem_*）
 *
 *  来源：NASA Mars Reconnaissance Orbiter HiRISE 立体像对 DTM
 *        （DTEEC_012340_1750_012195_1750_A01，Gale 克拉特 Murray 组
 *        分层沉积岩壁，1 m/px 高程 + 1 m/px RED 正射）。
 *        NASA/亚利桑那大学，公有领域（AWS Open Data, CC0）。
 *  文件：
 *    mars_dem_h.bin      512×512 Float32 高程场（米，相对中位数）
 *    mars_dem_albedo.jpg 2048² 真实正射上色（去光照+曲率积尘调制）
 *    mars_dem_normal.png 2048² DEM 法线 ⊕ 正射高频法线
 *    mars_dem_orm.png    1024² R=AO(地平线角天空可见度) G=粗糙 B=金属(0)
 *    mars_dem_meta.json  尺寸/垂直缩放等参数
 *  与旧版 marsGroundSet 的本质区别：**地形几何本身就是真的** ——
 *  高度场直接取自真实高程模型，贴图与几何来自同一份测量数据，
 *  山脊在哪、岩层怎么弯、坡向哪边倾，照片和高程完全互相印证。
 * ========================================================== */
const DEM_BASE = 'textures/';

/** 独立小加载器（不进 assets/baked 缓存；失败 resolve null 由调用方兜底） */
function loadTexFile(file, { srgb = true, aniso = 8 } = {}) {
  return new Promise((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      DEM_BASE + file,
      (tex) => {
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;   // 整张非重复，绝不平铺
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(1, 1);
        tex.anisotropy = aniso;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/** 在真实正射反照率上叠加火星标志地貌的颜色对比。
 *
 *  为什么贴图上还要再来一遍：TAR 沙脊在 HiRISE 影像里之所以一眼认得出，
 *  一半靠微地形、一半靠颜色 —— 洼里是暗色玄武质沙、脊上是亮的细尘；
 *  多边形裂纹更是几乎纯颜色特征（半米宽的浅槽，肉眼先看到的是暗线）。
 *  几何（surface.js）和这里的贴图共用 mars_features.js 的同一套函数
 *  与 seed，暗沙条纹与凸起沙脊逐点对齐。
 *
 *  坐标映射（与 PlaneGeometry 的 uv + flipY 约定一致）：
 *    世界 (x,z) → 画布像素 px = (x/sizeM + 0.5) * N，py = (z/sizeM + 0.5) * N
 */
function overlayMarsFeatures(img, h, meta) {
  const N = img.width;
  if (!N || !document.createElement) return null;
  const sizeM = meta.size_m || 300;
  const vScale = meta.vScale ?? 0.28;
  const demN = meta.N;
  const demPx = sizeM / (demN - 1);

  /* 1) 预计算坡度图（场景坡度 = 真实坡度 × vScale），与 surface.js 的 demSlope 同口径 */
  const slope = new Float32Array(demN * demN);
  for (let iz = 0; iz < demN; iz++) {
    const j0 = Math.max(iz - 1, 0), j1 = Math.min(iz + 1, demN - 1);
    for (let ix = 0; ix < demN; ix++) {
      const i0 = Math.max(ix - 1, 0), i1 = Math.min(ix + 1, demN - 1);
      const gx = (h[iz * demN + i1] - h[iz * demN + i0]) * vScale / ((i1 - i0) * demPx);
      const gz = (h[j1 * demN + ix] - h[j0 * demN + ix]) * vScale / ((j1 - j0) * demPx);
      slope[iz * demN + ix] = Math.hypot(gx, gz);
    }
  }
  /* 双线性采样坡度。bin 行号 fv = (0.5 - z/sizeM)*(demN-1)，与 demSample 一致 */
  const slopeAt = (x, z) => {
    const fu = Math.min(demN - 1, Math.max(0, (x / sizeM + 0.5) * (demN - 1)));
    const fv = Math.min(demN - 1, Math.max(0, (0.5 - z / sizeM) * (demN - 1)));
    const x0 = Math.floor(fu), y0 = Math.floor(fv);
    const x1 = Math.min(x0 + 1, demN - 1), y1 = Math.min(y0 + 1, demN - 1);
    const tx = fu - x0, ty = fv - y0;
    return (slope[y0 * demN + x0] * (1 - tx) + slope[y0 * demN + x1] * tx) * (1 - ty)
         + (slope[y1 * demN + x0] * (1 - tx) + slope[y1 * demN + x1] * tx) * ty;
  };

  /* 2) 半分辨率(1024)画叠加层：裂纹半米宽 ≈ 2 px，够用且省一半时间 */
  const OW = Math.min(1024, N);
  const oc = document.createElement('canvas'); oc.width = oc.height = OW;
  const octx = oc.getContext('2d');
  const od = octx.createImageData(OW, OW);
  const data = od.data;
  for (let py = 0; py < OW; py++) {
    const z = (py / OW - 0.5) * sizeM;
    for (let px = 0; px < OW; px++) {
      const x = (px / OW - 0.5) * sizeM;
      let r = 0, g = 0, b = 0, a = 0;
      const sl = slopeAt(x, z);
      /* TAR：洼处铺暗色玄武质沙，脊上提亮一层薄尘 */
      const fmT = flatFromSlope(sl, TAR.band);
      if (fmT > 0.003) {
        const s = tarSin(x, z);
        if (s < 0) {
          const k = Math.min(1, 0.38 * fmT * (-s));
          r = 98; g = 55; b = 36; a = 255 * k;
        } else {
          const k = Math.min(1, 0.11 * fmT * s);
          r = 238; g = 202; b = 162; a = 255 * k;
        }
      }
      /* 多边形裂纹：深褐暗线，压在沙纹之上 */
      const fmP = flatFromSlope(sl, POLY.band);
      if (fmP > 0.003) {
        const c = polyCrack(x, z) * fmP;
        if (c > 0.02) {
          const k = Math.min(1, 0.55 * c);
          if (255 * k >= a) { r = 62; g = 38; b = 26; a = 255 * k; }
        }
      }
      const o = (py * OW + px) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  octx.putImageData(od, 0, 0);

  /* 3) 原始正射 + 叠加层 → 一张 CanvasTexture 顶替 albedo */
  const cv = document.createElement('canvas'); cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(oc, 0, 0, N, N);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

/** 真实 DEM 地表集。任一关键成员缺失就返回 null（引擎走程序化地形）。 */
export async function marsDemSet() {
  const [albedo, normal, orm, meta, hBuf] = await Promise.all([
    loadTexFile('mars_dem_albedo.jpg', { srgb: true, aniso: 16 }),
    loadTexFile('mars_dem_normal.png', { srgb: false, aniso: 16 }),
    loadTexFile('mars_dem_orm.png', { srgb: false }),
    fetch(DEM_BASE + 'mars_dem_meta.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch(DEM_BASE + 'mars_dem_h.bin').then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
  ]);
  if (!albedo || !hBuf || !meta || !meta.N) return null;
  const h = new Float32Array(hBuf);
  if (h.length !== meta.N * meta.N) return null;   // 尺寸对不上=文件损坏
  /* 叠加 TAR 沙脊与裂纹的反照率对比；失败就退回原贴图，不阻塞加载 */
  let albedoMap = albedo;
  try {
    const ov = overlayMarsFeatures(albedo.image, h, meta);
    if (ov) albedoMap = ov;
  } catch (e) { /* 保守回退 */ }
  return { albedo: albedoMap, normal: normal || null, orm: orm || null, h, meta, real: true, dem: true };
}

/* ============================================================
 *  ★ 真实银河天球（assets/baked/sky_galaxy_*.jpg）
 *
 *  来源：NASA SVS "Deep Star Maps 2020"
 *        https://svs.gsfc.nasa.gov/4851/
 *        基于 Hipparcos-2 / Tycho-2 / Gaia DR2，共 17 亿颗恒星。
 *        NASA 政府作品，公有领域。
 *
 *  为什么这一张图能带来"照片级"星空：
 *    程序化 fbm 只能生成统计上相似的云，永远长不出真实的
 *    丝状纤维、暗尘埃带的遮挡、银心的饱和核心。这张图里全都有，
 *    因为它本来就是照片 —— 和上次行星换真实卫星影像是同一个逻辑。
 *
 *  对齐约定（与 tools/bake_sky.py 一致）：
 *    等距圆柱，u → 银经 0..2π，v → 银纬；长宽比 2:1。
 *    用的是银道坐标(_gal)版本，贴图的水平中线就是**银道面**。
 *    使用方（deepsky.js）需要把天球整体旋转，让贴图 Y 轴
 *    指向银河极（galAxis），银河带才会落在正确的位置。
 * ========================================================== */

/** 加载真实银河天球。优先 4096，加载失败降级 2048，再失败返回 null。 */
export async function skyGalaxySet() {
  /* 4096 版 2.8MB；弱网/移动端可以只放 2048（0.67MB）。 */
  const map4k = await loadAsset('sky_galaxy_4096.jpg', { srgb: true, aniso: 16 });
  if (map4k) return { map: map4k, real: true, size: 4096 };
  const map2k = await loadAsset('sky_galaxy_2048.jpg', { srgb: true, aniso: 16 });
  if (map2k) return { map: map2k, real: true, size: 2048 };
  return null;
}
