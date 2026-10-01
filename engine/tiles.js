/**
 * 日本麻将牌理引擎 —— 牌的表示与基础工具
 * =====================================================================
 *
 * 【索引约定（全引擎统一，请勿更改）】
 *   0 –  8 : 一萬 ～ 九萬   (m)
 *   9 – 17 : 一筒 ～ 九筒   (p)
 *  18 – 26 : 一索 ～ 九索   (s)
 *  27 – 33 : 東 南 西 北 白 發 中 (z)，字牌顺序即番符表顺序
 *  34 / 35 / 36 : 赤 5m / 赤 5p / 赤 5s
 *
 * 【赤牌约定】
 *   赤牌（34/35/36）只是“输入别名”。本模块不区分赤牌，所有公开函数在入口
 *   通过 normalizeHand() / normalizeIndex() 把 34/35/36 归一到 4/13/22。
 *   赤牌与普通 5 在计数数组里完全等价；赤ドラ 的区分留给将来的算ドラ模块。
 *
 * 【手牌约定】
 *   手牌统一为长度 34 的计数数组 number[34]（每项 0–4，表示该种牌的张数）。
 *   所有接收手牌的牌理函数（agari / shanten / waits），传入的计数数组
 *   **只包含暗牌部分**；副露用单独的 melds 数组传入，并用 meldCount = melds.length
 *   表达“已固定的面子数”。需要“整手牌”视角（暗牌 + 副露展开）时用 handWithMelds()。
 *
 * 【副露约定】
 *   meld = { type: 'chi'|'pon'|'minkan'|'ankan'|'kakan', tiles: number[] }
 *     chi    : 3 张顺子（升序），如 [0,1,2]
 *     pon    : 3 张相同
 *     minkan : 4 张相同（大明杠）
 *     ankan  : 4 张相同（暗杠）
 *     kakan  : 4 张相同（加杠）
 *   无论哪种副露，在“面子数”意义上一律算 1 个面子。
 */

/** 萬子花色编号 @type {number} */
export const SUIT_M = 0;
/** 筒子花色编号 @type {number} */
export const SUIT_P = 1;
/** 索子花色编号 @type {number} */
export const SUIT_S = 2;
/** 字牌花色编号 @type {number} */
export const SUIT_Z = 3;

/** 牌种类总数（不含赤） @type {number} */
export const NUM_TILE_TYPES = 34;
/** 计数数组的规范长度 @type {number} */
export const HAND_SIZE = 34;
/** 计数数组（含赤槽位）的最大长度 @type {number} */
export const HAND_SIZE_WITH_RED = 37;

/** 赤 5m 的输入别名索引 @type {number} */
export const RED_5M = 34;
/** 赤 5p 的输入别名索引 @type {number} */
export const RED_5P = 35;
/** 赤 5s 的输入别名索引 @type {number} */
export const RED_5S = 36;

/** 字牌起始索引 @type {number} */
export const HONOR_START = 27;
/** 每种牌的最大张数 @type {number} */
export const MAX_COPIES = 4;

/** 花色字母 → 花色编号 */
const SUIT_BY_CHAR = { m: SUIT_M, p: SUIT_P, s: SUIT_S, z: SUIT_Z };
/** 花色编号 → 花色字母 */
const CHAR_BY_SUIT = ['m', 'p', 's', 'z'];

/**
 * 把 34/35/36（赤牌别名）归一到 4/13/22；其余索引原样返回。
 *
 * @param {number} idx 牌索引（0–36，允许 34/35/36 表示赤 5）
 * @returns {number} 归一化后的牌索引（0–33）
 * @throws {RangeError} 索引不是 0–36 的整数时抛出
 */
export function normalizeIndex(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= HAND_SIZE_WITH_RED) {
    throw new RangeError(`牌索引必须是 0–36 的整数，收到 ${String(idx)}`);
  }
  if (idx === RED_5M) return 4;
  if (idx === RED_5P) return 13;
  if (idx === RED_5S) return 22;
  return idx;
}

/**
 * 把手牌计数数组归一化为规范的 number[34]（新数组，不修改入参）。
 *
 * 接受长度 34 的数组；也接受长度 ≥ 35 的数组（第 35–37 项为赤 5m/5p/5s），
 * 此时赤牌张数会被并入对应的普通 5。返回的数组长度固定为 34。
 *
 * @param {ArrayLike<number>} count 手牌计数数组（number[34] 或 number[37]）
 * @returns {number[]} 长度 34 的新计数数组
 * @throws {TypeError} 入参不是数组或长度不足 34 时抛出
 * @throws {RangeError} 计数值不是 0–4 的整数时抛出
 */
export function normalizeHand(count) {
  if (count === null || typeof count !== 'object' || typeof count.length !== 'number') {
    throw new TypeError('normalizeHand: 需要长度 ≥ 34 的计数数组');
  }
  if (count.length < HAND_SIZE) {
    throw new TypeError(`normalizeHand: 计数数组长度必须 ≥ 34，收到 ${count.length}`);
  }
  const out = new Array(HAND_SIZE);
  for (let i = 0; i < HAND_SIZE; i++) {
    const n = count[i] === undefined ? 0 : count[i];
    if (!Number.isInteger(n) || n < 0 || n > MAX_COPIES) {
      throw new RangeError(`normalizeHand: 第 ${i} 项计数非法（${String(n)}），应为 0–4 的整数`);
    }
    out[i] = n;
  }
  // 赤牌归一：34 → 4，35 → 13，36 → 22
  for (let i = HAND_SIZE; i < Math.min(count.length, HAND_SIZE_WITH_RED); i++) {
    const n = count[i] === undefined ? 0 : count[i];
    if (!Number.isInteger(n) || n < 0 || n > MAX_COPIES) {
      throw new RangeError(`normalizeHand: 第 ${i} 项（赤牌槽位）计数非法（${String(n)}）`);
    }
    if (n === 0) continue;
    const target = normalizeIndex(i);
    out[target] += n;
    if (out[target] > MAX_COPIES) {
      throw new RangeError(`normalizeHand: 赤牌并入后第 ${target} 项超过 4 张`);
    }
  }
  return out;
}

/**
 * 新建一个全 0 的手牌计数数组。
 *
 * @returns {number[]} 长度 34、全 0 的计数数组
 */
export function emptyHand() {
  return new Array(HAND_SIZE).fill(0);
}

/**
 * 统计手牌总张数。
 *
 * @param {ArrayLike<number>} count 手牌计数数组（只统计前 34 项）
 * @returns {number} 总张数
 */
export function totalTiles(count) {
  let sum = 0;
  const n = Math.min(count.length, HAND_SIZE);
  for (let i = 0; i < n; i++) sum += count[i];
  return sum;
}

/**
 * 复制手牌计数数组（只取前 34 项，赤牌槽位被忽略）。
 *
 * @param {ArrayLike<number>} count 手牌计数数组
 * @returns {number[]} 长度 34 的新数组
 */
export function cloneHand(count) {
  const out = new Array(HAND_SIZE);
  for (let i = 0; i < HAND_SIZE; i++) out[i] = count[i] === undefined ? 0 : count[i];
  return out;
}

/**
 * 返回牌索引所属花色。
 *
 * @param {number} idx 牌索引（允许 34/35/36）
 * @returns {number} 0=萬 1=筒 2=索 3=字
 */
export function suitOf(idx) {
  const i = normalizeIndex(idx);
  if (i < 9) return SUIT_M;
  if (i < 18) return SUIT_P;
  if (i < 27) return SUIT_S;
  return SUIT_Z;
}

/**
 * 返回牌在花色内的序号（数牌 1–9，字牌 1–7：東=1 … 中=7）。
 *
 * @param {number} idx 牌索引（允许 34/35/36，赤 5 返回 5）
 * @returns {number} 1–9（数牌）或 1–7（字牌）
 */
export function rankOf(idx) {
  const i = normalizeIndex(idx);
  if (i < 27) return (i % 9) + 1;
  return i - HONOR_START + 1;
}

/**
 * 是否为字牌。
 *
 * @param {number} idx 牌索引（允许 34/35/36）
 * @returns {boolean} 字牌返回 true
 */
export function isHonor(idx) {
  return normalizeIndex(idx) >= HONOR_START;
}

/**
 * 是否为老头牌（数牌的 1 或 9）。
 *
 * @param {number} idx 牌索引（允许 34/35/36）
 * @returns {boolean} 老头牌返回 true
 */
export function isTerminal(idx) {
  const i = normalizeIndex(idx);
  if (i >= HONOR_START) return false;
  const r = (i % 9) + 1;
  return r === 1 || r === 9;
}

/**
 * 是否为幺九牌（老头牌 + 字牌）。
 *
 * @param {number} idx 牌索引（允许 34/35/36）
 * @returns {boolean} 幺九牌返回 true
 */
export function isYaochu(idx) {
  const i = normalizeIndex(idx);
  return i >= HONOR_START || isTerminal(i);
}

/**
 * 是否为中张牌（数牌 2–8）。
 *
 * @param {number} idx 牌索引（允许 34/35/36）
 * @returns {boolean} 中张牌返回 true
 */
export function isSimple(idx) {
  return !isYaochu(idx);
}

/**
 * 牌索引 → 日麻惯用字符串。
 *
 * 例：4 → "5m"；8 → "9m"；27 → "1z"（東）；33 → "7z"（中）；
 *     34 → "0m"（赤 5m）、35 → "0p"、36 → "0s"。
 *
 * @param {number} idx 牌索引（0–36）
 * @returns {string} 形如 "5m" / "0m" / "1z" 的字符串
 * @throws {RangeError} 索引越界时抛出
 */
export function tileToStr(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= HAND_SIZE_WITH_RED) {
    throw new RangeError(`tileToStr: 牌索引必须是 0–36 的整数，收到 ${String(idx)}`);
  }
  if (idx >= HAND_SIZE) {
    // 赤 5
    return `0${CHAR_BY_SUIT[idx - 34]}`;
  }
  return `${rankOf(idx)}${CHAR_BY_SUIT[suitOf(idx)]}`;
}

/**
 * 日麻字符串 → 牌索引（"5m" → 4，"0m" → 34）。
 *
 * @param {string} str 形如 "5m" / "0m" / "1z" 的字符串（花色字母大小写皆可）
 * @returns {number} 牌索引 0–36
 * @throws {TypeError|RangeError} 格式非法时抛出
 */
export function strToTile(str) {
  if (typeof str !== 'string') throw new TypeError('strToTile: 需要字符串');
  const s = str.trim();
  const m = /^([0-9])\s*([mpszMPSZ])$/.exec(s);
  if (!m) throw new RangeError(`strToTile: 无法解析 "${str}"`);
  const digit = Number(m[1]);
  const suit = SUIT_BY_CHAR[m[2].toLowerCase()];
  if (digit === 0) {
    if (suit === SUIT_Z) throw new RangeError(`strToTile: 字牌没有 0（"${str}"）`);
    return 34 + suit; // 赤 5m/5p/5s → 34/35/36
  }
  if (suit === SUIT_Z && digit > 7) throw new RangeError(`strToTile: 字牌只有 1–7（"${str}"）`);
  return suit * 9 + digit - 1;
}

/**
 * 解析日麻标准记法手牌 → 计数数组。
 *
 * 支持：
 *   - 后缀式连写："123m456p789s11222z"
 *   - 单张后缀式："1m2m3m"（与 "123m" 等价）
 *   - 赤牌 "0m" / "0p" / "0s"（归一到 5m/5p/5s，本模块不区分赤）
 *   - 空白、半角/全角逗号会被忽略
 * 花色字母顺序不限，同一花色可出现多次。
 *
 * @param {string} str 手牌字符串
 * @returns {number[]} 长度 34 的计数数组（赤牌已归一）
 * @throws {TypeError|RangeError} 语法非法或某种牌超过 4 张时抛出
 */
export function parseHand(str) {
  if (typeof str !== 'string') throw new TypeError('parseHand: 需要字符串');
  const s = str.replace(/[\s,，、]/g, '');
  const hand = emptyHand();
  let pending = [];
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      pending.push(ch);
      continue;
    }
    const suit = SUIT_BY_CHAR[ch.toLowerCase()];
    if (suit === undefined) throw new RangeError(`parseHand: 非法字符 "${ch}"`);
    for (const d of pending) {
      const digit = Number(d);
      if (digit === 0 && suit === SUIT_Z) throw new RangeError('parseHand: 字牌没有 0z');
      if (suit === SUIT_Z && digit > 7) throw new RangeError(`parseHand: 字牌只有 1–7，收到 "${d}z"`);
      const idx = digit === 0 ? 34 + suit : suit * 9 + digit - 1;
      const target = normalizeIndex(idx);
      hand[target] += 1;
      if (hand[target] > MAX_COPIES) {
        throw new RangeError(`parseHand: ${tileToStr(target)} 超过 4 张`);
      }
    }
    pending = [];
  }
  if (pending.length > 0) throw new RangeError('parseHand: 结尾有多余数字，缺少花色字母');
  return hand;
}

/**
 * 计数数组 → 日麻标准记法字符串（按 m p s z 顺序、番号升序输出）。
 *
 * 例：parseHand("123m456p789s11222z") → "123m456p789s11222z"。
 * 注意：计数数组只有 34 项，无法表达赤牌，故输出中不会出现 "0m"。
 *
 * @param {ArrayLike<number>} count 手牌计数数组
 * @returns {string} 手牌字符串（空手牌返回 ""）
 */
export function handToStr(count) {
  let out = '';
  for (let s = 0; s < 4; s++) {
    const start = s * 9;
    const len = s === SUIT_Z ? 7 : 9;
    let digits = '';
    for (let k = 0; k < len; k++) {
      const n = count[start + k] === undefined ? 0 : count[start + k];
      for (let c = 0; c < n; c++) digits += String(k + 1);
    }
    if (digits.length > 0) out += digits + CHAR_BY_SUIT[s];
  }
  return out;
}

/**
 * 宝牌指示牌 → 宝牌。
 *
 * 数牌：1→2→…→9→1（同花色内循环）。
 * 字牌：风牌与三元牌**各自循环**
 *   東→南→西→北→東（北的宝牌是東）
 *   白→發→中→白（中的宝牌是白）
 *
 * @param {number} idx 指示牌索引（允许 34/35/36，赤 5 按 5 处理）
 * @returns {number} 对应的宝牌索引（0–33）
 */
export function doraFromIndicator(idx) {
  const i = normalizeIndex(idx);
  if (i >= HONOR_START) {
    // 风牌 27–30（東南西北，4 张一循环）
    if (i < 31) return HONOR_START + ((i - HONOR_START + 1) % 4);
    // 三元牌 31–33（白發中，3 张一循环）
    return 31 + ((i - 31 + 1) % 3);
  }
  const suit = Math.floor(i / 9);
  const rank = i % 9; // 0–8
  return suit * 9 + ((rank + 1) % 9);
}

/**
 * 在手牌中加入若干张牌（就地修改并返回同一数组）。
 *
 * @param {number[]} count 手牌计数数组（会被修改）
 * @param {number} idx 牌索引（允许 34/35/36，会被归一）
 * @param {number} [n=1] 加入张数
 * @returns {number[]} 传入的 count（便于链式调用）
 * @throws {RangeError} 加入后超过 4 张时抛出
 */
export function addTile(count, idx, n = 1) {
  const i = normalizeIndex(idx);
  if (!Number.isInteger(n) || n < 0) throw new RangeError('addTile: 张数必须是非负整数');
  const next = (count[i] || 0) + n;
  if (next > MAX_COPIES) {
    throw new RangeError(`addTile: ${tileToStr(i)} 超过 4 张（${next}）`);
  }
  count[i] = next;
  return count;
}

/**
 * 从手牌中移除若干张牌（就地修改并返回同一数组）。
 *
 * @param {number[]} count 手牌计数数组（会被修改）
 * @param {number} idx 牌索引（允许 34/35/36，会被归一）
 * @param {number} [n=1] 移除张数
 * @returns {number[]} 传入的 count
 * @throws {RangeError} 移除后为负数时抛出
 */
export function removeTile(count, idx, n = 1) {
  const i = normalizeIndex(idx);
  if (!Number.isInteger(n) || n < 0) throw new RangeError('removeTile: 张数必须是非负整数');
  const next = (count[i] || 0) - n;
  if (next < 0) throw new RangeError(`removeTile: ${tileToStr(i)} 数量不足`);
  count[i] = next;
  return count;
}

/**
 * 校验副露数组的结构（不检查牌理合法性，只检查形状与本模块的约定）。
 *
 * @param {Array<{type: string, tiles: number[]}>} melds 副露数组
 * @returns {Array<{type: string, tiles: number[]}>} 原样返回
 * @throws {TypeError|RangeError} 结构非法时抛出
 */
export function validateMelds(melds) {
  if (!Array.isArray(melds)) throw new TypeError('validateMelds: melds 必须是数组');
  for (const meld of melds) {
    if (meld === null || typeof meld !== 'object') throw new TypeError('validateMelds: 每个副露必须是对象');
    const { type, tiles } = meld;
    if (!Array.isArray(tiles)) throw new TypeError('validateMelds: meld.tiles 必须是数组');
    const size = type === 'chi' || type === 'pon' ? 3 : 4;
    if (type !== 'chi' && type !== 'pon' && type !== 'minkan' && type !== 'ankan' && type !== 'kakan') {
      throw new RangeError(`validateMelds: 未知副露类型 "${String(type)}"`);
    }
    if (tiles.length !== size) {
      throw new RangeError(`validateMelds: ${type} 需要 ${size} 张，收到 ${tiles.length} 张`);
    }
    for (let k = 0; k < tiles.length; k++) normalizeIndex(tiles[k]);
    if (type !== 'chi') {
      const first = normalizeIndex(tiles[0]);
      for (const t of tiles) {
        if (normalizeIndex(t) !== first) throw new RangeError(`validateMelds: ${type} 的牌必须相同`);
      }
    }
  }
  return melds;
}

/**
 * 统计副露中各牌占用的张数（用于计算进张剩余枚数）。
 *
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组
 * @returns {number[]} 长度 34 的计数数组
 */
export function meldTileCounts(melds = []) {
  validateMelds(melds);
  const out = emptyHand();
  for (const meld of melds) {
    for (const t of meld.tiles) out[normalizeIndex(t)] += 1;
  }
  return out;
}

/**
 * 把副露展开进计数数组，得到“整手牌”（暗牌 + 副露）视角。
 *
 * 注意：牌理计算（和牌分解 / 向听 / 进张）应当使用“暗牌 + meldCount”的视角，
 * 本函数只用于展示、ドラ 计数、或与外部数据对接。
 *
 * @param {ArrayLike<number>} hand 暗牌计数数组
 * @param {Array<{type: string, tiles: number[]}>} [melds] 副露数组
 * @returns {number[]} 长度 34 的整手牌计数数组（新数组）
 * @throws {RangeError} 展开后某种牌超过 4 张时抛出
 */
export function handWithMelds(hand, melds = []) {
  const out = normalizeHand(hand);
  validateMelds(melds);
  for (const meld of melds) {
    for (const t of meld.tiles) {
      const i = normalizeIndex(t);
      out[i] += 1;
      if (out[i] > MAX_COPIES) {
        throw new RangeError(`handWithMelds: ${tileToStr(i)} 超过 4 张`);
      }
    }
  }
  return out;
}
