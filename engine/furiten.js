import { normalizeHand, normalizeIndex, tileToStr, totalTiles } from './tiles.js';
import { isAgari, isKokushi13Tenpai } from './agari.js';
import { waitingTiles } from './waits.js';
import { detectYaku } from './yaku.js';
import { normalizeContext } from './fu.js';
import { KOKUSHI_13_FURITEN, resolveRules } from './rules.js';
/**
 * 日本麻将牌理引擎 —— 振听判定（フリテン）
 * =====================================================================
 *
 * 【规则依据】research/rules-variants.md §1.6 第 24 行（三种振听的成立与解除，三平台一致）
 *   + research/yaku-fu-score.md §1.8(7)（国士十三面听的振听口径）
 *   + research/raw/wrc2017.txt §5.5（Furiten：**即使该形无役也算振听**）。
 *
 * 【三种振听】
 *   1. **舍牌振听**（捨て牌フリテン）：自己的**牌河**里出现了自己能荣和的牌 → 不能荣和。
 *      - 只看牌河：**加槓的牌、拔北都不算**（它们不是舍牌）；
 *      - 判据是「能否成和牌形」，**与该形是否有役无关**（无役也算振听），
 *        所以这里用 waits.js 的 `waitingTiles()`（纯牌形），不做役种判定；
 *      - 只要河里有任一张和牌张，**整手都不能荣和**（不是只禁那一张）。
 *   2. **同巡振听**（同巡振聴 / 临时振听）：见逃（含抢槓放弃）后，在自己下一次摸牌或鸣牌之前
 *      不能荣和；他人鸣牌不会解除。
 *   3. **立直后振听**（リーチ後の振聴）：立直后见逃和牌张（或把和牌张摸切），
 *      **本局结束前一直振听**。
 *   自摸不受任何振听限制（`canRon` 在 `isTsumo = true` 时跳过振听判定）。
 *
 * 【为什么 `isTemporaryFuriten` 需要 `lastDrawnTile`】
 *   「是否见逃过」本质上是**游戏事件**，不是牌面状态；本函数只负责其中**能由牌面推出**的那一类：
 *   自己刚刚打出的牌（`lastDrawnTile`）若能把手牌补成和牌形，说明自己**放弃了和牌（和了放棄）**
 *   —— 摸切见逃与手切见逃都算。调用方若持有完整的「见逃」事件
 *   （例：见他家和牌张而放弃），请改用统一入口 `isFuriten(ctx)` 并传 `ctx.passedWin`。
 */


/**
 * 校验并归一 meldCount（缺省时由 melds.length 推出）。
 *
 * @param {number|undefined} meldCount 副露数
 * @param {Array<object>} [melds] 副露数组
 * @returns {number} 归一后的副露数（0–4）
 * @throws {RangeError} 非法时抛出
 */
function toMeldCount(meldCount, melds) {
  if (meldCount === undefined || meldCount === null) return (melds || []).length;
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > 4) {
    throw new RangeError(`meldCount 必须是 0–4 的整数，收到 ${String(meldCount)}`);
  }
  return meldCount;
}

/**
 * 校验 13 张（3n+1）听牌形的张数。
 *
 * 振听判定依赖「听哪些牌」，张数不对会得到静默错误的结论，因此这里**显式抛错**
 * 而不是像 waits.js 那样返回空结果。
 *
 * @param {ArrayLike<number>} hand13 暗牌计数数组
 * @param {number} meldCount 副露数
 * @returns {number[]} 归一化后的 13 张计数数组
 * @throws {TypeError|RangeError} 张数不是 13 - 3 × meldCount 时抛出
 */
function normalizeHand13(hand13, meldCount) {
  const h = normalizeHand(hand13);
  const expected = 13 - 3 * meldCount;
  const n = totalTiles(h);
  if (n !== expected) {
    throw new RangeError(
      `振听判定需要 ${expected} 张暗牌（13 - 3 × ${meldCount}），收到 ${n} 张`,
    );
  }
  return h;
}

/**
 * 归一化牌河数组（只允许舍牌；赤 5 会被归一到普通 5）。
 *
 * @param {ArrayLike<number>} pondTiles 牌河
 * @returns {number[]} 归一化后的牌索引数组
 * @throws {TypeError|RangeError} 不是数组或含非法索引时抛出
 */
function normalizePond(pondTiles) {
  if (pondTiles === undefined || pondTiles === null) return [];
  if (!Array.isArray(pondTiles) && typeof pondTiles.length !== 'number') {
    throw new TypeError('振听判定: pondTiles 必须是牌索引数组');
  }
  const out = [];
  for (const t of pondTiles) out.push(normalizeIndex(t));
  return out;
}

/**
 * 舍牌振听：自己的牌河里是否有自己能荣和的牌。
 *
 * 判据只看**牌形**（与该形是否有役无关，WRC §5.5）；只看牌河，加槓的牌与拔北不适用。
 *
 * @param {ArrayLike<number>} hand13 13 张暗牌计数数组（张数必须为 13 - 3 × meldCount）
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds=[]] 副露数组
 * @param {ArrayLike<number>} [pondTiles=[]] 自己的牌河（只含舍牌）
 * @returns {boolean} 振听返回 true
 * @throws {RangeError} 手牌张数不符时抛出
 * @example
 *   // 听 3m/6m，牌河里有 6m → 舍牌振听
 *   isDiscardFuriten(parseHand('12m456p789s11222z'), 0, [], [5]) // true
 */
export function isDiscardFuriten(hand13, meldCount, melds, pondTiles) {
  const mc = toMeldCount(meldCount, melds);
  const h = normalizeHand13(hand13, mc);
  const pond = normalizePond(pondTiles);
  if (pond.length === 0) return false;
  const waits = waitingTiles(h, mc, melds || []);
  if (waits.length === 0) return false;
  const waitSet = new Set(waits);
  return pond.some((t) => waitSet.has(t));
}

/**
 * 同巡振听（临时振听）的**牌面可判定部分**：见逃自摸。
 *
 * 传入的 `lastDrawnTile` 语义是「自己最近一次摸到、又被原样打出的牌（摸切）」：
 * 把这张牌补回打牌前的 13 张手牌若能构成和牌形，说明自己刚刚放弃了自摸和牌
 * （和了放棄）→ 在**自己下一次摸牌或鸣牌之前**不能荣和。
 *
 * 需要「见他家和牌张而放弃」这类完整事件时，请用 `isFuriten(ctx)` 并传 `ctx.passedWin = true`。
 *
 * @param {ArrayLike<number>} hand13 打牌之后的 13 张暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @param {Array<{type: string, tiles: number[]}>} [melds=[]] 副露数组
 * @param {ArrayLike<number>} [pondTiles=[]] 自己的牌河（只含舍牌）
 * @param {number|null} [lastDrawnTile] 刚被打出（摸切或手切）的那张牌；null/undefined 表示本巡没有这种打牌
 * @returns {boolean} 处于同巡振听返回 true
 * @throws {RangeError} 手牌张数不符、或 lastDrawnTile 非法 / 输入不自洽时抛出
 */
export function isTemporaryFuriten(hand13, meldCount, melds, pondTiles, lastDrawnTile) {
  const mc = toMeldCount(meldCount, melds);
  if (lastDrawnTile === undefined || lastDrawnTile === null) return false;
  const h = normalizeHand13(hand13, mc);
  const tile = normalizeIndex(lastDrawnTile);
  normalizePond(pondTiles); // 形状校验（牌河本身不参与「和了放棄」的判定）
  if (h[tile] >= 4) {
    throw new RangeError(
      `isTemporaryFuriten: 手中已有 4 张 ${tileToStr(tile)}，不可能再打出第 5 张（输入不自洽）`,
    );
  }
  // 打出的这张牌若能把手牌补成和牌形，说明刚刚放弃了和牌（和了放棄）→ 同巡振听。
  // 注意这与「摸切」还是「手切」无关：13 张 + 打出的那张 = 打牌前的 14 张手牌。
  h[tile] += 1;
  const given = isAgari(h, mc);
  h[tile] -= 1;
  return given;
}

/**
 * 立直后振听。
 *
 * 立直后见逃和牌张（或把和牌张摸切），本局结束前一直振听；且立直后不能改听，
 * 因此这种振听**无法自行解除**。状态由游戏层维护，本函数只做组合判定。
 *
 * @param {{isRiichi?: boolean, riichiFuriten?: boolean, passedWinAfterRiichi?: boolean,
 *          hasPassedWinSinceRiichi?: boolean}} [state] 状态对象
 * @returns {boolean} 立直后振听返回 true
 * @throws {TypeError} state 不是对象时抛出
 */
export function isRiichiFuriten(state) {
  if (state === undefined || state === null) return false;
  if (typeof state !== 'object') throw new TypeError('isRiichiFuriten: state 必须是对象');
  const riichi = state.isRiichi === true || state.isDoubleRiichi === true;
  const passed =
    state.riichiFuriten === true ||
    state.passedWinAfterRiichi === true ||
    state.hasPassedWinSinceRiichi === true;
  return riichi && passed;
}

/**
 * 统一振听入口：合并三种振听（任一种成立即振听）。
 *
 * @param {object} ctx 振听上下文
 *   - `hand13` 13 张暗牌（听牌形）；**或**给 `hand14` + `winTile` 由本函数自动扣除和牌张
 *   - `melds` 副露数组（可选）、`meldCount` 副露数（可选，缺省取 melds.length）
 *   - `pond` 自己的牌河（**只含舍牌**：加槓的牌、拔北不算，材料明确）
 *   - `winTile` 本次想荣和的牌（可选；国士十三面的「只禁现物」口径需要它）
 *   - `lastDrawnTile` 自己最近一次摸切打出的牌（同巡振听用，可选）
 *   - `passedWin` 本巡是否见逃过他家的和牌张（游戏层事件，可选）
 *   - `isRiichi` / `isDoubleRiichi` / `riichiFuriten` 立直后振听（可选）
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集（只用 `kokushi13Furiten`）
 * @returns {boolean} 处于振听（不能荣和）返回 true
 * @throws {RangeError} 手牌张数不符时抛出
 */
export function isFuriten(ctx, rules) {
  if (ctx === null || typeof ctx !== 'object') {
    throw new TypeError('isFuriten: ctx 必须是对象');
  }
  const r = resolveRules(rules);
  const melds = ctx.melds || [];
  const mc = toMeldCount(ctx.meldCount, melds);
  const hand13 = resolveHand13(ctx, mc);
  const pond = normalizePond(ctx.pond);

  // 1) 立直后振听（与牌河无关，最优先，且不可能解除）
  if (isRiichiFuriten(ctx)) return true;

  // 2) 舍牌振听
  if (pond.length > 0) {
    const waits = waitingTiles(hand13, mc, melds);
    if (waits.length > 0) {
      const kokushi13 = mc === 0 && isKokushi13Tenpai(hand13);
      if (kokushi13 && r[KOKUSHI_13_FURITEN] === false && ctx.winTile !== undefined && ctx.winTile !== null) {
        // 分歧规则：十三面听只对「河中出现过的那一张」振听，其余 12 面仍可荣和
        if (pond.includes(normalizeIndex(ctx.winTile))) return true;
      } else if (waits.some((t) => pond.includes(t))) {
        return true;
      }
    }
  }

  // 3) 同巡振听：显式事件（passedWin）或牌面可判定的「摸切见逃」
  if (ctx.passedWin === true) return true;
  if (ctx.lastDrawnTile !== undefined && ctx.lastDrawnTile !== null) {
    return isTemporaryFuriten(hand13, mc, melds, pond, ctx.lastDrawnTile);
  }
  return false;
}

/**
 * 由 ctx 求出 13 张听牌形（支持 hand13 直传，或 hand14 + winTile 自动扣除）。
 *
 * @param {object} ctx 上下文
 * @param {number} meldCount 副露数
 * @returns {number[]} 13 张计数数组
 * @throws {TypeError|RangeError} 既没有 hand13 也没有 hand14 + winTile、或张数不符时抛出
 */
function resolveHand13(ctx, meldCount) {
  if (ctx.hand13 !== undefined && ctx.hand13 !== null) {
    return normalizeHand13(ctx.hand13, meldCount);
  }
  if (ctx.hand14 !== undefined && ctx.hand14 !== null) {
    if (ctx.winTile === undefined || ctx.winTile === null) {
      throw new TypeError('isFuriten: 给 hand14 时必须同时给 winTile（用于扣除和牌张）');
    }
    const h = normalizeHand(ctx.hand14);
    const w = normalizeIndex(ctx.winTile);
    const expected14 = 14 - 3 * meldCount;
    if (totalTiles(h) !== expected14) {
      throw new RangeError(`isFuriten: hand14 应为 ${expected14} 张（14 - 3 × ${meldCount}），收到 ${totalTiles(h)} 张`);
    }
    if (h[w] <= 0) throw new RangeError('isFuriten: hand14 中没有 winTile，无法扣除');
    h[w] -= 1;
    return h;
  }
  throw new TypeError('isFuriten: 需要 hand13，或 hand14 + winTile');
}

/**
 * 荣和综合判定（和牌形 + 有役 + 非振听），并给出判定依据。
 *
 * 判定顺序：**先看牌形**（不是和牌形直接否）→ **再看起和番**（宝牌不计入，`hasYaku`）→
 * **最后看振听**。自摸（`ctx.isTsumo === true`）不受振听限制。
 *
 * @param {object} ctx 和牌上下文（yaku.js 的 Context 约定）+ 振听字段
 *   （`pond` / `hand14` / `winTile` / `lastDrawnTile` / `passedWin` / `riichiFuriten` …）
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集
 * @returns {{ok: boolean, isAgari: boolean, hasYaku: boolean, isFuriten: boolean,
 *            yakumanCount: number, totalHan: number, yaku: object, reasons: string[]}} 判定结果
 *   - `reasons` 逐条中文说明（教程用）
 * @throws {TypeError|RangeError} ctx / rules 结构非法时抛出
 */
export function canRonReasons(ctx, rules) {
  const r = resolveRules(rules);
  const c = normalizeContext(ctx);
  const yaku = detectYaku(ctx, r);
  const reasons = [];

  const agari = yaku.form !== null;
  if (!agari) {
    reasons.push('不是和牌形');
    for (const n of yaku.notes) reasons.push(n);
    return { ok: false, isAgari: false, hasYaku: yaku.hasYaku, isFuriten: false, yakumanCount: 0, totalHan: 0, yaku, reasons };
  }

  let furiten = false;
  if (c.isTsumo) {
    reasons.push('自摸和牌不受振听限制');
  } else {
    furiten = isFuriten({ ...ctx, hand14: c.hand, winTile: c.winTile, melds: c.melds }, r);
    if (furiten) reasons.push('振听：不能荣和（可自摸）');
  }

  if (!yaku.hasYaku) {
    reasons.push('无役：宝牌 / 赤宝牌不计入起和番，没有真役不能和牌');
    for (const n of yaku.notes) reasons.push(n);
  } else {
    const names = yaku.list.map((e) => `${e.name}${e.isYakuman ? `(${e.multiplier ?? 1}倍役满)` : ` ${e.han}番`}`);
    reasons.push(`成立役种：${names.join('、')}`);
  }

  const ok = agari && yaku.hasYaku && !furiten;
  return {
    ok,
    isAgari: true,
    hasYaku: yaku.hasYaku,
    isFuriten: furiten,
    yakumanCount: yaku.yakumanCount,
    totalHan: yaku.totalHan,
    yaku,
    reasons,
  };
}

/**
 * 荣和综合判定（简明版）：和牌形 + 有役 + 非振听。
 *
 * @param {object} ctx 和牌上下文（见 canRonReasons）
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集
 * @returns {boolean} 可以荣和返回 true
 * @throws {TypeError|RangeError} ctx / rules 结构非法时抛出
 */
export function canRon(ctx, rules) {
  return canRonReasons(ctx, rules).ok;
}
