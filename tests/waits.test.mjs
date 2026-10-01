/**
 * waits.js 单元测试
 * =====================================================================
 * 覆盖：
 *   - 各种听牌形的 waitingTiles（两面 / 嵌张 / 边张 / 单骑 / 双碰 / 九莲九面 / 国士十三面 /
 *     七对子 / 副露 1–4 组）
 *   - discardsKeepingTenpai / usefulTiles / ukeire / discardUkeire
 *   - 与 isAgari / shanten 的交叉一致性（随机手牌 + 定种子）
 *   - 剩余枚数是否正确扣除“自己暗牌 + 副露”占用的张数
 *   - 张数不符时返回空结果
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyHand, handToStr, parseHand, tileToStr, totalTiles } from '../engine/tiles.js';
import { isAgari } from '../engine/agari.js';
import { clearShantenCache, shanten } from '../engine/shanten.js';
import {
  discardUkeire,
  discardsKeepingTenpai,
  ukeire,
  usefulTiles,
  waitingTiles,
} from '../engine/waits.js';

/**
 * 定种子伪随机数。
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
 * 随机手牌生成器。
 *
 * @param {() => number} rnd 随机源
 * @param {number} size 张数
 * @param {boolean} structured 是否先堆面子/对子
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
 * 把牌索引数组转成便于阅读的字符串。
 *
 * @param {number[]} tiles 牌索引
 * @returns {string} 形如 "3s 6s"
 */
function tilesToStr(tiles) {
  return tiles.map(tileToStr).join(' ');
}

test('waitingTiles：各种听牌形', () => {
  const cases = [
    ['123m456m789m11p45s', 0, '3s 6s'], // 两面
    ['123m456m789m11p13s', 0, '2s'], // 嵌张
    ['123m456m789m11p89s', 0, '7s'], // 边张
    ['123m456m789m111p2s', 0, '2s'], // 单骑
    ['123m456m789m1122p', 0, '1p 2p'], // 双碰
    ['1112345678999m', 0, '1m 2m 3m 4m 5m 6m 7m 8m 9m'], // 九莲宝灯九面听
    ['19m19p19s1234567z', 0, '1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z'], // 国士十三面
    ['119m19p19s123456z', 0, '7z'], // 国士单骑
    ['1122334455667m', 0, '1m 4m 7m'], // 七对子 + 标准形三面
    ['111m222m333m444m5m', 0, '2m 3m 4m 5m 6m'], // 四暗刻形的五面听（2m–6m）
    ['1112223334445z', 0, '5z'], // 字牌刻子 + 单骑
  ];
  for (const [str, meldCount, expected] of cases) {
    const h = parseHand(str);
    assert.equal(totalTiles(h), 13 - 3 * meldCount, str);
    assert.equal(tilesToStr(waitingTiles(h, meldCount)), expected, str);
  }
});

test('waitingTiles：副露 1–4 组', () => {
  assert.equal(tilesToStr(waitingTiles(parseHand('123m456m789m1p'), 1)), '1p');
  assert.equal(tilesToStr(waitingTiles(parseHand('456m11p22s'), 2)), '1p 2s'); // 双碰
  assert.equal(tilesToStr(waitingTiles(parseHand('789m1p'), 3)), '1p');
  assert.equal(tilesToStr(waitingTiles(parseHand('1p'), 4)), '1p');
  // 张数不符 → 空
  assert.deepEqual(waitingTiles(parseHand('123m456m789m11p'), 1), []);
  assert.deepEqual(waitingTiles(parseHand('123m'), 0), []);
});

test('waitingTiles 与 isAgari 完全一致（随机 3000 手）', () => {
  const rnd = mulberry32(0x1234abcd);
  let checked = 0;
  for (let i = 0; i < 3000; i++) {
    const meldCount = i % 5;
    const h = randomHand(rnd, 13 - 3 * meldCount, rnd() < 0.5);
    if (!h) continue;
    checked++;
    const waits = new Set(waitingTiles(h, meldCount));
    for (let t = 0; t < 34; t++) {
      if (h[t] >= 4) continue;
      h[t] += 1;
      const win = isAgari(h, meldCount);
      h[t] -= 1;
      assert.equal(waits.has(t), win, `${handToStr(h)} + ${tileToStr(t)}`);
    }
  }
  assert.equal(checked, 3000);
});

test('waitingTiles(13 张) 非空 ⟺ shanten === 0', () => {
  const rnd = mulberry32(0x77aa33);
  for (let i = 0; i < 2000; i++) {
    const meldCount = i % 5;
    const h = randomHand(rnd, 13 - 3 * meldCount, rnd() < 0.5);
    if (!h) continue;
    const waits = waitingTiles(h, meldCount);
    assert.equal(waits.length > 0, shanten(h, meldCount) === 0, handToStr(h));
  }
});

test('discardsKeepingTenpai：打牌后仍听牌', () => {
  const h = parseHand('123m456m789m11p456s');
  const result = discardsKeepingTenpai(h, 0);
  const byDiscard = new Map(result.map((r) => [r.discard, r.waits]));
  // 打 4s / 5s / 6s 都能保持听牌（4s=21，5s=22，6s=23）
  assert.ok(byDiscard.has(21));
  assert.ok(byDiscard.has(22));
  assert.ok(byDiscard.has(23));
  assert.equal(tilesToStr(byDiscard.get(21)), '4s 7s'); // 56s 两面
  assert.equal(tilesToStr(byDiscard.get(22)), '5s'); // 4s6s 嵌张
  assert.equal(tilesToStr(byDiscard.get(23)), '3s 6s'); // 45s 两面
  // 结果按 discard 升序
  const order = result.map((r) => r.discard);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  // 拆掉雀头/面子也能保持听牌（例如打 1m → 23m + 456m + 789m + 11p + 456s）
  assert.equal(tilesToStr(byDiscard.get(0)), '1m 4m 7m');

  // 与暴力一致：打掉 d 后 waits 必须等于 waitingTiles(hand-d)
  for (const { discard, waits } of result) {
    h[discard] -= 1;
    assert.deepEqual(waits, waitingTiles(h, 0));
    h[discard] += 1;
  }

  // 张数不符 → 空
  assert.deepEqual(discardsKeepingTenpai(parseHand('123m456m789m11p'), 0), []);
});

test('discardsKeepingTenpai：副露时也正确', () => {
  // 11 张暗牌 + 1 副露 = 14 张
  const h = parseHand('456m789m11p22s3s');
  assert.equal(totalTiles(h), 11);
  const result = discardsKeepingTenpai(h, 1);
  const map = new Map(result.map((r) => [r.discard, tilesToStr(r.waits)]));
  assert.equal(result.length, 2);
  assert.equal(map.get(20), '1p 2s'); // 打 3s → 双碰听
  assert.equal(map.get(19), '1s 4s'); // 打 2s → 23s 两面听
});

test('usefulTiles / ukeire：进张与剩余枚数', () => {
  const h = parseHand('123m456m789m11p17s');
  const useful = usefulTiles(h, 0);
  assert.deepEqual(useful, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33].filter((t) => useful.includes(t)));
  assert.ok(useful.length > 0);
  // 每一张都确实使向听下降
  const base = shanten(h, 0);
  for (const t of useful) {
    h[t] += 1;
    assert.ok(shanten(h, 0) < base, `${tileToStr(t)} 应当降低向听`);
    h[t] -= 1;
  }
  // ukeire 的 count = 4 - 自己暗牌张数（无副露）
  const detail = ukeire(h, 0);
  for (const { tile, count } of detail) {
    assert.equal(count, 4 - h[tile], tileToStr(tile));
    assert.ok(useful.includes(tile));
  }
  // 按 count 降序、同 count 按牌索引升序
  for (let i = 1; i < detail.length; i++) {
    const prev = detail[i - 1];
    const cur = detail[i];
    assert.ok(prev.count > cur.count || (prev.count === cur.count && prev.tile < cur.tile));
  }
  // 已知值
  assert.deepEqual(
    detail.map((d) => [tileToStr(d.tile), d.count]),
    [['2s', 4], ['3s', 4], ['5s', 4], ['6s', 4], ['8s', 4], ['9s', 4], ['1s', 3], ['7s', 3], ['1p', 2]],
  );
});

test('ukeire / usefulTiles：剩余枚数要扣除副露占用的牌', () => {
  // 副露里有 1m×3；手里有 1m×1，则 1m 已用满 4 张
  const melds = [
    { type: 'pon', tiles: [0, 0, 0] },
    { type: 'chi', tiles: [9, 10, 11] },
  ];
  const concealed = parseHand('23m456m789m55p1m'); // 11 张 + 2 副露 = 13 张
  assert.equal(totalTiles(concealed), 11);
  // 1m 已被副露和暗牌占满 → 不可能再摸到
  assert.ok(!usefulTiles(concealed, 2, melds).includes(0));
  assert.ok(!ukeire(concealed, 2, melds).some((d) => d.tile === 0));
  // 4m 手里有 1 张 → 剩 3
  const detail = ukeire(concealed, 2, melds);
  const four = detail.find((d) => d.tile === 3);
  assert.ok(four === undefined || four.count === 3);
  // 不带 melds 时不会扣除（剩下的张数偏大）
  const withoutMelds = ukeire(concealed, 2);
  assert.ok(withoutMelds.every((d) => d.count >= (detail.find((x) => x.tile === d.tile)?.count ?? 0)));
});

test('ukeire：副露牌正好是听牌张时，剩余枚数要减 3', () => {
  // 副露 [123m]，暗牌 23m 456m 789m 55p → 听 1m / 4m / 7m
  const melds = [{ type: 'chi', tiles: [0, 1, 2] }];
  const concealed = parseHand('23m456m789m55p');
  assert.equal(totalTiles(concealed), 10);
  assert.equal(tilesToStr(waitingTiles(concealed, 1, melds)), '1m 4m 7m');
  const detail = ukeire(concealed, 1, melds);
  const oneM = detail.find((d) => d.tile === 0);
  const fourM = detail.find((d) => d.tile === 3);
  const sevenM = detail.find((d) => d.tile === 6);
  assert.equal(oneM.count, 3); // 4 - 0（暗牌）- 1（副露里 1 张）
  assert.equal(fourM.count, 3); // 4 - 1（暗牌 456m 里的 4m）- 0
  assert.equal(sevenM.count, 3); // 4 - 1（暗牌 789m 里的 7m）- 0
  // 不带 melds 时 1m 会被算成 4 张（偏大）
  const naive = ukeire(concealed, 1);
  assert.equal(naive.find((d) => d.tile === 0).count, 4);
});

test('discardUkeire：打牌明细与排序', () => {
  const h = parseHand('123m456m789m11p2s5s9s');
  const result = discardUkeire(h, 0);
  assert.equal(result.length, 13); // 13 种不同的牌可打
  // 排序：向听升序 → 进张总数降序 → 打牌索引升序
  for (let i = 1; i < result.length; i++) {
    const a = result[i - 1];
    const b = result[i];
    assert.ok(
      a.shanten < b.shanten ||
        (a.shanten === b.shanten && a.total > b.total) ||
        (a.shanten === b.shanten && a.total === b.total && a.discard < b.discard),
      `${tileToStr(a.discard)} 与 ${tileToStr(b.discard)} 排序错误`,
    );
  }
  // 每一项的 total 与明细一致，且明细里的牌都能降低向听
  for (const item of result) {
    const sum = item.ukeire.reduce((acc, d) => acc + d.count, 0);
    assert.equal(item.total, sum);
    h[item.discard] -= 1;
    assert.equal(item.shanten, shanten(h, 0));
    for (const d of item.ukeire) {
      // 剩余枚数按“打牌前”的手牌算：刚打出的那张牌已进牌河，也要扣掉
      const expected = 4 - h[d.tile] - (d.tile === item.discard ? 1 : 0);
      assert.equal(d.count, expected, `${tileToStr(d.tile)} 剩余枚数`);
    }
    h[item.discard] += 1;
  }
  // 张数不符 → 空
  assert.deepEqual(discardUkeire(parseHand('123m'), 0), []);
});

test('discardUkeire：听牌手牌的最佳打牌会保持听牌', () => {
  const h = parseHand('123m456m789m11p456s');
  const result = discardUkeire(h, 0);
  const best = result[0];
  assert.equal(best.shanten, 0);
  assert.ok(best.total > 0);
  assert.equal(tilesToStr(waitingTiles(parseHand('23m456m789m11p456s'), 0)), '1m 4m 7m');
  // 打 1m 与打 9m 都是三面听，进张最多
  assert.ok([0, 8].includes(best.discard));
});

test('discardUkeire：打出的牌会从剩余枚数里扣掉', () => {
  const h = parseHand('112233m456p789s11z'); // 14 张，打 1z 后仍听 1z
  const result = discardUkeire(h, 0);
  const discard1z = result.find((r) => r.discard === 27);
  assert.ok(discard1z);
  const wait1z = discard1z.ukeire.find((d) => d.tile === 27);
  if (wait1z) {
    // 打牌前手里有 2 张 1z，打掉 1 张后剩 1 张 → 4 - 1 - 1（牌河）= 2
    assert.equal(wait1z.count, 2);
  }
  // 与“打牌后手牌”的 ukeire 相比，打出的那张牌少 1 枚
  const after = h.slice();
  after[27] -= 1;
  const raw = ukeire(after, 0);
  for (const d of discard1z.ukeire) {
    const other = raw.find((x) => x.tile === d.tile);
    assert.ok(other);
    assert.equal(d.count, other.count - (d.tile === 27 ? 1 : 0));
  }
});

test('discardUkeire / discardsKeepingTenpai 与暴力一致（随机 800 手）', () => {
  const rnd = mulberry32(0x5150);
  let checked = 0;
  for (let i = 0; i < 800; i++) {
    const meldCount = i % 5;
    const h = randomHand(rnd, 14 - 3 * meldCount, i % 2 === 0);
    if (!h) continue;
    checked++;
    const detail = discardUkeire(h, meldCount);
    const distinct = [...new Set(h.map((c, idx) => (c > 0 ? idx : -1)).filter((x) => x >= 0))];
    assert.equal(detail.length, distinct.length, handToStr(h));
    for (const item of detail) {
      h[item.discard] -= 1;
      assert.equal(item.shanten, shanten(h, meldCount));
      const useful = usefulTiles(h, meldCount);
      assert.deepEqual(
        item.ukeire.map((d) => d.tile).sort((a, b) => a - b),
        useful,
        handToStr(h),
      );
      h[item.discard] += 1;
    }
    // discardsKeepingTenpai 必须正好是“打后向听为 0”的那些（两者都按打牌索引升序）
    const keep = discardsKeepingTenpai(h, meldCount);
    const expectedKeep = detail
      .filter((d) => d.shanten === 0)
      .map((d) => d.discard)
      .sort((a, b) => a - b);
    assert.deepEqual(keep.map((k) => k.discard), expectedKeep, handToStr(h));
    for (const k of keep) {
      assert.ok(k.waits.length > 0);
      h[k.discard] -= 1;
      assert.deepEqual(k.waits, waitingTiles(h, meldCount));
      h[k.discard] += 1;
    }
  }
  assert.equal(checked, 800);
});

test('缓存不会影响结果（清空缓存后重算一致）', () => {
  const h = parseHand('123m456m789m11p17s');
  const before = JSON.stringify(ukeire(h, 0));
  const waitsBefore = tilesToStr(waitingTiles(parseHand('123m456m789m11p45s'), 0));
  clearShantenCache();
  assert.equal(JSON.stringify(ukeire(h, 0)), before);
  assert.equal(tilesToStr(waitingTiles(parseHand('123m456m789m11p45s'), 0)), waitsBefore);
});
