/**
 * ui/audio.js —— 实时合成的音效
 *
 * 为什么是合成而不是音频素材：
 *   单文件交付不能带外部文件。1 秒 44.1kHz 单声道 ≈ 88KB，base64 后 ≈ 117KB，
 *   几个音效就 500KB+。合成的话体积是零，而且每次可以微调，听不腻。
 *
 * 三条听感原则（比「加音效」本身更重要）：
 *   ① **默认音量要小。** 默认 100% 是听觉灾难，这里默认 0.32。
 *   ② **每次不能完全一样。** 同一个打牌声重复上百次会疯 —— 每次给音高、音量、
 *      时长几个百分点的随机偏移，大脑就认它是自然的。
 *   ③ **留白。** 重要的声音前面要静一下，而不是「啪」地糊上去。
 *
 * 另外两条硬约束：
 *   - 浏览器不允许自动播放，AudioContext 必须等用户手势才能启动；
 *   - 这个模块会被 Node 测试间接 import，**任何浏览器 API 都不能在顶层碰**。
 */

const STORE_KEY = 'mahjong-audio-v1';

let ctx = null;
let master = null;
let noiseBuf = null;

let enabled = true;
let volume = 0.32;

/** 限流：一帧里堆几十个声音会糊成噪音（也防测试里一次性 drain 出几千个） */
let recent = 0;
let recentAt = 0;
const BURST_MAX = 4;
const BURST_WINDOW = 60;

/**
 * 这些声音**限流也不能吞**。
 *
 * 限流是给「打牌 / 摸牌」那种每巡都响的音效准备的；和牌、立直这种一声难求的
 * 声音如果刚好被窗口挤掉，玩家会觉得游戏卡了一下 —— 比多响一声糟糕得多。
 * 这条是测试逼出来的：连播 20 次打牌声之后，紧接着的和牌声直接被吞了。
 */
const PRIORITY = new Set(['win', 'riichi', 'levelUp', 'correct', 'wrong', 'drawEnd']);

/* ── 设置存取 ──────────────────────────────────────────────────── */

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (typeof o.enabled === 'boolean') enabled = o.enabled;
    if (typeof o.volume === 'number') volume = Math.min(1, Math.max(0, o.volume));
  } catch { /* 隐私模式：静默降级 */ }
}

function save() {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify({ enabled, volume }));
  } catch { /* 同上 */ }
}

load();

export const isEnabled = () => enabled;
export const getVolume = () => volume;

/** 通知界面刷新。Node 里没有 document，静默跳过。 */
function emit() {
  try {
    globalThis.document?.dispatchEvent(new CustomEvent('mj:audio-changed'));
  } catch { /* Node 或老浏览器 */ }
}

export function setEnabled(on) {
  enabled = !!on;
  save();
  emit();
  return enabled;
}

export const toggle = () => setEnabled(!enabled);

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, v));
  if (master) master.gain.value = volume;
  save();
  emit();
}

/** 浏览器要求 AudioContext 由用户手势创建；顺手处理挂起态 */
export function unlock() {
  if (!enabled) return false;
  if (!ensure()) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

function ensure() {
  if (ctx) return true;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;                       // Node / 老浏览器：静默禁用
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    return false;
  }
  return true;
}

/* ── 合成基元 ──────────────────────────────────────────────────── */

/** 白噪声缓冲，只生成一次 —— 每次新建 buffer 会明显卡顿 */
function noise() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/**
 * 一段带包络的噪声 —— 麻将的「啪」和「嚓」都是噪声，不是乐音。
 * @param {number} at 相对当前时刻的延迟（秒）
 */
function burst({ at = 0, dur = 0.1, freq = 3000, q = 1.2, gain = 0.4, type = 'bandpass', attack = 0.001 }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  src.playbackRate.value = 0.9 + Math.random() * 0.2;

  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.03);
}

/** 一个带包络的音 —— 用来给噪声垫底（撞击的闷响）或做提示音 */
function blip({ at = 0, freq = 440, dur = 0.12, gain = 0.2, type = 'sine', to = null }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  o.connect(g); g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** 每次演奏的几个百分点扰动 —— 让重复的声音不像机器 */
function jit() {
  return {
    p: 0.95 + Math.random() * 0.1,     // 音高 ±5%
    g: 0.92 + Math.random() * 0.16,    // 音量 ±8%
    d: 0.9 + Math.random() * 0.2,      // 时长 ±10%
  };
}

/* ── 音色库 ────────────────────────────────────────────────────── */

/**
 * 牌落桌。整个游戏里最重要的一个音 —— 它得听起来像一块塑料牌拍在绒面上：
 * 高频的「啪」+ 中频的木质感 + 低频撞击桌面的闷响，三层叠起来。
 */
function tileDrop(w = 1, at = 0) {
  const j = jit();
  burst({ at, dur: 0.085 * j.d, freq: (2700 + Math.random() * 1300) * j.p, q: 1.1, gain: 0.5 * j.g * w, attack: 0.0008 });
  burst({ at, dur: 0.055 * j.d, freq: 950 * j.p, q: 2.4, gain: 0.3 * j.g * w });
  blip({ at, freq: (175 + Math.random() * 45) * j.p, dur: 0.07 * j.d, gain: 0.2 * j.g * w });
}

/** 摸牌：比打牌轻、短、闷，因为它发生在绒面上而不是撞击 */
function tileDraw(at = 0) {
  const j = jit();
  burst({ at, dur: 0.05 * j.d, freq: 4300 * j.p, q: 0.9, gain: 0.13 * j.g, attack: 0.004 });
  burst({ at: at + 0.02, dur: 0.04, freq: 1600, q: 1.6, gain: 0.07 * j.g });
}

/** 手牌整理 / 牌在桌面上滑动 */
function tileSlide(at = 0) {
  burst({ at, dur: 0.13, freq: 2400, q: 0.6, gain: 0.1, type: 'bandpass', attack: 0.02 });
}

/* ── 对外的声音 ────────────────────────────────────────────────── */

const BANK = {
  /** 打牌 */
  discard: () => tileDrop(1),
  /** 摸牌 */
  draw: () => tileDraw(),
  /** 鸣牌：三张牌连着落桌，比单张重 */
  meld: () => { for (let i = 0; i < 3; i++) tileDrop(1.15, 0.035 * i); },
  /** 杠：四张，更沉 */
  kan: () => { for (let i = 0; i < 4; i++) tileDrop(1.25, 0.032 * i); burst({ at: 0, dur: 0.22, freq: 700, q: 1.4, gain: 0.18 }); },

  /** 立直：把点棒放到桌上，清脆的一下 + 一个上行的二音 */
  riichi: () => {
    tileDrop(1.2);
    blip({ at: 0.06, freq: 880, dur: 0.2, gain: 0.13, type: 'triangle' });
    blip({ at: 0.16, freq: 1318.5, dur: 0.26, gain: 0.1, type: 'triangle' });
  },

  /**
   * 和牌：先把牌推倒，再给一个上行的三音。
   * 刻意留 130ms 的白 —— 直接糊上去会显得廉价，静一下反而更有分量。
   */
  win: () => {
    burst({ at: 0, dur: 0.34, freq: 1900, q: 0.6, gain: 0.22, attack: 0.03 });
    [523.25, 659.25, 783.99].forEach((f, i) =>
      blip({ at: 0.13 + i * 0.085, freq: f, dur: 0.42, gain: 0.16, type: 'triangle' }));
  },

  /** 流局：下行两音，克制、不悲伤 */
  drawEnd: () => {
    [392, 311.13].forEach((f, i) => blip({ at: i * 0.15, freq: f, dur: 0.42, gain: 0.13, type: 'sine' }));
  },

  /** 翻宝牌 */
  dora: () => {
    burst({ at: 0, dur: 0.07, freq: 3200, q: 1.3, gain: 0.2 });
    blip({ at: 0.03, freq: 1046.5, dur: 0.16, gain: 0.08, type: 'triangle' });
  },

  /** 开局：理牌的一声轻响 */
  handStart: () => { tileSlide(); tileDraw(0.06); },

  /** UI 按钮：极短极轻的一下，几乎只是个触感确认。但得真听得见 —— 起初设成 0.07，
   *  过完主音量只剩 0.019（≈ −34 dBFS），笔记本喇叭上基本等于没有。 */
  click: () => burst({ at: 0, dur: 0.02, freq: 5200, q: 1.0, gain: 0.12, attack: 0.0006 }),

  /** 练习答对：上行大二度，明亮但不吵 */
  correct: () => {
    blip({ at: 0, freq: 659.25, dur: 0.13, gain: 0.14, type: 'triangle' });
    blip({ at: 0.08, freq: 880, dur: 0.2, gain: 0.13, type: 'triangle' });
  },

  /** 练习答错：下行小二度。**故意不刺耳** —— 学习工具不该惩罚用户 */
  wrong: () => {
    blip({ at: 0, freq: 311.13, dur: 0.14, gain: 0.12, type: 'sine' });
    blip({ at: 0.09, freq: 277.18, dur: 0.2, gain: 0.1, type: 'sine' });
  },

  /** 通关：三音上行 */
  levelUp: () => {
    [587.33, 739.99, 880].forEach((f, i) =>
      blip({ at: i * 0.075, freq: f, dur: 0.3, gain: 0.13, type: 'triangle' }));
  },

  /** 轮到你了：一声极轻的提示，不抢戏 —— 但也要够听见，理由同 click */
  yourTurn: () => blip({ at: 0, freq: 1046.5, dur: 0.12, gain: 0.12, type: 'sine' }),
};

/**
 * 播放一个音效。
 * @param {keyof BANK} name
 */
export function play(name) {
  if (!enabled) return;
  const fn = BANK[name];
  if (!fn) return;
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();

  // 限流：短时间内堆太多声音只会糊成噪音。重要声音不受限。
  if (!PRIORITY.has(name)) {
    const now = Date.now();
    if (now - recentAt > BURST_WINDOW) { recentAt = now; recent = 0; }
    if (++recent > BURST_MAX) return;
  }

  try { fn(); } catch { /* 音频永远不该让游戏崩 */ }
}

/** 供测试用：列出了哪些名字是有效的 */
export const SOUND_NAMES = Object.keys(BANK);
