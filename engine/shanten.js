import { HAND_SIZE, HONOR_START, normalizeHand, totalTiles } from './tiles.js';
/**
 * 日本麻将牌理引擎 —— 向听数
 * =====================================================================
 *
 * 【索引约定】见 tiles.js：
 *   0–8 萬 / 9–17 筒 / 18–26 索 / 27–33 東南西北白發中；34/35/36 为赤 5，
 *   入口一律归一到 4/13/22。
 *
 * 【手牌约定】
 *   hand 是长度 34 的计数数组，**只包含暗牌部分**；副露用 meldCount 表达
 *   （每个副露已经是一个完整面子）。合法输入张数为：
 *     - 摸牌前：13 - 3 * meldCount
 *     - 摸牌后：14 - 3 * meldCount
 *   14 张时给出的是“打掉一张后的最小向听数”（对全部打牌取 min）。
 *
 * 【返回值语义】
 *   -1 = 和牌形；0 = 听牌；n = n 向听；带副露的七对子/国士无双返回 Infinity。
 *
 * 【“可达成向听”的定义（重要）】
 *   本模块的向听数采用**可达成**定义：
 *     向听(h) = min { 需要摸进的张数 } - 1
 *              = min_{W} Σ_i max(0, W[i] - h[i]) - 1
 *   其中 W 取遍所有合法和牌形（4 面子 + 1 雀头，且每种牌不超过 4 张，
 *   副露已占的面子计入 W）。
 *   这样一来 “向听 = 0” 严格等价于 “存在一张牌能让这手牌和牌”，
 *   即**不会出现“死张听牌”导致的虚低向听**（例：1111m999p333s333z
 *   形上是单骑 1m，但 1m 已全部在自己手里，永远和不了，故本模块给 1 向听）。
 *   很多只看向听“形”的计算器会给这手牌 0 向听；两者差异仅出现在
 *   “完成牌已被自己占满”的情形。本引擎服务于进张/打牌建议，故取可达成定义。
 *
 * 【两个互相独立的实现（交叉验证用，结果必须完全一致）】
 *   法一 shantenStandardRec：递归拆除 + 到数公式。
 *        把暗牌拆成互不重叠的（面子 / 搭子 / 雀头 / 浮牌），由
 *          摸牌数 = 完成的搭子数 + 2 × 需要新建的面子数 + (无雀头 ? 1 : 0)
 *        得到该拆解的摸牌数（等价于经典到数公式 8 - 2×面子 - 搭子 - 雀头 的 +1），
 *        再对“需要摸进来的牌”做**张数可行性校验**（每种牌最多 4 张，
 *        死张拆解直接作废），最后取全局最小。
 *   法二 shantenStandardDP：完全不用到数公式。按花色做 DP 枚举目标和牌形 W，
 *        直接最小化 Σ max(0, W - hand)，再减 1。
 *   两者在随机样本与穷举子集上必须完全一致（见 tests/shanten.test.mjs）。
 */


/** 面子数上限 @type {number} */
const MAX_MENTSU = 4;
/** 块数上限（4 面子 + 1 雀头） @type {number} */
const MAX_BLOCKS = 5;
/** 搭子顺延状态维度（x / y 各 0–4） @type {number} */
const SHUNTSU_DIM = 5;

/** 结果缓存上限（超过即整体清空，避免无界增长） @type {number} */
const CACHE_LIMIT = 200000;
/** @type {Map<string, number>} */
const recCache = new Map();
/** @type {Map<string, number>} */
const dpCache = new Map();

/**
 * 生成手牌缓存键。
 *
 * @param {number[]} hand 归一化后的计数数组
 * @param {number} meldCount 副露数
 * @returns {string} 缓存键
 */
function cacheKey(hand, meldCount) {
  return `${meldCount}#${hand.join('')}`;
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
  if (!Number.isInteger(meldCount) || meldCount < 0 || meldCount > MAX_MENTSU) {
    throw new RangeError(`meldCount 必须是 0–4 的整数，收到 ${String(meldCount)}`);
  }
  return meldCount;
}

/**
 * 索引是否为幺九牌（内部快速版，入参已归一 0–33）。
 *
 * @param {number} i 归一化牌索引
 * @returns {boolean} 是幺九牌返回 true
 */
function isYaochuIndex(i) {
  if (i >= HONOR_START) return true;
  const r = i % 9;
  return r === 0 || r === 8;
}

/**
 * 某个搭子的“完成牌”候选（摸到其中任意一张即可成面子）。
 *
 * @param {number} a 搭子第一张（索引较小）
 * @param {number} b 搭子第二张
 * @returns {number[]} 完成牌索引数组；空数组表示无解（不会发生）
 */
function completionTiles(a, b) {
  if (a === b) return [a]; // 对子搭子：再摸一张成刻子
  const isNumber = a < HONOR_START;
  if (!isNumber) return [];
  const rankA = a % 9;
  const rankB = b % 9;
  if (rankB - rankA === 1) {
    // 两面 / 边张
    const out = [];
    if (rankA >= 1) out.push(a - 1);
    if (rankB <= 7) out.push(b + 1);
    return out;
  }
  if (rankB - rankA === 2) return [a + 1]; // 嵌张
  return [];
}

/**
 * 【法一】递归拆除 + 到数公式（含张数可行性校验）求标准形向听数。
 *
 * 实现要点：
 *   1. 从最小的非零牌开始分支：刻子 / 顺子 / 对子作雀头 / 对子作搭子 /
 *      两面·边张搭子 / 嵌张搭子 / 作浮牌弃置；同一状态用 Pareto 支配剪枝去重。
 *   2. 叶子处用“摸牌数公式”求值：
 *        摸牌数 = 完成的搭子数 + 2 × 还需新建的面子数 + (没有雀头 ? 1 : 0)
 *      向听 = 摸牌数 - 1。
 *   3. 再做可行性校验：公式假定“搭子的完成牌、新建面子的 2 张牌、雀头的 1 张牌”
 *      都能摸到；若某张牌 4 张全在自己手里（`hand[z] + 已需要摸的张数 > 4`），
 *      该拆解作废。少了这一步就会出现“死张听牌”的虚低向听。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {number} 向听数（-1 为和牌形）
 */
export function shantenStandardRec(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand);
  const key = cacheKey(h, mc);
  const hit = recCache.get(key);
  if (hit !== undefined) return hit;

  const need = MAX_MENTSU - mc;
  const result = need < 0 ? Infinity : recSearch(h, need);
  if (recCache.size >= CACHE_LIMIT) recCache.clear();
  recCache.set(key, result);
  return result;
}

/**
 * 法一的核心搜索。
 *
 * @param {number[]} h 归一化暗牌计数数组（会被就地修改并还原）
 * @param {number} need 暗牌部分需要凑出的面子数（4 - meldCount）
 * @returns {number} 向听数
 */
function recSearch(h, need) {
  let best = Infinity;
  // 可行性校验要看“原始手牌”有多少张（DFS 会把 h 拆空后还原，故先留一份快照）
  const original = h.slice();
  /** @type {Array<{tiles: number[], completions: number[]}>} 当前拆解里的搭子 */
  const taatsu = [];
  /** @type {number[]} 当前拆解里的浮牌 */
  const floaters = [];
  /** 还没被处理的暗牌张数（下界剪枝用） */
  let remaining = totalTiles(h);

  /**
   * 经典到数公式的“摸牌数”形式：把一个拆解（面子 m / 搭子 t / 雀头 p）变成
   *   完成的搭子数 + 2 × 新建面子数 + (无雀头 ? 1 : 0)
   * （等于经典向听公式 8 - 2×面子 - 搭子 - 雀头 的 +1）。
   *
   * @param {number} m 暗面子数
   * @param {number} t 搭子数
   * @param {number} p 雀头数（0/1）
   * @returns {number} 摸牌数
   */
  function baselineDraws(m, t, p) {
    const needMentsu = Math.max(0, need - m);
    const complete = Math.min(t, needMentsu);
    const fresh = needMentsu - complete;
    return complete + 2 * fresh + (p === 0 ? 1 : 0);
  }

  /**
   * 叶子求值：在“摸牌数最小且张数可行”的方案上更新 best。
   *
   * @param {number} m 暗面子数
   * @param {number} t 搭子数
   * @param {number} p 雀头数（0/1）
   * @returns {void}
   */
  function evaluateLeaf(m, t, p) {
    if (baselineDraws(m, t, p) - 1 >= best) return;
    const needMentsu = Math.max(0, need - m);
    const cost = leafCost(original, taatsu, floaters, needMentsu, p);
    if (cost - 1 < best) best = cost - 1;
  }

  /**
   * 当前状态下“可能达到的最小向听”的下界（用于剪枝）。
   *
   * 做法：假设剩下的 remaining 张牌能被最优地做成额外面子/搭子/雀头
   * （每个面子省 2 张摸牌、每个搭子或雀头省 1 张），取其中最好的一种组合。
   * 由于任何真实拆解都不可能比这个乐观估计更好，该值一定是下界，剪枝安全。
   *
   * @param {number} m 面子数
   * @param {number} t 搭子数
   * @param {number} p 雀头数
   * @returns {number} 向听数下界
   */
  function bound(m, t, p) {
    let b = Infinity;
    const maxExtraMentsu = Math.floor(remaining / 3);
    for (let dm = 0; dm <= maxExtraMentsu; dm++) {
      const rest = remaining - dm * 3;
      let v = baselineDraws(m + dm, t + Math.floor(rest / 2), p) - 1;
      if (v < b) b = v;
      if (p === 0 && rest >= 2) {
        v = baselineDraws(m + dm, t + Math.floor((rest - 2) / 2), 1) - 1;
        if (v < b) b = v;
      }
    }
    return b;
  }

  /**
   * @param {number} i 当前最小非零索引
   * @param {number} m 面子数
   * @param {number} t 搭子数
   * @param {number} p 雀头数
   */
  function rec(i, m, t, p) {
    while (i < HAND_SIZE && h[i] === 0) i++;
    // 注意：这里不能用“面子/搭子/雀头更多者支配”的 Pareto 剪枝。
    // 本实现带“张数可行性校验”，块数更多（到数值更低）的拆解可能因为完成牌
    // 已被自己占满而作废，反而块数少的拆解可行 —— 那样剪枝会丢掉正确答案。
    // 只保留下界剪枝（见 bound）。
    if (bound(m, t, p) >= best) return;

    if (i >= HAND_SIZE) {
      evaluateLeaf(m, t, p);
      return;
    }

    const rank = i % 9;
    const isNumber = i < HONOR_START;
    const blocks = m + t + p;

    // 1) 刻子
    if (h[i] >= 3 && m < need) {
      h[i] -= 3;
      remaining -= 3;
      rec(i, m + 1, t, p);
      remaining += 3;
      h[i] += 3;
    }
    // 2) 顺子
    if (isNumber && rank <= 6 && h[i + 1] > 0 && h[i + 2] > 0 && m < need) {
      h[i] -= 1;
      h[i + 1] -= 1;
      h[i + 2] -= 1;
      remaining -= 3;
      rec(i, m + 1, t, p);
      remaining += 3;
      h[i] += 1;
      h[i + 1] += 1;
      h[i + 2] += 1;
    }
    // 3) 对子作雀头（全局只会有一个）
    if (h[i] >= 2 && p === 0) {
      h[i] -= 2;
      remaining -= 2;
      rec(i, m, t, 1);
      remaining += 2;
      h[i] += 2;
    }
    // 4) 对子作搭子
    if (h[i] >= 2 && blocks < MAX_BLOCKS) {
      h[i] -= 2;
      remaining -= 2;
      taatsu.push({ tiles: [i, i], completions: [i] });
      rec(i, m, t + 1, p);
      taatsu.pop();
      remaining += 2;
      h[i] += 2;
    }
    // 5) 两面 / 边张搭子
    if (isNumber && rank <= 7 && h[i + 1] > 0 && blocks < MAX_BLOCKS) {
      h[i] -= 1;
      h[i + 1] -= 1;
      remaining -= 2;
      taatsu.push({ tiles: [i, i + 1], completions: completionTiles(i, i + 1) });
      rec(i, m, t + 1, p);
      taatsu.pop();
      remaining += 2;
      h[i] += 1;
      h[i + 1] += 1;
    }
    // 6) 嵌张搭子
    if (isNumber && rank <= 6 && h[i + 2] > 0 && blocks < MAX_BLOCKS) {
      h[i] -= 1;
      h[i + 2] -= 1;
      remaining -= 2;
      taatsu.push({ tiles: [i, i + 2], completions: [i + 1] });
      rec(i, m, t + 1, p);
      taatsu.pop();
      remaining += 2;
      h[i] += 1;
      h[i + 2] += 1;
    }
    // 7) 当作浮牌弃置
    h[i] -= 1;
    remaining -= 1;
    floaters.push(i);
    rec(i, m, t, p);
    floaters.pop();
    remaining += 1;
    h[i] += 1;
  }

  rec(0, 0, 0, 0);
  return best;
}

/** 所有可能的面子（用于“从零新建面子”的候选）：34 种刻子 + 21 种顺子 @type {number[][]} */
const FRESH_MENTSU = (() => {
  const out = [];
  for (let z = 0; z < HAND_SIZE; z++) out.push([z, z, z]);
  for (let s = 0; s < 3; s++) {
    for (let r = 0; r < 7; r++) {
      const a = s * 9 + r;
      out.push([a, a + 1, a + 2]);
    }
  }
  return out;
})();

/**
 * 叶子处求“最小可行摸牌数”。
 *
 * 给定拆解（面子 m / 搭子 / 雀头 p / 浮牌），完成它一共有 4 种手段：
 *   - 完成搭子：摸 1 张（该搭子的完成牌）；
 *   - 用浮牌做种子的新面子：浮牌 + 摸 2 张（顺子或刻子）；
 *   - 完全从零新建的面子：摸 3 张；
 *   - 雀头：已有（0 张）/ 用未选中的搭子或浮牌做种子（1 张）/ 全新摸两张（2 张）。
 * 把这些手段的参数（完成几个搭子、几个种子面子、几个全新面子、雀头方式）
 * 按总摸牌数升序枚举，返回**第一个张数上可行**的方案的总摸牌数。
 *
 * @param {number[]} original 原始暗牌计数数组
 * @param {Array<{tiles: number[], completions: number[]}>} taatsu 拆解里的搭子
 * @param {number[]} floaters 拆解里的浮牌（牌索引，可重复）
 * @param {number} needMentsu 还需要凑出的面子数（= need - m）
 * @param {number} p 雀头数（0/1）
 * @returns {number} 最小可行摸牌数（全部方案都不可行时为 Infinity）
 */
function leafCost(original, taatsu, floaters, needMentsu, p) {
  const t = taatsu.length;
  const f = floaters.length;
  const maxComplete = Math.min(t, needMentsu);
  /** @type {Array<{k: number, s: number, fresh: number, pairMode: number, cost: number}>} */
  const plans = [];
  for (let k = 0; k <= maxComplete; k++) {
    const rest = needMentsu - k;
    for (let s = 0; s <= Math.min(f, rest); s++) {
      const fresh = rest - s;
      const pairModes = p === 1 ? [0] : [1, 2];
      for (const pairMode of pairModes) {
        const cost = k + 2 * s + 3 * fresh + (pairMode === 1 ? 1 : pairMode === 2 ? 2 : 0);
        plans.push({ k, s, fresh, pairMode, cost });
      }
    }
  }
  plans.sort((a, b) => a.cost - b.cost);
  for (const plan of plans) {
    if (planFeasible(original, taatsu, floaters, plan)) return plan.cost;
  }
  return Infinity;
}

/**
 * 给定拆解与方案参数，检查“要摸的牌”是否都还存在（每种牌总共不超过 4 张）。
 *
 * 判据：对每种牌 z，`原手牌[z] + 需要摸的 z 张数 ≤ 4`。该条件充分（保证目标形
 * 合法）；同时不会漏掉最优解 —— 若某方案只因为“手里同种牌没用完”而通不过，
 * 把那些没用完的牌直接放进面子里会得到摸牌数更少（或相等）的拆解，
 * 递归拆除阶段一定会另行枚举到。
 *
 * @param {number[]} original 原始暗牌计数数组（不会被修改）
 * @param {Array<{tiles: number[], completions: number[]}>} taatsu 拆解里的搭子
 * @param {number[]} floaters 拆解里的浮牌（牌索引，可重复）
 * @param {{k: number, s: number, fresh: number, pairMode: number}} plan 方案参数
 * @returns {boolean} 可行返回 true
 */
function planFeasible(original, taatsu, floaters, plan) {
  const { k, s, fresh, pairMode } = plan;
  const used = new Int32Array(HAND_SIZE);
  const capacity = (z) => 4 - original[z] - used[z];
  const chosen = new Array(taatsu.length).fill(false);
  const usedFloater = new Array(floaters.length).fill(false);

  /**
   * 一组牌是否都摸得到（考虑重复张）。
   *
   * @param {number[]} list 1–3 张牌
   * @returns {boolean} 可摸到返回 true
   */
  function canDrawList(list) {
    if (list.length === 2) {
      if (list[0] === list[1]) return capacity(list[0]) >= 2;
      return capacity(list[0]) >= 1 && capacity(list[1]) >= 1;
    }
    if (list[0] === list[1]) return capacity(list[0]) >= 3;
    return capacity(list[0]) >= 1 && capacity(list[1]) >= 1 && capacity(list[2]) >= 1;
  }

  /**
   * 浮牌 f 能新建的面子（返回“需要摸的 2 张牌”）。
   *
   * @param {number} fl 浮牌索引
   * @returns {number[][]} 候选
   */
  function seedOptions(fl) {
    const out = [[fl, fl]];
    if (fl < HONOR_START) {
      const r = fl % 9;
      if (r >= 2) out.push([fl - 2, fl - 1]);
      if (r >= 1 && r <= 7) out.push([fl - 1, fl + 1]);
      if (r <= 6) out.push([fl + 1, fl + 2]);
    }
    return out;
  }

  /**
   * 收尾：安排雀头。
   *
   * @returns {boolean} 可行返回 true
   */
  function finishPair() {
    if (pairMode === 0) return true;
    if (pairMode === 1) {
      for (let i = 0; i < taatsu.length; i++) {
        if (chosen[i]) continue;
        for (const z of taatsu[i].tiles) {
          if (capacity(z) >= 1) return true;
        }
      }
      for (let i = 0; i < floaters.length; i++) {
        if (usedFloater[i]) continue;
        if (capacity(floaters[i]) >= 1) return true;
      }
      return false;
    }
    for (let z = 0; z < HAND_SIZE; z++) {
      if (capacity(z) >= 2) return true;
    }
    return false;
  }

  /**
   * 安排全新的面子（每个摸 3 张）。
   *
   * @param {number} start 候选面子的起始下标
   * @param {number} count 还要安排几个
   * @returns {boolean} 可行返回 true
   */
  function stepFresh(start, count) {
    if (count === 0) return finishPair();
    for (let idx = start; idx < FRESH_MENTSU.length; idx++) {
      const tri = FRESH_MENTSU[idx];
      if (!canDrawList(tri)) continue;
      for (const z of tri) used[z] += 1;
      if (stepFresh(idx, count - 1)) {
        for (const z of tri) used[z] -= 1;
        return true;
      }
      for (const z of tri) used[z] -= 1;
    }
    return false;
  }

  /**
   * 安排“浮牌做种子”的面子（每个摸 2 张）。
   *
   * @param {number} start 浮牌起始下标
   * @param {number} count 还要安排几个
   * @returns {boolean} 可行返回 true
   */
  function stepSeeded(start, count) {
    if (count === 0) return stepFresh(0, fresh);
    for (let i = start; i < floaters.length; i++) {
      if (usedFloater[i]) continue;
      for (const opt of seedOptions(floaters[i])) {
        if (!canDrawList(opt)) continue;
        usedFloater[i] = true;
        for (const z of opt) used[z] += 1;
        if (stepSeeded(i + 1, count - 1)) {
          for (const z of opt) used[z] -= 1;
          usedFloater[i] = false;
          return true;
        }
        for (const z of opt) used[z] -= 1;
        usedFloater[i] = false;
      }
    }
    return false;
  }

  /**
   * 选择要完成的搭子并分配完成牌。
   *
   * @param {number} start 搭子起始下标
   * @param {number} count 还要完成几个
   * @returns {boolean} 可行返回 true
   */
  function stepTaatsu(start, count) {
    if (count === 0) return stepSeeded(0, s);
    for (let i = start; i < taatsu.length; i++) {
      for (const z of taatsu[i].completions) {
        if (capacity(z) < 1) continue;
        used[z] += 1;
        chosen[i] = true;
        if (stepTaatsu(i + 1, count - 1)) {
          used[z] -= 1;
          chosen[i] = false;
          return true;
        }
        used[z] -= 1;
        chosen[i] = false;
      }
    }
    return false;
  }

  return stepTaatsu(0, k);
}

/**
 * 【法二】按花色 DP 求标准形向听数（完全不使用到数公式）。
 *
 * 思路：一副和牌形等价于“4 个面子 + 1 个雀头”的目标形 W。设
 *   deficit(W) = Σ_i max(0, W[i] - hand[i])   （还需要摸到的张数）
 * 每摸一张最多让 deficit 减少 1，而“摸到缺的那张、同时打掉多余的一张”
 * 可以每步减少 1，故 向听 = min_W deficit(W) - 1。
 *
 * 每个花色内部的面子互不跨花色，故对 4 个花色各做一次
 * “逐 rank、带顺子欠账状态 (x, y)” 的 DP，得到该花色用 m 个面子 + p 个雀头时的
 * 最小 deficit；再把 4 个花色按 (面子数, 雀头数) 卷积起来，取
 * “面子数 = 4 - meldCount、雀头数 = 1” 的最小 deficit。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {number} 向听数（-1 为和牌形）
 */
export function shantenStandardDP(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  const h = normalizeHand(hand);
  const key = cacheKey(h, mc);
  const hit = dpCache.get(key);
  if (hit !== undefined) return hit;

  const needMentsu = MAX_MENTSU - mc;
  let result;
  if (needMentsu < 0) {
    result = Infinity;
  } else {
    /** @type {Float64Array[]} */
    const tables = [];
    for (let s = 0; s < 3; s++) tables.push(suitDeficitTable(h, s * 9, 9, true));
    tables.push(suitDeficitTable(h, HONOR_START, 7, false));

    let acc = new Float64Array((MAX_MENTSU + 1) * 2).fill(Infinity);
    acc[0] = 0;
    for (const table of tables) {
      const next = new Float64Array(acc.length).fill(Infinity);
      for (let m = 0; m <= MAX_MENTSU; m++) {
        for (let p = 0; p <= 1; p++) {
          const base = acc[m * 2 + p];
          if (base === Infinity) continue;
          for (let m2 = 0; m + m2 <= MAX_MENTSU; m2++) {
            for (let p2 = 0; p + p2 <= 1; p2++) {
              const add = table[m2 * 2 + p2];
              if (add === Infinity) continue;
              const val = base + add;
              const at = (m + m2) * 2 + (p + p2);
              if (val < next[at]) next[at] = val;
            }
          }
        }
      }
      acc = next;
    }
    const deficit = acc[needMentsu * 2 + 1];
    result = deficit === Infinity ? Infinity : deficit - 1;
  }

  if (dpCache.size >= CACHE_LIMIT) dpCache.clear();
  dpCache.set(key, result);
  return result;
}

/**
 * 单花色 DP：返回“用 m 个面子 + p 个雀头（p∈{0,1}）时的最小补充张数”表。
 *
 * 状态 (m, p, x, y)：
 *   m = 已经**完成**的面子数（刻子 + 在本 rank 收尾的顺子）
 *   p = 已放置的雀头数
 *   x = 在 r-1 起头、还需要 r 与 r+1 的顺子数
 *   y = 在 r-2 起头、只需要 r 的顺子数（在本 rank 收尾，计入 m）
 * 处理 rank r 时选择：k 个刻子（0/1）、q 个雀头（0/1）、cnt 个在 r 起头的顺子，
 * 于是目标形在 r 上占用的张数 W = 3k + 2q + x + y + cnt（必须 ≤ 4），
 * 代价 += max(0, W - 手牌在 r 的张数)。
 *
 * @param {number[]} hand 归一化后的整手计数数组
 * @param {number} start 花色起始索引
 * @param {number} len 花色长度（9 或 7）
 * @param {boolean} allowShuntsu 是否允许顺子
 * @returns {Float64Array} 长度 10 的表，索引 m*2+p → 最小补充张数
 */
function suitDeficitTable(hand, start, len, allowShuntsu) {
  const idx = (m, p, x, y) => ((m * 2 + p) * SHUNTSU_DIM + x) * SHUNTSU_DIM + y;
  const stateCount = (MAX_MENTSU + 1) * 2 * SHUNTSU_DIM * SHUNTSU_DIM;
  let cur = new Float64Array(stateCount).fill(Infinity);
  let next = new Float64Array(stateCount).fill(Infinity);
  cur[idx(0, 0, 0, 0)] = 0;

  for (let r = 0; r < len; r++) {
    next.fill(Infinity);
    const c = hand[start + r];
    const canStartShuntsu = allowShuntsu && r + 2 < len;
    for (let m = 0; m <= MAX_MENTSU; m++) {
      for (let p = 0; p <= 1; p++) {
        for (let x = 0; x < SHUNTSU_DIM; x++) {
          for (let y = 0; y < SHUNTSU_DIM; y++) {
            const v = cur[idx(m, p, x, y)];
            if (v === Infinity) continue;
            for (let k = 0; k <= 1; k++) {
              if (m + k > MAX_MENTSU) continue;
              for (let q = 0; q <= 1; q++) {
                if (p + q > 1) continue;
                const base = 3 * k + 2 * q + x + y;
                if (base > 4) continue;
                const maxCnt = canStartShuntsu ? 4 - base : 0;
                for (let cnt = 0; cnt <= maxCnt; cnt++) {
                  if (m + k + y + x + cnt > MAX_MENTSU) continue; // 面子总数上限
                  const w = base + cnt;
                  const cost = v + (w > c ? w - c : 0);
                  // y 个顺子在本 rank 收尾 → 面子数 +y
                  const at = idx(m + k + y, p + q, cnt, x);
                  if (cost < next[at]) next[at] = cost;
                }
              }
            }
          }
        }
      }
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }

  const table = new Float64Array((MAX_MENTSU + 1) * 2).fill(Infinity);
  for (let m = 0; m <= MAX_MENTSU; m++) {
    for (let p = 0; p <= 1; p++) {
      const v = cur[idx(m, p, 0, 0)]; // 收尾时不允许有未完成的顺子欠账
      if (v < table[m * 2 + p]) table[m * 2 + p] = v;
    }
  }
  return table;
}

/**
 * 标准形向听数（对外主入口，等价于 shantenStandardRec）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {number} 向听数（-1 为和牌形）
 */
export function shantenStandard(hand, meldCount = 0) {
  return shantenStandardRec(hand, meldCount);
}

/**
 * 七对子向听数。
 *
 * 公式：6 - 对数 + max(0, 7 - 种类数)。
 * 4 张相同的牌只能算 1 对，因此 1111m2233445566p 之类不会被当成七对子听牌。
 * 有副露时七对子不可能成立，返回 Infinity。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {number} 向听数（-1 为和牌形；有副露为 Infinity）
 */
export function shantenChiitoi(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  if (mc > 0) return Infinity;
  const h = normalizeHand(hand);
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < HAND_SIZE; i++) {
    const n = h[i];
    if (n === 0) continue;
    kinds++;
    if (n >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/**
 * 国士无双向听数。
 *
 * 公式：13 - 幺九种类数 - (已有幺九对子 ? 1 : 0)。
 * 有副露时国士无双不可能成立，返回 Infinity。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {number} 向听数（-1 为和牌形；有副露为 Infinity）
 */
export function shantenKokushi(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  if (mc > 0) return Infinity;
  const h = normalizeHand(hand);
  let kinds = 0;
  let hasPair = false;
  for (let i = 0; i < HAND_SIZE; i++) {
    const n = h[i];
    if (n === 0) continue;
    if (!isYaochuIndex(i)) continue;
    kinds++;
    if (n >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/**
 * 向听数（标准形 / 七对子 / 国士无双 三者取最小）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组（只含暗牌）
 * @param {number} [meldCount=0] 副露数
 * @returns {number} 最小向听数（-1 为和牌形）
 */
export function shanten(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  let best = shantenStandardRec(hand, mc);
  if (best > -1) {
    const c = shantenChiitoi(hand, mc);
    if (c < best) best = c;
    const k = shantenKokushi(hand, mc);
    if (k < best) best = k;
  }
  return best;
}

/**
 * 清空内部记忆化缓存（测试或长时间运行的工具可调用）。
 *
 * @returns {void}
 */
export function clearShantenCache() {
  recCache.clear();
  dpCache.clear();
}

/**
 * 诊断用：手牌张数是否与 meldCount 匹配（13-3n 或 14-3n）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} [meldCount=0] 副露数
 * @returns {boolean} 张数合法返回 true
 */
export function isValidHandSize(hand, meldCount = 0) {
  const mc = toMeldCount(meldCount);
  const n = totalTiles(hand);
  return n === 13 - 3 * mc || n === 14 - 3 * mc;
}
