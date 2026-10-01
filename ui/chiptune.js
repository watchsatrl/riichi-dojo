/**
 * ui/chiptune.js —— NES 风格音源 + 音序器 + 背景音乐
 *
 * 为什么是合成而不是音频文件：单文件交付不能带外部资源。
 * 一分钟的循环即使压到 32kbps 单声道也要 240KB，base64 之后 +320KB —— 文件直接翻倍。
 * 而 8-bit 的音色（方波 + 三角波 + 噪声）**可以完全实时合成，体积是零**。
 *
 * 乐谱写成数据（音符 + 时值），几百字节就能存下一整首曲子，
 * 再用 8-bit 音色现场演奏。所以这里放的是**真正谱写过的旋律**，不是随机生成。
 *
 * ── 曲目 ────────────────────────────────────────────────────────
 * Erik Satie《Gymnopédie No. 1》（1888）。
 * 音符与和声取自 Mutopia Project 的公有领域 LilyPond 谱源
 * （https://www.mutopiaproject.org/ftp/SatieE/gymnopedie_1/gymnopedie_1.ly，
 *   license = "Public Domain"）。
 * 音区选择与配器是改编决定 —— 8-bit 编制只有三个声道，不可能照搬钢琴谱。
 *
 * ── 为什么选这首 ────────────────────────────────────────────────
 * 它标着「Lent et douloureux」（缓慢而痛苦），3/4 拍，刻意不抢注意力。
 * 麻将一局可能打十分钟，而玩家在思考 —— 音乐必须比音效更轻。
 */

/* ══ 音高换算 ═══════════════════════════════════════════════════ */

const STEP = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 };

/** 'f#5' → MIDI 音高（C4 = 60） */
export function midiOf(name) {
  const m = /^([a-g]#?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`看不懂的音名：${name}`);
  return STEP[m[1]] + (Number(m[2]) + 1) * 12;
}

/* ══ 乐谱 ═══════════════════════════════════════════════════════ */
/*
 * 每个小节三项：低音 · 和弦 · 旋律。
 * 旋律写成 [拍号, 音名, 时值(拍)]，拍号从 1 开始，时值默认 1 拍。
 * 3/4 拍，每小节 3 拍。
 *
 * 前 4 小节是引子（只有伴奏），旋律从第 5 小节进入 —— 和原谱一致。
 */
export const GYMNOPEDIE = [
  // ── 引子：Gmaj7 ↔ Dmaj7 交替 ──
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [] },
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [] },
  // ── 第一乐句 ──
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [[2, 'f#5', 1], [3, 'a5', 1]] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [[1, 'g5', 1], [2, 'f#5', 1], [3, 'c#5', 1]] },
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [[1, 'b4', 1], [2, 'c#5', 1], [3, 'd5', 1]] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [[1, 'a4', 3]] },
  // ── 长音：原谱在这里让旋律停住，伴奏继续 ──
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [[1, 'f#4', 3]] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [[1, 'f#4', 3]] },
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [[1, 'f#4', 3]] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [[1, 'f#4', 3]] },
  // ── 第二乐句：同一句的再现，收尾不同 ──
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [[2, 'f#5', 1], [3, 'a5', 1]] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [[1, 'g5', 1], [2, 'f#5', 1], [3, 'c#5', 1]] },
  { bass: 'g2', chord: ['b3', 'd4', 'f#4'], melody: [[1, 'b4', 1], [2, 'c#5', 1], [3, 'd5', 1]] },
  { bass: 'd3', chord: ['a3', 'c#4', 'f#4'], melody: [[1, 'a4', 3]] },
];

/* ══ 音源 ═══════════════════════════════════════════════════════ */

let ctx = null;
let master = null;
let noiseBuf = null;
let waveCache = null;

const BPM = 58;                       // 「Lent et douloureux」——慢，但不能拖到散架
const BEAT = 60 / BPM;
const BAR = BEAT * 3;

export { BPM, BEAT, BAR };

function ensure() {
  if (ctx) return true;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    waveCache = new Map();
  } catch { ctx = null; return false; }
  return true;
}

/**
 * 脉冲波。NES 的两个方波声道各有 12.5% / 25% / 50% / 75% 四种占空比，
 * 音色差别很大 —— 用 PeriodicWave 按占空比展开傅里叶级数才是真的像。
 */
function pulseWave(duty) {
  if (waveCache.has(duty)) return waveCache.get(duty);
  const n = 24;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  waveCache.set(duty, w);
  return w;
}

/** 一条方波声部 */
function pulse(freq, at, dur, gain, duty = 0.5) {
  const o = ctx.createOscillator();
  o.setPeriodicWave(pulseWave(duty));
  o.frequency.value = freq;
  const g = ctx.createGain();
  // 起音 8ms、释音 30ms —— 太陡会有咔嗒声，太缓就不像 8-bit 了
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.setValueAtTime(gain, at + Math.max(0.01, dur - 0.03));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(master);
  o.start(at); o.stop(at + dur + 0.02);
}

/** 三角波：NES 的低音声道，一个八度内很干净 */
function triangle(freq, at, dur, gain) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.02);
  g.gain.setValueAtTime(gain, at + Math.max(0.02, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(master);
  o.start(at); o.stop(at + dur + 0.02);
}

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* ══ 音序器 ═════════════════════════════════════════════════════ */

let timer = null;
let nextTime = 0;
let barIndex = 0;

/**
 * 提前排程，而不是用 setTimeout 卡着点发声。
 * setTimeout 的抖动在音乐里非常明显，必须按 AudioContext 的时钟预先排好。
 */
const LOOKAHEAD = 1.2;                // 提前排 1.2 秒

/**
 * 一小节里要发出的全部音 —— **纯函数，不碰音频**。
 *
 * 抽出来是为了能测：合成了什么是可以量的，而「第 5 小节少了一个音」
 * 这种事光靠耳朵听、靠读代码都容易漏。
 *
 * @returns {Array<[offset秒, midi, 声部, 时长秒, 音量]>}
 */
export function barEvents(bar) {
  const out = [[0, midiOf(bar.bass), 'bass', BAR * 0.98, 0.28]];
  for (const n of bar.chord) out.push([0.02, midiOf(n), 'chord', BAR * 0.94, 0.055]);
  for (const [beat, name, len = 1] of bar.melody) {
    out.push([(beat - 1) * BEAT, midiOf(name), 'melody', len * BEAT * 0.96, 0.17]);
  }
  return out;
}

function scheduleBar(bar, at) {
  for (const [off, m, voice, dur, gain] of barEvents(bar)) {
    if (voice === 'bass') triangle(hz(m), at + off, dur, gain);
    else pulse(hz(m), at + off, dur, gain, voice === 'chord' ? 0.25 : 0.5);
  }
  return at + BAR;
}

function pump() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    nextTime = scheduleBar(GYMNOPEDIE[barIndex], nextTime);
    barIndex = (barIndex + 1) % GYMNOPEDIE.length;
  }
  timer = setTimeout(pump, 300);
}

/* ══ 对外接口 ═══════════════════════════════════════════════════ */

const STORE_KEY = 'mahjong-bgm-v1';

let playing = false;
let enabled = true;
/*
 * 默认音量刻意压得很低（音效是 0.32，这里只有一半）。
 * 音乐是氛围，音效是信息 —— 在一局可能打十分钟、玩家还在算牌的场合，
 * 音乐稍微响一点就从「背景」变成「干扰」。
 */
let volume = 0.16;

function loadSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (typeof o.enabled === 'boolean') enabled = o.enabled;
    if (typeof o.volume === 'number') volume = Math.min(0.6, Math.max(0, o.volume));
  } catch { /* 隐私模式静默降级 */ }
}

function saveSettings() {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify({ enabled, volume }));
  } catch { /* 同上 */ }
}

function emit() {
  try { globalThis.document?.dispatchEvent(new CustomEvent('mj:bgm-changed')); } catch { /* Node */ }
}

loadSettings();

export const isPlaying = () => playing;
export const isBgmEnabled = () => enabled;
export const getBgmVolume = () => volume;

export function setBgmEnabled(on) {
  enabled = !!on;
  saveSettings();
  syncBgm();
  emit();
  return enabled;
}

export const toggleBgm = () => setBgmEnabled(!enabled);

export function setBgmVolume(v) {
  volume = Math.min(0.6, Math.max(0, v));
  saveSettings();
  if (playing) fadeTo(volume, 0.2);
  emit();
}

/** 按当前设置应用：开着就播，关了就停。由 app 在用户手势之后调用。 */
export function syncBgm() {
  if (enabled) startBgm(volume);
  else stopBgm();
}

/** 开始播放。重复调用是安全的。 */
export function startBgm(vol = volume) {
  if (playing) return true;
  if (!ensure()) return false;
  if (ctx.state === 'suspended') ctx.resume();

  // 淡入 —— 音乐突然出现比没有音乐更糟
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(0.0001, t);
  master.gain.linearRampToValueAtTime(Math.max(0.0001, vol), t + 1.6);

  nextTime = t + 0.1;
  barIndex = 0;
  playing = true;
  pump();
  return true;
}

/** 停（淡出）。 */
export function stopBgm() {
  if (!playing || !ctx) return;
  playing = false;
  clearTimeout(timer);
  timer = null;
  fadeTo(0.0001, 0.5);
}

function fadeTo(v, seconds) {
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
  master.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + seconds);
}

/** 测试用：这份谱子的基本信息 */
export const SCORE_INFO = {
  title: 'Gymnopédie No. 1',
  composer: 'Erik Satie',
  year: 1888,
  license: 'Public Domain',
  source: 'Mutopia Project',
  bars: GYMNOPEDIE.length,
  bpm: BPM,
  beatsPerBar: 3,
};
