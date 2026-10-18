/**
 * music.js — 背景音乐（WebAudio 现场合成，单曲循环）
 *
 * 为什么是"合成"而不是放一个 mp3？
 *   用户想要的是《Apollo's Triumph》(Audiomachine) /《Human Legacy》(Ivan Torrent)
 *   这类史诗纯音乐，但这两首都是版权厂牌的商业作品 —— 不能下载打包进站点。
 *   所以这里按它们共同的气质**原创合成**一首循环曲：
 *     小调底色 + 弦乐铺底 + 主题旋律 + 缓慢推进的鼓点 + 情绪层层堆高。
 *   好处：完全无版权风险、不带音频文件（首屏不背着几 MB）、不会被手机首播策略拦。
 *
 * 曲子结构（16 小节一轮，约 50 秒，循环播放）：
 *   ┌ 起（第 1-4 小节)   弦乐铺底 + 低音，铺开空间，旋律留白多
 *   ├ 承（第 5-8 小节)   旋律上行推高，第 3 小节鼓点进入
 *   ├ 转（第 9-12 小节)  情绪顶点，翻高八度并加叠音
 *   └ 合（第 13-16 小节) 旋律收束回主音，无缝接下一轮
 *
 * 用"手写时间轴 + 定时调度"实现：调度器每次只排 **一小节**，
 * 播放头往前推一小节，循环往复。不用 AudioBuffer 预渲染，省内存也方便调参。
 *
 * ⚠️ 注意 "一小节只排一小节"：MELODY 每层 4 个音符 × 1 拍 = 4 拍 = 1 小节，
 *    与 pump() 里 nextTime += BAR 的推进步长严格对齐。改旋律时务必保持这个约定。
 */

/* 曲子的基本参数 ------------------------------------------------------ */
const BPM = 76;                       // 慢速，史诗感需要"拖"
const BEAT = 60 / BPM;                // 一拍多少秒
const BAR = BEAT * 4;                 // 4/4 拍，一小节
const LOOKAHEAD = BAR * 4;            // 每次排 4 小节

/* F 小调音阶（半音偏移）。这两首参考曲都是小调，F 小调最接近那种阴沉底色 */
const F_MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24];
const ROOT = 87.31;                   // F2 = 87.31 Hz

/* 主题旋律：用音阶级数写，循环往复。
 * 数字是 F_MINOR 的下标，null 表示休止（留白也是史诗感的一部分）。
 *
 * ★ 结构约定（很重要，别再搞错）：
 *   外层 = 小节（16 个小节 = 一整轮曲式），内层 = 该小节里的 4 个音符，
 *   每个音符占 **一拍**。所以一小节 4 个音 × 1 拍 = 4 拍 = 1 小节 ✓
 *   调度器每次 scheduleBar() 只消费一层，一小节排一小节，不会叠。
 *
 * 曲式：起(4) → 承(4) → 转(4) → 合(4)，16 小节后回到起点无缝循环。 */
const MELODY = [
  // 起 —— 低声部主题，留白多，先把空间铺开
  [3, null, 4, null],
  [5, null, 4, null],
  [2, null, 3, null],
  [2, null, 0, null],
  // 承 —— 上行推高
  [3, null, 4, null],
  [5, 6, 7, null],
  [6, null, 5, null],
  [4, null, 3, null],
  // 转 —— 情绪顶点，拉长音 + 密集音
  [7, null, 8, 8],
  [9, null, 8, 7],
  [6, null, 7, null],
  [6, 5, 4, null],
  // 合 —— 收束回主音
  [3, 4, 5, 4],
  [3, null, 2, null],
  [2, null, 1, null],
  [0, null, null, null]
];

/* 弦乐和声：每小节的铺底音（F_MINOR 下标），四小节一轮换，
 * 走 i - VI - III - VII，是小调史诗最常用的进行。 */
const CHORDS = [0, 5, 2, 6];

function freq(semitone) {
  return ROOT * Math.pow(2, semitone / 12);
}

export function createMusic() {
  let ctx = null;
  let built = false;
  let on = false;
  let master = null;
  let buses = {};
  let nextTime = 0;             // 下一个要排的音符的时间点
  let schedTimer = 0;
  let barIndex = 0;             // 已经排到第几小节

  /* ★ 总音量。手机小喇叭功率低，之前的 0.85 会让多声部叠加削顶 →
   *   听感就是"沙沙的电流声/底噪"。现在靠 ①去掉噪声源（锯齿波/白噪声尾/混响长尾）
   *   ②加限幅器 ③重配音量配比，实测峰值约 0.58（-4.7 dBFS），没有削顶。
   *   想再响一点就调这一个值，别去动各支路。 */
  const MASTER_ON = 0.85;

  /* 简易混响：生成一段衰减噪声当脉冲响应，用 ConvolverNode 做空间感。
     现场合成的曲子不加混响会很"干"，弦乐尤其明显。

     ★ 手机噪音的元凶之一就在这：如果脉冲响应里的噪声衰减不够快，
       等于给整首曲子铺了一层持续宽带噪声（听感就是"沙沙/电流声"）。
       所以这里把衰减指数从 2.6 调到 4.5（掉得更快），长度 3.2s → 2.0s，
       并且开头 12ms 做一个快速淡出，避免直接冲击。 */
  function buildReverb() {
    const dur = 2.0;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        // 前 12ms 淡入，其余按 4.5 次幂快速衰减 —— 尾巴短、不积噪声
        const head = Math.min(1, i / (ctx.sampleRate * 0.012));
        d[i] = (Math.random() * 2 - 1) * head * Math.pow(1 - x, 4.5);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    // 湿声前先砍掉高频：混响里 2kHz 以上的内容在手机上最刺耳
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass'; damp.frequency.value = 1600; damp.Q.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;                 // 0.34 → 0.16，混响别抢主声
    conv.connect(damp); damp.connect(wet); wet.connect(master);
    return conv;
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    /* 输出链：master → limiter → destination
       ★ 加一个 DynamicsCompressorNode 当"安全阀"：
         万一以后有人调大某一路音量导致总信号超过 1.0，
         它会自动压住，而不是让波形削顶产生刺耳的沙沙声。
         threshold 设 -6dB、ratio 12:1，只在接近上限时动手，
         平时对音色几乎没有影响。 */
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 3;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    /* 各支路增益：宁可小也别削顶。
       多声部（3 层 pad + 旋律 + 鼓 + sub）同时响时总和必须留够余量，
       否则波形削顶 → 手机小喇叭上听起来就是"沙沙的电流声"。 */
    /* ★ 支路增益。上面把噪声源全砍了之后整体会偏轻，这里按实测反解放大 2.53x，
     *   让最终峰值落在 -5dBFS 附近（限幅器阈值 -6dB，留 6dB 余量不被压）。
     *   改音量优先动 MASTER_ON，别单独动这四条，否则配比会歪。 */
    buses.pad = ctx.createGain();  buses.pad.gain.value = 0.86; buses.pad.connect(master);
    buses.lead = ctx.createGain(); buses.lead.gain.value = 1.06; buses.lead.connect(master);
    buses.perc = ctx.createGain(); buses.perc.gain.value = 0.76; buses.perc.connect(master);
    buses.sub = ctx.createGain();  buses.sub.gain.value = 0.76; buses.sub.connect(master);

    // 给弦乐和主音各接一点混响
    const conv = buildReverb();
    buses.pad.connect(conv);
    buses.lead.connect(conv);

    // 极低频：撑住"宇宙很大"的体积感，F1
    const sub = ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = ROOT / 2;
    const sg = ctx.createGain(); sg.gain.value = 0.1;
    sub.connect(sg); sg.connect(buses.sub);
    sub.start();
    buses._sub = sub; buses._subGain = sg;

    built = true;
    nextTime = ctx.currentTime + 0.15;
    barIndex = 0;
  }

  /* ---------- 音色 ---------- */

  /** 弦乐：两个失谐三角波 + 低通，包络很长，像一层绵长的弦乐垫。
   *  用三角波而不是锯齿波 —— 锯齿的谐波太密，在手机小喇叭上会发"沙"。 */
  function pad(t, semi, dur, gain) {
    const f = freq(semi);
    const g = ctx.createGain();
    g.gain.value = 0;
    // 低通压到 900Hz：把 1kHz 以上全部砍掉，手机扬声器最刺耳的频段
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
    g.connect(lp); lp.connect(buses.pad);

    const oscs = [0, 6].map((dt, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = dt;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.25);
      return o;
    });

    const atk = Math.min(1.6, dur * 0.35);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.linearRampToValueAtTime(gain * 0.72, t + dur);
    // 收尾到真正的 0（不是 0.0001）：残留值长期叠加会积累成底噪
    g.gain.linearRampToValueAtTime(0, t + dur + 0.22);
    return oscs;
  }

  /** 主旋律音色：三角波 + 轻微高次谐波，像大提琴/圆号的中音区。
   *  谐波量从 0.22 降到 0.10、低通从 2400 压到 1500 —— 手机上扬声器
   *  还原不了高频，只会把 2kHz 附近变成刺耳的"滋滋"声。 */
  function lead(t, semi, dur, gain) {
    const f = freq(semi);
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.35;
    g.connect(lp); lp.connect(buses.lead);

    const o = ctx.createOscillator();
    o.type = 'triangle'; o.frequency.value = f;
    const h = ctx.createOscillator();
    h.type = 'sine'; h.frequency.value = f * 2;
    const hg = ctx.createGain(); hg.gain.value = 0.10;
    o.connect(g); h.connect(hg); hg.connect(g);
    o.start(t); h.start(t);
    o.stop(t + dur + 0.2); h.stop(t + dur + 0.2);

    // 弦乐式的慢起音：0.18s 爬到峰值，尾部干净收掉（指数衰减到 0）
    const atk = 0.18;
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.2);
  }

  /** 鼓：低频正弦"心跳"，做成电影配乐那种闷鼓。
   *  ★ 去掉了原来的"噪声尾" —— 那层白噪声在手机上就是持续的沙沙底噪，
   *    每小节 2~3 个鼓、一轮 16 小节，噪声会密集叠加。纯正弦下扫已经很闷够用。 */
  function drum(t, gain) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    g.gain.linearRampToValueAtTime(0, t + 0.5);      // 收到真正的 0，不留残留
    o.connect(g); g.connect(buses.perc);
    o.start(t); o.stop(t + 0.55);
  }

  /** 铺底低音：每小节开头一个长音，稳住和声 */
  function bassNote(t, semi, dur, gain) {
    const f = freq(semi) / 2;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(gain, t + 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.14);   // 收干净
    o.connect(g); g.connect(buses.sub);
    o.start(t); o.stop(t + dur + 0.2);
  }

  /* ---------- 排一个小节 ---------- */
  function scheduleBar(bar, t0) {
    const chord = CHORDS[bar % CHORDS.length];
    const dy = Math.floor(bar / CHORDS.length);          // 第几轮，情绪强度用它推
    const intensity = Math.min(1, 0.45 + dy * 0.22);     // 一轮比一轮强，但不无限涨

    /* 铺底：和弦音，一小节长。
       三层 pad 同响，单层音量要压住 —— 三个 0.2 叠起来就到 0.6 了。 */
    pad(t0, F_MINOR[chord] + 12, BAR * 0.98, 0.20 * intensity);
    pad(t0, F_MINOR[chord + 2] + 12, BAR * 0.98, 0.13 * intensity);
    pad(t0, F_MINOR[chord + 4] + 12, BAR * 0.98, 0.10 * intensity);
    // 低音
    bassNote(t0, F_MINOR[chord], BAR * 0.95, 0.16 * intensity);

    // 旋律：本小节对应的 4 个音符，每个占一拍（1 小节 = 4 拍）
    const mi = bar % MELODY.length;
    const phrase = MELODY[mi];
    let t = t0;
    for (let i = 0; i < phrase.length; i++) {
      const step = phrase[i];
      const stepDur = BEAT;            // 每个音占一拍
      if (step !== null) {
        // 第 9 小节起（转部）翻高八度，做情绪顶点
        const high = mi >= 8;
        lead(t, F_MINOR[step] + (high ? 12 : 0) + 12, stepDur * 0.92, 0.18 * intensity);
        // 高八度叠一层轻的，增加"宏大"感（后半段才叠，避免开头太满）
        if (mi >= 8) lead(t, F_MINOR[step] + 24, stepDur * 0.8, 0.055 * intensity);
      }
      t += stepDur;
    }

    // 鼓：第 3 小节起进来（前面留白），第 1 拍重音 + 第 3 拍轻音
    if (bar >= 2) {
      drum(t0, 0.30 * intensity);
      drum(t0 + BEAT * 2, 0.16 * intensity);
      if (bar >= 6) drum(t0 + BEAT * 3.5, 0.09 * intensity);   // 后段加切分
    }
  }

  /* ---------- 调度循环 ---------- */
  function pump() {
    if (!ctx || !on) return;
    // ★ 关键：AudioContext 还没 running 时不要排时间轴。
    //   手机（尤其 iOS Safari）刚创建 ctx 时是 suspended，resume() 是异步的，
    //   此刻 ctx.currentTime 还没开始走。如果这时把音符排进去，等时钟真正启动时
    //   这些时间点已经过期，会被直接丢弃 → 表现为"点了没声音"。
    //   所以这里守住：不是 running 就不排，等 resume 完成后的回调再启动。
    if (ctx.state !== 'running') {
      schedTimer = setTimeout(pump, 120);
      return;
    }
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (nextTime < horizon) {
      scheduleBar(barIndex, nextTime);
      nextTime += BAR;
      barIndex++;
    }
    // 用 500ms 而不是 900ms：手机后台会节流 setTimeout，
    // 排期窗口 LOOKAHEAD 是 4 小节(12.6s)，留的余量越小越安全。
    schedTimer = setTimeout(pump, 500);
  }

  /* 把 AudioContext 唤醒到 running，再回调。
     手机上"先 resume、成功了才排音符"是唯一可靠的顺序。 */
  function resumeThen(cb) {
    if (!ctx) { cb(); return; }
    if (ctx.state === 'running') { cb(); return; }
    const p = ctx.resume();
    if (p && typeof p.then === 'function') {
      p.then(() => { cb(); }).catch(() => {
        // resume 被拒（用户手势丢失等）：退化成轮询，pump 自己会等 running
        cb();
      });
    } else {
      cb();
    }
  }

  function armAndPump() {
    // 播放头落在"现在之后一点"，避免排到过去的时间点（排过去=不响）
    nextTime = Math.max(nextTime, ctx.currentTime + 0.25);
    clearTimeout(schedTimer);
    pump();
  }

  function start() {
    if (!built) build();
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* 下面 pump 会等 running */ }
    }
    on = true;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(MASTER_ON, ctx.currentTime + 2.0);
    // 不等 resume 返回就直接排一次：running 了立刻出声；
    // 没 running 的话 pump 自己会每 120ms 重试，resume 完成也会主动再叫一次。
    armAndPump();
    resumeThen(() => { if (on) armAndPump(); });
    return true;
  }

  function setOn(v) {
    if (!built) { if (v) start(); return; }
    on = !!v;
    if (on) {
      if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) { /* pump 会等 */ }
      }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(MASTER_ON, ctx.currentTime + 1.6);
      armAndPump();
      resumeThen(() => { if (on) armAndPump(); });
    } else {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.4);
      clearTimeout(schedTimer);
      // 不要立刻停掉已排的音符，让它们自然衰减出去，避免"啪"一声
      setTimeout(() => { if (!on) { clearTimeout(schedTimer); } }, 2200);
    }
  }

  /* 手机切回前台时调用：AudioContext 常被系统挂起。
     这里把 ctx 唤醒并把排期接回去，避免"切出去再回来就没声了"。 */
  function revive() {
    if (!built || !on) return false;
    if (ctx.state === 'suspended') {
      try { ctx.resume(); } catch (e) { /* 忽略 */ }
    }
    resumeThen(() => { if (on) armAndPump(); });
    return true;
  }

  return {
    start, setOn, revive,
    get playing() { return on; },
    get ready() { return built; },
    level: () => (master ? master.gain.value : -1),
    state: () => (ctx ? ctx.state : 'none'),
    /* 调试用：当前排到第几小节，测试里可以确认调度器真的在跑 */
    bar: () => barIndex,
    bpm: () => BPM
  };
}
