/**
 * agari.js 单元测试
 * =====================================================================
 * 覆盖：
 *   - 标准形 / 七对子 / 国士无双 的判定与边界（4 张相同不能当两对等）
 *   - 国士十三面（和牌形判据 + 听牌形判据）
 *   - decomposeStandard 的多解与去重（一杯口 / 二杯口 / 111222333 型）
 *   - 副露 1–4 组的情形
 *   - 穷举验证：“1 种数牌 + 字牌”子集上拆解的完备性（与暴力枚举对照）
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyHand, handToStr, parseHand, tileToStr, totalTiles } from '../engine/tiles.js';
import {
  agariForms,
  decomposeStandard,
  isAgari,
  isChiitoi,
  isKokushi,
  isKokushi13Tenpai,
  isKokushi13Wait,
  isSevenPairsShape,
  isStandardShape,
} from '../engine/agari.js';

/**
 * 生成拆解的唯一签名（用于去重与对照）。
 *
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} d 拆解
 * @returns {string} 签名
 */
function signature(d) {
  const parts = d.mentsu.map((m) => `${m.type}:${m.tiles.join('-')}`);
  parts.sort();
  return `${d.pair}|${parts.join(';')}`;
}

/**
 * 暴力枚举某手牌的全部标准形拆解（测试用独立参照实现，与引擎算法完全不同）。
 *
 * @param {number[]} hand 暗牌计数数组
 * @param {number} need 需要的面子数
 * @returns {Array<{pair: number, mentsu: number[][]}>} 全部拆解
 */
function bruteDecompositions(hand, need) {
  /** @type {number[][]} */
  const all = [];
  for (let z = 0; z < 34; z++) all.push([z, z, z]);
  for (let s = 0; s < 3; s++) {
    for (let r = 0; r < 7; r++) all.push([s * 9 + r, s * 9 + r + 1, s * 9 + r + 2]);
  }
  const out = [];
  for (let pair = 0; pair < 34; pair++) {
    if (hand[pair] < 2) continue;
    const chosen = [];
    /** @param {number} start */
    const rec = (start) => {
      if (chosen.length === need) {
        const need2 = new Array(34).fill(0);
        need2[pair] += 2;
        for (const m of chosen) for (const t of m) need2[t] += 1;
        for (let i = 0; i < 34; i++) if (need2[i] !== hand[i]) return;
        out.push({ pair, mentsu: chosen.map((m) => m.slice()) });
        return;
      }
      for (let i = start; i < all.length; i++) {
        chosen.push(all[i]);
        rec(i);
        chosen.pop();
      }
    };
    rec(0);
  }
  return out;
}

test('标准形和牌判定', () => {
  const agariHands = [
    '123m456p789s11222z',
    '111m222m333m444m55m',
    '11122233344455z',
    '123m456m789m234p55s',
    '112233m456p789s11z',
    '123m456m789m111p22s',
  ];
  for (const s of agariHands) {
    const h = parseHand(s);
    assert.equal(totalTiles(h), 14, s);
    assert.equal(isAgari(h, 0), true, `${s} 应当是和牌形`);
    assert.equal(isStandardShape(h, 0), true, `${s} 应当是标准形`);
    assert.ok(decomposeStandard(h, 0).length > 0, s);
  }
  const notAgari = [
    '123m456p789s11223z', // 13 张，不是和牌形
    '123m456p789s1122z', // 13 张
    '111m222m333m444m5m', // 13 张（听牌）
    '123m456p789s11224z', // 14 张但不成面子
  ];
  for (const s of notAgari) {
    assert.equal(isAgari(parseHand(s), 0), false, `${s} 不应是和牌形`);
  }
  // 张数不符一律 false
  assert.equal(isAgari(parseHand('123m'), 0), false);
  assert.equal(isStandardShape(parseHand('123m'), 0), false);
  assert.deepEqual(decomposeStandard(parseHand('123m'), 0), []);
});

test('decomposeStandard 返回全部去重后的解（111222333 型有两解）', () => {
  const h = parseHand('111222333m456p11z');
  const sols = decomposeStandard(h, 0);
  assert.equal(sols.length, 2);
  const sigs = new Set(sols.map(signature));
  assert.equal(sigs.size, 2, '解必须互不相同');
  const types = sols.map((d) => d.mentsu.map((m) => m.type).join(',')).sort();
  assert.deepEqual(types, [
    'koutsu,koutsu,koutsu,shuntsu',
    'shuntsu,shuntsu,shuntsu,shuntsu',
  ]);
  // 每个解都必须是 4 面子 + 雀头，牌数吻合
  for (const d of sols) {
    assert.equal(d.mentsu.length, 4);
    const recount = emptyHand();
    recount[d.pair] += 2;
    for (const m of d.mentsu) for (const t of m.tiles) recount[t] += 1;
    assert.deepEqual(recount, h);
    for (const m of d.mentsu) {
      assert.equal(m.concealed, true);
      assert.equal(m.tiles.length, 3);
      if (m.type === 'shuntsu') {
        assert.deepEqual(m.tiles, [m.tiles[0], m.tiles[0] + 1, m.tiles[0] + 2]);
      } else {
        assert.equal(m.tiles[0], m.tiles[1]);
        assert.equal(m.tiles[1], m.tiles[2]);
      }
    }
  }
});

test('一杯口 / 二杯口形：拆解里含两组相同顺子', () => {
  // 一一杯口（两组 345m）
  const iipeikou = decomposeStandard(parseHand('11122334455m999p'), 0);
  assert.equal(iipeikou.length, 2);
  const hasPair345 = iipeikou.some((d) => {
    const shuntsu = d.mentsu.filter((m) => m.type === 'shuntsu').map((m) => m.tiles.join('-'));
    return shuntsu.filter((x) => x === '2-3-4').length === 2 || shuntsu.filter((x) => x === '3-4-5').length === 2;
  });
  assert.ok(hasPair345, '应当存在含两组相同顺子的解');

  // 二杯口：123m×2 + 456p×2
  const ryanpeikou = parseHand('112233m445566p11z');
  assert.equal(isAgari(ryanpeikou, 0), true);
  const sols = decomposeStandard(ryanpeikou, 0);
  assert.ok(sols.length >= 1);
  const pairs = sols[0].mentsu.filter((m) => m.type === 'shuntsu').map((m) => m.tiles.join('-'));
  assert.equal(pairs.filter((x) => x === '0-1-2').length, 2);
  assert.equal(pairs.filter((x) => x === '12-13-14').length, 2);
  // 同时也是七对子形
  assert.equal(isChiitoi(ryanpeikou), true);
});

test('平和形与全是字牌的刻子手', () => {
  const pinfu = parseHand('123m456m789m234p55s');
  assert.equal(isAgari(pinfu, 0), true);
  const sol = decomposeStandard(pinfu, 0)[0];
  assert.equal(sol.mentsu.filter((m) => m.type === 'shuntsu').length, 4);
  assert.equal(tileToStr(sol.pair), '5s');

  const honors = parseHand('11122233344455z');
  assert.equal(isAgari(honors, 0), true);
  assert.equal(isChiitoi(honors), false); // 5 种各 2/3/4 张，不是七对子
  const hs = decomposeStandard(honors, 0);
  assert.equal(hs.length, 1);
  assert.equal(hs[0].mentsu.every((m) => m.type === 'koutsu'), true);
  assert.equal(tileToStr(hs[0].pair), '5z');
});

test('七对子：必须恰好 7 种各 2 张（4 张不能当两对）', () => {
  assert.equal(isChiitoi(parseHand('11223344556677m')), true);
  assert.equal(isSevenPairsShape(parseHand('11223344556677m')), true);
  assert.equal(isChiitoi(parseHand('1122334455667m')), false); // 13 张
  // 4 张相同 → 只能算 1 对，因此不成立
  assert.equal(isChiitoi(parseHand('11112222333344m')), false);
  assert.equal(isChiitoi(parseHand('11112233445566m')), false);
  // 3 张也不成立
  assert.equal(isChiitoi(parseHand('11122334455667m')), false);
  // 标准形与七对子互不排斥（两面听牌形）
  const both = parseHand('112233m445566p11z');
  assert.equal(isChiitoi(both), true);
  assert.equal(isStandardShape(both, 0), true);
});

test('国士无双 / 国士十三面', () => {
  const kokushi13 = parseHand('19m19p19s1234567z'); // 13 张，十三面听牌形
  assert.equal(isKokushi13Tenpai(kokushi13), true);
  const win = parseHand('19m19p19s12345677z'); // 14 张和牌形
  assert.equal(totalTiles(win), 14);
  assert.equal(isKokushi(win), true);
  assert.equal(isKokushi13Wait(win), true);
  assert.equal(isAgari(win, 0), true);
  assert.equal(isStandardShape(win, 0), false);

  // 单骑和牌形与十三面和牌形完全一样（必须由听牌形区分）
  const singleTenpai = parseHand('119m19p19s123456z'); // 13 张，单骑听 7z
  assert.equal(totalTiles(singleTenpai), 13);
  assert.equal(isKokushi13Tenpai(singleTenpai), false);
  const singleWin = parseHand('119m19p19s1234567z'); // 14 张：与十三面和牌形同一形状
  assert.equal(totalTiles(singleWin), 14);
  assert.equal(isKokushi13Wait(singleWin), true); // 形状相同 → 按约定返回 true
  assert.equal(isKokushi(singleWin), true);
  // 非国士
  assert.equal(isKokushi(parseHand('19m19p19s1234556z')), false); // 缺 7z，且有重复
  assert.equal(isKokushi(parseHand('19m19p19s1234567z'.replace('19s', '29s'))), false); // 混入中张
  assert.equal(isKokushi13Tenpai(parseHand('19m19p19s123456z')), false); // 只有 12 种
});

test('agariForms 汇总三类判定', () => {
  const standard = agariForms(parseHand('123m456p789s11222z'), 0);
  assert.equal(standard.standard.length, 1);
  assert.equal(standard.chiitoi, false);
  assert.equal(standard.kokushi, false);

  const chiitoi = agariForms(parseHand('11223344556677m'), 0);
  // 这手牌同时也是二杯口标准形，故 standard 非空
  assert.ok(chiitoi.standard.length >= 1);
  assert.equal(chiitoi.chiitoi, true);
  assert.equal(chiitoi.kokushi, false);

  const pureChiitoi = agariForms(parseHand('1199m2288p3355s77z'), 0);
  assert.equal(pureChiitoi.standard.length, 0);
  assert.equal(pureChiitoi.chiitoi, true);
  assert.equal(pureChiitoi.kokushi, false);

  const kokushi = agariForms(parseHand('19m19p19s12345677z'), 0);  assert.equal(kokushi.standard.length, 0);
  assert.equal(kokushi.chiitoi, false);
  assert.equal(kokushi.kokushi, true);

  // 有副露时七对子 / 国士一定为 false
  const withMeld = agariForms(parseHand('123m456m789m11p'), 1);
  assert.equal(withMeld.standard.length > 0, true);
  assert.equal(withMeld.chiitoi, false);
  assert.equal(withMeld.kokushi, false);

  // 张数不符时全空
  const bad = agariForms(parseHand('123m'), 0);
  assert.deepEqual(bad, { standard: [], chiitoi: false, kokushi: false });
});

test('副露 1 / 2 / 3 / 4 组的标准形判定', () => {
  const cases = [
    { concealed: '123m456m789m11p', meldCount: 1 }, // 11 张
    { concealed: '456m789m11p', meldCount: 2 }, // 8 张
    { concealed: '789m11p', meldCount: 3 }, // 5 张
    { concealed: '11p', meldCount: 4 }, // 2 张
  ];
  for (const { concealed, meldCount } of cases) {
    const h = parseHand(concealed);
    assert.equal(totalTiles(h), 14 - 3 * meldCount, concealed);
    assert.equal(isAgari(h, meldCount), true, `${concealed} + ${meldCount} 副露`);
    const sols = decomposeStandard(h, meldCount);
    assert.equal(sols.length, 1);
    assert.equal(sols[0].mentsu.length, 4 - meldCount);
    // 张数不匹配副露数时不是和牌形
    if (meldCount < 4) assert.equal(isAgari(h, meldCount + 1), false);
    if (meldCount > 0) assert.equal(isAgari(h, meldCount - 1), false);
  }
  // 副露数非法
  assert.throws(() => decomposeStandard(parseHand('11p'), 5), RangeError);
  assert.throws(() => isAgari(parseHand('11p'), -1), RangeError);
});

test('顺子不会跨越花色（8m9m1p 不成面子）', () => {
  const h = parseHand('789m123p456p789p11z');
  assert.equal(totalTiles(h), 14);
  assert.equal(isStandardShape(h, 0), true);
  const sols = decomposeStandard(h, 0);
  assert.equal(sols.length, 1);
  assert.equal(sols[0].mentsu.filter((m) => m.type === 'shuntsu').length, 4);

  // 8m9m 与 1p 相邻但不同花色 → 不能成顺子，故不是和牌形
  const cross = parseHand('89m1p123p456p789p11z');
  assert.equal(totalTiles(cross), 14);
  assert.equal(isStandardShape(cross, 0), false);
  assert.equal(isAgari(cross, 0), false);
});

/* ------------------------------------------------------------------ *
 * 穷举：拆解完备性
 * ------------------------------------------------------------------ */

/** “1 种数牌 + 字牌”的子集（萬子 9 种 + 字牌） */
const SUBSET_16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 27, 28, 29, 30, 31, 32, 33];
/** 1 种数牌 + 4 种字牌（用于规模更大的穷举） */
const SUBSET_13 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 27, 28, 29, 30];

/**
 * 枚举子集内所有张数为 total 的计数数组。
 *
 * @param {number[]} types 允许的牌索引
 * @param {number} total 总张数
 * @param {(hand: number[]) => void} visit 回调
 * @returns {void}
 */
function forEachHand(types, total, visit) {
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
  rec(0, total);
}

/**
 * 用暴力枚举构造“k 个面子 + 1 雀头”的全部和牌形集合。
 *
 * @param {number[]} types 允许的牌索引
 * @param {number} k 面子数
 * @returns {Set<string>} 手牌字符串集合
 */
function buildWinSet(types, k) {
  const has = new Set(types);
  /** @type {number[][]} */
  const mentsu = [];
  for (const z of types) mentsu.push([z, z, z]);
  for (const z of types) {
    if (z < 27 && z % 9 <= 6 && has.has(z + 1) && has.has(z + 2)) mentsu.push([z, z + 1, z + 2]);
  }
  const set = new Set();
  const chosen = [];
  /** @param {number} start */
  const rec = (start) => {
    if (chosen.length === k) {
      for (const pair of types) {
        const h = emptyHand();
        h[pair] += 2;
        let ok = true;
        for (const m of chosen) for (const t of m) h[t] += 1;
        for (let i = 0; i < 34; i++) if (h[i] > 4) { ok = false; break; }
        if (ok) set.add(handToStr(h));
      }
      return;
    }
    for (let i = start; i < mentsu.length; i++) {
      chosen.push(mentsu[i]);
      rec(i);
      chosen.pop();
    }
  };
  rec(0);
  return set;
}

test('穷举（1 种数牌 + 字牌）：拆解完备性 —— 与暴力和牌形集合完全一致', () => {
  const plan = [
    { types: SUBSET_16, k: 0, meldCount: 4 },
    { types: SUBSET_16, k: 1, meldCount: 3 },
    { types: SUBSET_13, k: 2, meldCount: 2 },
  ];
  for (const { types, k, meldCount } of plan) {
    const winSet = buildWinSet(types, k);
    const size = 3 * k + 2;
    let checked = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    forEachHand(types, size, (h) => {
      checked++;
      const engine = decomposeStandard(h, meldCount).length > 0;
      const reference = winSet.has(handToStr(h));
      if (engine && !reference) falsePositive++;
      if (!engine && reference) falseNegative++;
    });
    assert.ok(checked > 0);
    assert.equal(falsePositive, 0, `${types.length} 种牌 / ${size} 张：引擎拆出了不存在的解`);
    assert.equal(falseNegative, 0, `${types.length} 种牌 / ${size} 张：引擎漏解`);
  }
});

test('穷举（1 种数牌 + 字牌）：解集与暴力枚举逐手一致（含多重解与去重）', () => {
  // k=1：全部 5 张手牌逐一比对完整解集
  let checked = 0;
  forEachHand(SUBSET_16, 5, (h) => {
    const engine = new Set(decomposeStandard(h, 3).map(signature));
    const ref = new Set(
      bruteDecompositions(h, 1).map((d) => signature({ pair: d.pair, mentsu: d.mentsu.map((t) => ({ type: t[0] === t[1] ? 'koutsu' : 'shuntsu', tiles: t })) })),
    );
    assert.deepEqual([...engine].sort(), [...ref].sort(), handToStr(h));
    checked++;
  });
  // C(16+5-1, 5) = 15504，其中 16 种“5 张全同”不合法 → 15488
  assert.equal(checked, 15488);

  // k=2：抽样比对完整解集（含多重解）
  let sampled = 0;
  let i = 0;
  forEachHand(SUBSET_13, 8, (h) => {
    if (i++ % 17 !== 0) return; // 抽样
    const engine = new Set(decomposeStandard(h, 2).map(signature));
    const ref = new Set(
      bruteDecompositions(h, 2).map((d) => signature({ pair: d.pair, mentsu: d.mentsu.map((t) => ({ type: t[0] === t[1] ? 'koutsu' : 'shuntsu', tiles: t })) })),
    );
    assert.deepEqual([...engine].sort(), [...ref].sort(), handToStr(h));
    sampled++;
  });
  assert.ok(sampled > 5000, `抽样数量 ${sampled}`);
});
