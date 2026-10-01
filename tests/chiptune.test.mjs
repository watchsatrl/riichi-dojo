/**
 * 背景音乐的校验
 * =====================================================================
 * 音乐没法在这里听，但**乐谱数据是可以验的** —— 而且必须验：
 * 一个音名拼错、一个小节超过拍数、一个时值写反，都会让整首曲子在某处
 * 听起来莫名其妙地不对，而那种错误光看代码是发现不了的。
 *
 * 这里也顺便钉死「曲目来源」：音符取自 Mutopia 的公有领域谱源，
 * 不是凭记忆默写的。改名、改作曲家、改许可都要在这里留痕。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  midiOf, GYMNOPEDIE, SCORE_INFO, barEvents, BAR,
  startBgm, stopBgm, isPlaying, isBgmEnabled, setBgmEnabled, getBgmVolume, toggleBgm,
} from '../ui/chiptune.js';

/* ═══ 音高换算 ═══════════════════════════════════════════════════ */

test('音高换算：C4 = 60，八度差 12', () => {
  assert.equal(midiOf('c4'), 60, 'C4 必须是 MIDI 60（中央 C）');
  assert.equal(midiOf('c5'), 72);
  assert.equal(midiOf('c3'), 48);
  assert.equal(midiOf('a4'), 69, 'A4 必须是 440Hz（MIDI 69）');
  assert.equal(midiOf('f#5'), 78);
  assert.equal(midiOf('g2'), 43);
  assert.throws(() => midiOf('h4'), /看不懂的音名/, '非法音名必须报错，不能静默当成 0');
});

/* ═══ 乐谱数据 ═══════════════════════════════════════════════════ */

test('乐谱：每个音名都能解析，没有一个拼错', () => {
  for (const [i, bar] of GYMNOPEDIE.entries()) {
    assert.doesNotThrow(() => midiOf(bar.bass), `第 ${i + 1} 小节的低音「${bar.bass}」拼错了`);
    for (const n of bar.chord) {
      assert.doesNotThrow(() => midiOf(n), `第 ${i + 1} 小节的和弦音「${n}」拼错了`);
    }
    for (const [, name] of bar.melody) {
      assert.doesNotThrow(() => midiOf(name), `第 ${i + 1} 小节的旋律音「${name}」拼错了`);
    }
  }
});

test('乐谱：3/4 拍，旋律不能越出小节', () => {
  const BEATS = SCORE_INFO.beatsPerBar;
  assert.equal(BEATS, 3, '这首是 3/4 拍');

  for (const [i, bar] of GYMNOPEDIE.entries()) {
    assert.equal(bar.chord.length, 3, `第 ${i + 1} 小节的和弦应当是三和音`);

    let end = 0;
    for (const [beat, , len = 1] of bar.melody) {
      assert.ok(beat >= 1 && beat <= BEATS, `第 ${i + 1} 小节的旋律拍号 ${beat} 越界`);
      assert.ok(len > 0, `第 ${i + 1} 小节有非正时值`);
      end = Math.max(end, beat - 1 + len);
    }
    assert.ok(end <= BEATS + 1e-9,
      `第 ${i + 1} 小节的旋律一共 ${end} 拍，超过了 ${BEATS} 拍 —— 会盖到下一小节上去`);
  }
});

test('乐谱：音区合理，不会写出人耳听不见或刺耳的音', () => {
  const all = [];
  for (const bar of GYMNOPEDIE) {
    all.push(['bass', midiOf(bar.bass)]);
    for (const n of bar.chord) all.push(['chord', midiOf(n)]);
    for (const [, n] of bar.melody) all.push(['melody', midiOf(n)]);
  }
  for (const [part, m] of all) {
    // 低音别掉到钢琴最低音以下（A0 = 21），旋律别高过 C7 = 96
    assert.ok(m >= 33, `${part} 的音高 MIDI ${m} 太低，超出合理音区`);
    assert.ok(m <= 96, `${part} 的音高 MIDI ${m} 太高，会刺耳`);
  }
  // 声部之间要分得开，不然三个声道糊成一团
  const bassTop = Math.max(...GYMNOPEDIE.map((b) => midiOf(b.bass)));
  const melBottom = Math.min(...GYMNOPEDIE.flatMap((b) => b.melody.map(([, n]) => midiOf(n))));
  assert.ok(bassTop < melBottom,
    `低音最高到 MIDI ${bassTop}，旋律最低到 ${melBottom} —— 声部交叠了`);
});

test('乐谱：Gmaj7 ↔ Dmaj7 的交替与原谱一致', () => {
  // 原谱前 16 小节的伴奏是「低音 G↔D，和弦 Bm↔F#m」，合起来就是 Gmaj7 与 Dmaj7 交替。
  // 这是这首曲子最好认的特征，写错了整首就不像了。
  for (let i = 0; i < 16; i += 2) {
    assert.equal(GYMNOPEDIE[i].bass, 'g2', `第 ${i + 1} 小节低音应当是 G`);
    assert.deepEqual(GYMNOPEDIE[i].chord, ['b3', 'd4', 'f#4'],
      `第 ${i + 1} 小节应当是 Bm 和弦（和 G 组成 Gmaj7）`);
    assert.equal(GYMNOPEDIE[i + 1].bass, 'd3', `第 ${i + 2} 小节低音应当是 D`);
    assert.deepEqual(GYMNOPEDIE[i + 1].chord, ['a3', 'c#4', 'f#4'],
      `第 ${i + 2} 小节应当是 F#m 和弦（和 D 组成 Dmaj7）`);
  }
});

test('乐谱：开头四小节是引子，旋律从第五小节进', () => {
  for (let i = 0; i < 4; i++) {
    assert.equal(GYMNOPEDIE[i].melody.length, 0, `第 ${i + 1} 小节应当是纯伴奏的引子`);
  }
  assert.ok(GYMNOPEDIE[4].melody.length > 0, '第 5 小节旋律应当进来了');
});

/* ═══ 实际会发出什么声音 ═════════════════════════════════════════ */

test('发声：每小节确实是「1 低音 + 3 和弦 + 旋律」', () => {
  for (const [i, bar] of GYMNOPEDIE.entries()) {
    const ev = barEvents(bar);
    const byVoice = { bass: 0, chord: 0, melody: 0 };
    for (const [, , v] of ev) byVoice[v]++;

    assert.equal(byVoice.bass, 1, `第 ${i + 1} 小节应当只有一条低音声部`);
    assert.equal(byVoice.chord, 3, `第 ${i + 1} 小节应当是三和音`);
    assert.equal(byVoice.melody, bar.melody.length,
      `第 ${i + 1} 小节的旋律音数对不上`);
  }
});

test('发声：所有音都落在本小节之内，不会溢到下一小节', () => {
  for (const [i, bar] of GYMNOPEDIE.entries()) {
    for (const [off, midi, voice, dur] of barEvents(bar)) {
      assert.ok(off >= 0, `第 ${i + 1} 小节的 ${voice} 起点是负的`);
      assert.ok(off + dur <= BAR + 1e-6,
        `第 ${i + 1} 小节的 ${voice}（MIDI ${midi}）从 ${off.toFixed(2)}s 持续 ${dur.toFixed(2)}s，`
        + `超出小节长度 ${BAR.toFixed(2)}s —— 会盖到下一小节`);
    }
  }
});

test('发声：三个声部的层次是对的 —— 旋律领奏、低音托底、和弦垫底', () => {
  /*
   * 这里比的是「听起来的响度」，不是振幅。
   * 三角波的能量几乎全在基频，**同样的振幅听起来明显比方波轻** ——
   * 所以低音的数值故意给得比旋律高，这不是笔误。
   * 0.5 是个近似系数，只用来做数量级判断，不是精确的等响曲线。
   */
  const WEIGHT = { bass: 0.5, chord: 1, melody: 1 };

  /** 同一时刻发声的多个音按功率叠加 */
  function levels(bar) {
    const acc = { bass: 0, chord: 0, melody: 0 };
    for (const [, , voice, , g] of barEvents(bar)) acc[voice] += ((g) * WEIGHT[voice]) ** 2;
    return {
      bass: Math.sqrt(acc.bass), chord: Math.sqrt(acc.chord), melody: Math.sqrt(acc.melody),
    };
  }

  let checked = 0;
  for (const [i, bar] of GYMNOPEDIE.entries()) {
    if (!bar.melody.length) continue;              // 引子没有旋律，不适用
    const L = levels(bar);
    checked++;
    assert.ok(L.melody > L.bass,
      `第 ${i + 1} 小节：旋律响度 ${L.melody.toFixed(3)} 没有超过低音 ${L.bass.toFixed(3)}，`
      + '旋律会被人听成伴奏');
    assert.ok(L.bass > L.chord,
      `第 ${i + 1} 小节：低音 ${L.bass.toFixed(3)} 没有超过和弦 ${L.chord.toFixed(3)}`);
    assert.ok(L.chord > 0.05, `第 ${i + 1} 小节：和弦太轻（${L.chord.toFixed(3)}），等于没有`);
    assert.ok(L.melody < 0.4, `第 ${i + 1} 小节：旋律太响（${L.melody.toFixed(3)}）—— 这是背景音乐`);
  }
  assert.ok(checked >= 8, `只检查了 ${checked} 个有旋律的小节，覆盖不够`);
});

test('发声：这是一首慢曲 —— 一小节三拍，时长在合理范围', () => {
  // ♩=58、3/4 拍 → 一小节约 3.1 秒。太快就不是「Lent et douloureux」了。
  assert.ok(BAR > 2.5 && BAR < 3.6, `一小节 ${BAR.toFixed(2)} 秒，速度不对`);
  // 整首循环的长度：这个长度决定听多久会开始觉得重复
  const loop = BAR * GYMNOPEDIE.length;
  assert.ok(loop > 40, `整个循环只有 ${loop.toFixed(1)} 秒，太短会听腻`);
});

/* ═══ 曲目来源 ═══════════════════════════════════════════════════ */

test('曲目：来源与许可是记下来的，不是凭记忆默写的', () => {
  assert.equal(SCORE_INFO.title, 'Gymnopédie No. 1');
  assert.equal(SCORE_INFO.composer, 'Erik Satie');
  assert.equal(SCORE_INFO.year, 1888);
  assert.equal(SCORE_INFO.license, 'Public Domain',
    '必须是公有领域作品 —— 版权曲目不能内嵌');
  assert.match(SCORE_INFO.source, /Mutopia/, '要记下谱源，否则无从复核');
  assert.ok(SCORE_INFO.bpm > 40 && SCORE_INFO.bpm < 80,
    `速度 ${SCORE_INFO.bpm} 不合适 —— 原谱标的是「Lent et douloureux」（缓慢）`);
});

/* ═══ 播放控制 ═══════════════════════════════════════════════════ */

test('播放：没有 AudioContext 的环境静默降级，不抛异常', () => {
  assert.equal(typeof globalThis.AudioContext, 'undefined', '（前提）Node 里没有 AudioContext');
  assert.doesNotThrow(() => startBgm());
  assert.equal(isPlaying(), false, '没有音频环境时不该声称自己在播');
  assert.doesNotThrow(() => stopBgm());
  assert.doesNotThrow(() => setBgmEnabled(false));
  assert.doesNotThrow(() => setBgmEnabled(true));
});

test('播放：默认开着，音量刻意比音效低', () => {
  assert.equal(isBgmEnabled(), true, '默认应当开着 —— 用户要的就是背景音乐');
  const v = getBgmVolume();
  assert.ok(v > 0 && v <= 0.25,
    `音乐默认音量 ${v} 太高。音乐是氛围、音效是信息，一局可能打十分钟，音乐响一点就从背景变成干扰`);
});

test('播放：开关能切换，重复设置同一个值是安全的', () => {
  const before = isBgmEnabled();
  toggleBgm();
  assert.equal(isBgmEnabled(), !before);
  toggleBgm();
  assert.equal(isBgmEnabled(), before);

  setBgmEnabled(false);
  setBgmEnabled(false);          // 幂等
  assert.equal(isBgmEnabled(), false);
  setBgmEnabled(true);
  assert.equal(isBgmEnabled(), true);
});
