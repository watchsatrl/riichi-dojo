/**
 * shanten.js 单元测试
 * =====================================================================
 * 覆盖（本任务的重点文件）：
 *   1. 手工边界案例：国士十三面、九莲宝灯、四暗刻单骑、七对子（4 张不能当两对）、
 *      一杯口 / 二杯口、平和、副露 1–4 组、全字牌刻子手
 *   2. 三重交叉验证：
 *      (a) 自洽性：shanten(h)===0 ⟺ ∃t 使 h+t 为和牌形；shanten(h)=n>0 ⟹ ∃t 使 n 降为 n-1
 *          （6000 个定种子随机手牌，覆盖 0–4 副露）
 *      (b) 双实现对照：法一（递归拆除 + 到数公式 + 张数可行性）vs 法二（按花色 DP 最小补充张数）
 *      (c) 穷举小规模：全部 1/2/4 张手牌 vs 暴力枚举目标和牌形；子集上穷举 7 张手牌
 *   3. 性能：单次 shanten() 远低于 10ms
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyHand, handToStr, parseHand } from '../engine/tiles.js';
import { isAgari } from '../engine/agari.js';
import {
  clearShantenCache,
  shanten,
  shantenChiitoi,
  shantenKokushi,
  shantenStandard,
  shantenStandardDP,
  shantenStandardRec,
} from '../engine/shanten.js';

/** 所有面子（34 刻子 + 21 顺子） @type {number[][]} */
const ALL_MENTSU = (() => {
  const out = [];
  for (let z = 0; z < 34; z++) out.push([z, z, z]);
  for (let s = 0; s < 3; s++) for (let r = 0; r < 7; r++) out.push([s * 9 + r, s * 9 + r + 1, s * 9 + r + 2]);
  return out;
})();

/**
 * 定种子伪随机数（可复现）。
 *
 * @param {number} seed 种子
 * @returns {() => number} [0,1) 随机数
 */
function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成随机手牌（一半是“有结构”的手牌，一半是纯随机）。
 *
 * @param {() => number} rnd 随机源
 * @param {number} size 目标张数
 * @param {boolean} structured 是否先堆刻子/对子
 * @returns {number[]|null} 计数数组
 */
function randomHand(rnd, size, structured) {
  const h = emptyHand();
  let total = 0;
  if (structured) {
    while (total + 3 <= size) {
      const t = Math.floor(rnd() * 34);
      if (h[t] <= 1) {
        h[t] += 3;
        total += 3;
      }
    }
    while (total + 2 <= size) {
      const t = Math.floor(rnd() * 34);
      if (h[t] <= 2) {
        h[t] += 2;
        total += 2;
      }
    }
  }
  let guard = 0;
  while (total < size && guard++ < 5000) {
    const t = Math.floor(rnd() * 34);
    if (h[t] < 4) {
      h[t] += 1;
      total += 1;
    }
  }
  return total === size ? h : null;
}

/**
 * 暴力参照：min over 目标和牌形 W 的补充张数 - 1（只支持 need ≤ 1 的小规模手牌）。
 *
 * @param {number[]} hand 暗牌计数数组
 * @param {number} need 需要的面子数（0 或 1）
 * @returns {number} 向听数
 */
function bruteShantenSmall(hand, need) {
  let best = Infinity;
  for (let p = 0; p < 34; p++) {
    const dPair = Math.max(0, 2 - hand[p]);
    if (need === 0) {
      if (dPair < best) best = dPair;
      continue;
    }
    for (const m of ALL_MENTSU) {
      const a = m[0];
      let d = dPair;
      let ok = true;
      if (m[0] === m[1]) {
        // 刻子
        const oldW = a === p ? 2 : 0;
        const newW = oldW + 3;
        if (newW > 4) continue;
        d += Math.max(0, newW - hand[a]) - Math.max(0, oldW - hand[a]);
      } else {
        // 顺子：三张互不相同
        for (const t of m) {
          const oldW = t === p ? 2 : 0;
          const newW = oldW + 1;
          if (newW > 4) {
            ok = false;
            break;
          }
          d += Math.max(0, newW - hand[t]) - Math.max(0, oldW - hand[t]);
        }
      }
      if (ok && d < best) best = d;
    }
  }
  return best - 1;
}

/**
 * 枚举指定牌型子集内所有张数为 size 的手牌。
 *
 * @param {number[]} types 允许的牌索引
 * @param {number} size 张数
 * @param {(hand: number[]) => void} visit 回调（hand 会被复用，勿保存）
 * @returns {void}
 */
function forEachHand(types, size, visit) {
  const hand = emptyHand();
  /** @param {number} ti @param {number} left */
  const rec = (ti, left) => {
    if (ti === types.length) {
      if (left === 0) visit(hand);
      return;
    }
    const t = types[ti];
    for (let c = 0; c <= Math.min(4, left); c++) {
      hand[t] = c;
      rec(ti + 1, left - c);
    }
    hand[t] = 0;
  };
  rec(0, size);
}

/* ------------------------------------------------------------------ *
 * 1. 手工边界案例
 * ------------------------------------------------------------------ */

test('手工案例：和牌 / 听牌 / n 向听', () => {
  // [手牌, 副露数, 期望总向听, 期望标准形向听]（省略第 4 项时与总向听相同）
  const cases = [
    ['123m456p789s11222z', 0, -1], // 和牌
    ['111m222m333m444m55m', 0, -1], // 四暗刻形
    ['11122233344455z', 0, -1], // 全字牌刻子 + 雀头
    ['112233m445566p11z', 0, -1], // 二杯口
    ['123m456m789m234p55s', 0, -1], // 平和
    ['19m19p19s12345677z', 0, -1, 7], // 国士无双（字牌不成顺子，标准形向听很高）
    ['11223344556677m', 0, -1], // 七对子（同时也是二杯口）

    ['1112345678999m', 0, 0], // 九莲宝灯（纯正形听牌）
    ['111m222m333m444m5m', 0, 0], // 四暗刻单骑听牌
    ['19m19p19s1234567z', 0, 0, 8], // 国士十三面听牌
    ['119m19p19s123456z', 0, 0, 7], // 国士单骑听牌
    ['1112223334445z', 0, 0], // 全字牌刻子 + 单骑听
    ['1122334455667m', 0, 0], // 七对子听牌（同时也是标准形三面听）
    ['123m456m789m11p45s', 0, 0], // 两面听
    ['123m456m789m11p13s', 0, 0], // 嵌张听
    ['123m456m789m11p89s', 0, 0], // 边张听
    ['123m456m789m1122p', 0, 0], // 双碰听
    ['123m456m789m11p2s6s', 0, 1], // 一向听
    ['147m147p147s1234z', 0, 6, 8], // 散牌（七对子向听更低）

    ['123m456m789m11p', 1, -1], // 副露 1 组和牌
    ['123m456m789m1p', 1, 0], // 副露 1 组听牌
    ['456m789m11p', 2, -1],
    ['456m789m1p2p', 2, 0],
    ['789m11p', 3, -1],
    ['789m1p', 3, 0],
    ['11p', 4, -1],
    ['1p', 4, 0],
  ];
  for (const [str, meldCount, expected, expectedStd] of cases) {
    const h = parseHand(str);
    const std = expectedStd === undefined ? expected : expectedStd;
    assert.equal(shanten(h, meldCount), expected, `${str} + ${meldCount} 副露`);
    assert.equal(shantenStandard(h, meldCount), std, `${str} 标准形`);
    assert.equal(shantenStandardDP(h, meldCount), std, `${str} 标准形（DP）`);
  }
});

test('三类向听各自的公式：七对子 / 国士', () => {
  // 七对子
  assert.equal(shantenChiitoi(parseHand('11223344556677m')), -1);
  assert.equal(shantenChiitoi(parseHand('1122334455667m')), 0);
  assert.equal(shantenChiitoi(parseHand('112233445566m1p')), 0); // 6 对 + 1 单张 → 听 1p
  assert.equal(shantenChiitoi(parseHand('11223344556m1p2s')), 1); // 5 对 + 3 单张
  // 4 张相同只能算 1 对：11112222333344m 只有 4 种 → 6 - 4 + 3 = 5
  assert.equal(shantenChiitoi(parseHand('11112222333344m')), 5);
  // 有副露时不可能成立
  assert.equal(shantenChiitoi(parseHand('1122334455667m'), 1), Infinity);
  assert.equal(shantenKokushi(parseHand('19m19p19s1234567z'), 1), Infinity);

  // 国士
  assert.equal(shantenKokushi(parseHand('19m19p19s12345677z')), -1);
  assert.equal(shantenKokushi(parseHand('19m19p19s1234567z')), 0); // 十三面
  assert.equal(shantenKokushi(parseHand('119m19p19s123456z')), 0); // 单骑
  assert.equal(shantenKokushi(parseHand('19m19p19s123456z')), 1); // 12 种、无对子
  assert.equal(shantenKokushi(parseHand('19m19p1s1234567z1p')), 0); // 12 种 + 已有对子（等 9s）

  // shanten() 取三者最小：纯国士手牌的标准形向听很高，但总向听是 0
  const kokushi = parseHand('19m19p19s1234567z');
  assert.equal(shantenStandardRec(kokushi, 0), 8);
  assert.equal(shanten(kokushi, 0), 0);
});

test('4 张相同的牌在标准形里也只能用 4 张（死张听牌不算听）', () => {
  // 4 张 9m + 3 组副露：形上是单骑 9m，但 9m 已全部在自己手里 → 不是听牌
  const h = parseHand('9999m');
  assert.equal(shanten(h, 3), 1);
  assert.equal(shantenStandardRec(h, 3), 1);
  assert.equal(shantenStandardDP(h, 3), 1);
  // 对照：三张 9m + 一张 5m 时是真正的单骑听牌
  assert.equal(shanten(parseHand('999m5m'), 3), 0);
});

/* ------------------------------------------------------------------ *
 * 2(a). 自洽性验证（≥5000 随机手牌）
 * ------------------------------------------------------------------ */

test('自洽性：shanten(h)=0 ⟺ ∃t 和牌；=n>0 ⟹ ∃t 使向听降 1（随机 6000 手）', () => {
  const rnd = mulberry32(0x9e3779b9);
  let checked = 0;
  let fail1 = 0;
  let fail2 = 0;
  let fail3 = 0;
  for (let i = 0; i < 6000; i++) {
    const meldCount = i % 5;
    const size = 13 - 3 * meldCount;
    const h = randomHand(rnd, size, rnd() < 0.5);
    if (!h) continue;
    checked++;
    const s = shanten(h, meldCount);
    let canWin = false;
    let minNext = Infinity;
    for (let t = 0; t < 34; t++) {
      if (h[t] >= 4) continue; // 第 5 张不可能存在
      h[t] += 1;
      if (isAgari(h, meldCount)) canWin = true;
      const next = shanten(h, meldCount);
      if (next < minNext) minNext = next;
      h[t] -= 1;
    }
    if ((s === 0) !== canWin) fail1++;
    if (s > 0 && minNext !== s - 1) fail2++;
    // 摸一张最多让向听降 1（不会降 2）
    if (minNext < s - 1) fail3++;
  }
  assert.equal(checked, 6000);
  assert.equal(fail1, 0, 'shanten=0 与“存在和牌张”不一致');
  assert.equal(fail2, 0, '不存在能让向听降 1 的进张');
  assert.equal(fail3, 0, '一次摸牌让向听降了 2');
});

/* ------------------------------------------------------------------ *
 * 2(b). 双实现对照
 * ------------------------------------------------------------------ */

test('双实现对照：法一（递归拆除+到数公式）与法二（按花色 DP）在随机样本上完全一致', () => {
  const rnd = mulberry32(0x51ed270b);
  let checked = 0;
  for (let i = 0; i < 8000; i++) {
    const meldCount = i % 5;
    const isAfterDraw = i % 3 === 0; // 混入 14 张（摸牌后）的手牌
    const size = (isAfterDraw ? 14 : 13) - 3 * meldCount;
    const h = randomHand(rnd, size, rnd() < 0.5);
    if (!h) continue;
    checked++;
    const a = shantenStandardRec(h, meldCount);
    const b = shantenStandardDP(h, meldCount);
    assert.equal(a, b, `${handToStr(h)} + ${meldCount} 副露：法一=${a} 法二=${b}`);
  }
  assert.equal(checked, 8000);
});

test('双实现对照：边角手牌（满 4 张 / 死张 / 副露 4 组）也一致', () => {
  const hands = [
    '9999m', '9999m5m', '1111m2222m3333m4m', '1111m2222m3333m44m',
    '1111z', '5555s', '4444p5555s', '1111m2222m3333m4444m5m',
    '111122223333m44p', '19m19p19s1234567z', '1112345678999m', '11123456789995m',
  ];
  let checked = 0;
  for (const str of hands) {
    const h = parseHand(str);
    const n = h.reduce((a, b) => a + b, 0);
    for (let meldCount = 0; meldCount <= 4; meldCount++) {
      if (n !== 13 - 3 * meldCount && n !== 14 - 3 * meldCount) continue;
      checked++;
      assert.equal(
        shantenStandardRec(h, meldCount),
        shantenStandardDP(h, meldCount),
        `${str} + ${meldCount}`,
      );
    }
  }
  assert.ok(checked > 10);
});

/* ------------------------------------------------------------------ *
 * 2(c). 穷举小规模
 * ------------------------------------------------------------------ */

test('穷举：全部 1 张、2 张、4 张手牌与暴力枚举目标和牌形完全一致', () => {
  const all34 = Array.from({ length: 34 }, (_, i) => i);
  // 1 张（副露 4 组，听牌形）
  let n1 = 0;
  forEachHand(all34, 1, (h) => {
    n1++;
    const expect = bruteShantenSmall(h, 0);
    assert.equal(shanten(h, 4), expect, `1 张 ${handToStr(h)}`);
    assert.equal(shantenStandardRec(h, 4), expect);
    assert.equal(shantenStandardDP(h, 4), expect);
  });
  assert.equal(n1, 34);

  // 2 张（副露 4 组，和牌形 / 听牌形）
  let n2 = 0;
  forEachHand(all34, 2, (h) => {
    n2++;
    const expect = bruteShantenSmall(h, 0);
    assert.equal(shanten(h, 4), expect, `2 张 ${handToStr(h)}`);
    assert.equal(shantenStandardDP(h, 4), expect);
  });
  assert.equal(n2, 595);

  // 4 张（副露 3 组）：全部 66045 种
  let n4 = 0;
  let bad = null;
  forEachHand(all34, 4, (h) => {
    n4++;
    const expect = bruteShantenSmall(h, 1);
    const a = shantenStandardRec(h, 3);
    const b = shantenStandardDP(h, 3);
    if (bad === null && (a !== expect || b !== expect)) {
      bad = `${handToStr(h)}：期望 ${expect}，法一 ${a}，法二 ${b}`;
    }
  });
  assert.equal(bad, null);
  assert.equal(n4, 66045);
});

test('穷举：14 张（副露 3 组）抽样与暴力枚举一致', () => {
  const all34 = Array.from({ length: 34 }, (_, i) => i);
  let checked = 0;
  let i = 0;
  let bad = null;
  forEachHand(all34, 5, (h) => {
    if (i++ % 25 !== 0) return; // 抽样，约 2 万手
    const expect = bruteShantenSmall(h, 1);
    if (bad === null && (shantenStandardRec(h, 3) !== expect || shantenStandardDP(h, 3) !== expect)) {
      bad = `${handToStr(h)}：期望 ${expect}`;
    }
    checked++;
  });
  assert.equal(bad, null);
  assert.ok(checked > 19000 && checked < 21000, `抽样数 ${checked}`);
});

test('穷举（1 种数牌 + 字牌子集）：7 张手牌（副露 2 组）上双实现一致且满足自洽性', () => {
  const types = [0, 1, 2, 3, 4, 5, 6, 7, 8, 27, 28, 29]; // 萬子 + 東南西北
  let checked = 0;
  let abFail = 0;
  let propFail = 0;
  let firstBad = '';
  forEachHand(types, 7, (h) => {
    checked++;
    const a = shantenStandardRec(h, 2);
    const b = shantenStandardDP(h, 2);
    if (a !== b) {
      abFail++;
      if (!firstBad) firstBad = `${handToStr(h)}：法一 ${a}，法二 ${b}`;
      return;
    }
    const s = shanten(h, 2);
    if (s === 0) {
      // 听牌：必须存在和牌张
      let ok = false;
      for (let t = 0; t < 34 && !ok; t++) {
        if (h[t] >= 4) continue;
        h[t] += 1;
        if (isAgari(h, 2)) ok = true;
        h[t] -= 1;
      }
      if (!ok) {
        propFail++;
        if (!firstBad) firstBad = `${handToStr(h)}：声称听牌但无和牌张`;
      }
      return;
    }
    // 非听牌：必须存在让向听降 1 的进张
    let ok = false;
    for (let t = 0; t < 34 && !ok; t++) {
      if (h[t] >= 4) continue;
      h[t] += 1;
      if (shanten(h, 2) === s - 1) ok = true;
      h[t] -= 1;
    }
    if (!ok) {
      propFail++;
      if (!firstBad) firstBad = `${handToStr(h)}：向听 ${s} 但无有效进张`;
    }
  });
  // C(18,7)=31824 减去同种 ≥5 张的 936 种
  assert.equal(checked, 30888);
  assert.equal(abFail, 0, `两法不一致：${firstBad}`);
  assert.equal(propFail, 0, `自洽性失败：${firstBad}`);
});

/* ------------------------------------------------------------------ *
 * 3. 性能
 * ------------------------------------------------------------------ */

test('性能：单次 shanten() 远低于 10ms', () => {
  const rnd = mulberry32(0xabcdef);
  const hands = [];
  for (let i = 0; i < 3000; i++) hands.push(randomHand(rnd, 13, i % 2 === 0));
  // 冷启动（清空缓存）：用最长单次耗时衡量
  clearShantenCache();
  let worst = 0;
  for (const h of hands.slice(0, 400)) {
    const t0 = process.hrtime.bigint();
    shanten(h, 0);
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (dt > worst) worst = dt;
  }
  assert.ok(worst < 10, `单次 shanten() 最慢 ${worst.toFixed(3)}ms，要求 < 10ms`);

  // 批量（含缓存）平均耗时
  clearShantenCache();
  const t0 = process.hrtime.bigint();
  for (const h of hands) shanten(h, 0);
  const avg = Number(process.hrtime.bigint() - t0) / 1e6 / hands.length;
  assert.ok(avg < 2, `平均 ${avg.toFixed(4)}ms/次`);
});
