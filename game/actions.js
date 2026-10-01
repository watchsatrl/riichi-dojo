/**
 * 日本麻将对局状态机 —— 合法动作生成与校验（纯函数层）
 * =====================================================================
 *
 * 【职责】本模块只做「无副作用的合法性判定」，不持有对局状态、不修改入参。
 *   state.js 负责把它们组合成 `legalActions()`；这样规则可以被单独测试。
 *
 * 【规则依据】docs/rules.md
 *   - §3.2 摸打循环（摸牌后可宣告的动作清单）
 *   - §4.1 鸣牌优先顺序 荣和 > 碰/大明杠 > 吃
 *   - §4.2 吃/碰/杠的成立条件（吃仅下家、加杠需「碰过该牌且摸到第 4 张」）
 *   - §4.3 食替禁止的准确边界（现物替 + 筋替，只限制鸣牌后的那一次打牌）
 *   - §5.1 立直宣言条件（门清 / 听牌 / 点数 ≥ 1000 / 剩余可摸牌 ≥ 4）
 *   - §5.4 立直后暗杠：听牌集合必须完全一致
 *   - §6.4 形式听牌（无役也算听牌；空听也算；「听第 5 张」允许）
 *   - §10.5.1 九种九牌（首次摸牌 + 未鸣牌 + 幺九种数 ≥ 9）
 */

import {
  HAND_SIZE,
  HONOR_START,
  MAX_COPIES,
  isYaochu,
  normalizeHand,
  normalizeIndex,
  rankOf,
  suitOf,
} from '../engine/tiles.js';
import { isAgari } from '../engine/agari.js';

/**
 * 计算 13 张形（`13 - 3 × meldCount` 张暗牌）的听牌集合。
 *
 * 与 engine/waits.js 的 `waitingTiles()` 有**一处刻意的口径差异**：本函数只排除
 * 「**纯手牌**已经用尽该牌种 4 张」的牌（rules.md §6.4「听第 5 张：只要纯手牌未用尽该牌种的
 * 4 张」），而 `waitingTiles()` 把副露里的牌也算进占用。game 层用本函数作为统一口径，
 * 以保证「立直时记录的听牌集合」与「立直后暗杠比较用的听牌集合」严格可比。
 *
 * 另外本函数**不要求所听牌还有剩余**（空听 / 纯空听也算听牌，§6.4、附录 C-3）。
 *
 * @param {ArrayLike<number>} hand13 暗牌计数数组（`13 - 3 × meldCount` 张）
 * @param {number} [meldCount=0] 副露数
 * @returns {number[]} 能和牌的牌索引（升序，0–33）
 * @throws {TypeError|RangeError} 计数数组非法时抛出
 */
export function waitsOf(hand13, meldCount = 0) {
  const h = normalizeHand(hand13);
  const mc = meldCount === undefined || meldCount === null ? 0 : meldCount;
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    if (h[t] >= MAX_COPIES) continue; // 纯手牌已用尽 4 张 → 拿不到第 5 张，不参与判定
    h[t] += 1;
    if (isAgari(h, mc)) out.push(t);
    h[t] -= 1;
  }
  return out;
}

/**
 * 是否听牌（形式听牌也算，§6.4）—— 与 `waitsOf()` 同一判据的短路版本。
 *
 * `waitsOf()` 会算完整听牌集合（34 次和牌判定），本函数找到第一个就返回，
 * 用于立直候选筛选、流局听牌判定这类只需要布尔值的场景（自动对局性能关键路径）。
 *
 * @param {ArrayLike<number>} hand13 暗牌计数数组（`13 - 3 × meldCount` 张）
 * @param {number} [meldCount=0] 副露数
 * @returns {boolean} 听牌返回 true
 */
export function hasWait(hand13, meldCount = 0) {
  const h = normalizeHand(hand13);
  const mc = meldCount === undefined || meldCount === null ? 0 : meldCount;
  for (let t = 0; t < HAND_SIZE; t++) {
    if (h[t] >= MAX_COPIES) continue;
    h[t] += 1;
    const ok = isAgari(h, mc);
    h[t] -= 1;
    if (ok) return true;
  }
  return false;
}

/**
 * 是否听牌（形式听牌也算，§6.4）。
 *
 * @param {ArrayLike<number>} hand13 暗牌计数数组（`13 - 3 × meldCount` 张）
 * @param {number} [meldCount=0] 副露数
 * @returns {boolean} 听牌返回 true
 */
export function isTenpaiShape(hand13, meldCount = 0) {
  return hasWait(hand13, meldCount);
}

/**
 * 两个听牌集合是否完全相同（立直后暗杠的判据，§5.4）。
 *
 * @param {number[]} a 听牌集合 A
 * @param {number[]} b 听牌集合 B
 * @returns {boolean} 完全相同返回 true
 */
export function sameWaitSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * 列出「用手牌中的哪两张可以吃这张牌」。
 *
 * 吃只能吃上家（§4.2），本函数只判定牌形，上家限制由 state.js 施加。
 * 三种取法：`x-2,x-1` / `x-1,x+1`（嵌张）/ `x+1,x+2`（§4.2 表格）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} tile 被吃的牌（0–33；赤 5 会自动归一）
 * @returns {number[][]} 二元组数组，每个元素形如 `[a, b]`（升序）；不能吃时为空数组
 */
export function chiOptions(hand, tile) {
  const h = normalizeHand(hand);
  const t = normalizeIndex(tile);
  if (t >= HONOR_START) return []; // 字牌不能吃
  const r = t % 9; // 0–8
  const suitStart = t - r;
  const patterns = [];
  if (r >= 2) patterns.push([r - 2, r - 1]);
  if (r >= 1 && r <= 7) patterns.push([r - 1, r + 1]);
  if (r <= 6) patterns.push([r + 1, r + 2]);
  const out = [];
  for (const [a, b] of patterns) {
    if (h[suitStart + a] >= 1 && h[suitStart + b] >= 1) out.push([suitStart + a, suitStart + b]);
  }
  return out;
}

/**
 * 是否可以碰（手牌有该牌对子，§4.2）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} tile 被碰的牌
 * @returns {boolean} 可以碰返回 true
 */
export function canPon(hand, tile) {
  const h = normalizeHand(hand);
  return h[normalizeIndex(tile)] >= 2;
}

/**
 * 是否可以大明杠（手牌有该牌暗刻，§4.2）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number} tile 被杠的牌
 * @returns {boolean} 可以大明杠返回 true
 */
export function canMinkan(hand, tile) {
  const h = normalizeHand(hand);
  return h[normalizeIndex(tile)] >= 3;
}

/**
 * 可以暗杠的牌（手牌中恰好 4 张的牌种）。
 *
 * 「恰好 4 张」是引擎的计数上限决定的：手里不可能有第 5 张。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @returns {number[]} 可暗杠的牌索引（升序）
 */
export function ankanTiles(hand) {
  const h = normalizeHand(hand);
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) if (h[t] === MAX_COPIES) out.push(t);
  return out;
}

/**
 * 可以加杠的牌（自己碰过该牌、且手里还有第 4 张，§4.2）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {Array<{type: string, tiles: number[]}>} melds 副露数组
 * @returns {number[]} 可加杠的牌索引（升序）
 */
export function kakanTiles(hand, melds) {
  const h = normalizeHand(hand);
  const out = [];
  for (const meld of melds || []) {
    if (meld.type !== 'pon') continue;
    const t = normalizeIndex(meld.tiles[0]);
    if (h[t] >= 1 && !out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * 食替判定（§4.3）：鸣牌后的**第一次**打牌不得打出「能被鸣入牌组成的同一组面子的另一张」。
 *
 * 两种情形：
 *   1. **现物替**：打出刚鸣入的那张牌（吃 / 碰都适用）；
 *   2. **筋替**（仅吃）：吃 `45m` 叫 `3m` 成 `345m` 后打 `6m`，或叫 `6m` 成 `456m` 后打 `3m`。
 *      一般化为「记成型顺子的最小牌为 start，则 `start-1` 与 `start+3` 都在禁止之列」。
 *
 * 大明杠后不可能构成食替（4 张无法组成两组同顺子，§4.3 代码块），暗杠更不可能（牌没动）。
 *
 * @param {{type: string, tiles: number[], calledTile?: number}} meld 刚成立的副露
 * @param {number} discardTile 想打出的牌（0–36）
 * @returns {boolean} 构成食替（禁止）返回 true
 */
export function isKuikae(meld, discardTile) {
  if (meld === null || typeof meld !== 'object') return false;
  const d = normalizeIndex(discardTile);
  if (meld.type === 'chi') {
    const tiles = meld.tiles.map(normalizeIndex);
    const start = Math.min(...tiles);
    if (meld.calledTile !== undefined && meld.calledTile !== null) {
      if (normalizeIndex(meld.calledTile) === d) return true; // 现物替
    }
    if (suitOf(d) !== suitOf(start)) return false;
    const dr = rankOf(d);
    const sr = rankOf(start);
    return dr === sr - 1 || dr === sr + 3; // 筋替
  }
  if (meld.type === 'pon') {
    const called =
      meld.calledTile === undefined || meld.calledTile === null
        ? normalizeIndex(meld.tiles[0])
        : normalizeIndex(meld.calledTile);
    return called === d; // 现物替
  }
  return false;
}

/**
 * 列出某副露在被打牌阶段禁止打出的牌（供 UI 置灰与测试断言）。
 *
 * @param {{type: string, tiles: number[], calledTile?: number}} meld 副露
 * @returns {number[]} 禁止打出的牌索引（升序）
 */
export function kuikaeForbiddenTiles(meld) {
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) if (isKuikae(meld, t)) out.push(t);
  return out;
}

/**
 * 手牌中幺九牌的**种数**（九种九牌用，§10.5.1：是种数不是张数）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @returns {number} 0–13
 */
export function distinctYaochuKinds(hand) {
  const h = normalizeHand(hand);
  let n = 0;
  for (let t = 0; t < HAND_SIZE; t++) if (h[t] > 0 && isYaochu(t)) n++;
  return n;
}

/**
 * 列出可以打出的牌（含赤 5 的两种写法）。
 *
 * 赤牌约定：`hand` 是 34 项归一计数数组，赤牌信息在 `handRed`（按 m/p/s 三档）。
 *   - 手里同时有普通 5 与赤 5 → 同时给出 `5`（打普通）与 `34/35/36`（打赤）；
 *   - 手里的 5 全是赤的 → 只给 `5`（打出的必然是赤的，由 state.js 结算时判定）。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {number[]} [handRed=[0,0,0]] 手牌中赤 5m/5p/5s 的张数
 * @returns {number[]} 可打出的牌索引（升序，可能含 34–36）
 */
export function discardCandidates(hand, handRed) {
  const h = normalizeHand(hand);
  const red = handRed === undefined || handRed === null ? [0, 0, 0] : handRed;
  const out = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    if (h[t] <= 0) continue;
    out.push(t);
    if (t % 9 === 4 && t < 27) {
      const suit = Math.floor(t / 9);
      const reds = red[suit] || 0;
      if (reds > 0 && h[t] > reds) out.push(34 + suit); // 存在「打赤」这一独立选择
    }
  }
  return out.sort((a, b) => a - b);
}

/**
 * 归一化动作对象（补齐可省略字段、统一升序数组），便于比较与传输。
 *
 * @param {object} action 动作
 * @returns {object} 新对象（不修改入参）
 * @throws {TypeError|RangeError} 动作形状非法时抛出
 */
export function normalizeAction(action) {
  if (action === null || typeof action !== 'object') throw new TypeError('normalizeAction: 动作必须是对象');
  const type = action.type;
  switch (type) {
    case 'discard':
    case 'riichi': {
      // 0–36 全部合法（34/35/36 = 显式打赤 5）；非法索引由 normalizeIndex 抛错。
      // 注意：**不能**把 34 归一成 4 —— 那会让「打赤 5」与「打普通 5」变成同一个动作。
      const raw = action.tile;
      normalizeIndex(raw); // 校验
      return { type, tile: raw >= 34 ? raw : normalizeIndex(raw) };
    }
    case 'tsumo':
    case 'ron':
    case 'pass':
    case 'kyuushu':
    case 'nine_kan_abort':
      return { type };
    case 'pon':
      return { type };
    case 'chi': {
      if (!Array.isArray(action.tiles) || action.tiles.length !== 2) {
        throw new RangeError('normalizeAction: chi 需要 tiles: [number, number]');
      }
      const tiles = action.tiles.map(normalizeIndex).sort((a, b) => a - b);
      if (tiles[0] === tiles[1]) throw new RangeError('normalizeAction: chi 的两张牌不能相同');
      return { type, tiles };
    }
    case 'kan': {
      const kind = action.kind;
      if (kind !== 'ankan' && kind !== 'minkan' && kind !== 'kakan') {
        throw new RangeError(`normalizeAction: kan.kind 必须是 ankan/minkan/kakan，收到 ${String(kind)}`);
      }
      return { type, kind, tile: normalizeIndex(action.tile) };
    }
    default:
      throw new RangeError(`normalizeAction: 未知动作类型 "${String(type)}"`);
  }
}

/**
 * 动作的唯一键（用于「动作是否合法」的集合比较）。
 *
 * @param {object} action 动作
 * @returns {string} 形如 `kan:ankan:4` 的键
 */
export function actionKey(action) {
  const a = normalizeAction(action);
  if (a.type === 'chi') return `chi:${a.tiles.join('-')}`;
  if (a.type === 'kan') return `kan:${a.kind}:${a.tile}`;
  if (a.type === 'discard' || a.type === 'riichi') return `${a.type}:${a.tile}`;
  return a.type;
}

/**
 * 两个动作是否等价（chi 的两张牌顺序无关）。
 *
 * @param {object} a 动作 A
 * @param {object} b 动作 B
 * @returns {boolean} 等价返回 true
 */
export function sameAction(a, b) {
  try {
    return actionKey(a) === actionKey(b);
  } catch {
    return false;
  }
}

/**
 * 在合法动作表中查找与给定动作等价的项。
 *
 * @param {object[]} actions 合法动作表
 * @param {object} action 待查动作
 * @returns {object|null} 找到的规范动作（来自 actions），未找到返回 null
 */
export function findAction(actions, action) {
  if (!Array.isArray(actions)) return null;
  let key;
  try {
    key = actionKey(action);
  } catch {
    return null;
  }
  for (const a of actions) {
    if (actionKey(a) === key) return a;
  }
  return null;
}

/**
 * 动作的中文说明（事件播报 / 报错信息用）。
 *
 * @param {object} action 动作
 * @returns {string} 说明串
 */
export function describeAction(action) {
  const a = normalizeAction(action);
  switch (a.type) {
    case 'discard':
      return `打牌 ${a.tile}`;
    case 'riichi':
      return `立直宣言并打 ${a.tile}`;
    case 'tsumo':
      return '自摸和牌';
    case 'ron':
      return '荣和';
    case 'pass':
      return '放弃';
    case 'chi':
      return `吃 ${a.tiles.join('+')}`;
    case 'pon':
      return '碰';
    case 'kan':
      return `${a.kind} ${a.tile}`;
    case 'kyuushu':
      return '九种九牌流局';
    case 'nine_kan_abort':
      return '四槓散了流局';
    default:
      return String(a.type);
  }
}
