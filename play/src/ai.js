/**
 * ai.js —— 分级 AI 对手
 *
 * 全部是确定性算法，没有任何机器学习。牌效率 AI 的完整决策依据就是
 * 引擎的「向听数 + 进张数」—— 第 8 讲的「该打哪张」训练器已经证明了这一点。
 *
 * 分级：
 *   Lv1 随机   —— 陪练用，会无役、会振听，故意的
 *   Lv2 牌效率 —— 向听最小 + 进张最多，能打出像人的牌
 *   Lv3 防守   —— 在 Lv2 基础上，察觉到危险时改打安全牌
 *
 * 想换成 Mortal 那类模型，只需要替换 chooseDiscard 这一个函数。
 */

import { cloneHand, removeTile, tileToStr } from '../../engine/tiles.js';
import { shanten } from '../../engine/shanten.js';
import { discardUkeire, ukeire } from '../../engine/waits.js';

/* ── 难度参数 ──────────────────────────────────────────────────── */

export const LEVELS = {
  1: { name: '随机', callMelds: false, riichi: false, defend: false },
  2: { name: '牌效率', callMelds: false, riichi: true, defend: false },
  3: { name: '攻守', callMelds: true, riichi: true, defend: true },
};

/* ── 打牌决策 ──────────────────────────────────────────────────── */

/**
 * 合法打牌集合。
 * 立直之后只能摸切 —— 此时选择权其实为零。AI 必须**只在合法集合里挑**，
 * 不能先算最优解再直接用：那会生成非法动作（接真实状态机时立刻暴露过）。
 */
function discardPool(hand, allowed) {
  const pool = [];
  for (let t = 0; t < 34; t++) {
    if (!hand[t]) continue;
    if (allowed && !allowed.has(t)) continue;
    for (let k = 0; k < hand[t]; k++) pool.push(t);
  }
  return pool;
}

/** Lv2：先比向听数，再比进张数 */
function efficiencyDiscard(hand, meldCount, allowed) {
  const opts = discardUkeire(hand, meldCount).filter((o) => !allowed || allowed.has(o.discard));
  if (!opts.length) return null;
  let best = opts[0];
  for (const o of opts) {
    if (o.shanten < best.shanten) best = o;
    else if (o.shanten === best.shanten && o.total > best.total) best = o;
  }
  // 同分时随机挑一个，避免每局打得一模一样
  const tied = opts.filter((o) => o.shanten === best.shanten && o.total === best.total);
  return tied[Math.floor(Math.random() * tied.length)].discard;
}

/** Lv1：随便打一张 */
function randomDiscard(hand, allowed) {
  const pool = discardPool(hand, allowed);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/**
 * Lv3 的安全牌判断：优先打「对已经立直的人而言是现物」的牌。
 * 这是第 9 讲讲的现物 —— 对手牌河里出现过的牌，他永远不能荣和。
 */
function safeDiscard(hand, state, seat, allowed) {
  const threats = state.players.filter((p) => p.seat !== seat && p.riichi);
  if (!threats.length) return null;

  const pool = discardPool(hand, allowed);
  if (!pool.length) return null;

  // 对所有威胁者都是现物 → 绝对安全
  const allSafe = pool.filter((t) => threats.every((p) => (p.pond || []).includes(t)));
  if (allSafe.length) return allSafe[0];

  // 对至少一个威胁者是现物 → 相对安全
  const someSafe = pool.filter((t) => threats.some((p) => (p.pond || []).includes(t)));
  if (someSafe.length) return someSafe[0];

  return null;
}

/**
 * 决定打哪张。
 * @param {object} state
 * @param {number} seat
 * @param {Array} [legal] 该座位的合法动作表；给了就只在这个范围内选
 * @returns {number|null} 牌索引
 */
export function chooseDiscard(state, seat, legal = null) {
  const p = state.players[seat];
  const level = state.aiLevel?.[seat] ?? 2;
  const cfg = LEVELS[level] || LEVELS[2];

  // 注意：状态机的手牌**已经包含**刚摸到的那张（摸完后是 14 张），
  // 不需要再补 —— 补了就会让某种牌变成 5 张，被引擎的计数校验拦下。
  const hand = cloneHand(p.hand);
  const allowed = legal
    ? new Set(legal.filter((a) => a.type === 'discard').map((a) => a.tile))
    : null;

  if (allowed) {
    if (allowed.size === 0) return null;
    if (allowed.size === 1) return [...allowed][0];   // 立直后的摸切，没得选
  }

  if (cfg.defend) {
    // 自己还很远（两向听以上）时才考虑弃和，否则继续做牌
    const sh = shanten(hand, p.melds.length);
    if (sh >= 2) {
      const safe = safeDiscard(hand, state, seat, allowed);
      if (safe != null) return safe;
    }
  }

  if (level === 1) return randomDiscard(hand, allowed);
  return efficiencyDiscard(hand, p.melds.length, allowed);
}

/* ── 鸣牌决策 ──────────────────────────────────────────────────── */

/**
 * Lv3 才会鸣牌，而且只鸣「确定能带来役」的：
 * 三元牌 / 场风 / 自风的刻子（役牌），其余一律不碰 —— 这样至少不会鸣出无役。
 */
export function chooseMeld(state, seat, legal) {
  const p = state.players[seat];
  const level = state.aiLevel?.[seat] ?? 2;
  const cfg = LEVELS[level] || LEVELS[2];
  if (!cfg.callMelds) return null;

  const yakuhai = [27 + ((state.roundWind - 27 + 4) % 4), 27 + ((windOfSeat(state, seat) + 4) % 4), 31, 32, 33];

  for (const a of legal) {
    if (a.type === 'pon' && a.tile != null && yakuhai.includes(a.tile)) return a;
    if (a.type === 'kan' && a.tile != null && yakuhai.includes(a.tile)) return a;
  }
  return null;
}

const windOfSeat = (state, seat) => (seat - state.dealer + 4) % 4;

/* ── 立直决策 ──────────────────────────────────────────────────── */

export function shouldRiichi(state, seat, legal) {
  const level = state.aiLevel?.[seat] ?? 2;
  const cfg = LEVELS[level] || LEVELS[2];
  if (!cfg.riichi) return false;
  return legal.some((a) => a.type === 'riichi');
}

/* ── 总入口：按优先级挑一个动作 ────────────────────────────────── */

/**
 * 从合法动作里挑一个执行。返回 null 表示「什么都不做 / 过」。
 * 优先级：和牌 > 杠 > 碰 > 立直 > 打牌（打牌由 chooseDiscard 单独给）
 */
export function chooseAction(state, seat, legal) {
  if (!legal || !legal.length) return null;

  // 能和就和 —— 这是唯一无脑正确的决策
  const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
  if (win) return win;

  const meld = chooseMeld(state, seat, legal);
  if (meld) return meld;

  if (shouldRiichi(state, seat, legal)) {
    const r = legal.find((a) => a.type === 'riichi');
    // 立直必须同时指定要打的牌
    if (r && r.tile == null) {
      const d = chooseDiscard(state, seat, legal);
      if (d != null) return { type: 'riichi', tile: d };
    } else if (r) return r;
  }

  // 其余情况一律「过」。
  // 注意：没有 pass 选项时返回 null，**不要**凭空造一个 { type:'pass' } ——
  // 那不是合法动作，会污染调用方的动作集合校验。
  return legal.find((a) => a.type === 'pass') || null;
}

export { tileToStr, removeTile, ukeire };
