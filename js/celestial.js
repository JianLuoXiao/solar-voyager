/**
 * celestial.js — 太阳系构建
 * 太阳（动画等离子体 shader）/ 九大行星 / 卫星系统 / 行星环 / 大气散射
 * / 小行星带 / 彗星 / 漂流陨石
 */
import * as THREE from 'three';
import * as TEX from './textures.js';
import { PLANETS, SUN, BELTS, COMETS } from './data.js';
import { mulberry32 } from './textures.js';

const DEG = Math.PI / 180;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/* ============================================================
 *  GLSL: 3D Simplex 噪声（太阳表面对流）
 * ========================================================== */
const GLSL_SNOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute289(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute289(permute289(permute289(
      i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p, int oct){
  float a=0.5, s=0.0, n=0.0;
  for(int i=0;i<6;i++){ if(i>=oct) break; s+=a*snoise(p); n+=a; a*=0.5; p*=2.02; }
  return s/max(n,0.0001);
}
`;

/* ============================================================
 *  太阳
 * ========================================================== */
function buildSun(scene, opts) {
  const group = new THREE.Group();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBoost: { value: 1.0 }
    },
    vertexShader: /* glsl */`
      varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
      void main(){
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: GLSL_SNOISE + /* glsl */`
      uniform float uTime; uniform float uBoost;
      varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
      void main(){
        vec3 p = normalize(vPos);
        float t = uTime * 0.055;

        // 两层不同速度的等离子体对流 + 拉伸的纬向流动
        float flow = fbm3(p*3.1 + vec3(t*1.4, t*0.7, -t*1.1), 4);
        float cell = fbm3(p*8.5 + vec3(-t*0.9, t*1.3, t*0.6), 3);
        float fine = fbm3(p*17.0 + vec3(t*0.6), 2);

        float n = flow*0.55 + cell*0.3 + fine*0.15;
        float h = clamp(n*0.5 + 0.5, 0.0, 1.0);

        vec3 c1 = vec3(0.62,0.11,0.02);   // 暗：米粒边界
        vec3 c2 = vec3(1.00,0.36,0.05);   // 橙
        vec3 c3 = vec3(1.00,0.72,0.22);   // 金
        vec3 c4 = vec3(1.00,0.97,0.86);   // 白热

        vec3 col = mix(c1, c2, smoothstep(0.18,0.52,h));
        col = mix(col, c3, smoothstep(0.48,0.78,h));
        col = mix(col, c4, smoothstep(0.74,0.95,h));

        // 黑子：低温区域
        float spot = smoothstep(0.34, 0.16, h);
        col *= mix(1.0, 0.42, spot*0.85);

        // 边缘变暗 + 极轻微色晕
        vec3 V = normalize(vView);
        float rim = 1.0 - abs(dot(normalize(vNormal), V));
        col *= mix(1.0, 0.55, pow(rim, 2.4));
        col += c3 * pow(rim, 5.0) * 0.55;

        gl_FragColor = vec4(col * 1.85 * uBoost, 1.0);
      }
    `
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SUN.radius, 96, 64), mat);
  mesh.userData.bodyId = 'sun';
  group.add(mesh);

  // 日冕：三层叠加发光，越外层越淡
  const corona = new THREE.Group();
  const layers = [
    { s: 2.35, o: 0.55, c: 0xffb64d },
    { s: 3.9, o: 0.26, c: 0xff8c2a },
    { s: 7.2, o: 0.10, c: 0xff6a18 }
  ];
  for (const L of layers) {
    const m = new THREE.SpriteMaterial({
      map: TEX.glowSprite(256, L.c, 2.2), transparent: true, depthWrite: false,
      depthTest: true, blending: THREE.AdditiveBlending, opacity: L.o
    });
    const sp = new THREE.Sprite(m);
    sp.scale.setScalar(SUN.radius * L.s * 2);
    corona.add(sp);
  }
  group.add(corona);

  const light = new THREE.PointLight(0xfff0d8, 3.4, 0, 0);  // decay=0：不随距离衰减
  group.add(light);
  scene.add(group);

  return { group, mesh, material: mat, light, corona, update(t) { mat.uniforms.uTime.value = t; } };
}

/* ============================================================
 *  大气层（解析式单次散射）
 * ========================================================== */

/**
 * 旧版只有一个 `pow(1-|dot(N,V)|, k)` 的菲涅尔边缘光，问题是：
 *   · 完全不区分"视线穿过多少大气" —— 球体正对相机的中心也有大气，
 *     只是路径短；旧版那里亮度为 0，边缘为 1，看着像发光的圆环贴纸。
 *   · 不分通道 —— 地球的蓝天来自瑞利散射随波长 1/λ⁴ 变化，
 *     只用一个颜色乘一下出不来"边缘偏蓝、地平线偏白"的层次。
 *   · 晨昏线没有暖色 —— 真实的夕阳红是最有辨识度的一笔。
 *
 * 新版按体积散射的思路算：
 *   1. 把大气当成一层厚度 uThickness 的壳，射线在壳内的弦长 = 光学厚度 τ。
 *   2. 沿视线取 6 个采样点，各点密度按标高 e^(-h/H) 衰减，累加得 τ。
 *   3. 透射率 T = e^(-τ)，出射强度 = (1-T) × 太阳照亮比例。
 *      —— 这一条天然给出了"中心薄、边缘厚"的正确衰减。
 *   4. 出射颜色 = 瑞利蓝（只吃日照，背光面变暗）+ 米氏白（沿视线前向散射，
 *      所以逆光看行星时边缘会发亮，也就是"前向散射光晕"）。
 *   5. 晨昏线：只在太阳高度角接近 0 的窄带上叠加夕阳暖色。
 */

const ATM_VERT = /* glsl */`
  varying vec3 vNormalW;    // 世界空间法线
  varying vec3 vViewDirW;   // 世界空间：相机 → 片元
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vNormalW  = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ATM_FRAG = /* glsl */`
  precision highp float;

  uniform vec3  uRayleigh;     // 瑞利散射色（主导天空蓝）
  uniform vec3  uMie;          // 米氏散射色（气溶胶灰白）
  uniform vec3  uSunset;       // 晨昏线暖色
  uniform float uOpacity;      // 总不透明度
  uniform float uThickness;    // 大气壳相对行星半径的厚度（= 密度倍率）
  uniform float uMieStrength;
  uniform vec3  uSunDir;       // 由行星指向太阳（世界空间，已归一化）

  varying vec3 vNormalW;
  varying vec3 vViewDirW;

  const int   STEPS = 6;
  const float H     = 0.30;    // 标高：数值越小，大气越"贴"在表面

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDirW);

    float cosT = dot(N, V);
    /* 取朝向相机的那半球。用 abs 而不是分支，
       这样正对相机的中心和边缘能用同一条公式连续过渡。 */
    vec3 Nf = normalize(N * sign(cosT + 1e-6));

    /* ---- ① 视线在大气壳内的弦长 ----
       单位球坐标：壳外表面 r=1，内表面 r=1/(1+thickness)。
       掠射（|cosT|→0）时弦最长，正对（|cosT|→1）时最短。
       —— 这一条就是"边缘比中心厚"的真正来源。 */
    float Rout = 1.0;
    float Rin  = 1.0 / (1.0 + max(uThickness, 0.01));
    float b    = sqrt(max(1.0 - cosT * cosT, 0.0));

    float sOut = sqrt(max(Rout * Rout - b * b, 0.0));
    float sIn  = sqrt(max(Rin  * Rin  - b * b, 0.0));
    /* pathNorm ∈ [0,1]：中心≈0（视线在壳内很短），边缘→1（几乎全壳） */
    float chord = max(sOut - sIn, 0.0);
    float pathNorm = clamp(chord / max(Rout - Rin, 1e-4), 0.0, 1.0);

    /* ---- ② 光学厚度 τ = 密度 × 弦长 ----
       用 pathNorm 的幂次控制"厚重感"：幂越大，只有很靠边缘才明显。
       注意不要在这里再乘一个 1/(b-Rin)，那会让边缘亮度爆掉。 */
    float dens = 0.55 + 0.45 * exp(-(1.0 - pathNorm) * 3.0);
    float tau  = pathNorm * dens * 3.1;

    /* 透射率：中心几乎透明，边缘接近不透明。
       exp 形状比线性衰减更接近真实的辐射传输解。 */
    float transmit = 1.0 - exp(-tau);
    transmit = clamp(transmit, 0.0, 1.0);

    /* ---- ③ 太阳照亮比例 ---- */
    float ndl  = dot(Nf, normalize(uSunDir));
    float lit  = max(ndl, 0.0);
    /* litS：日照侧整体起亮；用 sqrt 让"半亮"区域也有可见的大气 */
    float litS = sqrt(lit);
    /* 昼夜大分界：夜面彻底不发光，否则会像套了个发光的环 */
    float day  = smoothstep(-0.22, 0.18, ndl);
    /* 晨昏线：只有 |ndl| 很小的窄带为正 */
    float dusk = max(1.0 - abs(ndl * 5.5), 0.0);
    dusk = dusk * dusk;                     // 收窄，避免暖色糊到白天

    /* ---- ④ 瑞利分量：只有日照面才有蓝天 ----
       乘以 day 保证背光面归零，这是"不该有蓝色描边"的关键 */
    vec3 col = uRayleigh * (0.30 + 0.95 * litS) * day;

    /* ---- ⑤ 米氏分量：气溶胶的灰白雾霭 ----
       同样吃 day，只在日照面出现。
       ★ 前向散射（逆光时边缘发亮）的幂从 10 降到 4、系数从 0.14 降到 0.05：
         pow(fwd,10) 在 fwd→1 时几乎是一个狄拉克尖峰，加上 AdditiveBlending
         就在向阳侧边缘烧出一个白斑（截图里那个亮团）。
         真实的前向散射是**很宽很缓**的一个瓣，所以降幂 + 降幅才对。 */
    float fwd = max(dot(-V, normalize(uSunDir)), 0.0);
    float mie = uMieStrength * day * (0.12 + 0.46 * lit) / (0.6 + uMieStrength);
    mie += uMieStrength * day * 0.05 * pow(fwd, 4.0) / (0.6 + uMieStrength);
    col += uMie * mie;

    /* ---- ⑥ 晨昏线：夕阳暖色，只在窄带上叠加 ---- */
    col += uSunset * dusk * day * 0.70;

    /* ---- ⑦ 组装 ----
       颜色先乘 transmit（厚度调制），再乘 α。
       α 同时受 uOpacity 和日照控制，夜面透明 → 不会出现完整光环。
       ★ 对颜色做更强的软压缩（reinhard），并对最终输出加一道
         亮度上限。大气是**叠加**在已经很亮的星球上，如果自己不设上限，
         向阳侧边缘必然过曝成一片白 —— 这是"假"的最大来源。
       真实遥感图里，大气在日下点附近的辐亮度与地表相当或更低，
       只有在**掠射区**才形成那圈细亮边。 */
    vec3 outc = col * transmit;
    outc = outc / (1.0 + outc * 1.35);
    /* 硬上限：单通道不超过 0.62。加了 Bloom 之后这一圈自然会"发光"，
       不需要靠极高的基础亮度去顶。 */
    outc = min(outc, vec3(0.62));

    float alpha = transmit * uOpacity * day * (0.18 + 0.62 * litS);
    alpha = min(alpha, 0.60);            // 硬上限：再厚也不允许糊住星球本身

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(outc, clamp(alpha, 0.0, 1.0));
  }
`;

function buildAtmosphere(cfg, radius) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRayleigh:   { value: new THREE.Color(cfg.rayleigh ?? cfg.color) },
      uMie:        { value: new THREE.Color(cfg.mie ?? 0xffffff) },
      uSunset:     { value: new THREE.Color(cfg.sunset ?? 0xff8a3a) },
      uOpacity:    { value: Math.min(cfg.opacity ?? 0.6, 0.6) },
      uThickness:  { value: cfg.thickness ?? 1.5 },
      uMieStrength:{ value: cfg.mieStrength ?? 0.45 },
      uSunDir:     { value: new THREE.Vector3(1, 0, 0) }
    },
    vertexShader: ATM_VERT,
    fragmentShader: ATM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending
  });

  /* 球壳稍微加密一点：掠射区的 alpha 梯度很陡，分段太少会出现棱 */
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius * (cfg.scale || 1.05), 96, 64), mat
  );
  /* 大气在行星之后画：先画不透明的行星，再叠加半透明大气 */
  mesh.renderOrder = 2;
  return mesh;
}

/* ============================================================
 *  轨道线
 * ========================================================== */
function buildOrbitLine(radius, ecc, color = 0x5f8a9a) {
  const pts = [];
  const a = radius, b = radius * (1 - ecc * 0.55);
  const SEG = 256;
  for (let i = 0; i <= SEG; i++) {
    const th = (i / SEG) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(th) * a, 0, Math.sin(th) * b));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 0.30, depthWrite: false
  });
  return new THREE.Line(geo, mat);
}

/* ============================================================
 *  ★ 顶点位移：把高程图当高度场，沿法线推出球面顶点
 *
 *  为什么这一步是"逼真度"的分水岭：
 *    法线贴图只能改**光照**，改不了**轮廓**。一个光滑球的边缘
 *    永远是一条完美圆弧，所以看起来像塑料球。只有真的移动顶点，
 *    山脉才会在剪影上凸出来。
 *
 *  约定必须与 bake_earth.py / three.js SphereGeometry 完全一致：
 *    u ∈ [0,1) → 经度 θ = u·2π
 *    v ∈ [0,1] → φ = v·π,  ny = cos(φ)
 *    等距圆柱：纹理 x = 经度, y = 纬度（北在上）
 *
 *  高程图里海洋被钳为 0，所以"0 处不动"，海面仍是完美球面。
 * ========================================================== */
async function applyDisplacement(geo, elevTex, amp, size) {
  if (amp <= 0) return;

  /* 没传真实高程图时，用程序化 fbm 造一个"类地形"高度场，
     保证几何提升在任何情况下都生效（不至于退回光滑球）。 */
  let data = null, W = 0, H = 0;
  if (elevTex && elevTex.image) {
    const im = elevTex.image;
    W = im.width; H = im.height;
    try {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      data = cx.getImageData(0, 0, W, H).data;
    } catch (e) {
      data = null;
    }
  }

  const sx = new TEX.Simplex3(4091);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal.clone();
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();

    let h;
    if (data) {
      /* 球面方向 → (u,v) → 采样高程 */
      const ny = dir.y;                                   // cos(φ)
      const phi = Math.acos(Math.max(-1, Math.min(1, ny)));
      const theta = Math.atan2(dir.z, dir.x);             // -π..π
      let u = theta / (Math.PI * 2); if (u < 0) u += 1;
      const vv = phi / Math.PI;
      const px = Math.min(W - 1, Math.max(0, Math.round(u * (W - 1))));
      const py = Math.min(H - 1, Math.max(0, Math.round(vv * (H - 1))));
      h = data[(py * W + px) * 4] / 255;
    } else {
      /* 程序化兜底：只造陆地级起伏，不做海洋掩膜 */
      const f = TEX.fbm(sx, dir.x * 2.6, dir.y * 2.6, dir.z * 2.6, 5, 1.9);
      h = Math.max(0, (f - 0.42) / 0.58);
    }

    if (h <= 0.001) continue;
    /* ★ 压平低地的幂指数，从 h² 改成 h^1.15。
       为什么必须改（有实测数据支撑，见 tools/elev_stats.py）：
         GEBCO 高程图的**陆地中位数只有 h=0.126**（大部分陆地是平原、
         低矮高原，不是山）。旧版用 h²，中位数变成 0.016，再乘 0.9%
         幅度 = 0.014% 半径 ≈ **0.07 像素** —— 完全看不见。
         只有 p90 以上的山地才勉强到 1.8 像素。所以旧版轮廓仍是完美圆弧。
       改成 h^1.15 后：中位数升到 0.075% 半径，p90 到 0.87%，
       配合下面把幅度提到 3.2%，典型大陆就能有 1~3 像素的真实起伏。 */
    const k = Math.pow(h, 1.15) * amp;
    pos.setXYZ(i,
      v.x + nrm.getX(i) * k,
      v.y + nrm.getY(i) * k,
      v.z + nrm.getZ(i) * k);
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/* ============================================================
 *  行星
 * ========================================================== */
async function buildPlanet(p, texSizeFor, onProgress, quality = 'high') {
  const holder = new THREE.Group();          // 沿轨道移动
  holder.name = p.id;

  const axial = new THREE.Group();           // 自转轴倾角
  axial.rotation.z = p.tilt * DEG;
  holder.add(axial);

  const spin = new THREE.Group();            // 自转
  axial.add(spin);

  const flatten = p.flatten || 0;
  /* ★ 顶点密度：这是"塑料球感"的头号元凶。
     最初只有 72×48 = 3456 个顶点，球面上一格跨 5°，法线贴图再细
     也会被顶点插值抹平，轮廓永远是一条完美圆弧。
     地球单独提到 768×384（约 29.5 万顶点），配合真实高程位移，
     大陆边缘、山脉、海岸线的**剪影**才真正立体起来。
     其余行星 320×192 已经是性价比拐点。 */
  const isEarth = p.type === 'earth';
  const seg = isEarth
    ? (quality === 'low' ? { w: 256, h: 128 }
      : quality === 'medium' ? { w: 512, h: 256 }
      : { w: 768, h: 384 })
    : (quality === 'low' ? { w: 96, h: 64 }
      : quality === 'medium' ? { w: 192, h: 128 }
      : { w: 320, h: 192 });
  const geo = new THREE.SphereGeometry(p.radius, seg.w, seg.h);
  if (flatten > 0) geo.scale(1, 1 - flatten, 1);

  /* ---- 材质 ---- */
  let material;
  let real = null;              // 地球的真实数据贴图集（非地球恒为 null）
  const size = texSizeFor(p.id);

  if (isEarth) {
    /* ★ 优先用**真实卫星数据**（tools/bake_earth.py 从 NASA Blue Marble
       + GEBCO 高程烘焙）。加载失败则回退到程序化版本，不至于白屏。
       ★ real 必须声明在**函数作用域**：下面的诊断块（window.__earthInfo）
       要用到它。曾经写成块内 let，导致诊断块抛 ReferenceError('real is
       not defined')，把整个 buildScene 的 Promise 打断、HUD 永不出现。
       那种错误在异常信息里只报"行号"，不看变量名根本猜不到原因。 */
    try {
      real = await TEX.earthRealSet();
    } catch (e) {
      real = null;
    }

    if (real) {
      material = new THREE.MeshStandardMaterial({
        map: real.map,
        normalMap: real.normal,
        /* 真实高程算出的法线，细节比程序化噪声丰富得多。
           ★ 位移提到 3.2% 后，几何本身已经贡献了宏观明暗，
             法线贴图的作用回归到"补细节"，所以强度从 0.75 降到 0.55，
             不然两者叠加会把地表打成揉皱的锡纸。 */
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughnessMap: real.roughness,
        /* ★ 用贴图当乘子时，基础值必须给 1.0，否则会被越乘越暗/越亮。
           这里 roughness 贴图本身已编码 0.10(海)~0.95(陆)。 */
        roughness: 1.0,
        /* ★ metalness 全程 0：地球表面是**电介质**。
           早期版本错把 specular 图接到 metalnessMap 上——那会让海洋
           按金属反射处理（有色、无漫反射），整颗球泛白像镀了层铬。
           海面高光靠"低 roughness"自然产生，不需要 metalness。 */
        metalness: 0.0,
        envMapIntensity: 0.22
      });
      /* ★★ 夜面城市灯光（参考图 206deb 的核心特征）：
         emissiveMap 用合成的夜灯贴图；但 MeshStandardMaterial 的
         emissive 是**全天常亮**的，白天也会看到灯——必须按太阳方向
         掩模：dot(世界法线, 指向太阳) > 0 的半球完全熄灯，夜半球全亮，
         晨昏线附近 0.09→-0.14 平滑过渡（真实城市在黄昏就陆续开灯）。
         掩模在 onBeforeCompile 里注入，太阳方向 uniform 挂在
         material.userData 上，由 buildScene 的每帧 update 回填。 */
      if (real.night) {
        material.emissiveMap = real.night;
        material.emissive = new THREE.Color(0xffc987);
        /* 2.3：实测 1.55 时从 2.6R 外看夜面，灯簇只有零星暗点读不出来；
           真实 ISS 照片里城市灯光网是夜面最醒目的元素，给足亮度 */
        material.emissiveIntensity = 2.3;
        const uSunDirW = { value: new THREE.Vector3(1, 0, 0) };
        material.userData.uSunDirW = uSunDirW;
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uSunDirW = uSunDirW;
          material.userData.nightShader = true;   // 诊断：注入确实发生了
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>',
              '#include <common>\nvarying vec3 vWorldN;\nuniform vec3 uSunDirW;')
            .replace('#include <beginnormal_vertex>',
              '#include <beginnormal_vertex>\nvWorldN = normalize(mat3(modelMatrix) * objectNormal);');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>',
              '#include <common>\nvarying vec3 vWorldN;\nuniform vec3 uSunDirW;')
            /* 1.0 - smoothstep(a,b,d)：d>a(白昼)→0，d<b(黑夜)→1。
               不直接写 smoothstep(0.09,-0.14,d)（edge0>edge1 在 GLSL 里未定义） */
            .replace('#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
               float dayK = 1.0 - smoothstep(-0.14, 0.09, dot(normalize(vWorldN), uSunDirW));
               totalEmissiveRadiance *= dayK;`);
        };
      }
      /* ★ 真实地形位移：把高程图当高度场，沿法线推出顶点。
         幅度取半径的 3.2%——**这是被实测数据倒推出来的值，不是拍的**：
           · 真实比例：喜马拉雅 8.8km / 地球 6371km ≈ 0.14%
           · 但 screen 上 1 像素 ≈ 0.14~0.30% 半径（见 tools/limb_math.py），
             真实比例连 1 个像素都不到，等于没做。
           · tools/elev_stats.py 实测：陆地高程中位数 h=0.126，
             要让它产生 1~3 像素起伏，需要 amp ≈ 3%。
         所以这里夸张约 23 倍。视觉上"像地球"，但物理上一眼能看出山脉。
         海平面以下（高程=0）不动，避免海洋出现凹陷。 */
      await applyDisplacement(geo, real.elevation || null, p.radius * 0.032, size);
    } else {
      const set = TEX.earthSet(size);
      material = new THREE.MeshStandardMaterial({
        map: set.map,
        normalMap: set.normal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        emissiveMap: set.emissive,
        emissive: new THREE.Color(0xffd9a0),
        emissiveIntensity: 0.85,
        roughnessMap: set.roughness,
        roughness: 0.92,
        metalness: 0.0
      });
      await applyDisplacement(geo, null, p.radius * 0.032, size);
    }
    // 云层
    /* ★ 云层要"薄"：真实数据贴图本身已经很亮（含云系），
       再叠一层不透明白云就整颗球糊成白球。opacity 取 0.42——
       参考图（蓝色弹珠视角）里云系是清晰可见的白色气旋，太薄就没了；
       颜色提白到 0xf4f8fc，让云在蓝海绿陆上更跳。 */
    const cloudMat = new THREE.MeshLambertMaterial({
      map: TEX.cloudLayer(Math.round(size * 0.75), 777),
      transparent: true, opacity: 0.42, depthWrite: false,
      color: 0xf4f8fc
    });
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(p.radius * 1.012, 96, 64), cloudMat);
    spin.add(clouds);
    holder.userData.clouds = clouds;
  } else if (p.type === 'gas' || p.type === 'ice') {
    const cfg = { ...p.texture, size };
    const map = TEX.gasGiant(cfg);
    await nextFrame();
    /* 气态行星也有"纹理感"：云顶的湍流被光照斜射时会显出起伏。
       强度给得很轻（0.35），否则会像布面。 */
    const nrm = TEX.normalFrom({
      size: Math.max(256, size >> 1), seed: cfg.seed,
      freq: (cfg.bandFreq || 5.5) * 0.6, oct: 4, strength: 0.35, detail: 1
    });
    material = new THREE.MeshStandardMaterial({
      map, normalMap: nrm, normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.86, metalness: 0.0
    });
  } else {
    const cfg = { ...p.texture, size };
    const map = TEX.rocky(cfg);
    await nextFrame();
    /* ★ 岩石行星：bumpMap 换成真正的法线贴图。
       旧版是 bumpScale: 0.035，在低顶点球体上几乎看不见任何效果。
       法线贴图与顶点密度解耦，才能让地表真正"糙"起来。 */
    const nrm = TEX.normalFrom({
      size: Math.max(256, size), seed: cfg.seed, freq: cfg.freq,
      oct: cfg.oct, craters: cfg.craters, strength: 1.55, detail: 2
    });
    await nextFrame();
    material = new THREE.MeshStandardMaterial({
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.95, 0.95),
      /* 保留一点点 bump 做"宏观起伏"，与法线贴图的细节层叠加 */
      bumpMap: nrm,
      bumpScale: 0.06,
      roughness: 0.94, metalness: 0.02
    });
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.bodyId = p.id;
  spin.add(mesh);

  /* 调试/验证用：暴露地球的实际几何与贴图来源，
     方便自动化测试确认"真实数据真的加载了"而不是悄悄回退。
     ★ 整段包 try/catch：这是纯诊断代码，绝不能因为它的问题
     把整个 buildScene 的 Promise 链打断（否则 HUD 都不会出现）。 */
  if (isEarth) {
    try {
      const g = geo.attributes.position;
      let rmin = Infinity, rmax = -Infinity;
      for (let i = 0; i < g.count; i += 7) {          // 抽样，够用
        const r = Math.sqrt(g.getX(i) ** 2 + g.getY(i) ** 2 + g.getZ(i) ** 2);
        if (r < rmin) rmin = r;
        if (r > rmax) rmax = r;
      }
      if (!isFinite(rmin)) rmin = p.radius;
      if (!isFinite(rmax)) rmax = p.radius;
      window.__earthInfo = {
        verts: g.count,
        segs: seg,
        displaced: (rmax - rmin) / p.radius,          // 位移幅度占比
        rmin: +rmin.toFixed(4),
        rmax: +rmax.toFixed(4),
        realTex: !!(real && real.real),
        hasElev: !!(real && real.elevation),
        hasNight: !!(real && real.night),
        /* ★ getter：onBeforeCompile 在首次渲染才触发，快照取不到，
           必须等测试代码在几秒后读取时才求值 */
        get nightMat() { return !!(material.emissiveMap && material.userData.nightShader); },
        emiInt: material.emissiveIntensity,
        mapFile: real && real.real ? 'earth_albedo_2048.jpg' : '(procedural)'
      };
    } catch (e) {
      window.__earthInfo = { error: String(e && e.message || e) };
    }
  }
  window.__builtPlanets = (window.__builtPlanets || []).concat([p.id]);

  /* ---- 大气 ---- */
  let atmosphere = null;
  if (p.atmosphere) {
    atmosphere = buildAtmosphere(p.atmosphere, p.radius);
    axial.add(atmosphere);
  }

  /* ---- 环 ---- */
  let ring = null;
  if (p.ring) {
    const inner = p.radius * p.ring.inner, outer = p.radius * p.ring.outer;
    const rgeo = new THREE.RingGeometry(inner, outer, 192, 1);
    // 重算 UV：让 u 沿半径方向（贴 1D 条纹图）
    const pos = rgeo.attributes.position, uv = rgeo.attributes.uv;
    const vt = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      vt.fromBufferAttribute(pos, i);
      const t = (vt.length() - inner) / (outer - inner);
      uv.setXY(i, t, 0.5);
    }
    const tex = TEX.ringTexture(
      1024,
      p.ring.thin ? [0.25, 0.52, 0.78] : [0.06, 0.30, 0.62, 0.66, 0.84],
      p.ring.palette || [[0, 0x6b5a44], [0.35, 0xb9a382], [1, 0xe6dcc4]],
      p.ring.seed
    );
    const rmat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      opacity: p.ring.opacity
    });
    ring = new THREE.Mesh(rgeo, rmat);
    ring.rotation.x = -Math.PI / 2;
    axial.add(ring);
  }

  return { holder, axial, spin, mesh, material, atmosphere, ring };
}

/* ============================================================
 *  卫星
 * ========================================================== */
async function buildMoon(m, parent, texSizeFor) {
  const pivot = new THREE.Group();
  pivot.rotation.x = (m.incl || 0) * DEG;
  parent.add(pivot);

  const orbit = new THREE.Group();
  pivot.add(orbit);

  const pos = new THREE.Group();
  pos.position.x = m.dist;
  orbit.add(pos);

  const spin = new THREE.Group();
  spin.rotation.z = (m.tilt || 0) * DEG;
  pos.add(spin);

  const size = texSizeFor(m.id, true);
  let material;
  if (m.icy) {
    material = new THREE.MeshStandardMaterial({
      map: TEX.icy({ ...m.icy, size }), roughness: 0.55, metalness: 0.05
    });
  } else {
    const cfg = { ...m.texture, size };
    const map = TEX.rocky(cfg);
    await nextFrame();
    /* 卫星多是小天体，陨坑是它最显眼的特征 —— 法线贴图能把这个特征做足 */
    const nrm = TEX.normalFrom({
      size: Math.max(256, size), seed: cfg.seed, freq: cfg.freq,
      oct: cfg.oct, craters: cfg.craters, strength: 1.7, detail: 2
    });
    material = new THREE.MeshStandardMaterial({
      map, normalMap: nrm, normalScale: new THREE.Vector2(1.05, 1.05),
      roughness: 0.92, metalness: 0.02
    });
  }
  /* 卫星球体同样加密：40×28 太粗，陨坑完全没有形体 */
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(m.radius, 96, 64), material);
  mesh.userData.bodyId = m.id;
  spin.add(mesh);

  let atmosphere = null;
  if (m.atmosphere) {
    atmosphere = buildAtmosphere(m.atmosphere, m.radius);
    pos.add(atmosphere);
  }

  await nextFrame();
  return { orbit, pos, spin, mesh, material, atmosphere };
}

/* ============================================================
 *  小行星带 / 柯伊伯带（InstancedMesh）
 * ========================================================== */
function buildBelt(cfg, quality) {
  const rnd = mulberry32(cfg.seed);
  const count = Math.round(cfg.count * (quality === 'high' ? 1 : quality === 'medium' ? 0.55 : 0.28));

  const base = new THREE.IcosahedronGeometry(1, 0);
  // 顶点扰动 -> 不规则岩块
  const pa = base.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i);
    const k = 0.68 + rnd() * 0.62;
    v.multiplyScalar(k);
    pa.setXYZ(i, v.x, v.y, v.z);
  }
  base.computeVertexNormals();

  const map = TEX.asteroidTexture(cfg.seed, quality === 'high' ? 256 : 128);
  const material = new THREE.MeshStandardMaterial({
    map, roughness: 0.95, metalness: 0.03, flatShading: true
  });
  const inst = new THREE.InstancedMesh(base, material, count);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const state = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const scl = new THREE.Vector3();
  const p = new THREE.Vector3();
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = cfg.innerRadius + Math.pow(rnd(), 0.72) * (cfg.outerRadius - cfg.innerRadius);
    const th = rnd() * Math.PI * 2;
    const y = (rnd() + rnd() + rnd() - 1.5) * cfg.thickness;
    const s = cfg.sizeMin + Math.pow(rnd(), 2.4) * (cfg.sizeMax - cfg.sizeMin);
    const spinAxis = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const speed = (0.25 + rnd() * 0.9) * (Math.PI * 2) / Math.sqrt(r * r * r) * 42;
    state.push({ r, th, y, s, spinAxis, spinPhase: rnd() * 6.28, spinRate: (rnd() - 0.5) * 1.6, speed, tiltx: (rnd() - 0.5) * 0.12 });

    p.set(Math.cos(th) * r, y, Math.sin(th) * r);
    e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    q.setFromEuler(e);
    scl.set(s * (0.7 + rnd() * 0.6), s * (0.7 + rnd() * 0.6), s * (0.7 + rnd() * 0.6));
    m4.compose(p, q, scl);
    inst.setMatrixAt(i, m4);
    const g = 0.55 + rnd() * 0.75;
    color.setRGB(g * (0.85 + rnd() * 0.3), g * 0.88, g * 0.82);
    inst.setColorAt(i, color);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

  return { inst, state, update(t) { updateBelt(inst, state, t); } };
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
  _s = new THREE.Vector3(), _p = new THREE.Vector3();
function updateBelt(inst, state, t) {
  for (let i = 0; i < state.length; i++) {
    const s = state[i];
    const th = s.th + t * s.speed;
    _p.set(Math.cos(th) * s.r, s.y + Math.sin(t * 0.12 + s.spinPhase) * 0.4, Math.sin(th) * s.r);
    const ang = s.spinPhase + t * s.spinRate;
    _q.setFromAxisAngle(s.spinAxis, ang);
    _s.setScalar(s.s);
    _m4.compose(_p, _q, _s);
    inst.setMatrixAt(i, _m4);
  }
  inst.instanceMatrix.needsUpdate = true;
}

/* ============================================================
 *  漂流陨石（近景，慢速漂浮）
 * ========================================================== */
function buildDrifters(count, quality) {
  const n = Math.round(count * (quality === 'high' ? 1 : quality === 'medium' ? 0.5 : 0.25));
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pa = geo.attributes.position;
  const v = new THREE.Vector3();
  const rnd = mulberry32(606060);
  for (let i = 0; i < pa.count; i++) {
    v.fromBufferAttribute(pa, i).multiplyScalar(0.6 + rnd() * 0.7);
    pa.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7a7065, roughness: 1, metalness: 0, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, n);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const state = [];
  for (let i = 0; i < n; i++) {
    const r = 30 + Math.pow(rnd(), 0.6) * 460;
    const th = rnd() * Math.PI * 2;
    state.push({
      r, th, y: (rnd() + rnd() - 1) * 60,
      size: 0.12 + Math.pow(rnd(), 2.2) * 0.9,
      vy: (rnd() - 0.5) * 0.5, spinRate: (rnd() - 0.5) * 0.8,
      phase: rnd() * 100, radial: (rnd() - 0.5) * 2.4
    });
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  return {
    inst, state,
    update(t) {
      for (let i = 0; i < n; i++) {
        const d = state[i];
        const th = d.th + t * 0.012 + d.radial * t * 0.0015;
        const rr = d.r + Math.sin(t * 0.08 + d.phase) * 3;
        p.set(Math.cos(th) * rr, d.y + Math.sin(t * 0.05 + d.phase) * 3, Math.sin(th) * rr);
        e.set(d.phase + t * d.spinRate * 0.4, d.phase * 1.7 + t * d.spinRate, d.phase * 0.5);
        q.setFromEuler(e);
        s.setScalar(d.size);
        m4.compose(p, q, s);
        inst.setMatrixAt(i, m4);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  };
}

/* ============================================================
 *  彗星（近日加速 + 朝向太阳的离子尾）
 * ========================================================== */
function buildComet(cfg, quality) {
  const group = new THREE.Group();

  const headMat = new THREE.MeshStandardMaterial({
    map: TEX.rocky({
      size: 256, seed: cfg.seed, freq: 4.2, oct: 5, contrast: 1.5,
      stops: [[0, 0x24282e], [0.45, 0x55606b], [0.75, 0x8a95a0], [1, 0xc0c8d0]]
    }),
    roughness: 0.9, metalness: 0.05, emissive: new THREE.Color(0x224466), emissiveIntensity: 0.35
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(cfg.radius, 32, 24), headMat);
  group.add(head);

  // 彗发
  const coma = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX.glowSprite(128, 0x9fd8ff, 2.4), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85
  }));
  coma.scale.setScalar(cfg.radius * 9);
  group.add(coma);

  // 离子尾：开口朝外的锥体
  const tailMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(cfg.color) }, uStrength: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength; varying vec2 vUv;
      void main(){
        float along = clamp(vUv.y, 0.0, 1.0);           // 0 靠近彗核
        float radial = abs(vUv.x - 0.5) * 2.0;
        float fade = pow(1.0 - along, 1.7) * (1.0 - pow(radial, 1.6));
        fade *= smoothstep(0.0, 0.12, along);
        gl_FragColor = vec4(uColor, max(fade,0.0) * 0.75 * uStrength);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
  });
  const tailLen = cfg.tailLength;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(cfg.radius * 3.4, cfg.radius * 0.35, tailLen, 24, 12, true), tailMat);
  tail.geometry.translate(0, tailLen / 2, 0);        // 原点移到彗核端
  tail.rotation.z = -Math.PI / 2;                     // 先指向 +X
  const tailPivot = new THREE.Group();
  tailPivot.add(tail);
  group.add(tailPivot);

  const dustTail = new THREE.Mesh(
    new THREE.CylinderGeometry(cfg.radius * 2.0, cfg.radius * 0.3, tailLen * 0.7, 20, 10, true),
    tailMat.clone()
  );
  dustTail.material.uniforms.uColor.value = new THREE.Color(0xffd9a0);
  dustTail.geometry.translate(0, tailLen * 0.35, 0);
  dustTail.rotation.z = -Math.PI / 2 - 0.22;
  tailPivot.add(dustTail);

  // 轨道几何参数
  const a = (cfg.perihelion + cfg.aphelion) / 2;
  const e = (cfg.aphelion - cfg.perihelion) / (cfg.aphelion + cfg.perihelion);
  const p = a * (1 - e * e);

  const state = { theta: cfg.offset * Math.PI * 2 };

  return {
    group, head, tailPivot, tailMat, dustTail,
    update(t, dt, timeScale) {
      const speed = (Math.PI * 2) / cfg.period;
      state.theta += dt * speed * timeScale;
      const cosT = Math.cos(state.theta);
      const r = p / (1 + e * cosT);
      const x = Math.cos(state.theta) * r;
      const z = Math.sin(state.theta) * r;
      group.position.set(x, 0, z);
      group.rotation.y = 0;
      group.parent && group.parent.updateMatrixWorld();
      // 尾巴始终背离太阳
      const dir = Math.atan2(z, x);
      tailPivot.rotation.y = -dir + Math.PI;
      tailPivot.rotation.z = cfg.incl * DEG;
      // 越靠近太阳尾巴越长（示意性，非物理严格）
      const heat = THREE.MathUtils.clamp(Math.pow(30 / r, 0.45), 0.25, 1.6);
      tailPivot.scale.setScalar(0.35 + heat * 0.9);
      tailMat.uniforms.uStrength.value = 0.35 + heat * 0.75;
      head.rotation.y = t * 0.4;
    }
  };
}

/* ============================================================
 *  组装
 * ========================================================== */
export async function buildSolarSystem(scene, { quality = 'high', onProgress = () => { } } = {}) {
  const root = new THREE.Group();
  root.name = 'solar-system';
  scene.add(root);

  const sizeFor = (id, isMoon = false) => {
    if (isMoon) return quality === 'high' ? 512 : 256;
    if (id === 'earth' || id === 'jupiter' || id === 'saturn') return quality === 'high' ? 1024 : 512;
    return quality === 'high' ? 512 : 256;
  };

  emit(0, '初始化恒星聚变');
  const sun = buildSun(root, { quality });

  const bodies = [];
  const orbitLines = [];
  const atmospheres = [];
  const nightLit = [];          // 地球夜灯材质（uSunDirW 每帧回填）

  const total = PLANETS.length;
  for (let i = 0; i < total; i++) {
    const p = PLANETS[i];
    emit(8 + (i / total) * 62, `正在雕刻 ${p.name}`);
    /* ★ 一颗行星构建失败不能拖垮整个场景：隔断异常、记录原因、继续下一颗。
       否则 HUD 永远不出现，页面看起来像"白屏"，极难定位。 */
    let built;
    try {
      built = await buildPlanet(p, sizeFor, onProgress, quality);
    } catch (e) {
      (window.__buildErrors = window.__buildErrors || []).push(p.id + ': ' + (e && e.message));
      console.warn('[buildPlanet] ' + p.id + ' 失败：', e);
      continue;
    }
    const built_ok = built;

    // 轨道：倾角 -> rotation.x，公转 -> orbitPivot.rotation.y
    const tiltPivot = new THREE.Group();
    tiltPivot.rotation.x = p.incl * DEG;
    tiltPivot.rotation.z = (p.id === 'pluto' ? 8 : 0) * DEG;
    root.add(tiltPivot);

    const orbitPivot = new THREE.Group();
    tiltPivot.add(orbitPivot);
    orbitPivot.add(built_ok.holder);

    const line = buildOrbitLine(p.orbit, p.ecc, p.id === 'pluto' ? 0x7a6a9a : 0x5f8a9a);
    tiltPivot.add(line);
    orbitLines.push(line);

    // 卫星
    const moons = [];
    if (p.moons) {
      for (const m of p.moons) {
        const mb = await buildMoon(m, built_ok.holder, sizeFor);
        const mline = buildOrbitLine(m.dist, 0, 0x3f6070);
        mline.material.opacity = 0.16;
        mb.pos.add(mline);
        mline.scale.setScalar(1);
        orbitLines.push(mline);
        moons.push({ id: m.id, name: m.name, data: m, ...mb, orbit: mb.orbit, line: mline });
        emit(8 + ((i + 0.6) / total) * 62, `生成卫星 ${m.name}`);
      }
    }

    if (built_ok.atmosphere) atmospheres.push(built_ok.atmosphere);

    /* ★ 地球夜灯：材质里带 uSunDirW uniform 的（onBeforeCompile 注入过
       昼夜掩模）加入待更新列表，每帧回填「指向太阳」的世界方向 */
    if (built_ok.material && built_ok.material.userData.uSunDirW) {
      nightLit.push({ mesh: built_ok.mesh, uSunDirW: built_ok.material.userData.uSunDirW });
    }

    bodies.push({
      data: p, id: p.id, name: p.name, en: p.en, tag: p.tag, type: p.type,
      radius: p.radius, orbitRadius: p.orbit,
      holder: built_ok.holder, axial: built_ok.axial, spin: built_ok.spin,
      mesh: built_ok.mesh, material: built_ok.material, atmosphere: built_ok.atmosphere,
      ring: built_ok.ring, moons, line,
      theta: Math.random() * Math.PI * 2 + (i * 1.7),
      world: new THREE.Vector3(),
      kind: 'planet'
    });
  }

  /* ---- 小行星带 / 柯伊伯带 ---- */
  emit(74, '播撒小行星带');
  const belts = BELTS.map((b) => {
    const belt = buildBelt(b, quality);
    belt.cfg = b;
    root.add(belt.inst);
    return belt;
  });
  await nextFrame();

  emit(80, '释放漂流陨石');
  const drifters = buildDrifters(420, quality);
  root.add(drifters.inst);
  await nextFrame();

  emit(85, '牵引彗星入轨');
  const comets = COMETS.map((c) => {
    const cb = buildComet(c, quality);
    root.add(cb.group);
    return cb;
  });

  emit(92, '点亮星光');
  await nextFrame();

  const sunWorld = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

  const api = {
    root, sun, sunLight: sun.light, bodies, orbitLines, belts, drifters, comets,

    /** 每帧推进演化。timeScale 为 UI 上的时间流速倍率 */
    update(t, dt, timeScale) {
      sun.update(t);

      for (const b of bodies) {
        // 公转
        b.theta += (dt * timeScale * Math.PI * 2) / b.data.orbital;
        const a = b.data.orbit;
        const bb = a * (1 - b.data.ecc * 0.55);
        b.holder.position.set(Math.cos(b.theta) * a, 0, Math.sin(b.theta) * bb);
        // 自转
        b.spin.rotation.y += (dt * timeScale * Math.PI * 2) / Math.abs(b.data.rotation) * Math.sign(b.data.rotation);
        if (b.holder.userData.clouds) {
          b.holder.userData.clouds.rotation.y += dt * timeScale * 0.035;
        }
        // 卫星
        for (const m of b.moons) {
          m.orbit.rotation.y += (dt * timeScale * Math.PI * 2) / m.data.period;
          m.spin.rotation.y += (dt * timeScale * Math.PI * 2) / Math.max(4, Math.abs(m.data.period) * 0.8);
        }
        if (b.ring) b.ring.rotation.z += dt * timeScale * 0.05;
      }

      for (const belt of belts) belt.update(t * 1.0);
      drifters.update(t);
      for (const c of comets) c.update(t, dt, timeScale);

      sun.group.getWorldPosition(sunWorld);
      for (let i = 0; i < atmospheres.length; i++) {
        const at = atmospheres[i];
        at.getWorldPosition(tmpV);
        tmpV.sub(sunWorld).normalize();
        at.material.uniforms.uSunDir.value.copy(tmpV.clone().negate());
      }
      /* 夜灯掩模：uSunDirW = 从地球表面**指向太阳**的世界方向。
         着色器里 dot(世界法线, uSunDirW) > 0 即白昼（熄灯）。
         ★ 注意方向：getWorldPosition 得到的是地心位置，
           sunWorld - 地心 才是"指向太阳"；写反了灯就会亮在白天、
           灭在夜里（第一版就踩了这个坑）。 */
      for (let i = 0; i < nightLit.length; i++) {
        const nl = nightLit[i];
        nl.mesh.getWorldPosition(tmpV);
        tmpV.sub(sunWorld).negate().normalize();
        nl.uSunDirW.value.copy(tmpV);
      }
    },

    setOrbitsVisible(v) {
      for (const l of api.orbitLines) l.visible = v;
    },
    setBeltsVisible(v) {
      for (const b of belts) b.inst.visible = v;
      drifters.inst.visible = v;
      for (const c of comets) c.group.visible = v;
    },
    setCometsVisible(v) {
      for (const c of comets) c.group.visible = v;
    },
    getWorldScale() { return root.scale.x; },
    setWorldScale(s) { root.scale.setScalar(s); }
  };

  function emit(pct, msg) { onProgress(pct, msg); }

  emit(96, '校准轨道');
  await nextFrame();
  emit(100, '就绪');
  return api;
}
