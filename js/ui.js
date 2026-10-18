/**
 * ui.js — 界面层
 * 加载舱 / 航图目录 / 天体档案 / 屏幕标签投影 / HUD 读数 / 环境音
 */
import * as THREE from 'three';
import { SUN } from './data.js';
import { createMusic } from './music.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/** 与 main.js 里 isTouch 同源判定；这里独立算一次，免得为了一个布尔值引依赖 */
const isTouchDevice = () =>
  (navigator.maxTouchPoints || 0) > 0 &&
  (window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches);

/* 主色：从贴图的色带里取中间色，保证目录小圆点和 3D 里的星球是同一个调子 */
function pickColor(body) {
  if (body.kind === 'sun') return 0xffb45c;
  const d = body.data;
  if (d.id === 'earth') return 0x3d7fc4;
  const stops = (d.texture && d.texture.stops) || (d.icy && d.icy.stops);
  if (!stops) return 0x8899aa;
  return stops[Math.floor(stops.length * 0.62)] ? stops[Math.floor(stops.length * 0.62)][1] : stops[0][1];
}
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

function discStyle(color) {
  return `radial-gradient(circle at 32% 30%, ${hex(color)} 0%, ${shade(color, -0.35)} 62%, ${shade(color, -0.72)} 100%)`;
}
function shade(c, k) {
  let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = 1 + k;
  r = Math.round(Math.min(255, r * f)); g = Math.round(Math.min(255, g * f)); b = Math.round(Math.min(255, b * f));
  return `rgb(${r},${g},${b})`;
}

export function createUI({ entries, handlers }) {
  const dom = {
    manifest: $('#manifest'), pct: $('#mf-pct'), ring: $('#mf-ring-progress'),
    status: $('#mf-status'), launch: $('#mf-launch'), hint: $('#mf-hint'),
    hud: $('#hud'), labels: $('#labels'),
    cat: $('#cat-main'),
    /* 移动端航图 */
    mcat: $('#mobile-cat'), mcatMain: $('#mcat-main'), mcatScroll: $('#mcat-scroll'),
    mcatSheet: $('#mcat-sheet'), mcatAll: $('#mcat-all'), mcatClose: $('#mcat-close'),
    inspEmpty: $('#insp-empty'), inspContent: $('#insp-content'),
    inspDisc: $('#insp-disc'), inspTag: $('#insp-tag'), inspName: $('#insp-name'),
    inspEn: $('#insp-en'), inspDesc: $('#insp-desc'), inspDetail: $('#insp-detail'),
    inspStats: $('#insp-stats'), inspMoons: $('#insp-moons'),
    roScale: $('#ro-scale'), roSpeed: $('#ro-speed'), roTime: $('#ro-time'), roFps: $('#ro-fps'),
    focusTag: $('#focus-tag'), focusName: $('#focus-name'), focusDist: $('#focus-dist'),
    crosshair: $('#crosshair'), toast: $('#toast'),
    help: $('#help'),
    land: $('#btn-land'),
    sfHud: $('#surface-hud'), sfName: $('#sf-name'), sfLoc: $('#sf-loc'), sfBrief: $('#sf-brief')
  };

  let selected = null;
  const labelPool = new Map();

  /* ---------------- 加载舱 ---------------- */
  const RING = 2 * Math.PI * 98;
  dom.ring.style.strokeDasharray = RING;
  dom.ring.style.strokeDashoffset = RING;

  function setProgress(p, msg) {
    const pp = Math.max(0, Math.min(100, p));
    dom.pct.textContent = Math.round(pp) + '%';
    dom.ring.style.strokeDashoffset = RING * (1 - pp / 100);
    if (msg) dom.status.textContent = msg;
  }
  /* 署名字样"自动收缩"兜底。
     这句话要求一行放下（折行会把末尾几个字甩到第二行，很难看），
     但各机型宽度差很多，纯靠 CSS 字号适配不一定够。
     这里量一次真实文本宽度：只要超出可用宽度，就按比例把字号降下来，
     下限 14px —— 再小就失去"显眼"的意义了，宁可让它折行。
     旋转屏幕后会重新量一遍。 */
  function fitOwner() {
    const el = document.querySelector('.mf-owner');
    if (!el) return;
    const inner = el.firstChild;                    // 只包含文本的那个节点
    if (!inner) return;
    const box = el.parentElement;
    if (!box) return;

    el.style.fontSize = '';                         // 先回到 CSS 定的值

    /* 可用宽度 = 容器宽 - 两侧引线 - 间距。
       引线是 flex 子项，直接量它们的实际宽度比写死数值可靠。 */
    const cs = getComputedStyle(el);
    const gap = parseFloat(cs.columnGap || cs.gap) || 0;
    const wBefore = parseFloat(getComputedStyle(el, '::before').width) || 0;
    const wAfter = parseFloat(getComputedStyle(el, '::after').width) || 0;
    const chrome = wBefore + wAfter + gap * 2;
    const avail = box.clientWidth - chrome;
    if (avail <= 0) return;

    /* Range 能拿到"纯文本"的宽度，不受 flex 拉伸影响 —— 
       直接量 el.scrollWidth 是不对的：flex 元素宽度会被内容撑开，
       看起来"刚好不溢出"，实际上文字已经被挤到边缘或裁掉了。 */
    let textW = 0;
    try {
      const r = document.createRange();
      r.selectNodeContents(inner);
      textW = r.getBoundingClientRect().width;
    } catch (e) {
      textW = el.scrollWidth - chrome;
    }
    if (!textW) return;

    if (textW > avail) {
      const base = parseFloat(getComputedStyle(el).fontSize) || 24;
      const size = Math.max(14, Math.floor(base * (avail / textW) * 100) / 100);
      el.style.fontSize = size + 'px';
    }
  }
  fitOwner();
  /* 字体加载完成后宽度会变，再校一次 */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => fitOwner()).catch(() => {});
  }
  window.addEventListener('resize', fitOwner);
  window.addEventListener('orientationchange', () => setTimeout(fitOwner, 320));
  if (window.screen && screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', () => setTimeout(fitOwner, 320));
  }

  function ready() {
    setProgress(100, '全部星系已就绪');
    dom.launch.classList.remove('hidden');
    dom.hint.classList.remove('hidden');
    dom.status.textContent = '全部星系已就绪';
    // 触屏设备的提示语要换：手机上没有耳机之外的"全屏浏览"选项，
    // 而且横竖屏切换本身就会全屏
    if (isTouchDevice()) {
      dom.hint.textContent = '建议横屏观看 · 双指可缩放空间';
    }
  }
  function enterScene() {
    dom.manifest.classList.add('gone');
    dom.hud.classList.remove('hidden');
    setTimeout(() => { dom.manifest.style.display = 'none'; }, 1100);
  }
  dom.launch.addEventListener('click', () => {
    enterScene();
    handlers.onLaunch && handlers.onLaunch();
    startMusic();
  });

  /* ---------------- 航图目录 ---------------- */
  /* 花名册内容生成：桌面端左侧面板和移动端抽屉共用这一份，
     免得两处各写一遍、改了一处忘了另一处。 */
  function fillCatalog(container) {
    container.innerHTML = '';
    const sunEntry = entries.find((e) => e.kind === 'sun');
    if (sunEntry) {
      container.appendChild(catItem(sunEntry, makeDot(sunEntry), '0.00 AU'));
    }
    const label = document.createElement('div');
    label.className = 'panel-title';
    label.style.cssText = 'margin:10px 6px 6px;font-size:9px;letter-spacing:.24em;color:var(--ink-faint)';
    label.textContent = 'PLANETS 01—09';
    container.appendChild(label);

    entries.filter((e) => e.kind === 'planet').forEach((e, i) => {
      const wrapper = document.createElement('div');
      wrapper.appendChild(catItem(e, makeDot(e), String(i + 1).padStart(2, '0')));
      if (e.moons && e.moons.length) {
        const mlist = document.createElement('div');
        mlist.className = 'cat-moons';
        e.moons.forEach((m) => {
          const mi = document.createElement('div');
          mi.className = 'cat-moon';
          mi.dataset.moon = m.id;
          mi.appendChild(makeDot({ data: m.data, kind: 'moon' }, 8));
          const nm = document.createElement('span');
          nm.className = 'cat-name';
          nm.textContent = m.data.name;
          mi.appendChild(nm);
          mi.addEventListener('click', (ev) => {
            ev.stopPropagation();
            select(moonEntry(m));
          });
          mlist.appendChild(mi);
        });
        wrapper.appendChild(mlist);
      }
      container.appendChild(wrapper);
    });
  }

  function buildCatalog() {
    fillCatalog(dom.cat);
    if (dom.mcatMain) fillCatalog(dom.mcatMain);
  }

  /* ---------------- 移动端航图快选带 ----------------
     底部一条横向滚动的行星快捷条：点一下 = 选中 + 飞过去。
     桌面那块面板在手机上被隐藏了，这条带子就是手机用户"手动选行星"的入口。 */
  function buildStrip() {
    if (!dom.mcatScroll) return;
    dom.mcatScroll.innerHTML = '';
    // 太阳排最前，然后按 1—9 顺序
    const sun = entries.find((e) => e.kind === 'sun');
    const list = (sun ? [sun] : []).concat(entries.filter((e) => e.kind === 'planet'));
    list.forEach((e) => {
      const chip = document.createElement('div');
      chip.className = 'mcat-chip' + (e.kind === 'sun' ? ' sun' : '');
      chip.dataset.id = e.id;
      const i = document.createElement('i');
      i.style.background = discStyle(pickColor(e));
      chip.appendChild(i);
      chip.appendChild(document.createTextNode(e.name));
      chip.addEventListener('click', () => {
        select(e);
        // 手机上"选中"之后就顺手飞过去，少一步操作
        handlers.onGoto && handlers.onGoto(e);
      });
      dom.mcatScroll.appendChild(chip);
    });
  }

  function highlightStrip(id) {
    if (!dom.mcatScroll) return;
    dom.mcatScroll.querySelectorAll('.mcat-chip').forEach((n) => {
      n.classList.toggle('active', n.dataset.id === id);
    });
  }

  /* 行内高亮的两个目录都要照顾到 */
  function highlightAll(id) {
    $$('.cat-item, .cat-moon, .mcat-chip').forEach((n) =>
      n.classList.toggle('active', n.dataset.id === id || n.dataset.moon === id));
  }

  function makeDot(e, size) {
    const dot = document.createElement('div');
    dot.className = 'cat-dot';
    const c = pickColor(e);
    dot.style.background = discStyle(c);
    if (size === 8) { dot.style.width = '8px'; dot.style.height = '8px'; }
    return dot;
  }

  function catItem(e, dot, badge) {
    const it = document.createElement('div');
    it.className = 'cat-item';
    it.dataset.id = e.id;
    it.appendChild(dot);
    const nm = document.createElement('span');
    nm.className = 'cat-name';
    nm.textContent = e.name;
    it.appendChild(nm);
    const sub = document.createElement('span');
    sub.className = 'cat-sub';
    sub.textContent = badge;
    it.appendChild(sub);
    it.addEventListener('click', () => select(e));
    return it;
  }

  function moonEntry(m) {
    return {
      id: m.id, kind: 'moon', name: m.data.name, en: m.data.en,
      data: m.data, _moon: m, moons: [],
      holder: m.pos, radius: m.data.radius,
      parent: entries.find((x) => x.moons && x.moons.includes(m))
    };
  }

  /* ---------------- 天体档案 ---------------- */
  function select(e) {
    if (selected && selected.id === e.id) return;
    selected = e;
    highlightAll(e.id);
    dom.inspEmpty.classList.add('hidden');
    dom.inspContent.classList.remove('hidden');
    // 手机上档案是底部抽屉：一旦有内容就掀起来（详见 CSS 里 #inspector.empty 的说明）
    const insp = $('#inspector');
    if (insp) insp.classList.remove('empty');
    // 手机端还有一个「航图花名册」抽屉，它和档案抽屉都占下半屏，
    // 两个一起开着会叠在一起。既然选中天体的目的就是看档案，这里直接把花名册收掉。
    if (dom.mcatSheet) dom.mcatSheet.classList.add('hidden');

    const d = e.data;
    const c = pickColor(e);
    dom.inspDisc.style.background = discStyle(c);
    if (e.kind === 'moon' && e.parent && e.parent.data.ring) {
      dom.inspDisc.style.boxShadow = `inset -10px -6px 18px rgba(0,0,0,.6), 0 0 22px rgba(255,255,255,.08)`;
    }
    dom.inspTag.textContent = d.tag || (e.kind === 'moon' ? '天然卫星' : '恒星');
    dom.inspName.textContent = d.name;
    dom.inspEn.textContent = d.en;
    dom.inspDesc.textContent = d.desc || '';
    dom.inspDetail.textContent = d.detail || '';

    dom.inspStats.innerHTML = '';
    const stats = d.real || {};
    Object.keys(stats).forEach((k) => {
      const row = document.createElement('div');
      row.className = 'st';
      const kv = document.createElement('span'); kv.className = 'st-k'; kv.textContent = k;
      const vv = document.createElement('span'); vv.className = 'st-v'; vv.textContent = stats[k];
      row.appendChild(kv); row.appendChild(vv);
      dom.inspStats.appendChild(row);
    });

    dom.inspMoons.innerHTML = '';
    if (e.kind === 'planet' && e.moons && e.moons.length) {
      const t = document.createElement('div');
      t.style.cssText = 'width:100%;font-family:var(--mono);font-size:9px;letter-spacing:.2em;color:var(--ink-faint);margin:2px 0 4px';
      t.textContent = `卫星系统 · ${e.moons.length}`;
      dom.inspMoons.appendChild(t);
      e.moons.forEach((m) => {
        const chip = document.createElement('div');
        chip.className = 'mchip';
        const i = document.createElement('i');
        i.style.background = discStyle(pickColor({ data: m.data, kind: 'moon' }));
        chip.appendChild(i);
        chip.appendChild(document.createTextNode(m.data.name));
        chip.addEventListener('click', () => select(moonEntry(m)));
        dom.inspMoons.appendChild(chip);
      });
    }

    handlers.onSelect && handlers.onSelect(e);

    // 登陆地表按钮：只有已经做好地表场景的星球才可点
    updateLandButton(e);
  }

  function updateLandButton(e) {
    const b = dom.land;
    if (!b) return;
    // strict=true 才代表"这块地表真的建好了"；卫星一律不开放
    const ready = !!(handlers.canLand && e && e.kind !== 'moon' && handlers.canLand(e.id, true));
    if (!ready) {
      b.textContent = '筹备中';
      b.classList.add('off');
      b.disabled = true;
      b.title = (e && e.kind === 'moon') ? '卫星地表暂不开放' : '该星球的地表场景尚未建成';
    } else {
      b.textContent = '登陆地表';
      b.classList.remove('off');
      b.disabled = false;
      b.title = `降落到${e.name}地表，第一人称行走`;
    }
  }

  $('#btn-follow').addEventListener('click', () => { selected && handlers.onFollow && handlers.onFollow(selected); });
  $('#btn-goto').addEventListener('click', () => { selected && handlers.onGoto && handlers.onGoto(selected); });
  $('#btn-land').addEventListener('click', () => {
    if (!selected || selected.kind === 'moon') return;
    handlers.onLand && handlers.onLand(selected);
  });
  $('#sf-exit').addEventListener('click', () => { handlers.onReturn && handlers.onReturn(); });

  /** 进入 / 退出地表：切换 HUD 与 body 类名 */
  function setSurfaceMode(on, cfg) {
    document.body.classList.toggle('on-surface', !!on);
    if (!dom.sfHud) return;
    if (!on) { dom.sfHud.classList.add('hidden'); return; }
    dom.sfHud.classList.remove('hidden');
    if (cfg) {
      dom.sfName.textContent = cfg.en || cfg.name || '';
      dom.sfLoc.textContent = cfg.intro || '';
      dom.sfBrief.textContent = cfg.brief || '';
    }
  }

  /** 把「驾驶手册」换成触屏版。文案与桌面版一一对应，只是换掉了输入方式 */
  function rewriteHelpForTouch() {
    const cols = dom.help.querySelectorAll('.ov-col');
    if (cols.length < 4) return;
    const fill = (col, title, items) => {
      col.querySelector('h4').textContent = title;
      col.querySelector('ul').innerHTML = items.map((s) => `<li>${s}</li>`).join('');
    };
    fill(cols[0], '移动', [
      '<b>左摇杆</b> 前后左右移动',
      '<b>跳跃键</b> 起跳（重力按各星球设定）',
      '<b>奔跑键</b> 点一下切换加速',
    ]);
    fill(cols[1], '视角', [
      '<b>拖动画面</b> 转动视角',
      '<b>双指捏合</b> 缩放整个太阳系空间',
      '<b>点击天体</b> 选中并查看档案',
    ]);
    fill(cols[2], '导航', [
      '<b>左侧航图</b> 点开可跳转九大行星',
      '<b>底部档案抽屉</b> 上滑查看天体资料',
      '<b>登陆地表</b> 降落到星球表面',
      '<b>返航按钮</b> 回到轨道视角',
    ]);
    fill(cols[3], '说明', [
      '距离与半径经过<b>艺术化压缩</b>，目的是看得见、看得爽',
      '右侧档案里的天文数据才是<b>真实值</b>',
      '建议<b>横屏</b>游玩，视野更开阔',
      '手机性能有限，卡顿时可在控制台<b>降低画质</b>',
    ]);
  }

  /* ---------------- HUD 读数 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2400);
  }
  function updateReadouts({ scale, speed, timeMul, fps }) {
    dom.roScale.textContent = scale.toFixed(2) + '×';
    dom.roSpeed.textContent = speed.toFixed(1) + ' u/s';
    dom.roTime.textContent = timeMul.toFixed(1) + '×';
    dom.roFps.textContent = fps;
  }
  function setFocus(name, dist) {
    if (!name) { dom.focusTag.classList.add('hidden'); dom.crosshair.classList.remove('hot'); return; }
    dom.focusTag.classList.remove('hidden');
    dom.focusName.textContent = name;
    dom.focusDist.textContent = dist;
    dom.crosshair.classList.add('hot');
  }

  /* ---------------- 屏幕标签 ---------------- */
  function ensureLabel(id, en, cn) {
    let el = labelPool.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'lbl';
      el.innerHTML = `<span>${en}</span><span class="lbl-cn">${cn}</span><span class="lbl-dist"></span>`;
      dom.labels.appendChild(el);
      labelPool.set(id, el);
    }
    return el;
  }
  const _v = new THREE.Vector3();
  function updateLabels(_projector, camera, list, visible) {
    if (!visible) {
      labelPool.forEach((el) => (el.style.display = 'none'));
      return;
    }
    // 手机上标签内容更长（英文+中文+距离），贴到右边缘会被切掉半边。
    // 按视口宽度算一个安全边距，而不是写死数字。
    const vw = window.innerWidth, vh = window.innerHeight;
    const narrow = vw < 720;
    const clampRight = narrow ? 74 : 92;
    const taken = [];
    // 远小近大：先算出屏幕位置，再决定要不要显示（避免标签糊成一片）
    const items = [];
    for (const it of list) {
      const p = it.pos;
      const dist = p.distanceTo(camera.position);
      _v.x = p.x; _v.y = p.y; _v.z = p.z;
      _v.project(camera);
      if (_v.z > 1 || _v.z < -1) { items.push(null); continue; }
      const sx = (_v.x * 0.5 + 0.5) * vw;
      const sy = (-_v.y * 0.5 + 0.5) * vh;
      if (sx < -40 || sx > vw + 40 || sy < -60 || sy > vh + 60) { items.push(null); continue; }
      items.push({ sx, sy, dist, it });
    }
    items.forEach((o, i) => {
      const it = list[i];
      const el = ensureLabel(it.id, it.en, it.cn);
      if (!o) { el.style.display = 'none'; return; }
      // 简易防重叠：同屏幕区域只留最近的一个（窄屏阈值收窄，否则会被挡掉一大片）
      const dx = narrow ? 76 : 92, dy = narrow ? 13 : 15;
      let blocked = false;
      for (const t of taken) {
        if (Math.abs(t.sx - o.sx) < dx && Math.abs(t.sy - o.sy) < dy) { blocked = true; break; }
      }
      if (blocked) { el.style.display = 'none'; return; }
      taken.push(o);
      el.style.display = 'flex';
      // 标签的定位点是圆的圆心，文字往右铺 —— 所以右边要留出 clampRight 的余量
      el.style.left = Math.max(Math.min(o.sx, vw - clampRight), 30) + 'px';
      el.style.top = (o.sy - Math.max(10, Math.min(34, 900 / Math.max(o.dist, 1)))) + 'px';
      const far = o.dist > 900;
      el.className = 'lbl' + (far ? ' dim' : '');
      const dEl = el.querySelector('.lbl-dist');
      if (dEl) dEl.textContent = Math.round(o.dist) + 'u';
    });
  }

  /* ---------------- 面板折叠 ---------------- */
  $$('.collapse').forEach((b) => {
    b.addEventListener('click', () => {
      const p = document.getElementById(b.dataset.target);
      // 手机上的空抽屉：先让"展开"优先于"折叠"，否则点一下反而是把空条也收掉
      if (p.classList.contains('empty')) {
        p.classList.remove('empty');
        b.textContent = '–';
        return;
      }
      p.classList.toggle('collapsed');
      b.textContent = p.classList.contains('collapsed') ? '+' : '–';
    });
  });

  /* ---------------- 帮助 ---------------- */
  // 触屏设备的操作说明与键鼠完全不同，硬套桌面文案会让人一脸问号
  if (isTouchDevice()) rewriteHelpForTouch();
  $('#btn-help').addEventListener('click', () => dom.help.classList.remove('hidden'));
  $('#help-close').addEventListener('click', () => dom.help.classList.add('hidden'));
  dom.help.addEventListener('click', (e) => { if (e.target === dom.help) dom.help.classList.add('hidden'); });

  /* ---------------- 背景音乐 ----------------
     一首现场合成的史诗纯音乐，循环播放（详见 music.js 顶部的说明）。
     这里只管一个"开 / 关"按钮 —— 曲目选择面板已经按需求去掉了，
     不给用户切曲，锁死这一首。 */
  let music = null, audioOn = false;
  function ensureMusic() {
    if (!music) music = createMusic();
    return music;
  }
  function startMusic() {
    const m = ensureMusic();
    m.start();
    audioOn = true;
    syncMusicUI();
  }
  function setMusicOn(v) {
    if (!music) { if (v) startMusic(); return; }
    music.setOn(v);
    audioOn = v;
    syncMusicUI();
  }
  function syncMusicUI() {
    const b = $('#btn-mute');
    if (!b) return;
    b.classList.toggle('on', audioOn);
    b.title = audioOn ? '背景音乐：播放中（点击静音）' : '背景音乐：已静音（点击播放）';
    // 手机端按钮会换一套文案/图标，跟着状态一起更新
    const t = b.querySelector('.tbtn-txt');
    if (t) t.textContent = audioOn ? ' 音乐' : ' 静音';
  }

  (function initMusicUI() {
    const btn = $('#btn-mute');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // 一个按钮搞定开关：开着就关，关着就开
      if (audioOn) setMusicOn(false);
      else startMusic();
    });
    syncMusicUI();
  })();

  /* 移动端音频保活三件套 ------------------------------------------------
     手机浏览器（iOS Safari / 微信内置 / 部分安卓）会主动挂起 AudioContext：
       ① 切到后台或锁屏          ② 来电/闹钟打断
       ③ 页面从 bfcache 恢复（返回上一页）
     光监听 visibilitychange 不够，必须把 music.revive() 接上，
     它会把 ctx 唤醒并把"排期"重新接回去（否则回来就没声了）。 */
  function musicKeepAlive() {
    if (!music || !audioOn) return;
    try { music.revive(); } catch (e) { /* 忽略：下次用户交互会再试 */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) musicKeepAlive();
  });
  // bfcache：从别的页面返回本页时，AudioContext 常是 suspended
  window.addEventListener('pageshow', (e) => {
    if (e && e.persisted) musicKeepAlive();
    else musicKeepAlive();
  });
  // 部分安卓 WebView 需要一次真实触摸才能唤醒；顺手兜一手
  window.addEventListener('touchend', () => {
    if (audioOn && music && music.state() !== 'running') musicKeepAlive();
  }, { passive: true });

  /* 导出给测试用 */
  window.__audio = {
    isOn: () => audioOn,
    master: () => (music ? music.level() : -1),
    target: () => 0.85,
    state: () => (music ? music.state() : 'none'),
    bar: () => (music ? music.bar() : -1),
    bpm: () => (music ? music.bpm() : 0),
    start: () => startMusic(),
    toggle: (v) => setMusicOn(v)
  };

  /* ---------------- 移动端航图：开合逻辑 ---------------- */
  if (dom.mcatAll && dom.mcatSheet) {
    dom.mcatAll.addEventListener('click', () => dom.mcatSheet.classList.remove('hidden'));
  }
  if (dom.mcatClose && dom.mcatSheet) {
    dom.mcatClose.addEventListener('click', () => dom.mcatSheet.classList.add('hidden'));
  }
  /* 点花名册的空白处也关掉（但别误伤行本身的点击） */
  if (dom.mcatSheet) {
    dom.mcatSheet.addEventListener('click', (e) => {
      if (e.target === dom.mcatSheet) dom.mcatSheet.classList.add('hidden');
    });
  }
  /* 手机上一旦选中天体，就把花名册收起来，让位给底部档案抽屉 */
  const _hideSheet = () => { if (dom.mcatSheet) dom.mcatSheet.classList.add('hidden'); };

  /* ---------------- 导出 ---------------- */
  buildCatalog();
  buildStrip();
  // 开局没有任何选中目标：手机上的抽屉先压成一条，别白占半屏
  const _insp = $('#inspector');
  if (_insp) _insp.classList.add('empty');

  return {
    setProgress, ready, toast, select, updateReadouts, setFocus, updateLabels,
    setSurfaceMode,
    get selected() { return selected; },
    highlight: highlightAll,
    hideMobileSheet: _hideSheet,
    openMobileSheet() { if (dom.mcatSheet) dom.mcatSheet.classList.remove('hidden'); },
    selectById(id) {
      const e = entries.find((x) => x.id === id);
      if (e) select(e);
    },
    selectMoon(m) { select(moonEntry(m)); },
    moonEntry,
    isAudioReady: () => !!audio
  };
}
