/**
 * controls.js — 星际飞行控制
 * FREE   自由飞行：WASD 前后左右 / QE 升降 / Shift 加速 / 鼠标转向 / 滚轮缩放整个空间
 * FOLLOW 天体跟随：鼠标拖拽环绕目标天体，滚轮调整距离
 * TRANSIT 过场巡飞：在两者之间做平滑插值（慢入慢出）
 * WALK   地表行走：站在行星地面上，WASD 走动 / 空格跳跃 / 简易重力 / 贴地
 */
import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const damp = (a, b, l, dt) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-l * dt));

export function createFlightControls(camera, dom, opts = {}) {
  const {
    getWorldScale = () => 1,
    setWorldScale = () => { },
    onModeChange = () => { },
    onLockChange = () => { }
  } = opts;

  const state = {
    mode: 'free',                    // free | follow | transit
    yaw: 0, pitch: 0,
    vel: new THREE.Vector3(),
    wanted: new THREE.Vector3(),
    boost: 1,
    baseSpeed: 26,
    idleTime: 0,
    autoCruise: true,
    follow: null,                    // { body, offset:Vector3 }
    transit: null,
    shake: 0,
    roll: 0,
    walk: null                       // 地表模式时才有值，见 enterWalk()
  };

  const keys = Object.create(null);
  let dragging = false;
  let pointerLocked = false;
  let enabled = true;
  const listeners = { wheelScale: [] };

  /**
   * 触屏虚拟输入。
   * moveX / moveZ 是摇杆推杆量，范围 [-1,1]，与键盘 WASD 语义一致：
   *   moveF 前(+)/后(-)、moveS 右(+)/左(-)。
   * 键盘和触屏是"或"的关系 —— 谁给的值大听谁的，这样两种设备混用也不会打架。
   */
  const touch = { active: false, moveF: 0, moveS: 0, run: false, jump: false };

  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  /**
   * 朝向解算的代理相机。
   * 注意：THREE.Object3D.lookAt() 让物体的 +Z 轴指向目标，
   *      而 THREE.Camera 的视觉前向是 -Z，两者差 180°。
   *      所以凡是要给「相机」算朝向，必须用 PerspectiveCamera 当代理，
   *      不能用普通 Object3D，否则目标会被甩到画面背后。
   */
  const lookProxy = new THREE.PerspectiveCamera();

  /** 复用 lookProxy 求出「站在 pos 处看向 target」时应有的四元数 */
  function quaternionTo(pos, target, out) {
    lookProxy.up.copy(camera.up);
    lookProxy.position.copy(pos);
    lookProxy.quaternion.identity();
    lookProxy.lookAt(target.x, target.y, target.z);
    out.copy(lookProxy.quaternion);
    return out;
  }

  /* ---------------- 输入 ---------------- */
  function onKeyDown(e) {
    const k = e.code;
    keys[k] = true;
    if (k === 'Tab') e.preventDefault();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    state.idleTime = 0;
  }
  function onKeyUp(e) { keys[e.code] = false; }

  /* ---- 统一的转向入口：鼠标 / 触屏共用，免得两份灵敏度漂移 ---- */
  function applyLook(dx, dy, touchMode) {
    const sens = touchMode ? 0.0030 : 0.0022;
    if (state.mode === 'follow') {
      rotateFollowOffset(-dx * sens * 1.9, -dy * sens * 1.9);
    } else if (state.mode === 'walk' && state.walk) {
      // 地表第一人称：只有偏航和俯仰，不含翻滚
      state.walk.yaw -= dx * sens;
      state.walk.pitch = clamp(state.walk.pitch - dy * sens, -1.32, 1.32);
    } else if (state.mode === 'free') {
      state.yaw -= dx * sens;
      state.pitch = clamp(state.pitch - dy * sens, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }
    state.idleTime = 0;
  }

  function onMouseDown(e) {
    if (e.button === 0 || e.button === 2) dragging = true;
  }
  function onMouseUp() { dragging = false; }
  function onMouseMove(e) {
    // 触屏上浏览器也会补发 mousemove，会和触摸拖动叠加成双倍转速 —— 拒掉
    if (touch.active) return;
    const active = dragging || pointerLocked;
    if (!active || !enabled) return;
    applyLook(e.movementX || 0, e.movementY || 0, false);
  }
  /**
   * 滚轮 / 捏合统一入口。
   *
   * 这里有个容易踩的设计冲突：跟随某颗天体时，滚轮究竟该干什么？
   *  - 「推开/拉近与行星的距离」（镜头视距）
   *  - 「缩放整个空间」（就是顶栏那个 SCALE 读数）
   * 早先的写法是二选一：跟随时只调视距，空间缩放就再也够不着了。
   * 手机上这个毛病最扎眼 —— 点了一颗行星之后，双指捏合就彻底失效。
   *
   * 现在的规则（两头都顾得上）：
   *  - 默认永远调「空间缩放」，符合"滚轮缩放整个空间"的原意；
   *  - 按住 Shift 时才切到「视距」，并把空间缩放按同一倍率同步过去 ——
   *    这样在跟随时把行星拉近，行星会同时变大，视觉上仍然是"拉近"。
   *
   * @param {number} d     滚轮的正负位移（正 = 缩小）
   * @param {number} factor 直接指定的倍率，给触屏捏合用（1 表示不变）
   */
  function applyZoom(d, factor) {
    if (!enabled) return;
    if (state.mode === 'walk') return;      // 站在地面上时不做任何缩放
    const follow = state.mode === 'follow' && state.follow;
    const orbitZoom = follow && keys['ShiftLeft'];   // 跟随时按 Shift = 调视距

    let mul;
    if (factor !== undefined) mul = factor;
    else mul = Math.pow(1.0014, -d);

    const ns = clamp(getWorldScale() * mul, 0.12, 4.0);
    setWorldScale(ns);
    listeners.wheelScale.forEach((f) => f(ns));

    if (orbitZoom) {
      // 视距跟着一起缩放：拉近时行星变大，退远时变小，观感才对
      const len = state.follow.offset.length();
      const nl = clamp(len * mul, state.follow.minDist, state.follow.maxDist);
      state.follow.offset.multiplyScalar(nl / len);
    }
    state.idleTime = 0;
  }

  function onWheel(e) {
    // 触屏上这个事件可能是程序合成的（双指捏合），此时不能 preventDefault，
    // 否则浏览器会把捏合当成页面缩放给拦下来。
    if (e.cancelable) e.preventDefault();
    applyZoom(e.deltaY);
  }
  function onContext(e) { e.preventDefault(); }
  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === dom;
    onLockChange(pointerLocked);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  dom.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onPointerLockChange);

  /**
   * 触屏事件绑在 window 的捕获阶段，而不是绑在 canvas 上。
   *
   * 为什么非这样不可：HUD / 档案抽屉 / 操控键都是浮在 canvas 之上的层，
   * 手指落在它们上面时事件根本到不了 canvas，视线就转不动了。
   * 而手机上档案抽屉一掀开就占了下面 60% 的屏幕 —— 绑 canvas 的话，
   * 选中一颗行星之后你就再也转不动视角了，这是最要命的那种"手机上没法用"。
   *
   * 所以：捕获阶段先拿事件（此时 target 还是真实元素），
   * 只把「真正可点的控件」排除在外，其余区域一律可以拖动转视角。
   */
  let tId = null, tX = 0, tY = 0, tMoved = 0;
  /**
   * 哪些地方的手指不参与"转视角"。
   *
   * 排除列表分两类：
   *  1) 真正的交互控件（按钮/滑杆/摇杆）；
   *  2) 「自己会滚动的容器」—— 档案抽屉在手机上是底部抽屉，
   *     内容比屏幕长时要能上下滑。要是把它也算作转视角区域，
   *     你一想往下拉看"登陆地表"那些按钮，视角就跟着转，内容纹丝不动。
   *
   * 第 2 类靠 SCROLL_OWNER 单独判：只要手指落在一个「能滚且真的滚得动」
   * 的元素里，就让给它滚，不抢。
   */
  const TOUCH_UI = 'button, input, a, #touch-ctl, .mchip, .cat-item, .cat-moon';

  /**
   * 向上找最近的、当前能滚动的祖先。
   * 判断"能滚"要同时看 overflow 和 scrollHeight > clientHeight ——
   * 不然一个 overflow:auto 但内容没超出的容器会把手势白白吃掉。
   */
  function scrollableAncestor(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const oy = cs.overflowY, ox = cs.overflowX;
      const canY = (oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 2;
      const canX = (ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 2;
      if (canY || canX) return n;
    }
    return null;
  }

  function onTouchStart(e) {
    if (!enabled || e.touches.length !== 1) return;
    const t = e.touches[0];
    // 落在按钮/滑杆/摇杆上的手指属于"操作控件"，不参与转视角
    if (e.target && e.target.closest && e.target.closest(TOUCH_UI)) { scrollOwner = null; return; }
    // 落在可滚动容器（手机上的档案抽屉）里的手指，交给它自己滚。
    // 这一步要放在 tId 判断之前：不然上一轮手势没清干净时，
    // 抽屉里的手指会被当成"上一次拖动的延续"，又开始转视角。
    if (e.target && scrollableAncestor(e.target)) {
      scrollOwner = e.target;
      tId = null; touch.active = false;
      return;
    }
    scrollOwner = null;
    if (tId !== null) return;
    tId = t.identifier; tX = t.clientX; tY = t.clientY; tMoved = 0;
    touch.active = true;
    state.idleTime = 0;
  }
  /** 正在被用户滚动的容器；非空时本手势一律不参与转视角 */
  let scrollOwner = null;
  function onTouchMove(e) {
    // 这根手指是落在可滚动容器（档案抽屉）里的 —— 整个手势期间都不抢，
    // 交给浏览器原生滚动。只在 touchstart 判一次就够，中途不再改判：
    // 否则滚到底部后手指继续拖，会突变去转视角，很突兀。
    if (scrollOwner) return;
    // 双指及以上 = 用户在捏合缩放，别把其中一根手指当作"拖动转向"
    if (e.touches.length >= 2) {
      if (tId !== null) { tId = null; touch.active = false; }
      return;
    }
    if (tId === null || e.touches.length !== 1 || !enabled) return;
    const t = e.touches[0];
    if (t.identifier !== tId) return;
    const dx = t.clientX - tX, dy = t.clientY - tY;
    tX = t.clientX; tY = t.clientY;
    tMoved += Math.abs(dx) + Math.abs(dy);
    if (tMoved < 5) return;                 // 死区：轻微抖动不算拖动，避免误吞点击
    if (e.cancelable) e.preventDefault();   // 拖视角时别让页面跟着滚
    applyLook(dx, dy, true);
  }
  function onTouchEnd(e) {
    if (scrollOwner) {
      // 手指抬完了才清掉"正在滚"的标记（多指时等最后一只离开）
      if (e.touches.length === 0) scrollOwner = null;
      return;
    }
    if (tId === null) return;
    for (const t of e.touches) if (t.identifier === tId) return;  // 还有其他手指按着
    tId = null; touch.active = false;
  }

  // 绑 window：捕获阶段能拿到真实 target，且不受任何覆盖层阻挡
  window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });

  function rotateFollowOffset(dTheta, dPhi) {
    const f = state.follow;
    if (!f) return;
    // 球坐标环绕
    const sph = new THREE.Spherical().setFromVector3(f.offset);
    sph.theta += dTheta;
    sph.phi = clamp(sph.phi - dPhi, 0.08, Math.PI - 0.08);
    f.offset.setFromSpherical(sph);
  }

  /* ---------------- 模式切换 ---------------- */
  function setMode(m) {
    state.mode = m;
    onModeChange(m);
  }

  /**
   * 平滑飞向目标
   * @param {THREE.Vector3} destPos 目标相机位置（世界坐标）
   * @param {THREE.Vector3} lookAt  目标注视点（世界坐标）
   */
  function flyTo(destPos, lookAt, duration = 2.4) {
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const endQuat = quaternionTo(destPos, lookAt, new THREE.Quaternion());
    state.transit = {
      t: 0, duration,
      startPos, startQuat,
      endPos: destPos.clone(),
      endQuat,
      lookAt: lookAt.clone()
    };
    setMode('transit');
  }

  /** 跟随某个天体 */
  function followBody(body, distanceMul = 5.5) {
    const bodyWorld = new THREE.Vector3();
    body.holder.getWorldPosition(bodyWorld);
    const minDist = body.radius * 2.2 * getWorldScale() + 1.2;
    const maxDist = Math.max(600, body.radius * 400 * getWorldScale());
    let offset = new THREE.Vector3().subVectors(camera.position, bodyWorld);
    let len = offset.length();
    if (len < 0.001) { offset.set(0, body.radius * 2, -body.radius * 5); len = offset.length(); }
    const preferred = clamp(body.radius * distanceMul, minDist, maxDist);
    offset.multiplyScalar(preferred / len);
    if (offset.y < body.radius * 0.18) offset.y = body.radius * 0.55;

    state.follow = { body, offset, minDist, maxDist };
    // 先飞过去
    flyTo(bodyWorld.clone().add(offset), bodyWorld.clone(), 1.9);
    state.transit.nextMode = 'follow';
    state.transit.body = body;
  }

  function releaseToFree() {
    // 保持当前朝向，转为自由飞行
    euler.setFromQuaternion(camera.quaternion);
    state.yaw = euler.y; state.pitch = euler.x;
    state.vel.set(0, 0, 0);
    state.follow = null;
    state.walk = null;
    if (state.mode === 'walk') { camera.up.set(0, 1, 0); camera.near = 0.05; camera.far = 30000; camera.updateProjectionMatrix(); }
    setMode('free');
  }

  /* ---------------- 地表行走 ---------------- */

  /**
   * 进入地表行走模式
   * @param {object} o { spawn:Vector3, yaw, pitch, gravity, jump, eye, bound, speed, getHeight }
   *   getHeight(x,z) 必须返回该点地面高度 —— 由地表场景提供，保证脚底与地形严格贴合。
   */
  function enterWalk(o) {
    const w = state.walk || (state.walk = {});
    w.pos = new THREE.Vector3().copy(o.spawn);
    w.y = o.getHeight ? o.getHeight(w.pos.x, w.pos.z) : 0;
    w.vel = new THREE.Vector3();
    w.vy = 0;
    w.yaw = o.yaw ?? 0;
    w.pitch = o.pitch ?? -0.02;
    w.eye = o.eye ?? 1.72;
    w.gravity = o.gravity ?? -9.8;
    w.jump = o.jump ?? 4.2;
    w.bound = o.bound ?? 55;
    w.speed = o.speed ?? 4.4;
    w.getHeight = o.getHeight || (() => 0);
    w.onGround = true;
    w.jumpLatch = false;
    w.bobT = 0;
    w.bob = 0;
    camera.up.set(0, 1, 0);
    setMode('walk');
  }

  function updateWalk(dt) {
    const w = state.walk;
    if (!w) return;

    /* --- 水平输入：朝向只取 yaw，人在地面上永远是水平走的 --- */
    let f = 0, s = 0;
    if (keys['KeyW'] || keys['ArrowUp']) f += 1;
    if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) s += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) s -= 1;
    // 摇杆推杆量直接叠加（模拟量），键盘是 1 档，两者取绝对值大的那个
    if (Math.abs(touch.moveF) > Math.abs(f)) f = touch.moveF;
    if (Math.abs(touch.moveS) > Math.abs(s)) s = touch.moveS;

    const sinY = Math.sin(w.yaw), cosY = Math.cos(w.yaw);
    // 前 = (-sinY, 0, -cosY)，右 = (cosY, 0, -sinY)
    let vx = -sinY * f + cosY * s;
    let vz = -cosY * f - sinY * s;
    const len = Math.hypot(vx, vz);
    // 推满摇杆时 len 恰好为 1；半推时速度按比例降，手感更接近"走路"
    const push = Math.min(1, len);
    const running = !!(keys['ShiftLeft'] || keys['ShiftRight']) || touch.run;
    const spd = (running ? w.speed * 1.95 : w.speed) * push;
    if (len > 0.001) { vx = (vx / len) * spd; vz = (vz / len) * spd; }

    // 空中操控权很弱（重力小的星球上尤其明显）
    const acc = w.onGround ? 14 : 1.8;
    w.vel.x = damp(w.vel.x, vx, acc, dt);
    w.vel.z = damp(w.vel.z, vz, acc, dt);
    w.pos.x += w.vel.x * dt;
    w.pos.z += w.vel.z * dt;

    // 软边界：贴边时把速度吃掉，不会硬生生卡住
    const rr = Math.hypot(w.pos.x, w.pos.z);
    if (rr > w.bound) {
      const k = w.bound / rr;
      w.pos.x *= k; w.pos.z *= k;
      w.vel.x *= 0.25; w.vel.z *= 0.25;
    }

    /* --- 垂直：跳跃 + 简易重力 --- */
    const wantJump = !!keys['Space'] || touch.jump;
    if (wantJump && w.onGround && !w.jumpLatch) {
      w.vy = w.jump;
      w.onGround = false;
      w.jumpLatch = true;
    }
    if (!wantJump) w.jumpLatch = false;

    const ground = w.getHeight(w.pos.x, w.pos.z);
    if (!w.onGround) {
      w.vy += w.gravity * dt;
      w.y += w.vy * dt;
      if (w.y <= ground) { w.y = ground; w.vy = 0; w.onGround = true; }
    } else {
      // 贴地：跟住地形。上坡限幅，防止"一步瞬移上台地"；下坡超过半米就进入下落
      const target = ground;
      const dy = target - w.y;
      if (dy > 0.9) w.y += 0.9;
      else w.y = damp(w.y, target, 18, dt);
      if (target < w.y - 0.5) { w.onGround = false; w.vy = 0; }
    }

    /* --- 走路晃动：很小的上下 + 左右摆，纯粹为了"有腿"的感觉 --- */
    const moving = Math.hypot(w.vel.x, w.vel.z);
    const k = Math.min(1, moving / Math.max(w.speed, 0.001));
    w.bobT += dt * moving * 1.75;
    const targetBob = w.onGround ? Math.sin(w.bobT) * 0.042 * k : 0;
    const targetSway = w.onGround ? Math.cos(w.bobT * 0.5) * 0.026 * k : 0;
    w.bob = damp(w.bob, targetBob, 12, dt);
    const sway = targetSway;

    camera.position.set(w.pos.x, w.y + w.eye + w.bob, w.pos.z);
    // YXZ：先偏航再俯仰再侧倾，和自由飞行保持一致
    euler.set(w.pitch, w.yaw, sway);
    camera.quaternion.setFromEuler(euler);
  }

  /* ---------------- 每帧更新 ---------------- */
  let prevPos = camera.position.clone();

  function update(dt) {
    if (!enabled) return;
    const scale = getWorldScale();
    const speed = state.baseSpeed * scale * state.boost;

    if (state.mode === 'walk' && state.walk) {
      updateWalk(dt);
      return;
    }

    if (state.mode === 'transit') {
      updateTransit(dt);
      return;
    }

    if (state.mode === 'follow' && state.follow) {
      const body = state.follow.body;
      const bodyWorld = tmpV; body.holder.getWorldPosition(bodyWorld);
      // 目标本身在移动 -> 相机跟着平移
      // 目标本身体型虽小但公转很快，收敛速率必须给足，否则画面里天体总偏在一侧
      const target = bodyWorld.clone().add(state.follow.offset);
      camera.position.lerp(target, 1 - Math.exp(-12 * dt));
      const look = bodyWorld;
      applyLookAt(look, dt, 22);
      applyIdleRoll(dt);
      return;
    }

    /* ---- 自由飞行 ---- */
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);

    let f = 0, s = 0, u = 0;
    if (keys['KeyW'] || keys['ArrowUp']) f += 1;
    if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) s += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) s -= 1;
    if (keys['KeyE']) u += 1;
    if (keys['KeyQ']) u -= 1;
    // 触屏：摇杆直接给前/side 两个模拟量，没有升降轴
    if (Math.abs(touch.moveF) > Math.abs(f)) f = touch.moveF;
    if (Math.abs(touch.moveS) > Math.abs(s)) s = touch.moveS;
    state.boost = (keys['ShiftLeft'] || keys['ShiftRight'] || touch.run) ? 4.5 : 1;

    const moving = f || s || u;
    if (moving) state.idleTime = 0; else state.idleTime += dt;

    state.wanted.set(0, 0, 0)
      .addScaledVector(forward, f)
      .addScaledVector(right, s)
      .addScaledVector(up, u);
    if (state.wanted.lengthSq() > 0) state.wanted.normalize().multiplyScalar(speed);

    // 怠速时的自动漂移，让画面永远有"在飞"的感觉
    if (!moving && state.autoCruise && state.idleTime > 6) {
      const drift = Math.min(1, (state.idleTime - 6) / 4);
      state.wanted.addScaledVector(forward, speed * 0.16 * drift);
      state.yaw += dt * 0.014 * drift;
    }

    state.vel.x = damp(state.vel.x, state.wanted.x, 3.2, dt);
    state.vel.y = damp(state.vel.y, state.wanted.y, 3.2, dt);
    state.vel.z = damp(state.vel.z, state.wanted.z, 3.2, dt);
    camera.position.addScaledVector(state.vel, dt);

    // 姿态：yaw/pitch + 侧向倾斜
    const targetRoll = -(s * 0.085) * Math.min(1, state.vel.length() / Math.max(speed, 0.001));
    state.roll = damp(state.roll, targetRoll, 4, dt);
    euler.set(state.pitch, state.yaw, state.roll);
    camera.quaternion.setFromEuler(euler);

    // 撞击续航嗯……恒星安全距离
    prevPos.copy(camera.position);
  }

  function updateTransit(dt) {
    const tr = state.transit;
    tr.t += dt;
    const k = clamp(tr.t / tr.duration, 0, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // easeInOutCubic
    camera.position.lerpVectors(tr.startPos, tr.endPos, e);
    camera.quaternion.copy(tr.startQuat).slerp(tr.endQuat, e);
    if (k >= 1) {
      if (tr.nextMode === 'follow') { setMode('follow'); state.follow = state.follow; }
      else {
        euler.setFromQuaternion(camera.quaternion);
        state.yaw = euler.y; state.pitch = euler.x; state.roll = 0;
        setMode('free');
      }
      state.transit = null;
    }
  }

  // 每帧用于 slerp 的中间目标（避免每帧 new Quaternion）
  const lookQuat = new THREE.Quaternion();
  function applyLookAt(target, dt, lerpRate) {
    quaternionTo(camera.position, target, lookQuat);
    camera.quaternion.slerp(lookQuat, 1 - Math.exp(-lerpRate * dt));
  }

  function applyIdleRoll(dt) {
    // 跟随模式下极轻微的呼吸式摇摆，避免画面死板
    const t = performance.now() * 0.001;
    camera.rotateZ(Math.sin(t * 0.35) * 0.006);
  }

  /** 获取屏幕中心射线方向（准星瞄准用） */
  function getRayDir(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  }

  function requestLock() { if (!pointerLocked && dom.requestPointerLock) dom.requestPointerLock(); }
  function exitLock() { if (document.exitPointerLock) document.exitPointerLock(); }

  function setInitial(position, lookAt) {
    camera.up.set(0, 1, 0);
    camera.position.copy(position);
    if (lookAt) {
      quaternionTo(position, lookAt, camera.quaternion);
      euler.setFromQuaternion(camera.quaternion);
      state.yaw = euler.y; state.pitch = euler.x;
    }
  }

  return {
    state, keys,
    update, setMode, flyTo, followBody, releaseToFree, getRayDir,
    requestLock, exitLock, setInitial, rotateFollowOffset,
    enterWalk,
    getWalk: () => state.walk,
    isPointerLocked: () => pointerLocked,
    setEnabled(v) { enabled = v; },
    getMode: () => state.mode,
    onWheelScale: (fn) => listeners.wheelScale.push(fn),
    setYawPitch(y, p) { state.yaw = y; state.pitch = p; },

    /* ---- 触屏虚拟输入 ---- */
    /** 摇杆推杆量：f 前(+)后(-)，s 右(+)左(-)，范围 [-1,1] */
    setTouchMove(f, s) { touch.moveF = f || 0; touch.moveS = s || 0; state.idleTime = 0; },
    /** 奔跑键：触屏的"持续按住"型加速，与 Shift 等价 */
    setTouchRun(on) { touch.run = !!on; },
    /** 跳跃键：按住即视为空格按下，抬手松开 */
    setTouchJump(on) { touch.jump = !!on; state.idleTime = 0; },
    isTouchDragging: () => touch.active,
    /** 触屏捏合缩放：直接喂像素当量，正数放大、负数缩小 */
    pinchZoom(px) {
      // 与滚轮共用同一套规则，避免两条链路的手感和行为漂移
      applyZoom(0, Math.pow(1.0014, px));
    },
    /**
     * 开关怠速自动漂移。
     * 自动化测试里必须能关掉它：空闲 6 秒后相机会自己缓慢平移+偏航，
     * 测试若拿相机位置当"视角有没有被拖动"的判据，会被这个漂移污染。
     */
    setAutoCruise(on) { state.autoCruise = !!on; state.idleTime = 0; }
  };
}
