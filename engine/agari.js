import { HAND_SIZE, HONOR_START, normalizeHand, totalTiles } from './tiles.js';
/**
 * 日本麻将牌理引擎 —— 和牌形判定与标准形拆解
 * =====================================================================
 *
 * 【索引约定】见 tiles.js：
 *   0–8 萬 / 9–17 筒 / 18–26 索 / 27–33 東南西北白發中；34/35/36 为赤 5，
 *   入口一律归一到 4/13/22。
 *
 * 【手牌约定】
 *   传入的 hand 是长度 34 的计数数组，**只包含暗牌部分**；
 *   副露用 meldCount（= melds.length）表达“已固定的面子数”，副露的具体牌不参与
 *   和牌形判定（因为任何副露本身都已经是完整面子）。
 *   因此本模块要求的暗牌张数为：
 *     - 和牌形 : 14 - 3 * meldCount
 *     - 听牌形 : 13 - 3 * meldCount
 *
 * 【本模块的产物】
 *   decomposeStandard() 只拆解**暗牌部分**，返回的 mentsu 全部来自暗牌，
 *   故其 concealed 字段恒为 true。要得到完整 4 面子 + 雀头，调用方需自行把
 *   melds 中的面子（concealed = false，暗杠除外）与拆解结果合并。
 */


/**
 * @typedef {Object} Mentsu
 * @property {'shuntsu'|'koutsu'} type 顺子或刻子
 * @property {number[]} tiles 组成该面子的牌索引（顺子升序；刻子为 3 个相同索引）
 * @property {boolean} concealed 是否暗面（本模块只拆暗牌，恒为 true）
 */

/**
 * @typedef {Object} StandardDecomposition
 * @property {number} pair 雀头的牌索引
 * @property {Mentsu[]} mentsu 面子数组（长度固定为 4 - meldCount）
 */

/**
 * 把某一花色（9 个或 7 个 rank 的计数数组）完全拆成面子。
 *
 * 算法：总是从**最小的非零 rank** 开始尝试，因此每个不同的面子多重集合
 * 只会被枚举一次（天然去重）。返回的每个解都是“该花色所有牌恰好用完”的
 * 面子列表；无法完全用完时该分支不产生解。
 *
 * @param {number[]} counts 花色内计数（长度 9 或 7），会被就地修改后还原
 * @param {number} start 该花色在 34 索引中的起始位置（0/9/18/27）
 * @param {boolean} allowShuntsu 是否允许顺子（字牌为 false）
 * @returns {Mentsu[][]} 所有拆解方案（每个方案是一组面子）
 */
function decomposeSuit(counts, start, allowShuntsu) {
  const len = counts.length;
  const results = [];
  const cur = [];

  /**
   * @param {number} pos 当前处理的 rank
   */
  function rec(pos) {
    while (pos < len && counts[pos] === 0) pos++;
    if (pos === len) {
      results.push(cur.slice());
      return;
    }
    // 刻子
    if (counts[pos] >= 3) {
      counts[pos] -= 3;
      cur.push({ type: 'koutsu', tiles: [start + pos, start + pos, start + pos], concealed: true });
      rec(pos);
      cur.pop();
      counts[pos] += 3;
    }
    // 顺子
    if (allowShuntsu && pos + 2 < len && counts[pos + 1] > 0 && counts[pos + 2] > 0) {
      counts[pos] -= 1;
      counts[pos + 1] -= 1;
      counts[pos + 2] -= 1;
      cur.push({
        type: 'shuntsu',
        tiles: [start + pos, start + pos + 1, start + pos + 2],
        concealed: true,
      });
      rec(pos);
      cur.pop();
      counts[pos] += 1;
      counts[pos + 1] += 1;
      counts[pos + 2] += 1;
    }
    // 其余情况：死路（该 rank 剩下的牌无法成面子）
  }

  rec(0);
  return results;
}

/**
 * 拆解标准形（4 面子 + 1 雀头）的**全部**方案（已去重）。
 *
 * 副露面子不计入返回值，只通过 meldCount 影响“需要几个面子”。
 * 若暗牌张数不是 14 - 3 * meldCount，或无法拆解，返回 []。
 *
 * 一杯口 / 二杯口判定需要“全部方案”，例如 111222333m 会同时给出
 * {111m,222m,333m} 与 {123m,123m,123m} 两组解。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（长度 34；允许含赤槽位的 37 长度数组）
 * @param {number} [meldCount=0] 副露数（已固定的面子数）
 * @returns {StandardDecomposition[]} 全部拆解方案，无解时为 []
 */
export function decomposeStandard(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  const needMentsu = 4 - mc;
  if (needMentsu < 0) return [];
  const h = normalizeHand(hand);
  if (totalTiles(h) !== needMentsu * 3 + 2) return [];

  const solutions = [];
  const seen = new Set();

  for (let pair = 0; pair < HAND_SIZE; pair++) {
    if (h[pair] < 2) continue;
    h[pair] -= 2;

    /** @type {Array<{start:number, sols:Mentsu[][]}>} */
    const perSuit = [];
    let dead = false;
    for (let s = 0; s < 4; s++) {
      const start = s * 9;
      const len = s === 3 ? 7 : 9;
      const counts = new Array(len);
      let any = false;
      for (let k = 0; k < len; k++) {
        counts[k] = h[start + k];
        if (counts[k] > 0) any = true;
      }
      if (!any) {
        perSuit.push({ start, sols: [[]] });
        continue;
      }
      const sols = decomposeSuit(counts, start, s !== 3);
      if (sols.length === 0) {
        dead = true;
        break;
      }
      perSuit.push({ start, sols });
    }

    if (!dead) {
      const combo = [];
      /** @param {number} si */
      const walk = (si) => {
        if (si === perSuit.length) {
          const key = signature(pair, combo);
          if (!seen.has(key)) {
            seen.add(key);
            solutions.push({ pair, mentsu: combo.slice() });
          }
          return;
        }
        for (const sol of perSuit[si].sols) {
          for (const m of sol) combo.push(m);
          walk(si + 1);
          for (let k = 0; k < sol.length; k++) combo.pop();
        }
      };
      walk(0);
    }

    h[pair] += 2;
  }

  return solutions;
}

/**
 * 生成一组拆解方案的去重签名。
 *
 * @param {number} pair 雀头索引
 * @param {Mentsu[]} mentsu 面子数组
 * @returns {string} 签名
 */
function signature(pair, mentsu) {
  const parts = mentsu.map((m) => `${m.type}:${m.tiles.join('-')}`);
  parts.sort();
  return `${pair}|${parts.join(';')}`;
}

/**
 * 是否为标准形和牌（4 面子 + 1 雀头）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {boolean} 是和牌形返回 true
 */
export function isStandardShape(hand, meldCount = 0) {
  return decomposeStandard(hand, meldCount).length > 0;
}

/**
 * 是否为七对子形。
 *
 * 必须**恰好 7 种牌各 2 张**：4 张相同的牌只能算 1 对（不能拆成两对），
 * 因此 1111m2233445566p 之类的牌形不是七对子。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（应为 14 张、无副露）
 * @returns {boolean} 是七对子形返回 true
 */
export function isChiitoi(hand) {
  const h = normalizeHand(hand);
  if (totalTiles(h) !== 14) return false;
  let kinds = 0;
  for (let i = 0; i < HAND_SIZE; i++) {
    const n = h[i];
    if (n === 0) continue;
    if (n !== 2) return false; // 1 张 / 3 张 / 4 张都不合法
    kinds++;
  }
  return kinds === 7;
}

/**
 * 七对子形的别名（isChiitoi 的语义化名称）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @returns {boolean} 是七对子形返回 true
 */
export function isSevenPairsShape(hand) {
  return isChiitoi(hand);
}

/**
 * 是否为国士无双向听/和牌形（13 种幺九牌齐全，其中一种 2 张）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（应为 14 张、无副露）
 * @returns {boolean} 是国士无双形返回 true
 */
export function isKokushi(hand) {
  const h = normalizeHand(hand);
  if (totalTiles(h) !== 14) return false;
  let kinds = 0;
  let doubled = 0;
  for (let i = 0; i < HAND_SIZE; i++) {
    const n = h[i];
    if (n === 0) continue;
    if (!isYaochuIndex(i)) return false;
    if (n > 2) return false;
    kinds++;
    if (n === 2) doubled++;
  }
  return kinds === 13 && doubled === 1;
}

/**
 * 和牌形是否为“国士十三面”形。
 *
 * 说明（重要）：国士十三面与国士无双**单骑**的和牌形完全一样，都是
 * “13 种幺九牌齐全 + 其中一种 2 张”。因此本函数对两者都返回 true；
 * 究竟算不算十三面，必须由调用方根据**听牌形**（13 张时是否为 13 种各 1 张，
 * 见 isKokushi13Tenpai）来判断。本函数只是按约定返回“该和牌形是否为十三面形”。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（14 张的和牌形）
 * @returns {boolean} 该和牌形是否为十三面形
 */
export function isKokushi13Wait(hand) {
  return isKokushi(hand);
}

/**
 * 13 张国士听牌形是否为“十三面”（13 种幺九牌各 1 张，无重复）。
 *
 * 这是判断国士十三面所必需的**听牌形**判据（见 isKokushi13Wait 的说明）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（13 张的听牌形）
 * @returns {boolean} 是十三面听牌形返回 true
 */
export function isKokushi13Tenpai(hand) {
  const h = normalizeHand(hand);
  if (totalTiles(h) !== 13) return false;
  let kinds = 0;
  for (let i = 0; i < HAND_SIZE; i++) {
    const n = h[i];
    if (n === 0) continue;
    if (n !== 1 || !isYaochuIndex(i)) return false;
    kinds++;
  }
  return kinds === 13;
}

/**
 * 三类和牌形（标准形 / 七对子 / 国士无双）的判定结果。
 *
 * 七对子与国士无双要求 meldCount === 0（有副露时不可能成立）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {{standard: StandardDecomposition[], chiitoi: boolean, kokushi: boolean}} 判定结果
 */
export function agariForms(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand);
  const expected = 14 - 3 * mc;
  if (expected < 2 || totalTiles(h) !== expected) {
    return { standard: [], chiitoi: false, kokushi: false };
  }
  return {
    standard: decomposeStandard(h, mc),
    chiitoi: mc === 0 ? isChiitoi(h) : false,
    kokushi: mc === 0 ? isKokushi(h) : false,
  };
}

/**
 * 是否为和牌形（标准形 / 七对子 / 国士无双 任一成立）。
 *
 * 暗牌张数必须等于 14 - 3 * meldCount，否则直接返回 false。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {boolean} 是和牌形返回 true
 */
export function isAgari(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand);
  const expected = 14 - 3 * mc;
  if (expected < 2 || totalTiles(h) !== expected) return false;
  if (decomposeStandard(h, mc).length > 0) return true;
  if (mc === 0 && (isChiitoi(h) || isKokushi(h))) return true;
  return false;
}

/**
 * 校验并归一 meldCount。
 *
 * @param {number} meldCount 副露数
 * @returns {number} 归一后的副露数（0–4）
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
 * 索引是否为幺九牌（内部快速版，入参已是 0–33）。
 *
 * @param {number} i 归一化牌索引
 * @returns {boolean} 是幺九牌返回 true
 */
function isYaochuIndex(i) {
  if (i >= HONOR_START) return true;
  const r = i % 9;
  return r === 0 || r === 8;
}
