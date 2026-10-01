/**
 * 日本麻将对局状态机 —— 牌山（壁牌 / 王牌 / 岭上牌）
 * =====================================================================
 *
 * 【规则依据】docs/rules.md
 *   - §3.1 配牌与牌山：牌山 136 张 = 17 墩 × 2 张 × 4 列；王牌 14 张（7 墩）不用于常规摸牌；
 *     岭上牌 = 王牌中最靠近开门位置的 2 墩 = 4 张；宝牌指示牌 = 开门位置起第 3 墩的上张，
 *     里宝牌指示牌 = 同墩的下张；可摸牌（壁牌）= 136 − 14 = 122 张。
 *   - §3.3 王牌与岭上牌：岭上牌仅 4 张 → 一局中开杠最大 4 次；第 5 次杠不得开出。
 *   - §3.5 宝牌：暗杠立即翻杠宝牌，明杠/加杠等摸岭上牌并打出 1 张后翻 → 杠宝牌指示牌最多 4 张，
 *     因此王牌里必须给「1 张初始宝牌 + 4 张杠宝牌」以及各自同墩下张的里宝牌留位置（共 10 张）。
 *   - §1.2 赤牌：雀魂四人段位场赤 5 万 / 赤 5 筒 / 赤 5 索各 1 张。
 *
 * 【牌表示】沿用引擎约定（engine/tiles.js 头部注释）：
 *   0–8 一萬～九萬 / 9–17 一筒～九筒 / 18–26 一索～九索 / 27–33 東南西北白發中；
 *   **34/35/36 作为赤 5m/5p/5s 的「物理身份」标记**在牌山里真实存在 —— 牌理引擎在入口会把它们
 *   归一到 4/13/22，所以赤牌的区分只由本模块与 game/state.js 维护（这样才能算赤宝牌）。
 *
 * 【王牌布局（dead，10 张）】数组下标即「墩序」：
 *   dead[0] 初始宝牌指示牌   dead[1] 初始里宝牌指示牌（同墩下张）
 *   dead[2] 第 1 张杠宝牌    dead[3] 第 1 张杠里宝牌
 *   dead[4] 第 2 张杠宝牌    dead[5] 第 2 张杠里宝牌
 *   dead[6] 第 3 张杠宝牌    dead[7] 第 3 张杠里宝牌
 *   dead[8] 第 4 张杠宝牌    dead[9] 第 4 张杠里宝牌
 */

import { HAND_SIZE, MAX_COPIES } from '../engine/tiles.js';

/** 可摸牌（壁牌）张数 @type {number} */
export const LIVE_WALL_SIZE = 122;
/** 岭上牌张数（四麻） @type {number} */
export const RINSHAN_SIZE = 4;
/** 王牌中除岭上牌之外的张数（宝牌 / 里宝牌 / 4 组杠宝牌及其里宝牌） @type {number} */
export const DEAD_WALL_SIZE = 10;
/** 全局牌张总数 @type {number} */
export const TOTAL_TILES = 136;
/** 一局内最多开杠次数（= 岭上牌张数，§3.3） @type {number} */
export const MAX_KANS = RINSHAN_SIZE;

/** dead 数组下标：初始宝牌指示牌 */
export const DEAD_DORA = 0;
/** dead 数组下标：初始里宝牌指示牌 */
export const DEAD_URA = 1;
/** dead 数组下标：第 k 张杠宝牌（k = 0..3） */
export const deadKanDoraIndex = (k) => 2 + 2 * k;
/** dead 数组下标：第 k 张杠里宝牌（k = 0..3） */
export const deadKanUraIndex = (k) => 3 + 2 * k;

/**
 * 生成可复现的伪随机数发生器（mulberry32）。
 *
 * 为什么自己实现而不用 Math.random：对局需要**可复现**（同一 seed 逐事件一致，用于回归测试与
 * 牌谱重放）。mulberry32 状态只有 32 位整数，可以整体写进 GameState.rngState 做快照 / 恢复。
 *
 * @param {number} [seed] 32 位整数种子；不传则取随机种子（不可复现）
 * @returns {(() => number) & {getState: () => number, setState: (v: number) => void}} rng：
 *   调用返回 [0,1) 的浮点数；`getState()` / `setState()` 用于快照
 * @throws {TypeError} seed 不是整数时抛出
 */
export function makeRng(seed) {
  let s;
  if (seed === undefined || seed === null) {
    s = Math.floor(Math.random() * 0x100000000);
  } else {
    if (!Number.isInteger(seed)) throw new TypeError(`makeRng: seed 必须是整数，收到 ${String(seed)}`);
    s = seed >>> 0;
  }
  if (s === 0) s = 0x9e3779b9; // 避免全 0 状态退化成常量序列

  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => s >>> 0;
  rng.setState = (v) => {
    if (!Number.isInteger(v)) throw new TypeError('makeRng.setState: 需要整数状态');
    s = v >>> 0;
  };
  return rng;
}

/**
 * Fisher–Yates 洗牌（返回新数组，不改入参）。
 *
 * @template T
 * @param {T[]} arr 待洗牌的数组
 * @param {() => number} rng 随机源，返回 [0,1)
 * @returns {T[]} 洗牌后的新数组
 * @throws {TypeError} 入参不是数组或 rng 不是函数时抛出
 */
export function shuffle(arr, rng) {
  if (!Array.isArray(arr)) throw new TypeError('shuffle: 需要数组');
  if (typeof rng !== 'function') throw new TypeError('shuffle: rng 必须是函数');
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const k = j < 0 ? 0 : j > i ? i : j; // 防御：注入的 rng 越界时钳制，保证不产生空洞
    const tmp = out[i];
    out[i] = out[k];
    out[k] = tmp;
  }
  return out;
}

/**
 * 生成一副完整的 136 张牌（含赤牌物理身份）。
 *
 * @param {{m?: number, p?: number, s?: number}} [aka] 各花色赤 5 的张数（0–4）；
 *   缺省 = 雀魂四人段位场 {m:1,p:1,s:1}（rules.md §1.2）
 * @returns {number[]} 长度 136 的牌索引数组（赤 5 记为 34/35/36）
 * @throws {RangeError} 赤牌张数非法时抛出
 */
export function fullTileSet(aka) {
  const spec = aka === undefined || aka === null ? { m: 1, p: 1, s: 1 } : aka;
  if (typeof spec !== 'object') throw new TypeError('fullTileSet: aka 必须是 {m,p,s} 对象');
  const red = [spec.m === undefined ? 0 : spec.m, spec.p === undefined ? 0 : spec.p, spec.s === undefined ? 0 : spec.s];
  const tiles = [];
  for (let t = 0; t < HAND_SIZE; t++) {
    // 5m/5p/5s 分别是 4/13/22，赤牌别名 34/35/36
    const suit = t < 9 ? 0 : t < 18 ? 1 : t < 27 ? 2 : -1;
    const isFive = suit >= 0 && t % 9 === 4;
    let reds = 0;
    if (isFive) {
      reds = red[suit];
      if (!Number.isInteger(reds) || reds < 0 || reds > MAX_COPIES) {
        throw new RangeError(`fullTileSet: 赤 5 张数必须是 0–4 的整数，收到 ${String(reds)}`);
      }
    }
    for (let k = 0; k < MAX_COPIES; k++) tiles.push(k < reds ? 34 + suit : t);
  }
  if (tiles.length !== TOTAL_TILES) {
    throw new RangeError(`fullTileSet: 牌张总数应为 ${TOTAL_TILES}，实际 ${tiles.length}`);
  }
  return tiles;
}

/**
 * 构建牌山：洗牌后切成「可摸牌 / 岭上牌 / 王牌」三段。
 *
 * @param {() => number} rng 随机源（makeRng 的产物）
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集；本函数只读取可选的
 *   `rules.akaDora`（扩展键，不参与 engine/rules.js 校验），未提供时用 options.aka
 * @param {{aka?: {m?: number, p?: number, s?: number}}} [options] 选项
 * @returns {{live: number[], dead: number[], rinshan: number[]}}
 *   - `live` 122 张，按摸牌顺序排列（数组头部即下一张）
 *   - `rinshan` 4 张岭上牌，按开杠顺序排列
 *   - `dead` 10 张王牌（布局见文件头注释）
 * @throws {TypeError} rng 不是函数时抛出
 * @example
 *   const wall = buildWall(makeRng(42), undefined);
 *   wall.live.length; // 122
 */
export function buildWall(rng, rules, options) {
  if (typeof rng !== 'function') throw new TypeError('buildWall: rng 必须是函数');
  const opts = options === undefined || options === null ? {} : options;
  const akaFromRules = rules !== undefined && rules !== null ? rules.akaDora : undefined;
  const tiles = shuffle(fullTileSet(opts.aka === undefined ? akaFromRules : opts.aka), rng);
  return {
    live: tiles.slice(0, LIVE_WALL_SIZE),
    rinshan: tiles.slice(LIVE_WALL_SIZE, LIVE_WALL_SIZE + RINSHAN_SIZE),
    dead: tiles.slice(LIVE_WALL_SIZE + RINSHAN_SIZE),
  };
}

/**
 * 取第 k 张杠宝牌指示牌（k = 0..3，对应第 k+1 次开杠）。
 *
 * @param {number[]} dead 王牌数组（10 张）
 * @param {number} k 杠序号（0 起）
 * @returns {number} 宝牌指示牌索引
 * @throws {RangeError} k 越界或 dead 长度不足时抛出
 */
export function kanDoraIndicator(dead, k) {
  if (!Array.isArray(dead) || dead.length < DEAD_WALL_SIZE) {
    throw new RangeError(`kanDoraIndicator: dead 必须是长度 ${DEAD_WALL_SIZE} 的数组`);
  }
  if (!Number.isInteger(k) || k < 0 || k > 3) throw new RangeError(`kanDoraIndicator: k 必须是 0–3，收到 ${String(k)}`);
  return dead[deadKanDoraIndex(k)];
}

/**
 * 取第 k 张杠里宝牌指示牌（与杠宝牌同墩下张）。
 *
 * @param {number[]} dead 王牌数组（10 张）
 * @param {number} k 杠序号（0 起）
 * @returns {number} 里宝牌指示牌索引
 * @throws {RangeError} k 越界或 dead 长度不足时抛出
 */
export function kanUraIndicator(dead, k) {
  if (!Array.isArray(dead) || dead.length < DEAD_WALL_SIZE) {
    throw new RangeError(`kanUraIndicator: dead 必须是长度 ${DEAD_WALL_SIZE} 的数组`);
  }
  if (!Number.isInteger(k) || k < 0 || k > 3) throw new RangeError(`kanUraIndicator: k 必须是 0–3，收到 ${String(k)}`);
  return dead[deadKanUraIndex(k)];
}
