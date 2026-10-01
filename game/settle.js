/**
 * 日本麻将对局状态机 —— 和了 / 流局的点数结算与连庄判定
 * =====================================================================
 *
 * 【规则依据】docs/rules.md
 *   - §2.4 本场：四麻 1 根 300 点；荣和由放铳者全额支付，自摸三家各付 100 × 本场
 *   - §2.5 供托：和牌者取走全部立直棒；多家和牌由头跳家取得；流局留场；终局由一位获得
 *   - §2.6 连庄条件（完备表）
 *   - §6.5 多家和牌：雀魂无头跳 → 全部结算（按逆时针），场供与立直棒归头跳家
 *   - §10.3 不听罚符：合计 3000 点，在听牌者之间平均分配
 *   - §10.4 流局满贯：按满贯清算，替代听牌清算
 *   - §11.1 包牌：雀魂只包「包牌役满」那一部分（大三元 / 大四喜；四槓子不包）
 *   - §12.1 终局判定；§12.2 击飞（严格小于 0）；§12.3 顺位马 [15,5,-5,-15]；§12.4 同点顺位
 *
 * 【职责边界】本模块**只计算**（返回 deltas / 明细），不修改玩家点数；
 *   点数的施加、结果落盘（state.result）由 state.js 完成。唯一例外是 `advanceHand()`，
 *   它负责把「下一局的亲家 / 本场 / 场风」写回 state（终局时写 ranking）。
 */

import { calcScore, HONBA_POINTS, RIICHI_STICK_POINTS } from '../engine/score.js';
import { detectYaku } from '../engine/yaku.js';
import { isYaochu, normalizeHand, normalizeIndex, totalTiles, tileToStr } from '../engine/tiles.js';
import { NAGASHI_MANGAN } from '../engine/rules.js';

/** 东的牌索引（自风 / 场风的基准） @type {number} */
const WIND_EAST = 27;

/** 雀魂的包牌役满（四槓子不包，§11.1） @type {ReadonlyArray<string>} */
export const PAO_YAKU = Object.freeze(['daisangen', 'daisuushii']);

/**
 * 流局满贯成立判定（§10.4）。
 *
 * 三个条件：① 打出过牌；② 牌河全是幺九牌；③ **自己的牌河没有被鸣牌**。
 * 注意常见误解纠正：**自己鸣过牌不影响成立**（§10.4）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {boolean} 成立返回 true
 */
export function isNagashiMangan(state, seat) {
  if (state.rules[NAGASHI_MANGAN] === false) return false;
  const p = state.players[seat];
  if (p.pond.length === 0) return false;
  for (const t of p.pond) if (!isYaochu(normalizeIndex(t))) return false;
  for (const called of p.pondCalled) if (called) return false;
  return true;
}

/**
 * 计算某个座位的自风（§1.4：自风由本局庄家决定，庄家恒为東）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {number} 27–30（東南西北）
 */
export function seatWindOf(state, seat) {
  return WIND_EAST + ((seat - state.dealer + 4) % 4);
}

/**
 * 手牌中赤宝牌总数（手牌 + 副露）。
 *
 * @param {object} player 玩家
 * @returns {number} 赤牌张数
 */
function redCountOf(player) {
  let n = 0;
  for (const v of player.handRed || []) n += v;
  for (const v of player.meldRed || []) n += v;
  return n;
}

/**
 * 把自摸支付额分摊到三家（返回每个座位应付额）。
 *
 * @param {number} winnerSeat 和牌者座位
 * @param {number} dealerSeat 亲家座位
 * @param {{all?: number, dealer?: number, child?: number}} payments calcScore 的支付表
 * @param {boolean} winnerIsDealer 和牌者是否亲家
 * @returns {Array<{seat: number, amount: number}>} 支付明细（amount 为应付正数）
 */
function tsumoShares(winnerSeat, dealerSeat, payments, winnerIsDealer) {
  const out = [];
  for (let s = 0; s < 4; s++) {
    if (s === winnerSeat) continue;
    let amount;
    if (winnerIsDealer) amount = payments.all;
    else amount = s === dealerSeat ? payments.dealer : payments.child;
    out.push({ seat: s, amount });
  }
  return out;
}

/**
 * 和了结算（§6.5 / §9 / §11.1）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 和牌者座位
 * @param {object} winCtx 和了上下文
 *   - `hand` **必需**：含和牌张的暗牌计数数组（张数必须为 `14 - 3 × 副露数`）
 *   - `winTile` **必需**：和牌张（0–36）
 *   - `isTsumo` 是否自摸
 *   - `discarder` 荣和时的放铳者座位（自摸时忽略）
 *   - `isChankan` / `chankanIsAnkan` 抢槓 / 被抢的是暗槓（§6.6）
 *   - `isRinshan` 岭上开花；`isHaitei` 海底摸月；`isHoutei` 河底捞鱼（§3.4）
 *   - `takesSticks` 是否取得立直棒，默认 true；**多家和牌时只有头跳家为 true**（§6.5）
 *   - `paoBy` 包牌者座位，默认取 `state.players[seat].paoBy`（§11.1）
 * @returns {{
 *   seat: number, isTsumo: boolean, isDealer: boolean, discarder: number|null,
 *   yaku: Array<object>, han: number, doraHan: number, totalHan: number,
 *   fu: number, yakumanCount: number, limit: string|null, limitName: string|null,
 *   payments: {breakdown: Array<{seat: number, amount: number}>, total: number},
 *   deltas: number[], pao: {seat: number, amount: number}|null,
 *   riichiSticksTaken: number, detail: string
 * }} 结算结果（`deltas` 为四家点数增减，含本场与立直棒；`sum(deltas) === 立直棒 × 1000`）
 * @throws {Error} 牌形不能和牌、张数不符、荣和未给放铳者等时抛出
 */
export function settleWin(state, seat, winCtx) {
  if (winCtx === null || typeof winCtx !== 'object') throw new TypeError('settleWin: winCtx 必须是对象');
  const p = state.players[seat];
  if (p === undefined) throw new RangeError(`settleWin: 座位 ${String(seat)} 不存在`);
  const isTsumo = winCtx.isTsumo === true;
  const isDealer = seat === state.dealer;
  const discarder = isTsumo ? null : winCtx.discarder;
  if (!isTsumo && !Number.isInteger(discarder)) {
    throw new Error('settleWin: 荣和必须给出 discarder（放铳者座位）');
  }
  if (!isTsumo && discarder === seat) throw new Error('settleWin: 放铳者不能是自己');

  const hand = normalizeHand(winCtx.hand);
  const expected = 14 - 3 * p.melds.length;
  if (totalTiles(hand) !== expected) {
    throw new Error(
      `settleWin: 和牌形暗牌应为 ${expected} 张（14 - 3 × ${p.melds.length} 组副露），收到 ${totalTiles(hand)} 张`,
    );
  }
  const winTile = normalizeIndex(winCtx.winTile);
  if (hand[winTile] <= 0) throw new Error(`settleWin: 手牌中没有和牌张 ${tileToStr(winTile)}`);

  const isRiichi = p.riichi === true || p.doubleRiichi === true;
  const takesSticks = winCtx.takesSticks !== false;
  // 天和 / 地和（§6.1 役满）：第一巡自摸且此前无任何吃碰杠（含暗槓）
  const firstDraw = isTsumo && p.drawCount === 1 && state.callCount === 0;
  const isTenhou = firstDraw && isDealer;
  const isChiihou = firstDraw && !isDealer;

  const yaku = detectYaku(
    {
      hand,
      melds: p.melds,
      winTile,
      isTsumo,
      roundWind: state.roundWind,
      seatWind: seatWindOf(state, seat),
      isRiichi: p.riichi === true,
      isDoubleRiichi: p.doubleRiichi === true,
      isIppatsu: p.ippatsu === true && isRiichi,
      isChankan: winCtx.isChankan === true,
      chankanIsAnkan: winCtx.chankanIsAnkan === true,
      isRinshan: winCtx.isRinshan === true,
      isHaitei: winCtx.isHaitei === true,
      isHoutei: winCtx.isHoutei === true,
      isTenhou,
      isChiihou,
      // 里宝牌只在立直（含两立直）和牌时计入；引擎内部也会再判一次（yaku.js countDora）
      doraIndicators: state.doraIndicators,
      uraIndicators: isRiichi ? state.uraIndicators : [],
      redCount: redCountOf(p),
      isNagashiMangan: false,
    },
    state.rules,
  );
  if (yaku.form === null || !yaku.hasYaku) {
    throw new Error(`settleWin: 不构成和牌（${yaku.notes.join('；') || '无役'}）`);
  }

  const honba = state.honba;
  const sticks = takesSticks ? state.riichiSticks : 0;
  const base = calcScore(
    {
      han: yaku.totalHan,
      fu: yaku.fu,
      isDealer,
      isTsumo,
      honba,
      riichiSticks: sticks,
      yakumanCount: yaku.yakumanCount,
    },
    state.rules,
  );

  /** @type {number[]} */
  const deltas = [0, 0, 0, 0];
  /** @type {Array<{seat: number, amount: number}>} */
  const breakdown = [];
  const honbaTotal = HONBA_POINTS * honba;

  // ---------- 包牌（§11.1，雀魂口径：只包「包牌役满」那一部分） ----------
  const paoSeat = winCtx.paoBy === undefined ? p.paoBy : winCtx.paoBy;
  const paoEntry = yaku.list.find((e) => e.isYakuman === true && PAO_YAKU.includes(e.id));
  let pao = null;
  if (paoEntry && Number.isInteger(paoSeat) && paoSeat !== seat) {
    const paoMult = paoEntry.multiplier === undefined ? 1 : paoEntry.multiplier;
    const otherMult = yaku.yakumanCount - paoMult;
    const paoScore = calcScore(
      { han: 13 * paoMult, fu: 0, isDealer, isTsumo, honba: 0, riichiSticks: 0, yakumanCount: paoMult },
      state.rules,
    );
    /** @type {Array<{seat: number, amount: number}>} */
    const paoBreakdown = [];
    if (isTsumo) {
      // 自摸：包牌者支付「包牌役满」全额（基本点 × 4 或 × 6，视和牌者亲/子）
      const full = isDealer
        ? paoScore.payments.all * 3
        : paoScore.payments.child * 2 + paoScore.payments.dealer;
      deltas[paoSeat] -= full;
      deltas[seat] += full;
      paoBreakdown.push({ seat: paoSeat, amount: full });
      pao = { seat: paoSeat, amount: full };
    } else {
      // 荣和：包牌者与放铳者折半
      const half = paoScore.payments.ron / 2;
      if (!Number.isInteger(half)) {
        throw new Error(`settleWin: 包牌折半出现非整数（${paoScore.payments.ron} / 2）`);
      }
      deltas[paoSeat] -= half;
      deltas[discarder] -= half;
      deltas[seat] += half * 2;
      paoBreakdown.push({ seat: paoSeat, amount: half }, { seat: discarder, amount: half });
      pao = { seat: paoSeat, amount: half };
    }
    // 积棒（本场棒）在雀魂口径下由包牌者承担（§11.1）
    if (honbaTotal > 0) {
      deltas[paoSeat] -= honbaTotal;
      deltas[seat] += honbaTotal;
      paoBreakdown.push({ seat: paoSeat, amount: honbaTotal });
    }
    breakdown.push(...paoBreakdown);
    // 其余役满部分：照常计算（雀魂 pao_scope = pao_part_only）
    if (otherMult > 0) {
      const otherScore = calcScore(
        { han: 13 * otherMult, fu: 0, isDealer, isTsumo, honba: 0, riichiSticks: 0, yakumanCount: otherMult },
        state.rules,
      );
      if (isTsumo) {
        for (const s of tsumoShares(seat, state.dealer, otherScore.payments, isDealer)) {
          deltas[s.seat] -= s.amount;
          deltas[seat] += s.amount;
          breakdown.push(s);
        }
      } else {
        deltas[discarder] -= otherScore.payments.ron;
        deltas[seat] += otherScore.payments.ron;
        breakdown.push({ seat: discarder, amount: otherScore.payments.ron });
      }
    }
  } else if (isTsumo) {
    for (const s of tsumoShares(seat, state.dealer, base.payments, isDealer)) {
      deltas[s.seat] -= s.amount;
      deltas[seat] += s.amount;
      breakdown.push(s);
    }
  } else {
    deltas[discarder] -= base.payments.ron;
    deltas[seat] += base.payments.ron;
    breakdown.push({ seat: discarder, amount: base.payments.ron });
  }

  // 立直棒全部归和牌者（多家和牌时由头跳家取得，由调用方以 takesSticks 控制）
  const riichiSticksTaken = sticks;
  if (sticks > 0) deltas[seat] += sticks * RIICHI_STICK_POINTS;

  const paid = breakdown.reduce((a, b) => a + b.amount, 0);
  return {
    seat,
    isTsumo,
    isDealer,
    discarder,
    yaku: yaku.list,
    han: yaku.han,
    doraHan: yaku.doraHan,
    totalHan: yaku.totalHan,
    fu: yaku.fu,
    yakumanCount: yaku.yakumanCount,
    limit: base.limit,
    limitName: base.limitName,
    payments: { breakdown, total: paid },
    deltas,
    pao,
    riichiSticksTaken,
    detail: base.detail,
  };
}

/**
 * 流局结算（§10.3 不听罚符 / §10.4 流局满贯）。
 *
 * @param {object} state 对局状态
 * @param {'exhaustive'|'kyuushu'|'suufonrenda'|'suuchariichi'|'sukanagare'|'nagashi'} kind 流局种类
 * @param {boolean[]} tenpai 四个座位是否听牌（荒牌流局用；途中流局无意义但会原样返回）
 * @returns {{
 *   kind: string, tenpai: boolean[],
 *   deltas: number[], payments: Array<{seat: number, amount: number}>,
 *   nagashiSeats: number[], notenPenalty: number
 * }} 结算结果
 *   - 荒牌流局时 `kind` 可能被升级为 `'nagashi'`（流局满贯优先于听牌清算）
 *   - 途中流局一律**不产生收付**（deltas 全 0）且立直棒留场
 * @throws {TypeError|RangeError} kind 非法时抛出
 */
export function settleDraw(state, kind, tenpai) {
  const kinds = ['exhaustive', 'kyuushu', 'suufonrenda', 'suuchariichi', 'sukanagare', 'nagashi'];
  if (!kinds.includes(kind)) throw new RangeError(`settleDraw: 未知流局种类 "${String(kind)}"`);
  const tp = Array.isArray(tenpai) && tenpai.length === 4 ? tenpai.map(Boolean) : [false, false, false, false];
  const deltas = [0, 0, 0, 0];
  /** @type {Array<{seat: number, amount: number}>} */
  const payments = [];
  const nagashiSeats = [];
  let realKind = kind;

  if (kind === 'exhaustive' || kind === 'nagashi') {
    for (let s = 0; s < 4; s++) if (isNagashiMangan(state, s)) nagashiSeats.push(s);
  }
  if (kind === 'exhaustive' && nagashiSeats.length === 0) {
    // ---------- 不听罚符（§10.3）：不听者共支付 3000 点，在听牌者之间平均分配 ----------
    const winners = [];
    const losers = [];
    for (let s = 0; s < 4; s++) (tp[s] ? winners : losers).push(s);
    if (winners.length > 0 && losers.length > 0) {
      const total = state.options.notenPenalty;
      const perLoser = total / losers.length;
      const perWinner = total / winners.length;
      for (const s of losers) {
        deltas[s] -= perLoser;
        payments.push({ seat: s, amount: perLoser });
      }
      for (const s of winners) deltas[s] += perWinner;
    }
  } else if (kind === 'nagashi' || nagashiSeats.length > 0) {
    // ---------- 流局满贯（§10.4）：按满贯自摸清算，不进行听牌清算 ----------
    // 本场不计入（本局仍以流局收尾，本场由 advanceHand 递增）；立直棒留场。
    realKind = 'nagashi';
    for (const seat of nagashiSeats) {
      const isDealer = seat === state.dealer;
      const sc = calcScore(
        { han: 5, fu: 0, isDealer, isTsumo: true, honba: 0, riichiSticks: 0 },
        state.rules,
      );
      for (const s of tsumoShares(seat, state.dealer, sc.payments, isDealer)) {
        deltas[s.seat] -= s.amount;
        deltas[seat] += s.amount;
        payments.push(s);
      }
    }
  }
  return { kind: realKind, tenpai: tp, deltas, payments, nagashiSeats, notenPenalty: state.options.notenPenalty };
}

/**
 * 判定本局是否连庄（§2.6 完备表）。
 *
 * @param {object} state 对局状态
 * @param {object} result 本局结果（state.result）
 * @returns {boolean} 连庄返回 true
 */
export function renchanOf(state, result) {
  if (result === null || result === undefined) throw new TypeError('renchanOf: 需要本局结果');
  if (result.type === 'win') {
    // 庄家和牌（含多家和牌中含庄家）→ 连庄
    return result.winners.some((w) => w.seat === state.dealer);
  }
  // 荒牌流局 / 流局满贯：庄家听牌 → 连庄；途中流局四种 → 一律连庄
  if (result.kind === 'exhaustive' || result.kind === 'nagashi') {
    return result.tenpai[state.dealer] === true;
  }
  return true;
}

/**
 * 当前一位（同点按东一局座次，§12.4）。
 *
 * @param {object} state 对局状态
 * @returns {number} 一位座位
 */
export function rank1Seat(state) {
  let best = 0;
  for (let s = 1; s < 4; s++) {
    const a = state.players[s].score;
    const b = state.players[best].score;
    if (a > b || (a === b && s < best)) best = s;
  }
  return best;
}

/**
 * 计算终局顺位与马点（§12.3 / §12.4）。
 *
 * @param {object} state 对局状态
 * @returns {Array<{rank: number, seat: number, score: number, uma: number, points: number}>}
 *   按顺位排列；`points` = `(终局点数 − 起始点数) / 1000 + 马点`（不舍入，附录 C-12）
 */
export function computeRanking(state) {
  const opts = state.options;
  if (opts.tieBreakBySeat === false) {
    // 未实现：WRC 口径的「同点者均分顺位点」需要另一套顺位点分配（§12.3 / §12.4 开关 tie_break_by_seat）
    throw new Error(
      'computeRanking: 本实现只支持雀魂口径「同点按东一局座次」（rules.md §12.4）；' +
        'tie_break_by_seat = false（WRC 同点均分顺位点）未实现，请显式说明需求',
    );
  }
  const order = [0, 1, 2, 3].sort((a, b) => {
    const d = state.players[b].score - state.players[a].score;
    if (d !== 0) return d;
    return a - b; // 同点按东一局座次（起家 = 0 号，§2.3 / §12.4）
  });
  return order.map((seat, i) => ({
    rank: i + 1,
    seat,
    score: state.players[seat].score,
    uma: opts.uma[i],
    points: (state.players[seat].score - opts.startingScore) / 1000 + opts.uma[i],
  }));
}

/**
 * 推进到下一局：计算亲家 / 本场 / 场风，或结束对局（§2.6、§12.1、§12.2）。
 *
 * 读取 `state.result`（本局结果，由 state.js 在结算后写入），并把下一局的
 * `state.handNumber` / `state.dealer` / `state.honba` / `state.roundWind` 就地写回；
 * 终局时写 `state.gameOver` 与 `state.ranking`，并把桌上剩余立直棒判给一位（§2.5 雀魂）。
 *
 * @param {object} state 对局状态
 * @returns {{renchan: boolean, nextDealer: number, nextHonba: number, nextHandNumber: number,
 *            roundWind: number, gameOver: boolean, reason: string|null,
 *            ranking: Array<object>|null}} 推进结果
 *   - `reason`：`null`（继续）| `'hakofuri'`（击飞）| `'max_round'`（打完最大局数）
 *     | `'dealer_top_renchan'`（庄家连庄且为一位 → 终局）| `'someone_over'`（有人超过返点 → 终局）
 * @throws {TypeError} 尚未有本局结果时抛出
 */
export function advanceHand(state) {
  const result = state.result;
  if (result === null || result === undefined) {
    throw new TypeError('advanceHand: state.result 为空，本局尚未结算');
  }
  const opts = state.options;
  const dealer = state.dealer;
  const renchan = renchanOf(state, result);
  const nextHandNumber = renchan ? state.handNumber : state.handNumber + 1;
  const nextDealer = renchan ? dealer : (dealer + 1) % 4;
  const nextHonba = renchan ? state.honba + 1 : 0;

  // 最大局数：东风战 = 南 4 局（index 7）；半庄战 = 西 4 局（index 11）（§12.1）
  const baseLast = opts.length === 'tonpuu' ? 3 : 7;
  const hardLast = baseLast + 4;

  let reason = null;
  if (state.players.some((p) => p.score < 0)) {
    reason = 'hakofuri'; // ① 击飞优先（严格小于 0，0 点继续，§12.2）
  } else if (nextHandNumber > hardLast) {
    reason = 'max_round'; // ② 到达最大局数
  } else if (state.handNumber >= baseLast) {
    // オーラス及以后（§12.1 ③④⑤⑥）
    const dealerIsTop = rank1Seat(state) === dealer;
    const anyoneOver = state.players.some((p) => p.score >= opts.requiredPoints);
    if (renchan && !dealerIsTop) reason = null; // ③ 连庄优先
    else if (renchan && dealerIsTop) reason = 'dealer_top_renchan'; // ④ 庄家连庄且为一位 → 终局
    else if (!anyoneOver) reason = null; // ⑤ 无人达返点 → 加时（南入 / 西入）
    else reason = 'someone_over'; // ⑥ 有人达返点且庄家未连庄 → 终局
  }

  const gameOver = reason !== null;
  if (!gameOver) {
    state.handNumber = nextHandNumber;
    state.dealer = nextDealer;
    state.honba = nextHonba;
    state.roundWind = WIND_EAST + Math.floor(state.handNumber / 4);
  } else {
    // 终局：桌上剩余立直棒归一位（§2.5，雀魂 top_takes_all）
    if (state.riichiSticks > 0 && opts.riichiStickOnFinal === 'top_takes_all') {
      state.players[rank1Seat(state)].score += state.riichiSticks * RIICHI_STICK_POINTS;
      state.riichiSticks = 0;
    }
    state.gameOver = true;
    state.ranking = computeRanking(state);
  }
  return {
    renchan,
    nextDealer: state.dealer,
    nextHonba: state.honba,
    nextHandNumber: state.handNumber,
    roundWind: state.roundWind,
    gameOver,
    reason,
    ranking: state.ranking,
  };
}
