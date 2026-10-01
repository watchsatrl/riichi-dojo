import { HAND_SIZE, meldTileCounts, normalizeHand, totalTiles } from './tiles.js';
import { isAgari } from './agari.js';
import { shanten } from './shanten.js';
/**
 * 日本麻将牌理引擎 —— 听牌、进张与打牌分析
 * =====================================================================
 *
 * 【索引约定】见 tiles.js：
 *   0–8 萬 / 9–17 筒 / 18–26 索 / 27–33 東南西北白發中；34/35/36 为赤 5，
 *   入口一律归一到 4/13/22。
 *
 * 【手牌约定】
 *   hand 是长度 34 的计数数组，**只包含暗牌部分**；副露用 melds 数组传入，
 *   meldCount = melds.length。本模块的函数都允许额外传入 melds（可选），
 *   用于把副露里已占用的牌从“剩余枚数”中扣除。
 *
 * 【牌数约定】
 *   - hand13 类函数（waitingTiles）：暗牌必须是 13 - 3 * meldCount 张
 *   - hand14 类函数（discardsKeepingTenpai / discardUkeire）：暗牌必须是 14 - 3 * meldCount 张
 *   - usefulTiles / ukeire：一般传 13 - 3 * meldCount 张的暗牌（摸牌前）
 *   张数不符时相应函数返回空结果（不抛异常），以便调用方容错。
 */


/**
 * 校验并归一 meldCount。
 *
 * @param {number} meldCount 副露数
 * @returns {number} 归一后的副露数
 * @throws {RangeError} 非法时抛出
 */
function toMeldCount(meldCount) {
  if (meldCount === undefined || meldCount === null) return 0;
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) {
    throw new RangeError(`meldCount 必须是 0–4 的整数，收到 ${String(meldCount)}`);
  }
  return meldCount;
}

/**
 * 计算“已经不可能再摸到”的张数（自己暗牌 + 副露）。
 *
 * @param {number[]} hand 归一化后的暗牌计数数组
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组
 * @returns {number[]} 长度 34 的占用计数数组
 */
function occupiedCounts(hand, melds = []) {
  const occupied = hand.slice(0, HAND_SIZE);
  const fromMelds = meldTileCounts(melds);
  for (let i = 0; i < HAND_SIZE; i++) occupied[i] += fromMelds[i];
  return occupied;
}

/**
 * 13 张（3n+1）听牌形等哪些牌能和。
 *
 * @param {ArrayLike<number>} hand13 暗牌计数数组，张数必须为 13 - 3 * meldCount
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组（可选，用于排除已被自己占满 4 张的牌）
 * @returns {number[]} 能和牌的牌索引数组（升序）；张数不符时返回 []
 */
export function waitingTiles(hand13, meldCount = 0, melds = []) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand13);
  if (totalTiles(h) !== 13 - 3 * mc) return [];
  const occupied = occupiedCounts(h, melds);
  const waits = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    if (occupied[t] >= 4) continue; // 自己已占满 4 张，不可能再摸到
    h[t] += 1;
    if (isAgari(h, mc)) waits.push(t);
    h[t] -= 1;
  }
  return waits;
}

/**
 * 14 张（3n+2）手牌打掉某张后仍听牌的列表。
 *
 * @param {ArrayLike<number>} hand14 暗牌计数数组，张数必须为 14 - 3 * meldCount
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组（可选）
 * @returns {Array<{discard: number, waits: number[]}>} 每一项为“打这张 → 听这些牌”，discard 升序
 */
export function discardsKeepingTenpai(hand14, meldCount = 0, melds = []) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand14);
  if (totalTiles(h) !== 14 - 3 * mc) return [];
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    if (h[t] === 0) continue;
    h[t] -= 1;
    const waits = waitingTiles(h, mc, melds);
    h[t] += 1;
    if (waits.length > 0) out.push({ discard: t, waits });
  }
  return out;
}

/**
 * 进张：摸到后能让向听数下降的牌（不考虑剩余枚数，只看向听变化）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（一般传 13 - 3 * meldCount 张）
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组（可选，用于排除已占满 4 张的牌）
 * @returns {number[]} 有效牌索引数组（升序）
 */
export function usefulTiles(hand, meldCount = 0, melds = []) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand);
  const occupied = occupiedCounts(h, melds);
  const base = shanten(h, mc);
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    if (occupied[t] >= 4) continue;
    h[t] += 1;
    const s = shanten(h, mc);
    h[t] -= 1;
    if (s < base) out.push(t);
  }
  return out;
}

/**
 * 进张明细（含剩余枚数）。
 *
 * 剩余枚数 = 4 - 自己暗牌张数 - 副露占用张数（不扣除其他家手牌与牌河）。
 * 返回按“剩余枚数降序、牌索引升序”排序。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（一般传 13 - 3 * meldCount 张）
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组（可选）
 * @returns {Array<{tile: number, count: number}>} 进张明细
 */
export function ukeire(hand, meldCount = 0, melds = []) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand);
  const occupied = occupiedCounts(h, melds);
  return computeUkeire(h, mc, occupied);
}

/**
 * 进张计算的内部实现：occupied 表示“已不可能摸到”的张数。
 *
 * @param {number[]} h 归一化暗牌计数数组
 * @param {number} mc 副露数
 * @param {number[]} occupied 长度 34 的占用计数数组
 * @returns {Array<{tile: number, count: number}>} 进张明细（已排序）
 */
function computeUkeire(h, mc, occupied) {
  const base = shanten(h, mc);
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    const remain = 4 - occupied[t];
    if (remain <= 0) continue;
    h[t] += 1;
    const s = shanten(h, mc);
    h[t] -= 1;
    if (s < base) out.push({ tile: t, count: remain });
  }
  out.sort((a, b) => (b.count - a.count) || (a.tile - b.tile));
  return out;
}

/**
 * 打掉某张牌后的进张明细，用于“打哪张最好”的判定。
 *
 * 剩余枚数按**打牌前**的手牌计算，因此刚打出的那张牌也会被扣掉 1 张
 * （它已进入自己的牌河，不可能再摸到）。
 * 返回按“向听数升序、进张总枚数降序、打牌索引升序”排序，第一项即最佳打牌。
 *
 * @param {ArrayLike<number>} hand14 暗牌计数数组，张数必须为 14 - 3 * meldCount
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组（可选）
 * @returns {Array<{discard: number, shanten: number, ukeire: Array<{tile: number, count: number}>, total: number}>}
 *          每种可打的牌的明细；张数不符时返回 []
 */
export function discardUkeire(hand14, meldCount = 0, melds = []) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand14);
  if (totalTiles(h) !== 14 - 3 * mc) return [];
  const occupiedBefore = occupiedCounts(h, melds);
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    if (h[t] === 0) continue;
    h[t] -= 1;
    const s = shanten(h, mc);
    const detail = computeUkeire(h, mc, occupiedBefore);
    let total = 0;
    for (const d of detail) total += d.count;
    out.push({ discard: t, shanten: s, ukeire: detail, total });
    h[t] += 1;
  }
  out.sort((a, b) => (a.shanten - b.shanten) || (b.total - a.total) || (a.discard - b.discard));
  return out;
}
