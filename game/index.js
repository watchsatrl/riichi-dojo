/**
 * 日本麻将对局状态机 —— 统一出口
 * =====================================================================
 *
 * 用法：
 * ```js
 * import { createGame, startHand, legalActions, applyAction, viewFor, isHandOver } from './game/index.js';
 *
 * const state = createGame({ seed: 42 });      // 默认雀魂四人段位场规则
 * let events = startHand(state);
 * while (!isHandOver(state)) {
 *   const seat = currentSeat(state);
 *   const actions = legalActions(state, seat);
 *   events = applyAction(state, seat, actions[0]);   // UI / AI 在这里挑选动作
 * }
 * ```
 *
 * 【模块划分】
 *   - `wall.js`    牌山：洗牌 / 配牌素材 / 岭上 / 王牌与宝牌指示牌
 *   - `actions.js` 合法动作生成与校验（纯函数）
 *   - `settle.js`  和了 / 流局的点数结算与连庄判定
 *   - `state.js`   状态主体与 API（createGame / startHand / legalActions / applyAction / viewFor）
 */

export {
  buildWall,
  shuffle,
  makeRng,
  fullTileSet,
  kanDoraIndicator,
  kanUraIndicator,
  LIVE_WALL_SIZE,
  RINSHAN_SIZE,
  DEAD_WALL_SIZE,
  TOTAL_TILES,
  MAX_KANS,
  DEAD_DORA,
  DEAD_URA,
  deadKanDoraIndex,
  deadKanUraIndex,
} from './wall.js';

export {
  waitsOf,
  isTenpaiShape,
  sameWaitSet,
  chiOptions,
  canPon,
  canMinkan,
  ankanTiles,
  kakanTiles,
  isKuikae,
  kuikaeForbiddenTiles,
  distinctYaochuKinds,
  discardCandidates,
  normalizeAction,
  actionKey,
  sameAction,
  findAction,
  describeAction,
} from './actions.js';

export {
  settleWin,
  settleDraw,
  advanceHand,
  isNagashiMangan,
  seatWindOf,
  renchanOf,
  rank1Seat,
  computeRanking,
  PAO_YAKU,
} from './settle.js';

export {
  createGame,
  startHand,
  currentSeat,
  legalActions,
  applyAction,
  isHandOver,
  isGameOver,
  viewFor,
  countAllTiles,
  checkInvariants,
  waitsFor,
  isTenpaiSeat,
  isSuukaikanPending,
  PHASES,
  DEFAULT_OPTIONS,
  TILE_TOTAL,
  SCORE_TOTAL,
} from './state.js';
