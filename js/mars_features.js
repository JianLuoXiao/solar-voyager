/* ============================================================
 *  mars_features.js — 火星标志性地貌（共享参数 + 共享形状函数）
 *
 *  为什么单独一个文件：
 *    TAR 沙脊与多边形裂纹同时出现在两个地方——
 *      ① surface.js：驱动地形几何（真实起伏）
 *      ② textures.js：驱动反照率贴图（真实颜色对比）
 *    两边必须逐点一致（同参数、同 seed、同 warp），否则暗沙条纹
 *    和凸起的沙脊会错位。所以参数和形状函数只写这一份。
 *
 *  地貌说明（HiRISE 影像里盖尔坑最"认脸"的两类地表）：
 *    ① TAR（transverse aeolian ridges，横向风成沙脊）
 *       风把细沙梳成一排排规则沙脊：脊线垂直风向、波长十几米、
 *       脊高约 1 m。洼里积的是暗色玄武质沙，脊上是偏亮的尘。
 *    ② 多边形裂纹（thermal contraction polygons）
 *       含冰细粒层反复热胀冷缩裂成的网，尺度 5~20 m，
 *       槽宽约半米到一米。陡坡上存不住沙、也裂不出网，
 *       所以两者都要乘坡度掩码 flatFromSlope。
 * ========================================================== */

/** TAR：横向风成沙脊参数（场景坐标，米） */
export const TAR = {
  wl: 14.0,          // 沙脊波长：垂直风向的重复周期
  amp: 0.22,         // 脊高（场景米；真实 ~1 m × vScale 0.28 ≈ 0.28）
  dir: 0.62,         // 风向角（弧度）：相位沿风向变化，脊线垂直风向
  band: [0.09, 0.30] // 坡度掩码：|∇h|<0.09(≈5°) 全有，>0.30(≈17°) 全无
};

/** 多边形热收缩裂纹参数（场景坐标，米） */
export const POLY = {
  cell: 11.0,          // 多边形尺度
  amp: 0.085,          // 槽深（场景米；几何上只是微凹，主要靠贴图认出）
  band: [0.12, 0.34]
};

/** 形状函数的固定 seed —— 几何与贴图共用同一个噪声实例，保证逐点对齐 */
export const MF_SEED = 20260922;

/* 共享噪声实例：由 textures.js 在模块加载时注入 Simplex3 类。
   mars_features.js 故意不 import textures.js（避免循环依赖），
   只在第一次用到噪声时才需要它。 */
let _simplex = null;
export function initMarsFeatures(Simplex3Class) {
  _simplex = new Simplex3Class(MF_SEED);
}
function mfFbm(x, y, z, oct) {
  let f = 1, amp = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * _simplex.noise3(x * f, y * f, z * f);
    norm += amp; f *= 2.1; amp *= 0.5;
  }
  return sum / norm;
}

/** 整数格点 hash → [0,1)。Math.imul 保证 32 位乘法不丢精度 */
export function cellRand(i, j, salt) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(salt, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Voronoi 第二近邻距离减最近邻距离：在多边形网格线上恰为 0，
    往格子内部迅速变大 —— 用它的反相就能画出等宽的裂纹。 */
export function polyField(x, z, cell) {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
  let f1 = 1e9, f2 = 1e9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const ax = gx + i, az = gz + j;
      const px = (ax + cellRand(ax, az, 1)) * cell;
      const pz = (az + cellRand(ax + 9176, az - 3513, 2)) * cell;
      const dx = x - px, dz = z - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return (f2 - f1) / cell;   // 归一化：网格线 0，格子内部趋近 0.5+
}

/** TAR 沙脊形状：已含低频弯曲与沿脊长短变化，返回大致 -1..1 的无量纲值 */
export function tarSin(x, z) {
  const kx = Math.cos(TAR.dir), kz = Math.sin(TAR.dir);
  const warp = mfFbm(x * 0.02, 77.1, z * 0.02, 2) * 7.0;
  const crest = 0.55 + 0.45 * mfFbm(x * 0.05, 13.9, z * 0.05, 2);
  return Math.sin((x * kx + z * kz) * (2 * Math.PI / TAR.wl) + warp) * crest;
}

/** 裂纹强度 0..1：1 = 正好在网格线上 */
export function polyCrack(x, z) {
  const d = polyField(x, z, POLY.cell);
  const w = 0.045 + 0.035 * mfFbm(x * 0.08, 41.3, z * 0.08, 2);
  const t = Math.min(1, Math.max(0, d / w));
  return 1 - t * t * (3 - 2 * t);   // smoothstep 反相
}

/** 坡度掩码：平坦处 1，陡壁 0（smoothstep 下降沿） */
export function flatFromSlope(s, band) {
  let t = (s - band[0]) / (band[1] - band[0]);
  t = Math.min(1, Math.max(0, t));
  return 1 - t * t * (3 - 2 * t);
}
