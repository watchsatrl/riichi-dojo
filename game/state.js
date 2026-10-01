/**
 * 日本麻将对局状态机 —— 状态主体
 * =====================================================================
 *
 * 【职责】四人立直麻将的完整对局流程（纯逻辑，无 UI / DOM）：
 *   配牌 → 摸打循环 → 鸣牌（吃碰杠）→ 立直 → 和了 / 流局 → 结算 → 连庄 / 轮庄 → 终局。
 *   牌理判定（和牌形 / 役 / 符 / 点 / 振听）全部复用 engine/，本模块只负责**流程与状态**。
 *
 * 【规则依据】docs/rules.md（雀魂四人段位场基准）
 *   - §2 局与场：亲家轮转、本场、供托、连庄条件完备表
 *   - §3 配牌与摸打：摸打循环、王牌与岭上、海底/河底、宝牌与杠宝牌翻出时机
 *   - §4 鸣牌：优先顺序（和 > 碰/杠 > 吃）、吃仅下家、食替禁止、鸣牌后立即打牌
 *   - §5 立直：宣言条件、宣言牌放铳（燕返）、立直后锁定手牌、立直后暗杠限制、一发、两立直
 *   - §6 和了判定：必须有役、振听、多家和牌（无头跳全部结算）、抢槓、岭上、海底/河底
 *   - §10 流局：荒牌流局 + 不听罚符、流局满贯、途中流局四种
 *   - §11 特殊规则：包牌（只包大三元/大四喜那一部分）
 *   - §12 终局：击飞、加时（南入/西入）、顺位马、同点顺位
 *
 * 【设计要点】
 *   1. **摸牌是自动的**：Action 判别联合里没有 `draw`，所以「无人鸣牌」时下一家的摸牌
 *      由上一次 `applyAction` 内部完成并产出 `draw` 事件（§3.2 的循环在实现上是原子的）。
 *   2. **赤牌**：`hand` 是 34 项归一计数数组（引擎约定），赤牌的物理身份另用
 *      `handRed` / `meldRed` 记录，最终以 `redCount` 交给引擎计赤宝牌（§1.2）。
 *      打牌时 `tile: 5` 表示「打普通的 5」，`tile: 34/35/36` 表示「打赤 5」。
 *   3. **鸣牌响应**：`pendingClaims` 列出所有「有牌可鸣」的座位，逐家响应（pass / 鸣牌 / 荣和），
 *      全部响应完毕后统一裁决 —— 这样多家荣和（双响 / 三响）才能全部结算（§6.5）。
 *   4. 所有非法动作一律 `throw Error`，绝不静默忽略。
 */

import {
  HAND_SIZE,
  MAX_COPIES,
  emptyHand,
  cloneHand,
  isHonor,
  normalizeIndex,
  totalTiles,
  tileToStr,
} from '../engine/tiles.js';
import { isAgari } from '../engine/agari.js';
import { canRonReasons, isFuriten } from '../engine/furiten.js';
import { shanten } from '../engine/shanten.js';
import { resolveRules } from '../engine/rules.js';
import { settleMultiRon, RIICHI_STICK_POINTS, HONBA_POINTS } from '../engine/score.js';
import {
  DEAD_DORA,
  DEAD_URA,
  MAX_KANS,
  buildWall,
  kanDoraIndicator,
  kanUraIndicator,
  makeRng,
} from './wall.js';
import {
  ankanTiles,
  canMinkan,
  canPon,
  chiOptions,
  describeAction,
  discardCandidates,
  distinctYaochuKinds,
  findAction,
  hasWait,
  isKuikae,
  isTenpaiShape,
  kakanTiles,
  sameWaitSet,
  waitsOf,
} from './actions.js';
import {
  advanceHand,
  computeRanking,
  isNagashiMangan,
  rank1Seat,
  seatWindOf,
  settleDraw,
  settleWin,
} from './settle.js';

/** 对局阶段 @type {Readonly<Record<string, string>>} */
export const PHASES = Object.freeze({
  /** 尚未开局 / 上一局已结束但未开新局 */
  IDLE: 'idle',
  /** 摸牌后的决策窗口（可自摸 / 暗杠 / 加杠 / 立直 / 九种九牌 / 打牌） */
  DRAW: 'draw',
  /** 鸣牌后的决策窗口（只能打牌，受食替限制） */
  DISCARD: 'discard',
  /** 有人打牌或加槓，等其余各家响应 */
  CLAIM: 'claim',
  /** 本局已结束，等待下一局 */
  HAND_OVER: 'hand_over',
  /** 整个对局已结束 */
  GAME_OVER: 'game_over',
});

/** 牌总数（用于不变量自检） @type {number} */
export const TILE_TOTAL = 136;

/** 点数总和（含供托的立直棒，用于不变量自检） @type {number} */
export const SCORE_TOTAL = 100000;

/** 雀魂四人段位场默认对局参数（rules.md §12.3 / §1.2 / §10.3 / §2.4） */
export const DEFAULT_OPTIONS = Object.freeze({
  /** 场制：`'hanchan'` 半庄（东南战，西入）/ `'tonpuu'` 东风战（南入） */
  length: 'hanchan',
  /** 起始点数（§12.3） */
  startingScore: 25000,
  /** 一位必要点数（§12.1 sudden_death_threshold） */
  requiredPoints: 30000,
  /** 顺位马（§12.3） */
  uma: Object.freeze([15, 5, -5, -15]),
  /** 本场 1 根的点数（§2.4；引擎 score.js 固定为 300，改值不受支持） */
  honbaValue: 300,
  /** 不听罚符合计（§10.3；引擎层固定为 3000，改值不受支持） */
  notenPenalty: 3000,
  /** 赤牌枚数（§1.2） */
  aka: Object.freeze({ m: 1, p: 1, s: 1 }),
  /** 终局同点是否按东一局座次决定顺位（§2.3，雀魂 true） */
  tieBreakBySeat: true,
  /** 终局剩余立直棒归属（§2.5，雀魂 top_takes_all） */
  riichiStickOnFinal: 'top_takes_all',
});

/**
 * 归一化 / 校验对局参数。
 *
 * @param {object} config createGame 的入参
 * @returns {object} 完整参数对象
 * @throws {Error} 出现本实现不支持或非法的取值时抛出
 */
function resolveOptions(config) {
  const o = { ...DEFAULT_OPTIONS, ...(config.options || {}) };
  if (config.length !== undefined) o.length = config.length;
  if (o.length !== 'hanchan' && o.length !== 'tonpuu') {
    throw new Error(
      `createGame: length 只能是 'hanchan'（半庄，东1-南4-西入）或 'tonpuu'（东风，东1-4-南入），收到 ${JSON.stringify(o.length)}` +
        '；三麻（108 张 / 拔北 / 自摸损）本实现不支持',
    );
  }
  // 引擎 score.js 把本场 300 / 立直棒 1000 写死，改值需要另写一份点数表 → 显式拒绝而不是静默错算
  if (o.honbaValue !== HONBA_POINTS) {
    throw new Error(`createGame: honbaValue 只支持 ${HONBA_POINTS}（引擎 score.js 固定值，§2.4）`);
  }
  if (o.notenPenalty !== 3000) {
    throw new Error('createGame: notenPenalty 只支持 3000（四麻，§10.3）；三麻 2000 本实现不支持');
  }
  if (!Array.isArray(o.uma) || o.uma.length !== 4) throw new Error('createGame: uma 必须是长度 4 的数组');
  if (o.riichiStickOnFinal !== 'top_takes_all') {
    throw new Error("createGame: 只实现雀魂的 riichiStickOnFinal = 'top_takes_all'（§2.5）");
  }
  if (o.tieBreakBySeat === false) {
    throw new Error('createGame: 只实现雀魂的同点按座次（§12.4）；WRC 的「同点者均分顺位点」未实现');
  }
  if (o.aka === null || typeof o.aka !== 'object') throw new Error('createGame: aka 必须是 {m,p,s} 对象');
  for (const k of ['m', 'p', 's']) {
    const v = o.aka[k] === undefined ? 0 : o.aka[k];
    if (!Number.isInteger(v) || v < 0 || v > MAX_COPIES) {
      throw new Error(`createGame: aka.${k} 必须是 0–4 的整数，收到 ${String(o.aka[k])}`);
    }
  }
  return o;
}

/**
 * 新建一个玩家状态。
 *
 * @param {number} seat 座位 0–3
 * @param {number} score 起始点数
 * @returns {object} 玩家状态
 */
function makePlayer(seat, score) {
  return {
    seat,
    score,
    /** 暗牌计数数组（长度 34，赤 5 已归一） */
    hand: emptyHand(),
    /** 副露数组，格式与引擎一致；额外带 `calledTile` / `from` 便于食替与播报 */
    melds: [],
    /** 牌河（按打出顺序，0–33 归一索引） */
    pond: [],
    /** 牌河中每一张是否被鸣走 */
    pondCalled: [],
    riichi: false,
    riichiTurn: null,
    doubleRiichi: false,
    ippatsu: false,
    /** 是否处于振听（不能荣和；由引擎 isFuriten 综合判定后写入，供 UI 读取） */
    furiten: false,
    /** 同巡振听（见逃 / 摸切见逃，自己切牌后解除，§6.3） */
    tempFuriten: false,
    /** 立直后振听（本局不可解除，§6.3） */
    riichiFuriten: false,
    /** 当前摸到的牌（未打出的那张）；34–36 表示赤 5 */
    drawnTile: null,
    /** 是否门清（暗杠不破坏门清，§4.2） */
    menzen: true,
    /** 手牌中赤 5m/5p/5s 的张数（按 m,p,s 三档） */
    handRed: [0, 0, 0],
    /** 副露中赤 5 的张数 */
    meldRed: [0, 0, 0],
    /** 立直时锁定的听牌集合（§5.4 暗杠判据） */
    riichiWaits: null,
    /** 包牌责任者座位（§11.1），无包牌为 null */
    paoBy: null,
    /** 本局摸牌次数 */
    drawCount: 0,
    /** 本局打牌次数 */
    discardCount: 0,
    /** 当前这张牌是否来自岭上（岭上开花，§6.7） */
    rinshanDraw: false,
    /** 当前这张牌是否海底牌（海底摸月，§3.4） */
    haiteiDraw: false,
    /** 待翻的杠宝牌张数（明杠 / 加杠在打出 1 张后翻，§3.5） */
    pendingKanDora: 0,
    /** 荒牌流局时写入的听牌判定结果（供 UI / 结算读取） */
    tenpai: false,
  };
}

/**
 * 创建一局对局。
 *
 * @param {object} [config] 配置
 * @param {number} [config.seed] 随机种子（不传则随机；同 seed 逐事件可复现）
 * @param {object} [config.rules] 规则集，默认 `SAKURA_4P`（雀魂四人段位场）
 * @param {number[]} [config.scores] 起始点数（默认 [25000,25000,25000,25000]，总和须为 100000）
 * @param {number} [config.handNumber] 起始局数（0 = 东一局；4 = 南一局；8 = 西一局）
 * @param {object} [config.options] 对局参数覆盖（见 DEFAULT_OPTIONS）
 * @param {'hanchan'|'tonpuu'} [config.length] 场制简写（等价 options.length）
 * @returns {object} GameState
 * @throws {Error} 参数非法时抛出
 */
export function createGame(config = {}) {
  const seed = config.seed === undefined || config.seed === null ? undefined : config.seed;
  const rules = resolveRules(config.rules);
  const options = resolveOptions(config);
  const scores = config.scores === undefined || config.scores === null ? [25000, 25000, 25000, 25000] : config.scores.slice();
  if (scores.length !== 4) throw new Error(`createGame: scores 必须是长度 4 的数组，收到 ${scores.length}`);
  for (const s of scores) {
    if (!Number.isInteger(s)) throw new Error(`createGame: scores 必须是整数，收到 ${String(s)}`);
  }
  const sum = scores.reduce((a, b) => a + b, 0);
  if (sum !== SCORE_TOTAL) {
    throw new Error(`createGame: 四家起始点数之和必须是 ${SCORE_TOTAL}，收到 ${sum}`);
  }
  const handNumber = config.handNumber === undefined || config.handNumber === null ? 0 : config.handNumber;
  if (!Number.isInteger(handNumber) || handNumber < 0 || handNumber > 11) {
    throw new Error(`createGame: handNumber 必须是 0–11 的整数（0=东一 … 11=西四），收到 ${String(config.handNumber)}`);
  }
  const rng = makeRng(seed);
  const dealer = handNumber % 4;
  return {
    rules,
    seed: seed === undefined ? null : seed,
    rng,
    rngState: rng.getState(),
    options,
    players: [0, 1, 2, 3].map((seat) => makePlayer(seat, scores[seat])),
    wall: { live: [], dead: [], rinshan: [], rinshanIndex: 0 },
    doraIndicators: [],
    uraIndicators: [],
    kanDoraCount: 0,
    turn: dealer,
    phase: PHASES.IDLE,
    handNumber,
    roundWind: 27 + Math.floor(handNumber / 4),
    dealer,
    honba: 0,
    riichiSticks: 0,
    lastDiscard: null,
    pendingClaims: [],
    claimResults: [],
    claimContext: null,
    kuikaeLock: null,
    result: null,
    gameOver: false,
    ranking: null,
    callCount: 0,
    kanCount: 0,
    kanOwners: [],
    discardLog: [],
    suukaikanPending: false,
    turnCount: 0,
  };
}

// ---------------------------------------------------------------------------
// 手牌 / 赤牌 记账原语
// ---------------------------------------------------------------------------

/**
 * 往手牌加一张（含赤牌记账）。
 *
 * @param {object} p 玩家
 * @param {number} tile 牌索引（0–36）
 * @returns {void}
 */
function addToHand(p, tile) {
  const t = normalizeIndex(tile);
  p.hand[t] += 1;
  if (tile >= 34) p.handRed[tile - 34] += 1;
}

/**
 * 从手牌取走指定物理牌（含赤牌记账）。
 *
 * @param {object} p 玩家
 * @param {number} tile 牌索引（0–36）
 * @returns {void}
 */
function removeOneFromHand(p, tile) {
  const t = normalizeIndex(tile);
  if (p.hand[t] <= 0) throw new Error(`内部错误：手牌中没有 ${tileToStr(t)}`);
  p.hand[t] -= 1;
  if (tile >= 34) {
    if (p.handRed[tile - 34] <= 0) throw new Error(`内部错误：赤牌记账不一致（${tileToStr(tile)}）`);
    p.handRed[tile - 34] -= 1;
  }
}

/**
 * 从手牌中挑选 n 张指定牌种的**物理牌**（优先用普通 5，把赤 5 留在手里）。
 *
 * @param {object} p 玩家
 * @param {number} t 归一牌索引 0–33
 * @param {number} n 张数
 * @returns {number[]} n 张物理牌索引（可能含 34–36）
 * @throws {Error} 手牌不足时抛出
 */
function pickPhysical(p, t, n) {
  const isFive = t < 27 && t % 9 === 4;
  const suit = isFive ? Math.floor(t / 9) : -1;
  let reds = isFive ? p.handRed[suit] : 0;
  let plains = p.hand[t] - reds;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (plains > 0) {
      out.push(t);
      plains -= 1;
    } else if (reds > 0) {
      out.push(34 + suit);
      reds -= 1;
    } else {
      throw new Error(`内部错误：手牌中 ${tileToStr(t)} 不足 ${n} 张`);
    }
  }
  return out;
}

/**
 * 取走手牌中某牌种的**全部**物理牌（暗杠用）。
 *
 * @param {object} p 玩家
 * @param {number} t 归一牌索引 0–33
 * @returns {number[]} 全部物理牌索引
 */
function takeAllPhysical(p, t) {
  return pickPhysical(p, t, p.hand[t]);
}

/**
 * 更新门清标记（暗杠不破坏门清，§4.2）。
 *
 * @param {object} p 玩家
 * @returns {void}
 */
function updateMenzen(p) {
  p.menzen = p.melds.every((m) => m.type === 'ankan');
}

/**
 * 副露中赤 5 的记账。
 *
 * @param {object} p 玩家
 * @param {number[]} tiles 副露的物理牌
 * @returns {void}
 */
function addMeldRed(p, tiles) {
  for (const t of tiles) if (t >= 34) p.meldRed[t - 34] += 1;
}

/**
 * 计算玩家 13 张形暗牌（`13 - 3 × 副露数`）；形态不符时返回 null。
 *
 * @param {object} p 玩家
 * @returns {number[]|null} 13 张形计数数组
 */
function concealed13(p) {
  const mc = p.melds.length;
  const expect13 = 13 - 3 * mc;
  const h = cloneHand(p.hand);
  const n = totalTiles(h);
  if (n === expect13) return h;
  if (n === expect13 + 1 && p.drawnTile !== null) {
    const d = normalizeIndex(p.drawnTile);
    if (h[d] > 0) {
      h[d] -= 1;
      return h;
    }
  }
  return null;
}

/** 玩家手牌「价值张数」（暗牌 + 每个面子 3 张；杠的第 4 张不计） */
function handValue(p) {
  return totalTiles(p.hand) + 3 * p.melds.length;
}

/**
 * 手中赤宝牌总数（手牌 + 副露）。
 *
 * @param {object} p 玩家
 * @returns {number} 赤牌张数
 */
function redCountOf(p) {
  let n = 0;
  for (const v of p.handRed) n += v;
  for (const v of p.meldRed) n += v;
  return n;
}

// ---------------------------------------------------------------------------
// 开局
// ---------------------------------------------------------------------------

/**
 * 重置某个玩家的一局状态（保留点数）。
 *
 * @param {object} p 玩家
 * @returns {void}
 */
function resetPlayerForHand(p) {
  p.hand = emptyHand();
  p.melds = [];
  p.pond = [];
  p.pondCalled = [];
  p.riichi = false;
  p.riichiTurn = null;
  p.doubleRiichi = false;
  p.ippatsu = false;
  p.furiten = false;
  p.tempFuriten = false;
  p.riichiFuriten = false;
  p.drawnTile = null;
  p.menzen = true;
  p.handRed = [0, 0, 0];
  p.meldRed = [0, 0, 0];
  p.riichiWaits = null;
  p.paoBy = null;
  p.drawCount = 0;
  p.discardCount = 0;
  p.rinshanDraw = false;
  p.haiteiDraw = false;
  p.pendingKanDora = 0;
  p.tenpai = false;
}

/**
 * 开始新的一局（配牌）。
 *
 * 庄家起手 13 张后立即摸第 14 张（§3.1），因此本函数返回的事件里包含庄家的 `draw`。
 *
 * @param {object} state 对局状态
 * @returns {object[]} 事件数组（`hand_start` + 庄家 `draw`）
 * @throws {Error} 对局已结束或当前阶段不适合开局时抛出
 */
export function startHand(state) {
  if (state.gameOver) throw new Error('startHand: 对局已结束，无法开始新的一局');
  if (state.phase !== PHASES.IDLE && state.phase !== PHASES.HAND_OVER) {
    throw new Error(`startHand: 当前阶段是 ${state.phase}，只有 idle / hand_over 可以开新局`);
  }
  for (const p of state.players) resetPlayerForHand(p);
  state.doraIndicators = [];
  state.uraIndicators = [];
  state.kanDoraCount = 0;
  state.lastDiscard = null;
  state.pendingClaims = [];
  state.claimResults = [];
  state.claimContext = null;
  state.kuikaeLock = null;
  state.result = null;
  state.callCount = 0;
  state.kanCount = 0;
  state.kanOwners = [];
  state.discardLog = [];
  state.suukaikanPending = false;
  state.turnCount = 0;

  const wall = buildWall(state.rng, state.rules, { aka: state.options.aka });
  state.rngState = state.rng.getState();
  state.wall = { live: wall.live, dead: wall.dead, rinshan: wall.rinshan, rinshanIndex: 0 };
  state.doraIndicators = [wall.dead[DEAD_DORA]];

  // 配牌：庄家起，逆时针，先各 4 张 × 3 轮，再各 1 张 = 13 张
  const deal = (seat) => {
    const p = state.players[seat];
    const tile = state.wall.live.shift();
    addToHand(p, tile);
  };
  for (let round = 0; round < 3; round++) {
    for (let k = 0; k < 4; k++) for (let i = 0; i < 4; i++) deal((state.dealer + i) % 4);
  }
  for (let i = 0; i < 4; i++) deal((state.dealer + i) % 4);

  state.turn = state.dealer;
  state.phase = PHASES.DRAW;
  const events = [
    {
      type: 'hand_start',
      handNumber: state.handNumber,
      roundWind: state.roundWind,
      honba: state.honba,
      dealer: state.dealer,
      scores: state.players.map((p) => p.score),
      doraIndicators: state.doraIndicators.slice(),
    },
  ];
  events.push(...drawFor(state, state.dealer, { rinshan: false }));
  return events;
}

// ---------------------------------------------------------------------------
// 摸牌
// ---------------------------------------------------------------------------

/**
 * 让某座位摸一张牌（普通摸牌或岭上摸牌）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {{rinshan: boolean}} opts 是否岭上摸牌
 * @returns {object[]} 事件数组（`draw`）
 * @throws {Error} 牌山 / 岭上牌耗尽时抛出
 */
function drawFor(state, seat, opts) {
  const p = state.players[seat];
  let tile;
  if (opts.rinshan) {
    if (state.wall.rinshanIndex >= state.wall.rinshan.length) {
      throw new Error('drawFor: 岭上牌已用完（一局最多开 4 次杠，§3.3）');
    }
    tile = state.wall.rinshan[state.wall.rinshanIndex];
    state.wall.rinshanIndex += 1;
  } else {
    if (state.wall.live.length === 0) throw new Error('drawFor: 牌山已摸完（应走荒牌流局，§10.2）');
    tile = state.wall.live.shift();
  }
  addToHand(p, tile);
  p.drawnTile = tile;
  p.drawCount += 1;
  p.rinshanDraw = opts.rinshan === true;
  p.haiteiDraw = opts.rinshan !== true && state.wall.live.length === 0;
  state.turn = seat;
  state.phase = PHASES.DRAW;
  state.turnCount += 1;
  refreshFuriten(state, seat);
  return [{ type: 'draw', seat, tile }];
}

// ---------------------------------------------------------------------------
// 振听维护
// ---------------------------------------------------------------------------

/**
 * 重新计算某座位是否处于振听（舍牌振听 / 同巡振听 / 立直振听，§6.3）。
 *
 * 直接复用 engine/furiten.js 的 `isFuriten`，避免两套口径。手牌形态不满足 13 张形
 * （鸣牌后待打牌的那一瞬间）时保持原值 —— 该时点本来也不能荣和。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {void}
 */
function refreshFuriten(state, seat) {
  const p = state.players[seat];
  const h13 = concealed13(p);
  if (h13 === null) return;
  let f;
  try {
    f = isFuriten(
      {
        hand13: h13,
        melds: p.melds,
        pond: p.pond.slice(),
        passedWin: p.tempFuriten === true,
        isRiichi: p.riichi === true,
        isDoubleRiichi: p.doubleRiichi === true,
        riichiFuriten: p.riichiFuriten === true,
      },
      state.rules,
    );
  } catch {
    f = p.riichiFuriten === true || p.tempFuriten === true;
  }
  p.furiten = f;
}

// ---------------------------------------------------------------------------
// 役判定上下文
// ---------------------------------------------------------------------------

/**
 * 构造引擎所需的和了上下文（yaku.js 的 Context + 振听字段）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {object} extra 覆盖字段（hand / winTile / isTsumo / isChankan / …）
 * @returns {object} ctx
 */
function yakuContext(state, seat, extra) {
  const p = state.players[seat];
  const riichi = p.riichi === true || p.doubleRiichi === true;
  return {
    hand: extra.hand,
    melds: p.melds,
    winTile: extra.winTile,
    isTsumo: extra.isTsumo === true,
    roundWind: state.roundWind,
    seatWind: seatWindOf(state, seat),
    isRiichi: p.riichi === true,
    isDoubleRiichi: p.doubleRiichi === true,
    isIppatsu: p.ippatsu === true && riichi,
    isChankan: extra.isChankan === true,
    chankanIsAnkan: extra.chankanIsAnkan === true,
    isRinshan: extra.isRinshan === true,
    isHaitei: extra.isHaitei === true,
    isHoutei: extra.isHoutei === true,
    isTenhou: false,
    isChiihou: false,
    doraIndicators: state.doraIndicators,
    uraIndicators: riichi ? state.uraIndicators : [],
    redCount: redCountOf(p),
    // ---- 振听字段（荣和用；canRonReasons 会自行调用 isFuriten）----
    pond: p.pond.slice(),
    passedWin: p.tempFuriten === true,
    riichiFuriten: p.riichiFuriten === true,
    hand14: extra.hand,
  };
}

/**
 * 判断某张牌是否能荣和（和牌形 + 有役 + 非振听，§6.2 / §6.3）。
 *
 * 先用廉价的 `isAgari()` 过滤掉绝大多数情况，只有真的成和牌形时才调用役种判定
 * （`canRonReasons`），否则 200 局自动对局的性能不可接受。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {number} tile 荣和牌（0–33 归一）
 * @param {object} ctxInfo 场景信息（chankan / houtei）
 * @returns {object|null} `canRonReasons` 结果，不可荣和返回 null
 */
function ronCheck(state, seat, tile, ctxInfo) {
  const p = state.players[seat];
  const t = normalizeIndex(tile);
  if (p.hand[t] >= MAX_COPIES) return null; // 4 张都在自己手里，不可能再得到
  const hand14 = cloneHand(p.hand);
  hand14[t] += 1;
  if (totalTiles(hand14) !== 14 - 3 * p.melds.length) return null;
  if (!isAgari(hand14, p.melds.length)) return null;
  const res = canRonReasons(
    yakuContext(state, seat, {
      hand: hand14,
      winTile: t,
      isTsumo: false,
      isChankan: ctxInfo.isChankan === true,
      chankanIsAnkan: ctxInfo.chankanIsAnkan === true,
      isHoutei: ctxInfo.isHoutei === true,
    }),
    state.rules,
  );
  return res.ok ? res : null;
}

/**
 * 判断当前摸到的牌是否能自摸和牌（自摸不受振听限制，§6.3）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {object|null} `canRonReasons` 结果，不能自摸返回 null
 */
function tsumoCheck(state, seat) {
  const p = state.players[seat];
  if (p.drawnTile === null) return null;
  const hand14 = cloneHand(p.hand);
  if (totalTiles(hand14) !== 14 - 3 * p.melds.length) return null;
  if (!isAgari(hand14, p.melds.length)) return null;
  const res = canRonReasons(
    yakuContext(state, seat, {
      hand: hand14,
      winTile: normalizeIndex(p.drawnTile),
      isTsumo: true,
      isRinshan: p.rinshanDraw === true,
      isHaitei: p.haiteiDraw === true,
    }),
    state.rules,
  );
  return res.ok ? res : null;
}

// ---------------------------------------------------------------------------
// 合法动作
// ---------------------------------------------------------------------------

/**
 * 当前该谁行动。
 *
 * `phase = 'claim'` 时返回第一个还没响应的鸣牌候选座位（玩家侧可循环调用
 * `legalActions(state, currentSeat(state))` 逐个响应）。
 *
 * @param {object} state 对局状态
 * @returns {number} 座位 0–3
 */
export function currentSeat(state) {
  if (state.phase === PHASES.CLAIM && state.pendingClaims.length > 0) return state.pendingClaims[0].seat;
  return state.turn;
}

/**
 * 复制动作数组（避免外部改动内部状态）。
 *
 * @param {object[]} actions 动作数组
 * @returns {object[]} 新数组
 */
function copyActions(actions) {
  return actions.map((a) => (a.tiles ? { ...a, tiles: a.tiles.slice() } : { ...a }));
}

/**
 * 某座位当前可以打出的牌（受立直锁定与食替限制）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {number[]} 可打出的牌索引（升序，可能含 34–36）
 */
function legalDiscardTiles(state, seat) {
  const p = state.players[seat];
  let tiles = discardCandidates(p.hand, p.handRed);
  if (p.riichi || p.doubleRiichi) {
    // §5.3 立直后手牌锁定：摸什么打什么
    if (p.drawnTile === null) return [];
    const d = normalizeIndex(p.drawnTile);
    tiles = tiles.filter((t) => normalizeIndex(t) === d);
  }
  const lock = state.kuikaeLock;
  if (lock && lock.seat === seat) tiles = tiles.filter((t) => !isKuikae(lock.meld, t));
  return tiles;
}

/**
 * 某座位此刻能否暗杠（§4.2 / §5.4）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {number[]} 可暗杠的牌索引
 */
function ankanOptions(state, seat) {
  const p = state.players[seat];
  if (p.drawnTile === null) return [];
  if (state.kanCount >= MAX_KANS) return [];
  const out = [];
  for (const t of ankanTiles(p.hand)) {
    if (p.riichi || p.doubleRiichi) {
      // §5.4 立直后暗杠：听牌【集合】必须完全一致（不是「只要还听牌」）
      const after = cloneHand(p.hand);
      after[t] = 0; // 14 - 4 = 10 = 13 - 3 × (副露数 + 1)
      if (!sameWaitSet(waitsOf(after, p.melds.length + 1), p.riichiWaits || [])) continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * 某座位此刻能否加杠（§4.2：立直后禁止加杠）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {number[]} 可加杠的牌索引
 */
function kakanOptions(state, seat) {
  const p = state.players[seat];
  if (p.drawnTile === null) return [];
  if (p.riichi || p.doubleRiichi) return [];
  if (state.kanCount >= MAX_KANS) return [];
  return kakanTiles(p.hand, p.melds);
}

/**
 * 某座位此刻是否可以宣言立直（§5.1），返回可同时打出的牌。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {number[]} 可宣告立直并打出的牌（升序）
 */
function riichiOptions(state, seat) {
  const p = state.players[seat];
  if (!p.menzen || p.riichi || p.doubleRiichi) return [];
  if (p.drawnTile === null) return [];
  if (p.score < 1000) return []; // ③ 点数 ≥ 1000（恰好 1000 可以）
  if (state.wall.live.length < 4) return []; // ④ 剩余可摸牌 ≥ 4（雀魂口径，附录 C-2）
  const mc = p.melds.length;
  const out = [];
  for (const t of discardCandidates(p.hand, p.handRed)) {
    const h13 = cloneHand(p.hand);
    h13[normalizeIndex(t)] -= 1;
    if (totalTiles(h13) !== 13 - 3 * mc) continue;
    // 先用向听数（≈1.5µs）粗筛，再确认听牌（听牌集合非空）：15 个候选逐个算完整
    // 听牌集合在 200 局自动对局里是最大热点，这一步把开销降了一个数量级。
    if (shanten(h13, mc) !== 0) continue;
    if (!hasWait(h13, mc)) continue;
    out.push(t);
  }
  return out;
}

/**
 * 某座位此刻能否宣告九种九牌（§10.5.1）。
 *
 * 条件：自己**第一次摸牌之后、打牌之前**，此前**没有吃 / 碰 / 明杠 / 暗杠**，
 * 手牌中**幺九牌的种数 ≥ 9**。宣告是**权利而非义务**。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {boolean} 可以宣告返回 true
 */
function canKyuushu(state, seat) {
  const p = state.players[seat];
  if (p.drawCount !== 1) return false;
  if (p.melds.length > 0) return false; // 鸣过牌（含暗杠）即不可
  if (p.drawnTile === null) return false;
  return distinctYaochuKinds(p.hand) >= 9;
}

/**
 * 摸牌阶段的全部合法动作。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {object[]} 动作数组
 */
function drawPhaseActions(state, seat) {
  const actions = [];
  for (const t of legalDiscardTiles(state, seat)) actions.push({ type: 'discard', tile: t });
  if (tsumoCheck(state, seat) !== null) actions.push({ type: 'tsumo' });
  for (const t of ankanOptions(state, seat)) actions.push({ type: 'kan', kind: 'ankan', tile: t });
  for (const t of kakanOptions(state, seat)) actions.push({ type: 'kan', kind: 'kakan', tile: t });
  for (const t of riichiOptions(state, seat)) actions.push({ type: 'riichi', tile: t });
  if (canKyuushu(state, seat)) actions.push({ type: 'kyuushu' });
  // 四槓散了是强制流局，这里额外提供一个显式宣告入口（不宣告则打牌后自动流局，§10.5.4）
  if (state.suukaikanPending) actions.push({ type: 'nine_kan_abort' });
  return actions;
}

/**
 * 鸣牌后打牌阶段的合法动作（只能打一张，§4.4）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {object[]} 动作数组
 */
function discardPhaseActions(state, seat) {
  return legalDiscardTiles(state, seat).map((t) => ({ type: 'discard', tile: t }));
}

/**
 * 某座位当前的**全部**合法动作。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位 0–3
 * @returns {object[]} 动作数组（判别联合，`type` 为判别字段）；不该该座位行动时返回 []
 */
export function legalActions(state, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) {
    throw new RangeError(`legalActions: seat 必须是 0–3 的整数，收到 ${String(seat)}`);
  }
  if (state.phase === PHASES.CLAIM) {
    const pc = state.pendingClaims.find((x) => x.seat === seat);
    if (!pc) return [];
    refreshFuriten(state, seat); // UI 读 furiten 字段时要反映最新的见逃 / 牌河状态
    return copyActions(pc.actions);
  }
  if ((state.phase === PHASES.DRAW || state.phase === PHASES.DISCARD) && state.turn === seat) {
    refreshFuriten(state, seat);
    return state.phase === PHASES.DRAW ? drawPhaseActions(state, seat) : discardPhaseActions(state, seat);
  }
  return [];
}

/**
 * 打牌之后是否存在合法的一张可打（食替保护）。
 *
 * 理论上手里 ≥ 10 张牌，食替最多禁 3 种，必然有牌可打；这里仍做一次显式检查，
 * 避免出现「鸣牌后无牌可打」的死锁。
 *
 * @param {object} p 玩家
 * @param {object} meldDraft meld 草案（含 `meld` 与 `fromHand`）
 * @returns {boolean} 存在合法打牌返回 true
 */
function postCallDiscardExists(p, meldDraft) {
  const h = cloneHand(p.hand);
  for (const t of meldDraft.fromHand) h[normalizeIndex(t)] -= 1;
  for (let t = 0; t < HAND_SIZE; t++) {
    if (h[t] <= 0) continue;
    if (!isKuikae(meldDraft.meld, t)) return true;
  }
  return false;
}

/**
 * 生成某座位对刚打出的牌 / 刚加槓的牌的响应动作（§4.1 优先级：和 > 碰/杠 > 吃）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {object} info claimContext
 * @returns {object[]} 动作数组（不含 pass）
 */
function claimActionsFor(state, seat, info) {
  const p = state.players[seat];
  const t = normalizeIndex(info.tile);
  const acts = [];
  // 荣和优先于一切副露（§4.1）；河底牌可以被荣和（§3.4）
  if (ronCheck(state, seat, t, info) !== null) acts.push({ type: 'ron' });
  if (info.kind !== 'discard') return acts; // 抢槓窗口只有荣和
  if (info.haitei) return acts; // 不可以鸣海底牌（§3.4）
  if (p.riichi || p.doubleRiichi) return acts; // 立直后不可鸣牌（§5.3）
  if (p.melds.length >= 4) return acts; // 面子已满

  const discarder = info.discarder;
  const meldsFull = p.melds.length + 1 > 4;
  if (!meldsFull && p.hand[t] >= 2) {
    const fromHand = pickPhysical(p, t, 2);
    const draft = { meld: { type: 'pon', tiles: [...fromHand, info.tile], calledTile: info.tile }, fromHand };
    if (postCallDiscardExists(p, draft)) acts.push({ type: 'pon' });
  }
  if (!meldsFull && state.kanCount < MAX_KANS && canMinkan(p.hand, t)) {
    // 大明杠后摸岭上牌再打牌，且 4 张同牌不可能构成两组同顺子 → 不存在食替（§4.3）
    acts.push({ type: 'kan', kind: 'minkan', tile: t });
  }
  if (!meldsFull && seat === (discarder + 1) % 4 && !isHonor(t)) {
    for (const pair of chiOptions(p.hand, t)) {
      const fromHand = [];
      for (const x of pair) fromHand.push(...pickPhysical(p, x, 1));
      const tiles = [...fromHand, info.tile].sort((a, b) => normalizeIndex(a) - normalizeIndex(b));
      const draft = { meld: { type: 'chi', tiles, calledTile: info.tile }, fromHand };
      if (postCallDiscardExists(p, draft)) acts.push({ type: 'chi', tiles: pair.slice() });
    }
  }
  return acts;
}

/**
 * 打开鸣牌响应窗口；无人可鸣时立刻裁决。
 *
 * @param {object} state 对局状态
 * @param {object} info claimContext
 * @returns {object[]} 事件数组
 */
function openClaimWindow(state, info) {
  const pending = [];
  for (let i = 1; i <= 3; i++) {
    const seat = (info.discarder + i) % 4;
    const acts = claimActionsFor(state, seat, info);
    if (acts.length > 0) pending.push({ seat, actions: [...acts, { type: 'pass' }] });
  }
  state.claimContext = info;
  state.claimResults = [];
  if (pending.length === 0) {
    state.pendingClaims = [];
    return resolveClaimWindow(state);
  }
  state.pendingClaims = pending;
  state.phase = PHASES.CLAIM;
  return [];
}

/** 相对放铳者的逆时针序号（0 = 下家） */
function ccwOrder(discarder, seat) {
  return (seat - discarder + 4) % 4;
}

// ---------------------------------------------------------------------------
// 鸣牌执行
// ---------------------------------------------------------------------------

/**
 * 标记牌河中的某张牌被鸣走（流局满贯判定用，§10.4）。
 *
 * @param {object} state 对局状态
 * @returns {void}
 */
function markLastDiscardCalled(state) {
  const info = state.claimContext;
  const p = state.players[info.discarder];
  const idx = p.pond.length - 1;
  if (idx < 0 || normalizeIndex(p.pond[idx]) !== normalizeIndex(info.tile)) {
    throw new Error('内部错误：被鸣的牌不是牌河最后一张');
  }
  p.pondCalled[idx] = true;
  if (state.lastDiscard) state.lastDiscard.called = true;
}

/**
 * 破坏全场一发（任何吃 / 碰 / 杠，含暗杠，§5.5）。
 *
 * @param {object} state 对局状态
 * @returns {void}
 */
function breakIppatsu(state) {
  for (const p of state.players) p.ippatsu = false;
}

/**
 * 登记包牌责任（§11.1：大三元 / 大四喜；四槓子不包）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 鸣牌者
 * @param {number} fromSeat 打出被鸣之牌的座位
 * @returns {void}
 */
function registerPao(state, seat, fromSeat) {
  const p = state.players[seat];
  let dragons = 0;
  let winds = 0;
  for (const meld of p.melds) {
    if (meld.type === 'chi') continue;
    const t = normalizeIndex(meld.tiles[0]);
    if (t >= 31) dragons += 1;
    else if (t >= 27 && t <= 30) winds += 1;
  }
  if (dragons >= 3 || winds >= 4) p.paoBy = fromSeat;
}

/**
 * 执行碰。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {object[]} 事件数组
 */
function doPon(state, seat) {
  const info = state.claimContext;
  const p = state.players[seat];
  const t = normalizeIndex(info.tile);
  const fromHand = pickPhysical(p, t, 2);
  for (const x of fromHand) removeOneFromHand(p, x);
  const meld = {
    type: 'pon',
    tiles: [...fromHand, info.tile].sort((a, b) => normalizeIndex(a) - normalizeIndex(b)),
    calledTile: info.tile,
    from: info.discarder,
  };
  p.melds.push(meld);
  addMeldRed(p, meld.tiles);
  updateMenzen(p);
  markLastDiscardCalled(state);
  state.callCount += 1;
  breakIppatsu(state);
  state.kuikaeLock = { seat, meld };
  state.turn = seat;
  state.phase = PHASES.DISCARD;
  p.drawnTile = null;
  state.lastDiscard = null;
  state.pendingClaims = [];
  state.claimContext = null;
  refreshFuriten(state, seat);
  registerPao(state, seat, info.discarder);
  return [{ type: 'meld', seat, meld: { ...meld, tiles: meld.tiles.slice() } }];
}

/**
 * 执行吃（只能吃上家，§4.2）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {number[]} pair 用手牌中的哪两张吃
 * @returns {object[]} 事件数组
 */
function doChi(state, seat, pair) {
  const info = state.claimContext;
  const p = state.players[seat];
  const fromHand = [];
  for (const x of pair) fromHand.push(...pickPhysical(p, normalizeIndex(x), 1));
  for (const x of fromHand) removeOneFromHand(p, x);
  const meld = {
    type: 'chi',
    tiles: [...fromHand, info.tile].sort((a, b) => normalizeIndex(a) - normalizeIndex(b)),
    calledTile: info.tile,
    from: info.discarder,
  };
  p.melds.push(meld);
  addMeldRed(p, meld.tiles);
  updateMenzen(p);
  markLastDiscardCalled(state);
  state.callCount += 1;
  breakIppatsu(state);
  state.kuikaeLock = { seat, meld };
  state.turn = seat;
  state.phase = PHASES.DISCARD;
  p.drawnTile = null;
  state.lastDiscard = null;
  state.pendingClaims = [];
  state.claimContext = null;
  refreshFuriten(state, seat);
  return [{ type: 'meld', seat, meld: { ...meld, tiles: meld.tiles.slice() } }];
}

/**
 * 执行大明杠（§4.2）。大明杠不摸打，直接摸岭上牌。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {object[]} 事件数组
 */
function doMinkan(state, seat) {
  const info = state.claimContext;
  const p = state.players[seat];
  const t = normalizeIndex(info.tile);
  const fromHand = pickPhysical(p, t, 3);
  for (const x of fromHand) removeOneFromHand(p, x);
  const meld = {
    type: 'minkan',
    tiles: [...fromHand, info.tile].sort((a, b) => normalizeIndex(a) - normalizeIndex(b)),
    calledTile: info.tile,
    from: info.discarder,
  };
  p.melds.push(meld);
  addMeldRed(p, meld.tiles);
  updateMenzen(p);
  markLastDiscardCalled(state);
  state.callCount += 1;
  state.kanCount += 1;
  state.kanOwners.push(seat);
  p.pendingKanDora += 1; // 明杠要等摸岭上牌并打出 1 张后才翻杠宝牌（§3.5）
  breakIppatsu(state);
  state.kuikaeLock = null; // 大明杠后不可能构成食替（§4.3）
  state.pendingClaims = [];
  state.claimContext = null;
  refreshFuriten(state, seat);
  registerPao(state, seat, info.discarder);
  checkSuukaikan(state);
  const events = [
    { type: 'meld', seat, meld: { ...meld, tiles: meld.tiles.slice() } },
    { type: 'kan', seat, kind: 'minkan', tile: t },
  ];
  events.push(...drawFor(state, seat, { rinshan: true }));
  return events;
}

/**
 * 四槓散了成立判定（§10.5.4，纯函数，便于单测）。
 *
 * 「同一人开 4 槓」**不流局**（保留四槓子机会，但本局该家不得再开槓）；
 * 「复数人开出第 4 槓」→ 该家打出一张牌且未放铳时流局。
 *
 * @param {number} kanCount 本局开杠总次数
 * @param {number[]} kanOwners 每次开杠的座位（按顺序）
 * @returns {boolean} 是否进入「四槓散了待判定」状态
 */
export function isSuukaikanPending(kanCount, kanOwners) {
  if (kanCount < MAX_KANS) return false;
  return new Set(kanOwners).size >= 2;
}

/**
 * 第 4 次开杠之后登记四槓散了（§10.5.4）。
 *
 * @param {object} state 对局状态
 * @returns {void}
 */
function checkSuukaikan(state) {
  state.suukaikanPending = isSuukaikanPending(state.kanCount, state.kanOwners);
}

/**
 * 翻出下一张杠宝牌指示牌（§3.5）。
 *
 * @param {object} state 对局状态
 * @returns {object[]} 事件数组（`dora_reveal`）
 */
function revealKanDora(state) {
  if (state.kanDoraCount >= 4) throw new Error('revealKanDora: 杠宝牌指示牌已全部翻出（最多 4 张）');
  const indicator = kanDoraIndicator(state.wall.dead, state.kanDoraCount);
  state.kanDoraCount += 1;
  state.doraIndicators.push(indicator);
  return [{ type: 'dora_reveal', indicator }];
}

/**
 * 翻出里宝牌（立直者和牌时，§3.5）。
 *
 * @param {object} state 对局状态
 * @returns {object[]} 事件数组
 */
function revealUra(state) {
  if (state.uraIndicators.length > 0) return [];
  const dead = state.wall.dead;
  const list = [dead[DEAD_URA]];
  for (let k = 0; k < state.kanDoraCount; k++) list.push(kanUraIndicator(dead, k));
  state.uraIndicators = list;
  return list.map((indicator) => ({ type: 'dora_reveal', indicator, isUra: true }));
}

/**
 * 完成一次杠（暗杠 / 加杠）—— 应用副露、翻杠宝牌（暗杠立即翻）、摸岭上牌。
 *
 * @param {object} state 对局状态
 * @param {object} info claimContext（kind = 'ankan' | 'chankan'）
 * @returns {object[]} 事件数组
 */
function completeKan(state, info) {
  const seat = info.discarder;
  const p = state.players[seat];
  const t = normalizeIndex(info.tile);
  const events = [];
  const kind = info.kind === 'ankan' ? 'ankan' : 'kakan';
  const tiles = takeAllPhysical(p, t);
  for (const x of tiles) removeOneFromHand(p, x);
  if (kind === 'ankan') {
    const meld = { type: 'ankan', tiles: tiles.slice() };
    p.melds.push(meld);
    addMeldRed(p, meld.tiles);
    updateMenzen(p);
    events.push({ type: 'meld', seat, meld: { ...meld, tiles: meld.tiles.slice() } });
    events.push(...revealKanDora(state)); // 暗杠立即翻杠宝牌（§3.5）
  } else {
    // 加杠：把原来的碰升级为加杠
    const idx = p.melds.findIndex((m) => m.type === 'pon' && normalizeIndex(m.tiles[0]) === t);
    if (idx < 0) throw new Error(`内部错误：加杠找不到对应的碰（${tileToStr(t)}）`);
    const old = p.melds[idx];
    const meld = {
      type: 'kakan',
      tiles: [...old.tiles, ...tiles].sort((a, b) => normalizeIndex(a) - normalizeIndex(b)),
      calledTile: old.calledTile,
      from: old.from,
    };
    p.melds[idx] = meld;
    addMeldRed(p, tiles);
    p.pendingKanDora += 1; // 加杠同明杠：打出 1 张后才翻（§3.5）
    events.push({ type: 'meld', seat, meld: { ...meld, tiles: meld.tiles.slice() } });
  }
  state.kanCount += 1;
  state.kanOwners.push(seat);
  state.callCount += 1;
  events.push({ type: 'kan', seat, kind, tile: t });
  breakIppatsu(state);
  state.pendingClaims = [];
  state.claimContext = null;
  state.kuikaeLock = null;
  refreshFuriten(state, seat);
  checkSuukaikan(state);
  events.push(...drawFor(state, seat, { rinshan: true }));
  return events;
}

// ---------------------------------------------------------------------------
// 打牌
// ---------------------------------------------------------------------------

/**
 * 解析要打出的物理牌（普通 5 还是赤 5）。
 *
 * @param {object} p 玩家
 * @param {number} tile 动作里的 tile（0–36）
 * @returns {{tile: number, isRed: boolean}} 实际打出的物理牌
 */
function resolveDiscardPhysical(p, tile) {
  const t = normalizeIndex(tile);
  if (p.hand[t] <= 0) throw new Error(`打牌：手里没有 ${tileToStr(t)}`);
  const isFive = t < 27 && t % 9 === 4;
  if (!isFive) return { tile: t, isRed: false };
  const suit = Math.floor(t / 9);
  const reds = p.handRed[suit];
  if (tile >= 34) {
    if (reds <= 0) throw new Error(`打牌：手里没有赤 ${tileToStr(tile)}`);
    return { tile: 34 + suit, isRed: true };
  }
  if (reds > 0 && p.hand[t] <= reds) return { tile: 34 + suit, isRed: true }; // 手里的 5 全是赤
  return { tile: t, isRed: false };
}

/**
 * 判断打出某张牌是否会「和了放棄」（同巡振听，§6.3）。
 *
 * @param {object} p 玩家（已打出该牌）
 * @param {number} t 归一牌索引
 * @returns {boolean} 打出该牌本可和牌返回 true
 */
function wouldCompleteHand(p, t) {
  const h = cloneHand(p.hand);
  if (h[t] >= MAX_COPIES) return false;
  h[t] += 1;
  return isAgari(h, p.melds.length);
}

/**
 * 执行打牌（含立直宣言打牌）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {object} action `{type:'discard'|'riichi', tile}`
 * @returns {object[]} 事件数组
 */
function applyDiscard(state, seat, action) {
  const events = [];
  const p = state.players[seat];
  const isRiichiDecl = action.type === 'riichi';
  const physical = resolveDiscardPhysical(p, action.tile);
  const t = normalizeIndex(physical.tile);
  const wasHaitei = p.haiteiDraw === true;
  const isTsumogiri = p.drawnTile !== null && normalizeIndex(p.drawnTile) === t;

  // 同巡振听：只有自己切牌才解除（§6.3，雀魂 / 天凤口径；逆巡副露不解除）
  p.tempFuriten = false;
  removeOneFromHand(p, physical.tile);
  p.pond.push(t);
  p.pondCalled.push(false);
  p.discardCount += 1;
  p.drawnTile = null;
  p.rinshanDraw = false;
  p.haiteiDraw = false;
  state.discardLog.push({ seat, tile: physical.tile });

  // 打出的牌能补成和牌形 → 和了放棄 → 同巡振听；立直者则本局永久振听（§6.3）
  if (wouldCompleteHand(p, t)) {
    p.tempFuriten = true;
    if (p.riichi || p.doubleRiichi) p.riichiFuriten = true;
  }

  // 一发窗口：自己下一次打牌即结束（宣言牌本身不算，§5.5）
  if (!isRiichiDecl && p.ippatsu) p.ippatsu = false;

  if (isRiichiDecl) {
    p.riichi = true;
    // 两立直：自己第一巡、且此前无任何吃碰杠（§5.6）
    p.doubleRiichi = state.callCount === 0 && p.discardCount === 1;
    p.ippatsu = true;
    p.riichiTurn = state.turnCount;
    p.score -= RIICHI_STICK_POINTS;
    state.riichiSticks += 1;
    const h13 = concealed13(p);
    p.riichiWaits = h13 === null ? [] : waitsOf(h13, p.melds.length);
  }

  state.lastDiscard = {
    seat,
    tile: physical.tile,
    called: false,
    isHaitei: wasHaitei,
    isRiichiDecl,
    isKan: false,
  };
  state.kuikaeLock = null; // 自己打牌后食替限制解除（§4.3）
  refreshFuriten(state, seat);

  // 明杠 / 加杠的杠宝牌：打出 1 张后翻（§3.5）—— 在鸣牌响应之前翻出，符合「打牌后翻」
  if (p.pendingKanDora > 0) {
    for (let i = 0; i < p.pendingKanDora; i++) events.push(...revealKanDora(state));
    p.pendingKanDora = 0;
  }

  events.push({ type: 'discard', seat, tile: physical.tile, isRiichi: isRiichiDecl, isTsumogiri });
  if (isRiichiDecl) events.push({ type: 'riichi', seat, tile: physical.tile });

  const info = {
    kind: 'discard',
    discarder: seat,
    tile: physical.tile,
    haitei: wasHaitei,
    houtei: wasHaitei,
    riichiDecl: isRiichiDecl,
    isChankan: false,
    chankanIsAnkan: false,
  };
  events.push(...openClaimWindow(state, info));
  return events;
}

// ---------------------------------------------------------------------------
// 鸣牌窗口裁决
// ---------------------------------------------------------------------------

/**
 * 全部候选座位响应完毕后的裁决（§4.1 优先级、§6.5 多家和牌、§10.5.4 四槓散了）。
 *
 * @param {object} state 对局状态
 * @returns {object[]} 事件数组
 */
function resolveClaimWindow(state) {
  const info = state.claimContext;
  const results = state.claimResults.slice();
  state.pendingClaims = [];
  state.claimResults = [];
  const ordered = results.slice().sort((a, b) => ccwOrder(info.discarder, a.seat) - ccwOrder(info.discarder, b.seat));
  const rons = ordered.filter((r) => r.action.type === 'ron');

  if (rons.length > 0) {
    state.claimContext = null;
    return resolveRonWins(
      state,
      rons.map((r) => r.seat),
      info,
    );
  }
  if (info.kind === 'ankan' || info.kind === 'chankan') {
    return completeKan(state, info);
  }
  if (state.suukaikanPending) {
    state.claimContext = null;
    return endDraw(state, 'sukanagare');
  }
  const minkan = ordered.find((r) => r.action.type === 'kan');
  const pon = ordered.find((r) => r.action.type === 'pon');
  const chi = ordered.find((r) => r.action.type === 'chi');
  if (minkan) return doMinkan(state, minkan.seat);
  if (pon) return doPon(state, pon.seat);
  if (chi) {
    state.claimContext = info;
    return doChi(state, chi.seat, chi.action.tiles);
  }
  return afterNoClaim(state, info);
}

/**
 * 无人鸣牌 / 无人和牌之后的推进（途中流局判定 → 下一家摸牌 / 荒牌流局）。
 *
 * @param {object} state 对局状态
 * @param {object} info claimContext
 * @returns {object[]} 事件数组
 */
function afterNoClaim(state, info) {
  state.claimContext = null;
  // 四风连打（§10.5.2）：第一巡四家连续打出同一种风牌，中途无任何鸣牌
  if (info.kind === 'discard' && checkSuufonRenda(state)) return endDraw(state, 'suufonrenda');
  // 四家立直（§10.5.3）：四家全部立直且第四家的立直成立（宣言牌放铳时立直不成立 → 不会走到这里）
  if (info.kind === 'discard' && state.players.every((p) => p.riichi || p.doubleRiichi)) {
    return endDraw(state, 'suuchariichi');
  }
  // 荒牌流局（§10.2）
  if (state.wall.live.length === 0) return endDraw(state, 'exhaustive');
  const next = (info.discarder + 1) % 4;
  return drawFor(state, next, { rinshan: false });
}

/**
 * 四风连打判定（§10.5.2）。
 *
 * @param {object} state 对局状态
 * @returns {boolean} 成立返回 true
 */
function checkSuufonRenda(state) {
  if (state.callCount > 0) return false;
  const log = state.discardLog;
  if (log.length !== 4) return false;
  const counts = [0, 0, 0, 0];
  for (const d of log) counts[d.seat] += 1;
  if (counts.some((c) => c !== 1)) return false;
  const t = normalizeIndex(log[0].tile);
  if (t < 27 || t > 30) return false; // 必须是风牌
  return log.every((d) => normalizeIndex(d.tile) === t);
}

// ---------------------------------------------------------------------------
// 和了
// ---------------------------------------------------------------------------

/**
 * 应用四家点数变化（含类型校验）。
 *
 * @param {object} state 对局状态
 * @param {number[]} deltas 四家增减
 * @returns {void}
 */
function applyDeltas(state, deltas) {
  for (let s = 0; s < 4; s++) {
    const d = deltas[s];
    if (!Number.isInteger(d)) throw new Error(`内部错误：点数增减必须是整数，座位 ${s} 得到 ${String(d)}`);
    state.players[s].score += d;
  }
}

/**
 * 构造对外的和了结果（含明牌信息，供 UI 播报）。
 *
 * @param {object} state 对局状态
 * @param {object} r settleWin 的结果
 * @param {object} winCtx 和了上下文
 * @returns {object} 可序列化结果
 */
function publicWinResult(state, r, winCtx) {
  const p = state.players[r.seat];
  return {
    ...r,
    yaku: r.yaku.map((e) => ({ id: e.id, name: e.name, ja: e.ja, han: e.han, isYakuman: e.isYakuman, multiplier: e.multiplier })),
    winTile: normalizeIndex(winCtx.winTile),
    hand: cloneHand(winCtx.hand),
    melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
    isIppatsu: p.ippatsu === true,
    isRiichi: p.riichi === true,
    isDoubleRiichi: p.doubleRiichi === true,
  };
}

/**
 * 多家荣和结算（§6.5：雀魂无头跳，全部结算；场供与立直棒归头跳家）。
 *
 * @param {object} state 对局状态
 * @param {number[]} seats 和牌者座位（已按逆时针排序）
 * @param {object} info claimContext
 * @returns {object[]} 事件数组
 */
function resolveRonWins(state, seats, info) {
  const events = [];
  const discarder = info.discarder;
  const winTile = normalizeIndex(info.tile);
  const totalDeltas = [0, 0, 0, 0];

  // §5.2 立直宣言牌放铳（燕返）：立直不成立、退还宣言供托、本局视为从未立直
  if (info.riichiDecl === true) {
    const dp = state.players[discarder];
    dp.riichi = false;
    dp.doubleRiichi = false;
    dp.ippatsu = false;
    dp.riichiWaits = null;
    dp.riichiTurn = null;
    state.riichiSticks -= 1;
    // 退还的 1000 点只记在 deltas 里（点数在结算末尾统一施加），避免重复加减
    totalDeltas[discarder] += RIICHI_STICK_POINTS;
    state.lastDiscard.riichiVoid = true;
    refreshFuriten(state, discarder);
  }

  const multi = settleMultiRon(
    seats.map((s) => ({ seat: s })),
    state.rules,
  );
  const winners = multi.winners.map((w) => w.seat);
  const headBump = winners[0];

  // 里宝牌：立直者和牌才翻（§3.5）
  if (winners.some((s) => state.players[s].riichi || state.players[s].doubleRiichi)) {
    events.push(...revealUra(state));
  }

  const results = [];
  for (const seat of winners) {
    const p = state.players[seat];
    const hand14 = cloneHand(p.hand);
    hand14[winTile] += 1;
    const winCtx = {
      hand: hand14,
      winTile,
      isTsumo: false,
      discarder,
      isChankan: info.kind === 'chankan' || info.kind === 'ankan',
      chankanIsAnkan: info.kind === 'ankan',
      isRinshan: false,
      isHaitei: false,
      isHoutei: info.houtei === true,
      takesSticks: seat === headBump,
    };
    const r = settleWin(state, seat, winCtx);
    results.push({ r, winCtx });
    for (let s = 0; s < 4; s++) totalDeltas[s] += r.deltas[s];
  }

  applyDeltas(state, totalDeltas);
  const sticksTaken = results.reduce((a, x) => a + x.r.riichiSticksTaken, 0);
  state.riichiSticks -= sticksTaken;
  state.result = {
    type: 'win',
    winners: results.map((x) => publicWinResult(state, x.r, x.winCtx)),
    discarder,
    winTile,
    isTsumo: false,
    isChankan: info.kind === 'chankan' || info.kind === 'ankan',
    deltas: totalDeltas,
  };
  for (const { r, winCtx } of results) events.push({ type: 'win', seat: r.seat, result: publicWinResult(state, r, winCtx) });
  events.push(...finishHand(state));
  return events;
}

/**
 * 自摸和牌结算（§6.7 / §3.4）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {object[]} 事件数组
 */
function applyTsumo(state, seat) {
  const events = [];
  const p = state.players[seat];
  const winCtx = {
    hand: cloneHand(p.hand),
    winTile: normalizeIndex(p.drawnTile),
    isTsumo: true,
    discarder: null,
    isChankan: false,
    chankanIsAnkan: false,
    isRinshan: p.rinshanDraw === true,
    isHaitei: p.haiteiDraw === true,
    isHoutei: false,
    takesSticks: true,
  };
  if (p.riichi || p.doubleRiichi) events.push(...revealUra(state));
  const r = settleWin(state, seat, winCtx);
  applyDeltas(state, r.deltas);
  state.riichiSticks -= r.riichiSticksTaken;
  state.result = {
    type: 'win',
    winners: [publicWinResult(state, r, winCtx)],
    discarder: null,
    winTile: normalizeIndex(p.drawnTile),
    isTsumo: true,
    isChankan: false,
    deltas: r.deltas.slice(),
  };
  events.push({ type: 'win', seat, result: publicWinResult(state, r, winCtx) });
  events.push(...finishHand(state));
  return events;
}

// ---------------------------------------------------------------------------
// 流局 / 收尾
// ---------------------------------------------------------------------------

/**
 * 结束本局为流局。
 *
 * @param {object} state 对局状态
 * @param {string} kind 流局种类
 * @returns {object[]} 事件数组
 */
function endDraw(state, kind) {
  const events = [];
  const tenpai = [0, 1, 2, 3].map((s) => {
    const p = state.players[s];
    const h13 = concealed13(p);
    const tp = h13 !== null && isTenpaiShape(h13, p.melds.length);
    p.tenpai = tp;
    return tp;
  });
  const draw = settleDraw(state, kind, tenpai);
  applyDeltas(state, draw.deltas);
  state.result = {
    type: 'draw',
    kind: draw.kind,
    tenpai,
    deltas: draw.deltas,
    payments: draw.payments,
    nagashiSeats: draw.nagashiSeats,
  };
  events.push({ type: 'draw_end', kind: draw.kind, tenpai, payments: draw.payments });
  events.push(...finishHand(state));
  return events;
}

/**
 * 收尾：推进局数 / 本场（或终局），产出 `hand_end` 与 `game_over`。
 *
 * @param {object} state 对局状态
 * @returns {object[]} 事件数组
 */
function finishHand(state) {
  const events = [];
  state.lastDiscard = null;
  state.pendingClaims = [];
  state.claimResults = [];
  state.claimContext = null;
  state.kuikaeLock = null;
  state.suukaikanPending = false;
  const adv = advanceHand(state);
  state.result.renchan = adv.renchan;
  if (adv.gameOver) {
    state.gameOver = true;
    state.phase = PHASES.GAME_OVER;
  } else {
    state.phase = PHASES.HAND_OVER;
  }
  events.push({
    type: 'hand_end',
    deltas: state.result.deltas,
    nextDealer: adv.nextDealer,
    nextHonba: adv.nextHonba,
    gameOver: adv.gameOver,
  });
  if (adv.gameOver) {
    events.push({ type: 'game_over', ranking: adv.ranking.map((x) => ({ ...x })) });
  }
  return events;
}

// ---------------------------------------------------------------------------
// 动作分发
// ---------------------------------------------------------------------------

/**
 * 执行一个动作。
 *
 * 非法动作**一律抛 Error**（不静默忽略），错误信息里带上当前阶段与合法动作列表。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位 0–3
 * @param {object} action 动作（判别联合，见文件头 / README）
 * @returns {object[]} 事件数组
 * @throws {Error} 动作非法、对局已结束、本局未开始时抛出
 */
export function applyAction(state, seat, action) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) {
    throw new RangeError(`applyAction: seat 必须是 0–3 的整数，收到 ${String(seat)}`);
  }
  if (state.gameOver) throw new Error('applyAction: 对局已结束');
  if (state.phase === PHASES.IDLE) throw new Error('applyAction: 本局尚未开始，请先调用 startHand()');
  if (state.phase === PHASES.HAND_OVER) throw new Error('applyAction: 本局已结束，请先调用 startHand()');

  const legal = legalActions(state, seat);
  const found = findAction(legal, action);
  if (found === null) {
    let what;
    try {
      what = describeAction(action);
    } catch {
      what = JSON.stringify(action);
    }
    throw new Error(
      `非法动作：座位 ${seat} 在阶段 ${state.phase} 不能「${what}」；` +
        `当前合法动作：${legal.length === 0 ? '（无，不该该座位行动）' : legal.map(describeAction).join('、')}`,
    );
  }

  if (state.phase === PHASES.CLAIM) {
    const pending = state.pendingClaims.find((x) => x.seat === seat);
    // 见逃和牌 / 抢槓 → 同巡振听（立直后则本局永久振听），§6.3
    if (found.type === 'pass' && pending !== undefined && pending.actions.some((a) => a.type === 'ron')) {
      const p = state.players[seat];
      p.tempFuriten = true;
      if (p.riichi || p.doubleRiichi) p.riichiFuriten = true;
    }
    state.pendingClaims = state.pendingClaims.filter((x) => x.seat !== seat);
    state.claimResults.push({ seat, action: found });
    refreshFuriten(state, seat);
    if (state.pendingClaims.length > 0) return [];
    return resolveClaimWindow(state);
  }

  switch (found.type) {
    case 'discard':
    case 'riichi':
      return applyDiscard(state, seat, found);
    case 'tsumo':
      return applyTsumo(state, seat);
    case 'kan':
      return found.kind === 'ankan' ? applyAnkan(state, seat, found.tile) : applyKakan(state, seat, found.tile);
    case 'kyuushu':
      return endDraw(state, 'kyuushu');
    case 'nine_kan_abort':
      return endDraw(state, 'sukanagare');
    default:
      throw new Error(`applyAction: 未处理的动作类型 ${String(found.type)}`);
  }
}

/**
 * 宣言暗杠：先开抢槓窗口（雀魂国士可抢暗杠，§6.6），无人抢再成立。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {number} tile 牌
 * @returns {object[]} 事件数组
 */
function applyAnkan(state, seat, tile) {
  const p = state.players[seat];
  const t = normalizeIndex(tile);
  if (p.hand[t] !== MAX_COPIES) throw new Error('内部错误：暗杠需要手里恰好 4 张');
  const info = {
    kind: 'ankan',
    discarder: seat,
    tile,
    haitei: false,
    houtei: false,
    riichiDecl: false,
    isChankan: true,
    chankanIsAnkan: true,
  };
  return openClaimWindow(state, info);
}

/**
 * 宣言加杠：先开抢槓窗口（§6.6），无人抢再成立并摸岭上牌。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @param {number} tile 牌
 * @returns {object[]} 事件数组
 */
function applyKakan(state, seat, tile) {
  const info = {
    kind: 'chankan',
    discarder: seat,
    tile,
    haitei: false,
    houtei: false,
    riichiDecl: false,
    isChankan: true,
    chankanIsAnkan: false,
  };
  return openClaimWindow(state, info);
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/**
 * 这一局是否已结束。
 *
 * @param {object} state 对局状态
 * @returns {boolean} 已结束返回 true
 */
export function isHandOver(state) {
  return state.phase === PHASES.HAND_OVER || state.phase === PHASES.GAME_OVER;
}

/**
 * 整个对局是否已结束（击飞 / 打完南场或西场等，§12.1）。
 *
 * @param {object} state 对局状态
 * @returns {boolean} 已结束返回 true
 */
export function isGameOver(state) {
  return state.gameOver === true || state.phase === PHASES.GAME_OVER;
}

/**
 * 全场牌张统计（不变量自检用）：手牌 + 副露 + 牌河 + 牌山 + 王牌 + 未摸的岭上牌。
 *
 * @param {object} state 对局状态
 * @returns {number[]} 长度 34 的计数数组（赤 5 已归一到 5）
 */
export function countAllTiles(state) {
  const out = emptyHand();
  for (const p of state.players) {
    for (let t = 0; t < HAND_SIZE; t++) out[t] += p.hand[t];
    for (const m of p.melds) for (const t of m.tiles) out[normalizeIndex(t)] += 1;
    // 被鸣走的牌物理上已移入副露；牌河里只留「位置」用于振听与流局满贯判定（§6.3 / §10.4），
    // 所以这里按 pondCalled 跳过，避免重复计数。
    for (let i = 0; i < p.pond.length; i++) {
      if (p.pondCalled[i]) continue;
      out[normalizeIndex(p.pond[i])] += 1;
    }
  }
  for (const t of state.wall.live) out[normalizeIndex(t)] += 1;
  for (const t of state.wall.dead) out[normalizeIndex(t)] += 1;
  for (let i = state.wall.rinshanIndex; i < state.wall.rinshan.length; i++) {
    out[normalizeIndex(state.wall.rinshan[i])] += 1;
  }
  return out;
}

/**
 * 不变量自检（每一步之后都应成立，供测试与调试）。
 *
 * 检查项：
 *   1. 全场牌数守恒 = 136；每种牌不超过 4 张；
 *   2. 每家「暗牌 + 3 × 副露数」为 13（14 仅在轮到自己摸打时）；
 *   3. 四家点数 + 供托立直棒 = 100000；
 *   4. 岭上牌与开杠次数不超过 4；宝牌指示牌数量自洽。
 *
 * @param {object} state 对局状态
 * @returns {string[]} 违规说明数组（空数组 = 全部通过）
 */
export function checkInvariants(state) {
  const bad = [];
  const counts = countAllTiles(state);
  let total = 0;
  for (let t = 0; t < HAND_SIZE; t++) {
    total += counts[t];
    if (counts[t] > MAX_COPIES) bad.push(`牌种 ${t}（${tileToStr(t)}）全场出现 ${counts[t]} 张 > 4`);
  }
  if (total !== TILE_TOTAL) bad.push(`全场牌数 ${total} ≠ ${TILE_TOTAL}`);

  if (state.phase !== PHASES.IDLE) {
    // 处于「摸打窗口」的座位暗牌为 14 张：摸牌 / 鸣牌后打牌阶段是当前玩家；
    // 抢槓（暗杠 / 加杠）窗口里则是对应的开杠者（其副露尚未落定，仍是 14 张形）。
    const activeSeats = new Set();
    if ((state.phase === PHASES.DRAW || state.phase === PHASES.DISCARD) && state.turn !== null) {
      activeSeats.add(state.turn);
    }
    if (
      state.phase === PHASES.CLAIM &&
      state.claimContext !== null &&
      (state.claimContext.kind === 'ankan' || state.claimContext.kind === 'chankan')
    ) {
      activeSeats.add(state.claimContext.discarder);
    }
    for (const p of state.players) {
      const v = handValue(p);
      // 本局结束后和牌者手上仍是 14 张（和牌张未打出）→ 允许 13 或 14
      const settled = state.phase === PHASES.HAND_OVER || state.phase === PHASES.GAME_OVER;
      const expected = activeSeats.has(p.seat) ? 14 : 13;
      if (settled ? v < 13 || v > 14 : v !== expected) {
        bad.push(`座位 ${p.seat} 手牌价值张数 ${v} ≠ ${expected}（阶段 ${state.phase}）`);
      }
    }
  }

  const scoreSum = state.players.reduce((a, p) => a + p.score, 0) + state.riichiSticks * RIICHI_STICK_POINTS;
  if (scoreSum !== SCORE_TOTAL) bad.push(`点数总和 ${scoreSum} ≠ ${SCORE_TOTAL}`);
  for (const p of state.players) {
    if (!Number.isInteger(p.score)) bad.push(`座位 ${p.seat} 点数不是整数：${String(p.score)}`);
  }

  if (state.wall.rinshanIndex > state.wall.rinshan.length) bad.push('岭上牌索引越界');
  if (state.kanCount > MAX_KANS) bad.push(`开杠次数 ${state.kanCount} > ${MAX_KANS}`);
  if (state.doraIndicators.length !== 1 + state.kanDoraCount && state.phase !== PHASES.IDLE) {
    bad.push(`宝牌指示牌 ${state.doraIndicators.length} 张与杠宝牌计数 ${state.kanDoraCount} 不自洽`);
  }
  return bad;
}

/**
 * 给 AI 与 UI 用的只读快照（深拷贝 + 冻结顶层，改不动内部状态）。
 *
 * 隐藏信息规则：
 *   - 只暴露 `seat` 自己的暗牌、摸到的牌与立直听牌集合；
 *   - 其他人的 `pendingClaims` 只给出座位（谁在响应），**不给动作列表** ——
 *     动作列表会泄露「那家有和牌张 / 有对子」这类手牌信息（能鸣什么本身就是隐藏信息）；
 *   - 本局结束后（`hand_over` / `game_over`）才公开全部暗牌（荒牌流局时立直者需亮牌，§10.2）。
 * 需要热座（同一进程驱动多家）时直接使用 GameState 本体即可。
 *
 * @param {object} state 对局状态
 * @param {number} seat 观察者座位 0–3
 * @returns {object} 快照（顶层已 Object.freeze）
 */
export function viewFor(state, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) {
    throw new RangeError(`viewFor: seat 必须是 0–3 的整数，收到 ${String(seat)}`);
  }
  const revealAll = state.phase === PHASES.HAND_OVER || state.phase === PHASES.GAME_OVER;
  const players = state.players.map((p) => ({
    seat: p.seat,
    score: p.score,
    riichi: p.riichi,
    doubleRiichi: p.doubleRiichi,
    ippatsu: p.ippatsu,
    furiten: p.furiten,
    tempFuriten: p.tempFuriten,
    riichiFuriten: p.riichiFuriten,
    menzen: p.menzen,
    meldCount: p.melds.length,
    handCount: totalTiles(p.hand),
    melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
    pond: p.pond.slice(),
    pondCalled: p.pondCalled.slice(),
    tenpai: p.tenpai,
    drawnTile: p.seat === seat || revealAll ? p.drawnTile : null,
    hand: p.seat === seat || revealAll ? cloneHand(p.hand) : null,
    waits: p.seat === seat && p.riichiWaits !== null ? p.riichiWaits.slice() : null,
  }));
  const view = {
    seat,
    phase: state.phase,
    turn: state.turn,
    handNumber: state.handNumber,
    roundWind: state.roundWind,
    dealer: state.dealer,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    remainingTiles: state.wall.live.length,
    rinshanRemaining: state.wall.rinshan.length - state.wall.rinshanIndex,
    doraIndicators: state.doraIndicators.slice(),
    uraIndicators: state.uraIndicators.slice(),
    lastDiscard: state.lastDiscard === null ? null : { ...state.lastDiscard },
    pendingClaims: state.pendingClaims.map((x) => ({
      seat: x.seat,
      actions: x.seat === seat ? copyActions(x.actions) : [],
    })),
    result: state.result === null ? null : cloneResult(state.result),
    gameOver: state.gameOver,
    ranking: state.ranking === null ? null : state.ranking.map((x) => ({ ...x })),
    rules: state.rules,
    legalActions: legalActions(state, seat),
    players,
    self: players.find((p) => p.seat === seat),
  };
  return Object.freeze(view);
}

/**
 * 克隆本局结果（避免外部改动内部状态）。
 *
 * @param {object} result state.result
 * @returns {object} 克隆
 */
function cloneResult(result) {
  return {
    ...result,
    tenpai: result.tenpai ? result.tenpai.slice() : undefined,
    deltas: result.deltas ? result.deltas.slice() : undefined,
    payments: result.payments ? result.payments.map((x) => ({ ...x })) : undefined,
    nagashiSeats: result.nagashiSeats ? result.nagashiSeats.slice() : undefined,
    winners: result.winners
      ? result.winners.map((w) => ({
          ...w,
          hand: w.hand ? w.hand.slice() : undefined,
          melds: w.melds ? w.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })) : undefined,
          yaku: w.yaku ? w.yaku.map((y) => ({ ...y })) : undefined,
          deltas: w.deltas ? w.deltas.slice() : undefined,
          payments: w.payments
            ? { breakdown: w.payments.breakdown.map((b) => ({ ...b })), total: w.payments.total }
            : undefined,
        }))
      : undefined,
  };
}

/**
 * 某座位当前的听牌列表（供 AI / UI；形式听牌也算，§6.4）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {number[]} 听牌索引（升序）；形态不符时返回 []
 */
export function waitsFor(state, seat) {
  const p = state.players[seat];
  const h13 = concealed13(p);
  if (h13 === null) return [];
  return waitsOf(h13, p.melds.length);
}

/**
 * 某座位是否听牌（形式听牌也算，§6.4）。
 *
 * @param {object} state 对局状态
 * @param {number} seat 座位
 * @returns {boolean} 听牌返回 true
 */
export function isTenpaiSeat(state, seat) {
  return waitsFor(state, seat).length > 0;
}

/** 供调试 / 播报：座位是否处于包牌责任 */
export { isNagashiMangan, rank1Seat, computeRanking };
