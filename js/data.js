/**
 * data.js — 天体资料表
 * 说明：这里的 radius / orbit / 周期数值是"为了好看而压缩过的观赏值"，
 *       真实天文数据放在 real 字段里，用于右侧信息面板展示。
 *       真实距离若按 1:1 呈现，海王星会远到看不出这是个"系统"，所以我们撒了点谎。
 */

export const SUN = {
  id: 'sun', name: '太阳', en: 'SOL', tag: 'G2V 主序星', type: 'sun',
  radius: 13,
  rotation: 90,
  color: 0xffcf6b,
  desc: '占太阳系总质量 99.86% 的那颗恒星，也是这里唯一在发光的东西。',
  detail: '你此刻看到的每一束光，都是它核心区每秒 6 亿吨氢聚变反应的余晖，走了 8 分 20 秒才抵达地球。它表面的米粒组织以每秒 1.5 公里的速度翻涌，其磁场每 11 年翻转一次极性。',
  real: {
    '直径': '1,391,400 km（地球的 109 倍）',
    '质量': '1.989×10³⁰ kg',
    '表面温度': '约 5,505 ℃',
    '核心温度': '约 1,500 万 ℃',
    '自转周期': '25.4 天（赤道）',
    '年龄': '约 46 亿年'
  }
};

export const PLANETS = [
  {
    id: 'mercury', name: '水星', en: 'MERCURY', tag: '类地行星 · I', type: 'rocky',
    radius: 1.35, orbit: 42, incl: 7.0, tilt: 0.03, ecc: 0.09,
    orbital: 22, rotation: 58,
    desc: '离太阳最近，也跑得最快，一天比一年还长。',
    detail: '没有大气层的保护，昼夜温差可达 600 ℃。它表面布满与月球相似的撞击坑，其中卡洛里盆地直径达 1,550 km——形成那次撞击的震动，足以让整个星体重新塑形。它的金属核占了半径的 85%，是一颗"没穿衣服的铁球"。',
    real: {
      '赤道直径': '4,879 km',
      '距太阳': '0.39 AU（5,791 万 km）',
      '公转周期': '88 天',
      '自转周期': '58.6 天',
      '表面温差': '-173 ~ 427 ℃',
      '卫星数': '0'
    },
    texture: {
      seed: 11, freq: 2.6, oct: 6, contrast: 1.35,
      stops: [[0, 0x2b2723], [0.35, 0x50483f], [0.62, 0x776c60], [0.85, 0x9b9186], [1, 0xc0b6a8]],
      craters: { count: 90, min: 0.03, max: 0.19, depth: 0.55 }
    }
  },
  {
    id: 'venus', name: '金星', en: 'VENUS', tag: '类地行星 · II', type: 'rocky',
    radius: 2.55, orbit: 65, incl: 3.4, tilt: 177.4, ecc: 0.02,
    orbital: 32, rotation: -70,
    desc: '太阳系最热的地方，地表可以熔化铅。',
    detail: '浓厚的二氧化碳大气造成失控温室效应，地表温度稳定在 464 ℃，比水星还热。它的自转是逆向的——在金星上，太阳从西边升起。云层由硫酸组成，以 4 天一圈的速度超级旋转，远快于 243 天的自转。',
    real: {
      '赤道直径': '12,104 km',
      '距太阳': '0.72 AU（1.082 亿 km）',
      '公转周期': '224.7 天',
      '自转周期': '243 天（逆向）',
      '表面温度': '约 464 ℃',
      '气压': '地球的 92 倍'
    },
    // 金星：浓硫酸云，瑞利散射弱、米氏散射极强（所以是均匀的橙黄色，没有蓝天）
    atmosphere: { color: 0xffd9a0, opacity: 0.55, scale: 1.045, fresnel: 2.2,
      rayleigh: 0xd8a860, mie: 0xf0c078, sunset: 0xff7a2a, mieStrength: 0.62, thickness: 1.8 },
    texture: {
      seed: 22, freq: 1.9, oct: 5, contrast: 0.85,
      stops: [[0, 0x8c6a3c], [0.4, 0xc39a5c], [0.68, 0xe0c48a], [0.88, 0xf0dcae], [1, 0xfaf0d2]]
    }
  },
  {
    id: 'earth', name: '地球', en: 'EARTH', tag: '类地行星 · III', type: 'earth',
    radius: 2.75, orbit: 92, incl: 0, tilt: 23.44, ecc: 0.017,
    orbital: 40, rotation: 14,
    desc: '目前已知唯一存在生命的星球，也是你的出发地。',
    detail: '71% 的表面被液态水覆盖，磁场为它挡住了太阳风，大气层替它烧掉了绝大多数不请自来的访客。此刻有超过 8 万个人类正在天上飞——在黑暗的一面，你能看见他们城市的灯火连成的脉络。',
    real: {
      '赤道直径': '12,756 km',
      '距太阳': '1 AU（1.496 亿 km）',
      '公转周期': '365.26 天',
      '自转周期': '23 小时 56 分 4 秒',
      '平均温度': '15 ℃',
      '卫星数': '1'
    },
    // rayleigh = 瑞利散射更强的蓝通道；mie = 气溶胶造成的灰白雾霭；
    // sunset = 晨昏线处夕阳的暖色（地平线泛红的原因）
    // ★ opacity 从 0.60 降到 0.42、thickness 从 1.35 降到 1.05：
    //   真实地球大气在轨道高度看是一条**极细的蓝边**，不是一轮厚白圈。
    //   旧值配合 AdditiveBlending 会在向阳侧烧出一个白斑（截图里的亮团）。
    //   大气壳本身也从 scale 1.05 收到 1.035，让蓝边更贴地、更锐利。
    atmosphere: { color: 0x4a9fd8, opacity: 0.42, scale: 1.035, fresnel: 2.6,
      rayleigh: 0x4a9fd8, mie: 0xa8c4e0, sunset: 0xff8a42, mieStrength: 0.22, thickness: 1.05 },
    moons: [
      { id: 'moon', name: '月球', en: 'LUNA', radius: 0.74, dist: 7.2, period: 24, incl: 5.1, tilt: 6.7,
        desc: '地球唯一的天然卫星，潮汐的制造者。',
        detail: '它正以每年 3.8 厘米的速度远离我们。它的自转与公转完全同步，因此永远只有一面朝向地球——人类直到 1959 年才第一次看见月球背面。',
        real: { '直径': '3,475 km', '距地球': '384,400 km', '公转周期': '27.3 天', '表面重力': '地球的 1/6' },
        texture: {
          seed: 33, freq: 3.2, oct: 6, contrast: 1.45,
          stops: [[0, 0x2a2723], [0.3, 0x4f4a44], [0.58, 0x7a736a], [0.82, 0xa39b90], [1, 0xc9c2b6]],
          craters: { count: 150, min: 0.02, max: 0.16, depth: 0.6 }
        } }
    ]
  },
  {
    id: 'mars', name: '火星', en: 'MARS', tag: '类地行星 · IV', type: 'rocky',
    radius: 1.95, orbit: 124, incl: 1.85, tilt: 25.19, ecc: 0.09,
    orbital: 52, rotation: 14.5,
    desc: '红色星球，拥有太阳系最高的火山和最大的峡谷。',
    detail: '它的红色来自地表氧化铁——本质上就是铁锈。奥林帕斯山高 21.9 km，是珠峰的近三倍；水手大峡谷长 4,000 km，横穿整个赤道。南极冰盖若全部融化，足以淹没整个星球到 11 米深。',
    real: {
      '赤道直径': '6,792 km',
      '距太阳': '1.52 AU（2.279 亿 km）',
      '公转周期': '687 天',
      '自转周期': '24 小时 37 分',
      '平均温度': '-63 ℃',
      '卫星数': '2'
    },
    texture: {
      seed: 44, freq: 2.5, oct: 6, contrast: 1.3, polar: 0xf2f0ea, polarSize: 0.16, veins: 0.25, veinColor: 0x4a2118,
      stops: [[0, 0x3d1c11], [0.3, 0x6b3218], [0.55, 0x94502a], [0.78, 0xb9703f], [1, 0xd39a6e]],
      craters: { count: 60, min: 0.04, max: 0.2, depth: 0.4 }
    },
    moons: [
      { id: 'phobos', name: '火卫一', en: 'PHOBOS', radius: 0.24, dist: 3.6, period: 11, incl: 1.1, tilt: 0,
        desc: '正在坠向火星的小土豆。',
        detail: '它离火星太近了，近到每圈都比火星自转更快——所以在火星上看，火卫一从西边升起、东边落下，一天升落两次。它正以每世纪 2 米的速度靠近火星，几千万年后会被撕成一道环。',
        real: { '大小': '27×22×18 km', '距火星': '9,376 km', '公转周期': '7.65 小时' },
        texture: { seed: 51, freq: 4.2, oct: 5, contrast: 1.5,
          stops: [[0, 0x1c1815], [0.5, 0x453d36], [1, 0x7a7065]],
          craters: { count: 40, min: 0.05, max: 0.24, depth: 0.7 } } },
      { id: 'deimos', name: '火卫二', en: 'DEIMOS', radius: 0.17, dist: 5.2, period: 18, incl: 1.8, tilt: 0,
        desc: '更小、更远，也更安静。',
        detail: '太阳系已知最小的卫星之一，平均直径仅 12.4 公里。它的名字和火卫一一起来自希腊神话中的"恐惧"与"惊慌"，是火星战神的随从。',
        real: { '大小': '15×12×11 km', '距火星': '23,463 km', '公转周期': '30.3 小时' },
        texture: { seed: 52, freq: 4.6, oct: 5, contrast: 1.4,
          stops: [[0, 0x1a1714], [0.5, 0x413a34], [1, 0x6f665d]],
          craters: { count: 30, min: 0.06, max: 0.26, depth: 0.65 } } }
    ]
  },
  {
    id: 'jupiter', name: '木星', en: 'JUPITER', tag: '气态巨行星 · V', type: 'gas',
    radius: 8.6, orbit: 178, incl: 1.3, tilt: 3.13, ecc: 0.05,
    orbital: 88, rotation: 6.5, flatten: 0.065,
    desc: '太阳系的重量级守护者，质量是其余行星总和的 2.5 倍。',
    detail: '它没有可以站立的表面，你只会一路坠入越来越稠密的氢，最终变成金属。大红斑是一场持续了至少 350 年的风暴，风速超过 400 km/h，整个地球都能塞进去。它用引力替内太阳系挡下了无数来犯的彗星。',
    real: {
      '赤道直径': '142,984 km',
      '距太阳': '5.2 AU（7.786 亿 km）',
      '公转周期': '11.86 年',
      '自转周期': '9 小时 56 分',
      '云顶温度': '-108 ℃',
      '卫星数': '95 颗以上'
    },
    texture: {
      seed: 55, size: 1024, bandFreq: 6.2, turbulence: 0.55, spiral: 0.5, bandContrast: 1.05,
      stops: [[0, 0x6b4a35], [0.22, 0xa37f56], [0.4, 0xd8c39a], [0.55, 0xf0e2c4], [0.7, 0xc79a6d], [0.85, 0x96603d], [1, 0x5f3d2c]],
      storms: [
        { lat: -0.35, lon: 1.1, w: 0.30, h: 0.13, color: 0xc4503a, strength: 0.95 },
        { lat: 0.62, lon: 3.2, w: 0.18, h: 0.07, color: 0xe8dcc0, strength: 0.5 },
        { lat: -0.72, lon: 5.0, w: 0.14, h: 0.06, color: 0xd8c0a0, strength: 0.45 }
      ]
    },
    moons: [
      { id: 'io', name: '木卫一', en: 'IO', radius: 0.92, dist: 13.2, period: 18, incl: 0.4,
        desc: '太阳系火山活动最激烈的天体。',
        detail: '木星的潮汐力不断揉捏它，内部热量让它拥有 400 多座活火山，硫磺喷泉可以喷到 500 公里高。表面因此呈现出病态的硫黄色，是它每时被潮汐拉伸吐出一亿吨岩浆的证据。',
        real: { '直径': '3,643 km', '距木星': '421,700 km', '公转周期': '1.77 天' },
        texture: { seed: 61, freq: 3.0, oct: 6, contrast: 1.5,
          stops: [[0, 0x6b3d12], [0.3, 0xb5801f], [0.55, 0xdcb63a], [0.75, 0xf0dc78], [1, 0xfaf0b0]],
          craters: { count: 12, min: 0.06, max: 0.2, depth: 0.3 } } },
      { id: 'europa', name: '木卫二', en: 'EUROPA', radius: 0.8, dist: 16.4, period: 25, incl: 0.5,
        desc: '冰壳之下，藏着比地球全部海洋更多的液态水。',
        detail: '它的表面是极其光滑的水冰，布满了相互交错的褐色裂纹——下方的海洋在潮汐作用下不断涨落，把冰壳撕开又冻结。这里是人类搜寻地外生命的头号目标。',
        real: { '直径': '3,122 km', '距木星': '671,034 km', '公转周期': '3.55 天', '冰下海洋': '深度可能达 100 km' },
        icy: { seed: 62, freq: 2.2, crack: 0.85, crackColor: 0x9c6042,
          stops: [[0, 0xc9bfae], [0.4, 0xe4dccc], [0.7, 0xf4eee2], [1, 0xfdfaf4]] } },
      { id: 'ganymede', name: '木卫三', en: 'GANYMEDE', radius: 1.32, dist: 20.6, period: 34, incl: 0.2,
        desc: '太阳系最大的卫星，比水星还大。',
        detail: '它拥有自己的磁场，是唯一已知拥有磁层的卫星。表面一半是古老的深色陨击地形，一半是相对年轻的沟槽地貌，记录了早期太阳系剧烈的撞击史。',
        real: { '直径': '5,268 km', '距木星': '1,070,412 km', '公转周期': '7.15 天' },
        texture: { seed: 63, freq: 2.8, oct: 6, contrast: 1.25, veins: 0.3, veinColor: 0x8a8073,
          stops: [[0, 0x37322c], [0.35, 0x5d564c], [0.6, 0x8b8276], [0.82, 0xb0a89a], [1, 0xd6cfc2]],
          craters: { count: 90, min: 0.03, max: 0.15, depth: 0.4 } } },
      { id: 'callisto', name: '木卫四', en: 'CALLISTO', radius: 1.16, dist: 25.4, period: 48, incl: 0.3,
        desc: '太阳系里陨坑最密集的天体，一张被砸了 40 亿年的脸。',
        detail: '它几乎没有地质活动，表面得以完整保留太阳系早期的撞击记录。最大的撞击盆地瓦尔哈拉直径 3,800 km，同心环向外扩散如涟漪。',
        real: { '直径': '4,821 km', '距木星': '1,882,709 km', '公转周期': '16.69 天' },
        texture: { seed: 64, freq: 2.6, oct: 6, contrast: 1.3,
          stops: [[0, 0x24201c], [0.35, 0x453f38], [0.62, 0x6f675d], [0.85, 0x928a7e], [1, 0xb8b0a2]],
          craters: { count: 160, min: 0.02, max: 0.14, depth: 0.5 } } }
    ]
  },
  {
    id: 'saturn', name: '土星', en: 'SATURN', tag: '气态巨行星 · VI', type: 'gas',
    radius: 7.2, orbit: 248, incl: 2.49, tilt: 26.73, ecc: 0.06, flatten: 0.098,
    orbital: 130, rotation: 7,
    desc: '拥有太阳系最壮观的环系，密度却比水还小。',
    detail: '如果有足够大的浴缸，土星能浮在水面上。它的环主要由水冰组成，宽度可达 28 万公里，厚度却往往不足 10 米——一张比纸还薄、比地球还宽的唱片。它的北极存在一个稳定的六边形喷流，边长 13,800 km。',
    real: {
      '赤道直径': '120,536 km',
      '距太阳': '9.54 AU（14.34 亿 km）',
      '公转周期': '29.45 年',
      '自转周期': '10 小时 33 分',
      '平均密度': '0.687 g/cm³',
      '卫星数': '146 颗以上'
    },
    ring: { inner: 1.35, outer: 2.45, tilt: 0, opacity: 0.95, seed: 91 },
    texture: {
      seed: 66, size: 1024, bandFreq: 5.0, turbulence: 0.42, spiral: 0.32, bandContrast: 0.8,
      stops: [[0, 0x8a6a42], [0.25, 0xba9a63], [0.45, 0xdcbf88], [0.62, 0xf0dcb0], [0.8, 0xcaa876], [1, 0x96774e]],
      storms: [{ lat: 0.55, lon: 2.4, w: 0.2, h: 0.07, color: 0xf5ead0, strength: 0.55 }]
    },
    moons: [
      { id: 'titan', name: '土卫六', en: 'TITAN', radius: 1.12, dist: 15.5, period: 40, incl: 0.3,
        desc: '唯一拥有浓厚大气的卫星，下着甲烷的雨。',
        detail: '它有河流、湖泊和降雨，只是液体是液态甲烷和乙烷。地表温度 -179 ℃，氮气大气比地球还厚。"惠更斯"号 2005 年落在它的表面，传回了人类在另一颗天体岸边看到的第一张照片。',
        real: { '直径': '5,150 km', '距土星': '1,221,870 km', '公转周期': '15.95 天', '大气压': '地球的 1.45 倍' },
        // 土卫六：厚氮气大气 + 甲烷雾霾，同样是"米氏散射主导"，呈均匀橙黄
        atmosphere: { color: 0xffa858, opacity: 0.55, scale: 1.055, fresnel: 2.4,
          rayleigh: 0xc07a3a, mie: 0xe8a860, sunset: 0xff6a20, mieStrength: 0.55, thickness: 1.55 },
        texture: { seed: 71, freq: 2.2, oct: 5, contrast: 0.9,
          stops: [[0, 0x8a4a12], [0.35, 0xc07020], [0.6, 0xe09540], [0.82, 0xf2bb72], [1, 0xfce0a8]] } },
      { id: 'enceladus', name: '土卫二', en: 'ENCELADUS', radius: 0.42, dist: 11.2, period: 26, incl: 0.1,
        desc: '南极不断向太空喷水的冰月。',
        detail: '卡西尼号发现它的南极裂缝喷出上百道水蒸气羽流，直接成为土星 E 环的物质来源。探测器穿越羽流时检测到了盐、二氧化硅和有机分子——来自一个温暖的有海底热泉的海洋。',
        real: { '直径': '504 km', '距土星': '237,948 km', '公转周期': '1.37 天', '羽流速度': '约 400 m/s' },
        icy: { seed: 72, freq: 2.6, crack: 0.6, crackColor: 0xa0b8c8,
          stops: [[0, 0xa8b0b8], [0.4, 0xd0d8e0], [0.7, 0xeef2f6], [1, 0xffffff]] } },
      { id: 'rhea', name: '土卫五', en: 'RHEA', radius: 0.62, dist: 21.5, period: 56, incl: 0.35,
        desc: '沾满撞击痕迹的雪球。',
        detail: '太阳系第二大的土星卫星，表面由水冰与少量岩石组成，几乎没有大气。它被认为拥有一颗稀薄的尘埃环——这是人类第一次怀疑卫星也能有环。',
        real: { '直径': '1,528 km', '距土星': '527,108 km', '公转周期': '4.52 天' },
        texture: { seed: 73, freq: 3.4, oct: 6, contrast: 1.2,
          stops: [[0, 0x4a4a48], [0.4, 0x8a8a86], [0.7, 0xb8b8b4], [1, 0xe4e4e0]],
          craters: { count: 110, min: 0.03, max: 0.16, depth: 0.45 } } }
    ]
  },
  {
    id: 'uranus', name: '天王星', en: 'URANUS', tag: '冰质巨行星 · VII', type: 'ice',
    radius: 4.4, orbit: 312, incl: 0.77, tilt: 97.77, ecc: 0.05,
    orbital: 190, rotation: -9,
    desc: '躺着自转的行星，转轴几乎贴着轨道面。',
    detail: '它的自转轴倾斜 98 度，像一个滚动的球而不是旋转的陀螺，导致两极各有长达 42 年的极昼与极夜。大气中的甲烷吸收红光、散射蓝绿，让它呈现出没有细节的青色圆盘。',
    real: {
      '赤道直径': '51,118 km',
      '距太阳': '19.19 AU（28.71 亿 km）',
      '公转周期': '84 年',
      '自转周期': '17 小时 14 分（逆向）',
      '云顶温度': '-195 ℃',
      '卫星数': '28 颗'
    },
    ring: { inner: 1.6, outer: 2.05, tilt: 0, opacity: 0.35, seed: 92, palette: [[0, 0x3a5a68], [0.5, 0x7a95a0], [1, 0xa8c0c8]], thin: true },
    // 天王星：大气以甲烷为主，甲烷强烈吸收红光 → 整体呈青蓝。瑞利散射弱、色泽偏冷
    atmosphere: { color: 0x9fe8e0, opacity: 0.45, scale: 1.035, fresnel: 2.4,
      rayleigh: 0x7ad8e0, mie: 0xb0e0dc, sunset: 0xd8a060, mieStrength: 0.16, thickness: 1.05 },
    texture: {
      seed: 77, bandFreq: 2.4, turbulence: 0.2, spiral: 0.18, bandContrast: 0.55, size: 512,
      stops: [[0, 0x2e6b6b], [0.4, 0x5a9e9c], [0.7, 0x8fc9c4], [1, 0xbfe6e2]]
    },
    moons: [
      { id: 'titania', name: '天卫三', en: 'TITANIA', radius: 0.58, dist: 9.4, period: 32, incl: 0.1,
        desc: '天王星最大的卫星，冰封的峡谷世界。',
        detail: '表面被巨大的峡谷系统切割，最长的一条长达 1,600 km，深达数十公里。它是在天王星被撞歪的那次灾难中幸存下来的古老天体。',
        real: { '直径': '1,578 km', '距天王星': '435,910 km', '公转周期': '8.71 天' },
        texture: { seed: 81, freq: 3.0, oct: 5, contrast: 1.15,
          stops: [[0, 0x3a3d42], [0.4, 0x6a6e74], [0.75, 0x9aa0a6], [1, 0xc4c9ce]],
          craters: { count: 70, min: 0.04, max: 0.18, depth: 0.42 } } },
      { id: 'oberon', name: '天卫四', en: 'OBERON', radius: 0.52, dist: 12.6, period: 44, incl: 0.2,
        desc: '坑底浮现出神秘暗色物质的卫星。',
        detail: '它表面的一些陨坑底部覆盖着来源未知的暗色物质，可能是从内部渗出的含碳冰。它是最外侧的大卫星，记录着天王星系统最外层的历史。',
        real: { '直径': '1,523 km', '距天王星': '583,520 km', '公转周期': '13.46 天' },
        texture: { seed: 82, freq: 2.9, oct: 5, contrast: 1.2,
          stops: [[0, 0x2a2c30], [0.4, 0x565a60], [0.7, 0x82878e], [1, 0xb0b5bc]],
          craters: { count: 100, min: 0.03, max: 0.17, depth: 0.5 } } }
    ]
  },
  {
    id: 'neptune', name: '海王星', en: 'NEPTUNE', tag: '冰质巨行星 · VIII', type: 'ice',
    radius: 4.25, orbit: 372, incl: 1.77, tilt: 28.32, ecc: 0.01,
    orbital: 240, rotation: 8.5,
    desc: '太阳系风速最快的行星，由数学算式算出来的行星。',
    detail: '它是人类先用笔算出位置、再用望远镜找到的行星——1846 年，天文学家根据天王星轨道的异常推算出它应当在那儿，当晚就找到了。这里的风速可达 2,100 km/h，是地球最强飓风的九倍。',
    real: {
      '赤道直径': '49,528 km',
      '距太阳': '30.07 AU（44.95 亿 km）',
      '公转周期': '164.8 年',
      '自转周期': '16 小时 6 分',
      '最大风速': '2,100 km/h',
      '卫星数': '16 颗'
    },
    // 海王星：甲烷 + 未知吸光物质 → 更饱和的深蓝；大气活跃，米氏散射略强
    atmosphere: { color: 0x4a7ae8, opacity: 0.50, scale: 1.035, fresnel: 2.3,
      rayleigh: 0x3a6ae0, mie: 0x8fb4f0, sunset: 0xe08a4a, mieStrength: 0.22, thickness: 1.15 },
    texture: {
      seed: 88, bandFreq: 3.4, turbulence: 0.35, spiral: 0.3, bandContrast: 0.7, size: 512,
      stops: [[0, 0x12266e], [0.3, 0x25479c], [0.55, 0x3f6cc4], [0.8, 0x6f9ce0], [1, 0xa8c8f0]],
      storms: [{ lat: -0.4, lon: 4.2, w: 0.24, h: 0.1, color: 0x0a1428, strength: 0.7 }]
    },
    moons: [
      { id: 'triton', name: '海卫一', en: 'TRITON', radius: 0.82, dist: 8.6, period: -28, incl: 23,
        desc: '逆行的 satellites：它曾是柯伊伯带的居民。',
        detail: '它绕海王星公转的方向与海王星自转相反，说明它不是在这里形成，而是被引力捕获的柯伊伯带天体。表面有活跃的氮气间歇泉，能在高空形成黑色的羽流羽冠。',
        real: { '直径': '2,707 km', '距海王星': '354,759 km', '公转周期': '5.88 天（逆行）', '表面温度': '-235 ℃' },
        icy: { seed: 86, freq: 2.4, crack: 0.5, crackColor: 0xd8b8a0,
          stops: [[0, 0xb8a094], [0.35, 0xdcc4b4], [0.65, 0xf0dcc8], [1, 0xfdf2e6]] } }
    ]
  },
  {
    id: 'pluto', name: '冥王星', en: 'PLUTO', tag: '矮行星 · IX', type: 'rocky',
    radius: 1.25, orbit: 432, incl: 17.16, tilt: 122.5, ecc: 0.25,
    orbital: 300, rotation: 26,
    desc: '被开除出九大行星行列，却依然在这里等着你。',
    detail: '1930 年被发现时被认为是行星，2006 年被重新归类为矮行星。新视野号 2015 年飞掠时发现，它的斯普特尼克平原是一片巨大的氮冰冰川，还拥有蓝色雾霭的大气层——一颗比想象中复杂得多的世界。',
    real: {
      '赤道直径': '2,377 km',
      '距太阳': '39.48 AU（59 亿 km）',
      '公转周期': '248 年',
      '自转周期': '6.39 天',
      '表面温度': '-229 ℃',
      '卫星数': '5 颗'
    },
    texture: {
      seed: 99, freq: 2.8, oct: 6, contrast: 1.4, polar: 0xe8d8c0, polarSize: 0.1,
      stops: [[0, 0x3a3028], [0.3, 0x6b5a48], [0.55, 0x9a866c], [0.8, 0xc2ac90], [1, 0xe4d4b8]],
      craters: { count: 40, min: 0.05, max: 0.22, depth: 0.35 }
    },
    moons: [
      { id: 'charon', name: '冥卫一', en: 'CHARON', radius: 0.6, dist: 4.6, period: 20, incl: 0.001,
        desc: '大到让系统质心落在两者之外的卫星。',
        detail: '它直径达冥王星的一半以上，两者互相潮汐锁定，如同在太空中共享一支舞。它的北极覆盖着红色的托林有机沉积物——来自冥王星逃逸大气的化学沉降。',
        real: { '直径': '1,212 km', '距冥王星': '19,591 km', '公转周期': '6.39 天' },
        texture: { seed: 98, freq: 3.2, oct: 5, contrast: 1.25, polar: 0xc8a090, polarSize: 0.12,
          stops: [[0, 0x3a3430], [0.4, 0x6e665f], [0.7, 0x9a9188], [1, 0xc4bbb0]],
          craters: { count: 50, min: 0.04, max: 0.2, depth: 0.4 } } }
    ]
  }
];

/** 小行星带 / 陨石群配置 */
export const BELTS = [
  { id: 'main-belt', name: '主小行星带', count: 2600, innerRadius: 140, outerRadius: 165, thickness: 4.2,
    sizeMin: 0.05, sizeMax: 0.42, ecc: 1.0, color: 0x6d6157, seed: 401 },
  { id: 'kuiper', name: '柯伊伯带', count: 1400, innerRadius: 452, outerRadius: 560, thickness: 14,
    sizeMin: 0.06, sizeMax: 0.65, ecc: 1.0, color: 0x6a7a86, seed: 402 },
  { id: 'trojan', name: '特洛伊群', count: 260, innerRadius: 240, outerRadius: 275, thickness: 6,
    sizeMin: 0.04, sizeMax: 0.22, ecc: 1.0, color: 0x7a6a55, seed: 403 }
];

/** 彗星 */
export const COMETS = [
  { id: 'comet-a', name: '长周期彗星', radius: 0.55, perihelion: 26, aphelion: 340, incl: 62, period: 190, seed: 501, color: 0x9fd8ff, tailLength: 26, offset: 0.0 },
  { id: 'comet-b', name: '短周期彗星', radius: 0.4, perihelion: 48, aphelion: 200, incl: -38, period: 120, seed: 502, color: 0xc8e0ff, tailLength: 18, offset: 0.5 }
];

/* ============================================================
 *  行星地表参数表
 *  ready: true  -> 已经做了完整地表场景，可以登陆
 *  ready: false -> 占位，UI 上显示"筹备中"
 *
 *  场景尺度说明：1 单位 = 1 米。地形 300×300，可行走半径 58 米，
 *  眼高 1.72 米，重力与跳跃初速按各行星真实的 g 换算。
 * ========================================================== */
export const SURFACES = {

  /* ---------------- 火星：完整样板 ---------------- */
  mars: {
    id: 'mars', name: '火星', en: 'MARS', ready: true, seed: 4404,
    intro: '盖尔撞击坑西缘 · Murray 组分层沉积岩壁 · 黄昏前 40 分钟',
    brief: '你脚下不是随便捏的地形——是好奇号探测器实测的 HiRISE 高程数据，300×300 米真实的分层岩壁。气压只有地球的 0.6%，但你仍能听见风——因为这里的风是靠沙粒敲打头盔传进来的。地表全是氧化铁，说白了，你脚下踩的是一整颗星球的铁锈。',
    size: 300, playRadius: 58, gravity: -3.72, jump: 3.9, eye: 1.72,

    relief: {
      amp: 7.5, freq: 0.0115, basin: 8.0, rim: 0.034, rimCap: 24,
      ridge: { amp: 3.2, freq: 0.023 },
      dune: { amp: 1.05, freq: 0.085, warp: 6.2 },
      detail: { amp: 0.6, freq: 0.17 }
    },
    ground: {
      /* ★ 参考图（毅力号/好奇号地表全景）的地面不是"暗红铁锈"，
         而是灰棕-沙橙的干裂泥地：暗部 5a3d2a（阴影里的湿沙），
         亮部 dfc094（向阳的细沙）。整体比旧版（4a2011→e3ac83）
         更浅、更偏黄，红度降低。 */
      stops: [
        [0, 0x5a3d2a], [0.22, 0x77503a], [0.45, 0x966646],
        [0.68, 0xb2834f], [0.86, 0xc79c6a], [1, 0xd2ab74]
      ],
      rock: 0x6b5140, rough: 0.96, metal: 0.02
    },
    // normalStrength / normalScale 控制地表法线贴图的凹凸强度；
    // 调高会让碎石颗粒更明显，过高则像砂纸（经验上限 ~1.6）
    detailRepeat: 36, crackle: 0.34, bumpScale: 0.35,
    normalStrength: 1.5, normalScale: 1.0,

    /* ★ 天空：参考图里火星的天空是**浅黄褐色的雾霾**（但terscotch），
       整个天穹都比较亮——尘埃把阳光散射得到处都是，天顶也暗不下去，
       而且白天基本看不见星星。旧版 zenith 0x180a16（近黑）是地球思路，
       直接照搬会一眼假。 */
    sky: {
      horizon: 0xdfc09a, mid: 0xcaa173, zenith: 0x9d6f47,
      sunDir: [0.86, 0.34, -0.45],
      sunColor: 0xffe3b0, glow: 1.0, sharp: 40,
      haze: 0.80, hazeColor: 0xd8b58c,
      diskColor: 0xfff6e6, diskPower: 2.0, glowColor: 0xffd9a0
    },
    /* 尘埃削弱直射光、但大幅增强天空漫射。曝光实测过一版：
       hemi 1.55 + ambient 0.42 会让近景沙地泛白（参考图的地面
       明度更低），回调到 1.25 / 0.34。 */
    light: {
      sun: 0xffcf96, intensity: 2.3,
      hemiSky: 0xd9b48c, hemiGround: 0x7a4a30, hemi: 1.25,
      ambientColor: 0x8a6040, ambient: 0.34
    },
    // groundHeight 是贴地雾层的厚度（米），groundOpacity 是浓度。
    // ★ 雾密度实测校准：0.0115 时 118m 外的台地被雾洗白 74%（exp 衰减），
    //   剪影全变成奶油色剪纸；0.0075 时保留 ~41% 自身颜色，和参考图
    //   "霾里看得见橙棕色台地"一致。雾色也从奶油色加深到饱和沙橙。
    fog: { color: 0xbd8a5c, density: 0.0075,
      groundColor: 0xb98d60, groundHeight: 18.0, groundOpacity: 0.24 },

    /* 白天星空几乎不可见（尘霾散射压过星光），只留极少数最亮的 */
    stars: { dim: 320, bright: 42, tilt: 0.42, spin: 0.032 },
    /* ★ 黑色火山岩：参考图（尤其 Jezero 全景）里散布着大量深灰黑色
       的块状玄武岩，与橙色沙地形成强对比——这是火星地表最有辨识度
       的一笔。旧版 0x6b3a26（棕）看起来像"土坷垃"，必须改成近黑。 */
    rocks: { count: 260, min: 0.18, max: 2.2, color: 0x3d3833, rough: 0.90 },
    /* ★ 平顶台地（mesa）：参考图远处的标准地貌——陡壁、平顶、
       底部风蚀裙。必须放到环形山脊（rimStart=66 起隆）**以外**，
       否则半埋进山脊里穿帮；宽度上限也压小，太宽近看就是一堵方墙。 */
    silhouettes: {
      count: 40, rMin: 118, rMax: 185, wMin: 12, wMax: 38, hMin: 8, hMax: 26,
      color: 0x7a4a34, shape: 'mesa'
    },
    dust: {
      count: 1300, color: 0xe0b488, size: 0.3, opacity: 0.55,
      box: 70, height: 16, wind: [2.6, 0.15, 0.9]
    },
    devils: {
      count: 2, particles: 420, radius: 4.2, height: 26,
      size: 0.55, opacity: 0.42, color: 0xd8a878, dist: 46
    },
    skyMoons: [
      { name: '火卫一 PHOBOS', size: 3.4, dist: 700, az: 1.1, alt: 0.95, color: 0x6a5f56 },
      { name: '火卫二 DEIMOS', size: 2.0, dist: 760, az: -2.2, alt: 1.32, color: 0x6f675d }
    ],
    lander: { x: -7.5, z: 5.0, ry: 0.72 },
    spawnZ: 7,
    // 出生朝向：让太阳落在画面右缘约 37 度的位置 —— 顺光看不清地貌，
    // 全逆光又黑成一团，斜侧光既能看见太阳又能看清沙丘的起伏
    spawnYaw: -0.44
  },

  /* ---------------- 以下为占位：只登记意向，尚未建场地表 ---------------- */
  mercury: { id: 'mercury', name: '水星', ready: false, note: '玄武岩陨坑 · 近黑天幕 · 无风（真空）' },
  venus: { id: 'venus', name: '金星', ready: false, note: '硫磺岩层 · 橙红浓雾 · 低频雷鸣' },
  earth: { id: 'earth', name: '地球', ready: false, note: '海岸礁岩 · 蓝天薄云 · 入夜银河流星' },
  jupiter: { id: 'jupiter', name: '木星', ready: false, note: '氨冰云海观景平台 · 大红斑 · 层积闪电' },
  saturn: { id: 'saturn', name: '土星', ready: false, note: '云海平台 · 环带横贯天际 · 冰晶飘落' },
  uranus: { id: 'uranus', name: '天王星', ready: false, note: '甲烷冰原 · 钻石雨 · 侧躺的极昼' },
  neptune: { id: 'neptune', name: '海王星', ready: false, note: '深蓝冰原 · 超音速风的呼啸' },
  pluto: { id: 'pluto', name: '冥王星', ready: false, note: '氮冰平原 · 斯普特尼克裂纹 · 背光光晕' }
};

/** 哪些星球已经开放登陆 */
export const LANDABLE = Object.keys(SURFACES).filter((k) => SURFACES[k].ready);
