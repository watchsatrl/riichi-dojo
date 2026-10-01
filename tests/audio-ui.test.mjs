/**
 * 音效与牌桌动效的校验
 * =====================================================================
 * 声音没法在这里听，但**合成过程是可以用假的 AudioContext 记下来的** ——
 * 记下来就能验证三件真正影响听感的事：
 *
 *   ① 音量在合理区间。爆音和听不见都是 bug，不是审美。
 *   ② 每次有微小随机。同一个打牌声重复上百次而毫无变化，是这个游戏
 *      最容易让人关掉声音的原因。
 *   ③ 限流生效。一帧里堆几十个声音只会糊成噪音。
 *
 * 另外验证牌桌的动画闸门：整块 innerHTML 每次事件都重建，动画类如果无脑挂上，
 * 牌河最后一张会每帧重新「啪」一次。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/* ── 假的 Web Audio ───────────────────────────────────────────── */

const made = { gains: [], oscs: [], srcs: [], filters: [] };

class Param {
  constructor(v) { this.value = v; this.ramps = []; }
  setValueAtTime(v, t) { this.value = v; this.ramps.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.value = v; this.ramps.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.value = v; this.ramps.push(['exp', v, t]); return this; }
}

class Node {
  constructor(kind) {
    this.kind = kind;
    this.gain = new Param(1);
    this.frequency = new Param(440);
    this.Q = new Param(1);
    this.playbackRate = new Param(1);
    this.type = '';
    this.started = 0;
  }
  connect(n) { return n; }
  start(t) { this.started = t; }
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new Node('dest');
  }
  createGain() { const n = new Node('gain'); made.gains.push(n); return n; }
  createOscillator() { const n = new Node('osc'); made.oscs.push(n); return n; }
  createBufferSource() { const n = new Node('src'); made.srcs.push(n); return n; }
  createBiquadFilter() { const n = new Node('filt'); made.filters.push(n); return n; }
  createBuffer(ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; }
}

function reset() {
  made.gains.length = 0; made.oscs.length = 0; made.srcs.length = 0; made.filters.length = 0;
}

globalThis.AudioContext = FakeAudioContext;
globalThis.localStorage = undefined;      // 走「存不了」的降级路径

// 可控时钟：限流是按真实时间算的，测试跑得比 60ms 快得多，
// 不接管时间的话第一次之后的声音全会被当成「同一瞬间」而丢掉。
let clock = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => clock;
const tick = (ms = 500) => { clock += ms; };

const audio = await import('../ui/audio.js');

/** 找出这一次发声里所有包络的峰值音量 */
function peaks() {
  return made.gains.flatMap((g) => g.gain.ramps.filter(([k]) => k === 'lin').map(([, v]) => v));
}
/** 这一次发声用到的所有中心频率 */
function freqs() {
  return [...made.filters.map((f) => f.frequency.value), ...made.oscs.map((o) => o.frequency.value)];
}

/**
 * 某条包络在 t 时刻的值（t 从 0 开始，对应 AudioContext.currentTime）。
 * 录音里记的是 setValueAtTime / linearRamp / exponentialRamp 三种调用，
 * 这里把它们还原成一条可求值的曲线。
 */
function envelopeAt(g, t) {
  const r = g.gain.ramps;
  if (!r.length) return 0;
  if (t <= r[0][2]) return 0;
  for (let i = 1; i < r.length; i++) {
    const [, v0, t0] = r[i - 1];
    const [k1, v1, t1] = r[i];
    if (t <= t1) {
      const u = (t - t0) / Math.max(1e-6, t1 - t0);
      if (k1 === 'lin') return v0 + (v1 - v0) * u;
      return v0 * Math.pow(Math.max(v1, 1e-6) / Math.max(v0, 1e-6), u);
    }
  }
  return r[r.length - 1][1];
}

/**
 * 这次发声里，**所有包络叠加之后的峰值**。
 *
 * 关键在于必须叠加：一个「杠」是四张牌连着落桌，每条包络单独看都不大，
 * 但它们在同一时刻是相加的 —— 只看单条包络会完全漏掉爆音。
 * 主音量节点没有包络，会被过滤掉。
 *
 * 注意单位：包络的时间轴是**秒**（AudioContext 的惯例），别拿毫秒去比。
 */
function peakSum(seconds = 0.9) {
  const gains = made.gains.filter((g) => g.gain.ramps.length);
  let max = 0;
  for (let t = 0; t < seconds; t += 0.0005) {      // 0.5ms 一步
    let s = 0;
    for (const g of gains) s += envelopeAt(g, t);
    if (s > max) max = s;
  }
  return max;
}

/* ═══ 基本行为 ═══════════════════════════════════════════════════ */

test('音效库：该有的声音都在，而且没有重复键', () => {
  const names = audio.SOUND_NAMES;
  for (const n of ['discard', 'draw', 'meld', 'kan', 'riichi', 'win', 'drawEnd',
    'dora', 'handStart', 'click', 'correct', 'wrong', 'levelUp']) {
    assert.ok(names.includes(n), `缺少音效「${n}」`);
  }
  assert.equal(new Set(names).size, names.length, '音效名有重复');
});

test('音效：未知名字、无声环境都不会抛异常', () => {
  reset();
  tick();
  assert.doesNotThrow(() => audio.play('这个名字不存在'));
  assert.equal(made.gains.length, 0, '未知名字不应该产生任何声音');

  // 没有 AudioContext 的环境（Node / 老浏览器）必须静默降级
  const saved = globalThis.AudioContext;
  globalThis.AudioContext = undefined;
  tick();
  assert.doesNotThrow(() => audio.play('click'));
  globalThis.AudioContext = saved;
});

/* ═══ 听感的三条硬指标 ═══════════════════════════════════════════ */

test('听感①：叠加之后的峰值不爆音，也不会小到听不见', () => {
  const vol = audio.getVolume();
  for (const name of audio.SOUND_NAMES) {
    reset();
    tick();                                // 每个音效隔开，避免被限流吞掉
    audio.play(name);

    const peak = peakSum();
    assert.ok(peak > 0, `音效「${name}」没有产生任何包络，等于没声音`);

    // 经过主音量之后才是真正送进声卡的电平
    const out = peak * vol;
    assert.ok(out <= 1.0,
      `音效「${name}」叠加峰值 ${out.toFixed(2)}（× 主音量 ${vol}）会削波爆音`);
    assert.ok(out >= 0.03,
      `音效「${name}」叠加峰值只有 ${out.toFixed(3)}（≈ ${(20 * Math.log10(out)).toFixed(0)} dBFS），`
      + '过完主音量之后笔记本喇叭上基本听不见');
  }
});

test('听感①b：牌声逐张加重，但不能越加越爆', () => {
  // 单张 < 碰 < 杠，这是刻意的层次；但最重的那个也得在安全线内
  const level = (name) => { reset(); tick(); audio.play(name); return peakSum() * audio.getVolume(); };
  const one = level('discard');
  const pon = level('meld');
  const kan = level('kan');
  assert.ok(pon > one, `碰（${pon.toFixed(2)}）应该比单张打牌（${one.toFixed(2)}）重`);
  assert.ok(kan > pon, `杠（${kan.toFixed(2)}）应该比碰（${pon.toFixed(2)}）重`);
  assert.ok(kan <= 1.0, `最重的杠叠加峰值 ${kan.toFixed(2)}，会爆音`);
});

test('听感②：同一个音效每次发声都有微小随机 —— 否则重复上百次会让人立刻关掉声音', () => {
  const vary = (name, pick) => {
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      reset();
      tick();
      audio.play(name);
      seen.add(pick());
    }
    return seen.size;
  };

  const freqVariants = vary('discard', () => freqs().map((f) => Math.round(f)).join(','));
  assert.ok(freqVariants >= 3,
    `打牌声 6 次只出现 ${freqVariants} 种音高组合 —— 随机化没生效，听感会很机械`);

  const drawVariants = vary('draw', () => freqs().map((f) => Math.round(f)).join(','));
  assert.ok(drawVariants >= 3, `摸牌声只有 ${drawVariants} 种变化`);
});

test('听感③：限流生效 —— 一帧里堆几十个声音只会糊成噪音', () => {
  reset();
  // 这里**故意不推进时钟**，全部落在同一个窗口
  for (let i = 0; i < 20; i++) audio.play('discard');

  const grains = made.srcs.length;        // 每个「牌落桌」用 2 个噪声源
  assert.ok(grains <= 4 * 2,
    `限流没生效：同一窗口里放出了 ${grains} 个噪声源（应当 ≤ 8）`);
});

test('听感④：重要声音不会被限流吞掉', () => {
  reset();
  for (let i = 0; i < 20; i++) audio.play('discard');   // 先把窗口挤满
  const before = made.gains.length;

  audio.play('win');                                    // 同一瞬间的和牌声必须响
  assert.ok(made.gains.length > before,
    '限流把和牌声吞了 —— 玩家会觉得游戏卡了一下，比多响一声糟糕得多');

  for (const name of ['riichi', 'levelUp', 'correct', 'wrong']) {
    const n = made.gains.length;
    audio.play(name);
    assert.ok(made.gains.length > n, `重要声音「${name}」被限流吞掉了`);
  }
});

test('设置：音量可调且被夹在 0–1，默认音量偏小', () => {
  const def = audio.getVolume();
  assert.ok(def > 0 && def <= 0.4,
    `默认音量 ${def} 不合适 —— 默认开满是最常见的听感灾难`);

  audio.setVolume(-5);
  assert.equal(audio.getVolume(), 0);
  audio.setVolume(99);
  assert.equal(audio.getVolume(), 1);
  audio.setVolume(0.5);
  assert.equal(audio.getVolume(), 0.5);
});

test('设置：静音后不再产生任何声音', () => {
  audio.setEnabled(false);
  assert.equal(audio.isEnabled(), false);
  reset();
  tick();
  audio.play('discard');
  audio.play('win');                       // 连不限流的声音也不该响
  assert.equal(made.gains.length, 0, '静音状态下仍然发出了声音');

  audio.setEnabled(true);
  reset();
  tick();
  audio.play('discard');
  assert.ok(made.gains.length > 0, '取消静音后没有恢复发声');
});

/* ═══ 牌桌动效闸门 ═══════════════════════════════════════════════ */

test('动效闸门：同一帧重复渲染不再播动画，内容变了才播', async () => {
  const { renderTable, resetTableAnimation } = await import('../play/src/table.js');

  const view = {
    mySeat: 0, turn: 0, dealer: 0, phase: 'draw', legal: [], dora: [], roundWind: 0,
    wallCount: 60, honba: 0, sticks: 0, riichi: [false, false, false, false],
    players: [0, 1, 2, 3].map((seat) => ({
      seat, wind: seat, score: 25000, hand: seat === 0 ? 13 : 13,
      pond: [], melds: [], riichi: false, furiten: false, drawn: null,
    })),
  };
  view.players[0].hand = Array(13).fill(0);

  resetTableAnimation();
  const first = renderTable(view);
  const second = renderTable(view);          // 一模一样地再渲染一次

  assert.ok(/class="table anim"/.test(first), '第一次渲染应当允许播动画');
  assert.ok(!/class="table anim"/.test(second),
    '内容没变却又挂了 anim —— 牌河最后一张会每帧重新落一次，看着像抽搐');

  // 牌河变长了 → 该播
  view.players[1].pond = [5];
  const third = renderTable(view);
  assert.ok(/class="table anim"/.test(third), '内容变了却没播动画');
});
