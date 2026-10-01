import { HAND_SIZE, HONOR_START, normalizeHand, normalizeIndex, tileToStr, validateMelds } from './tiles.js';
import { isChiitoi, isKokushi } from './agari.js';
import { RENFON_PAIR_FU, resolveRules } from './rules.js';
/**
 * 日本麻将牌理引擎 —— 符数计算（符計算）
 * =====================================================================
 *
 * 【规则依据】research/yaku-fu-score.md §2 全节 + §1.8(6)（荣和补成的刻子算明刻）
 *   + §4 实现陷阱 ①②⑥⑦⑧⑨。
 *
 * 【依赖方向（重要）】
 *   fu.js 只依赖 tiles.js / agari.js / rules.js；yaku.js **单向**依赖 fu.js。
 *   这样安排是因为符数计算与役种判定都要用到同一套「面子统一视图」和「听牌形分类」，
 *   把基础视图放在 fu.js 可以彻底避免两个模块互相 import（循环引用）。
 *
 * 【符数约定（全部来自 §2，与主流平台一致）】
 *   - 副底 +20；门清荣和 +10（暗杠不算副露，故有暗杠仍是门清）；自摸 +2（岭上开花同样 +2）
 *   - 听牌符：单骑 / 嵌张 / 边张 +2，两面 / 双碰 0
 *   - 雀头符：三元牌 +2、自风 +2、场风 +2 → **连风牌 4 符**（`rules.renfonPairFu` 可改 2）
 *   - 面子符：中张明刻 2 / 幺九明刻 4 / 中张暗刻 4 / 幺九暗刻 8；
 *             中张明槓 8 / 幺九明槓 16 / 中张暗槓 16 / 幺九暗槓 32
 *   - **荣和补成的刻子按明刻计**（天凤原文 `ロン和了で完成した刻子は明刻子とし順子は暗順子とする`）
 *   - 平和自摸固定 **20** 符（舍弃自摸 2 符）；七对子固定 **25** 符（不做切上、不加任何附加符）
 *   - 一般形总符不足 30 时抬到 **30**（副露平和形荣和 20 → 30、自摸 22 → 30）
 *   - 其余一律**向上**取整到 10（32 → 40、102 → 110；不是四舍五入）
 *   - 役满不参与符计算（返回 `{fu: 0, raw: 0, isFixed: true}`）
 *
 * 【本模块导出的三类 API】
 *   1. 符数计算：`calcFu()`
 *   2. 和牌形基础视图：`buildHandView()` / `enumerateWinRoles()` / `classifyWinTile()`
 *      —— 供 yaku.js 复用（面子统一视图、和牌张角色、听牌形）
 *   3. 平和判定：`isPinfu()`（平和既是役也决定「平和自摸 20 符」，两处必须同一口径）
 */


/** 三元牌起始索引（白=31 發=32 中=33） @type {number} */
const DRAGON_START = 31;
/** 东（场风 / 自风的最小索引） @type {number} */
const WIND_EAST = 27;
/** 北（场风 / 自风的最大索引） @type {number} */
const WIND_NORTH = 30;

/** 平和自摸的固定符 @type {number} */
export const PINFU_TSUMO_FU = 20;
/** 七对子的固定符 @type {number} */
export const CHIITOI_FU = 25;
/** 一般形（4 面子 1 雀头）的最低符 @type {number} */
export const MIN_STANDARD_FU = 30;
/** 副底 @type {number} */
export const BASE_FU = 20;
/** 门清荣和加符 @type {number} */
export const MENZEN_RON_FU = 10;
/** 自摸加符 @type {number} */
export const TSUMO_FU = 2;

/** 风牌的中文名 @type {Record<number, string>} */
const WIND_NAMES = Object.freeze({ 27: '東', 28: '南', 29: '西', 30: '北' });
/** 三元牌的中文名 @type {Record<number, string>} */
const DRAGON_NAMES = Object.freeze({ 31: '白', 32: '發', 33: '中' });

/**
 * @typedef {Object} MentsuView
 * @property {'shuntsu'|'koutsu'|'kantsu'} kind 顺子 / 刻子 / 槓子
 * @property {number} tile 顺子=最小牌索引；刻子·槓子=该牌索引
 * @property {number[]} tiles 组成该面子的牌索引（顺子升序、刻子重复、槓子 4 张）
 * @property {boolean} concealed 是否暗面（暗刻 / 暗槓 true；副露 false；荣和补成的刻子 false）
 * @property {boolean} isKan 是否为槓子
 * @property {boolean} open 是否属于副露（吃 / 碰 / 明槓 / 加槓）
 * @property {'meld'|'decom'} source 来自副露数组还是 decomposeStandard 的拆解结果
 * @property {string} [meldType] 副露原始类型（chi/pon/minkan/ankan/kakan）
 * @property {boolean} [ronCompleted] 是否由荣和补成（用于教学提示）
 */

/**
 * @typedef {Object} HandView
 * @property {number} pair 雀头牌索引
 * @property {MentsuView[]} mentsu 统一面子视图，长度 4（副露在前、暗牌拆解在后）
 * @property {boolean} isMenzen 是否门清（只要没有吃碰明槓加槓就是门清，暗杠不破坏门清）
 * @property {number} meldCount 副露数
 * @property {number} role 生效的和牌张角色（-1 = 和牌张补成雀头）
 */

/**
 * @typedef {Object} WaitInfo
 * @property {'tanki'|'kanchan'|'penchan'|'ryanmen'|'shanpon'} type 听牌形
 * @property {number} fu 听牌符（0 或 2）
 * @property {string} label 中文名
 * @property {boolean} ryanmen 是否两面听（平和条件之一）
 * @property {string} desc 说明
 */

/**
 * @typedef {Object} FuItem
 * @property {string} label 加符项名称（中文，供教程直接显示）
 * @property {number} fu 该项符数
 * @property {string} [note] 备注（为什么这么算）
 */

/**
 * @typedef {Object} FuResult
 * @property {number} fu 最终符数（已切上到 10，或特殊固定值 20 / 25 / 0）
 * @property {number} raw 加符项合计（未做「向上取整到 10」；特殊固定时可能不等于 fu）
 * @property {FuItem[]} items 逐项明细（教程用）
 * @property {boolean} isFixed 是否被规则固定为特殊值（平和自摸 20 / 七对子 25 / 役满 0）
 */

/**
 * 归一化并校验 Context（fu.js 与 yaku.js 共用的入口校验）。
 *
 * 只做形状与取值校验，不做「是否和牌形」的业务判定；缺省的可选字段一律补成安全默认值，
 * 因此调用方只需要提供 `hand` / `melds` / `winTile` 三样必需信息。
 *
 * @param {object} ctx 和牌上下文（见 detectYaku 的 Context 约定）
 * @returns {object} 归一化后的新对象（不修改入参）
 * @throws {TypeError|RangeError} 形状非法（手牌不是 34 计数数组、副露结构错误、场风自风越界）时抛出
 */
export function normalizeContext(ctx) {
  if (ctx === null || typeof ctx !== 'object') {
    throw new TypeError('normalizeContext: ctx 必须是对象');
  }
  if (ctx.hand === undefined) throw new TypeError('normalizeContext: ctx.hand 缺失');
  if (ctx.winTile === undefined) throw new TypeError('normalizeContext: ctx.winTile 缺失');
  const hand = normalizeHand(ctx.hand);
  const melds = (ctx.melds === undefined || ctx.melds === null ? [] : validateMelds(ctx.melds)).map(
    (m) => ({ type: m.type, tiles: m.tiles.map(normalizeIndex) }),
  );
  const roundWind = toWind(ctx.roundWind, 'roundWind');
  const seatWind = toWind(ctx.seatWind, 'seatWind');
  return {
    hand,
    melds,
    winTile: normalizeIndex(ctx.winTile),
    isTsumo: ctx.isTsumo === true,
    roundWind,
    seatWind,
    isRiichi: ctx.isRiichi === true,
    isDoubleRiichi: ctx.isDoubleRiichi === true,
    isIppatsu: ctx.isIppatsu === true,
    isChankan: ctx.isChankan === true,
    chankanIsAnkan: ctx.chankanIsAnkan === true,
    isRinshan: ctx.isRinshan === true,
    isHaitei: ctx.isHaitei === true,
    isHoutei: ctx.isHoutei === true,
    isTenhou: ctx.isTenhou === true,
    isChiihou: ctx.isChiihou === true,
    isRenhou: ctx.isRenhou === true,
    doraIndicators: toIndexArray(ctx.doraIndicators, 'doraIndicators'),
    uraIndicators: toIndexArray(ctx.uraIndicators, 'uraIndicators'),
    redCount: toCount(ctx.redCount, 'redCount'),
    isNagashiMangan: ctx.isNagashiMangan === true,
    yakumanCount: toCount(ctx.yakumanCount, 'yakumanCount'),
  };
}

/**
 * 校验并归一风牌索引。
 *
 * @param {unknown} value 场风 / 自风
 * @param {string} name 字段名（报错用）
 * @returns {number} 27–30
 * @throws {RangeError} 非 27–30 的整数时抛出
 */
function toWind(value, name) {
  const v = value === undefined || value === null ? WIND_EAST : value;
  if (!Number.isInteger(v) || v < WIND_EAST || v > WIND_NORTH) {
    throw new RangeError(`normalizeContext: ${name} 必须是 27–30（東南西北），收到 ${String(value)}`);
  }
  return v;
}

/**
 * 校验并归一牌索引数组（宝牌指示牌等）。
 *
 * @param {unknown} value 数组或空
 * @param {string} name 字段名
 * @returns {number[]} 归一化后的索引数组
 * @throws {TypeError|RangeError} 不是数组或含非法索引时抛出
 */
function toIndexArray(value, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`normalizeContext: ${name} 必须是数组`);
  return value.map((v) => {
    try {
      return normalizeIndex(v);
    } catch (err) {
      throw new RangeError(`normalizeContext: ${name} 含非法牌索引 ${String(v)}（${err.message}）`);
    }
  });
}

/**
 * 校验并归一非负整数计数（赤牌张数等）。
 *
 * @param {unknown} value 计数
 * @param {string} name 字段名
 * @returns {number} 非负整数
 * @throws {RangeError} 非法时抛出
 */
function toCount(value, name) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`normalizeContext: ${name} 必须是非负整数，收到 ${String(value)}`);
  }
  return value;
}

/**
 * 是否门清：只要没有吃 / 碰 / 明槓 / 加槓就是门清（**暗杠不算副露**，仍视为门清）。
 *
 * @param {Array<{type: string}>} melds 副露数组
 * @returns {boolean} 门清返回 true
 */
export function isMenzen(melds) {
  return (melds || []).every((m) => m.type === 'ankan');
}

/**
 * 把一条副露转成统一面子视图。
 *
 * @param {{type: string, tiles: number[]}} meld 副露
 * @returns {MentsuView} 面子视图
 */
function meldToView(meld) {
  const tiles = meld.tiles.map(normalizeIndex);
  const isKan = meld.type === 'minkan' || meld.type === 'ankan' || meld.type === 'kakan';
  const isChi = meld.type === 'chi';
  const concealed = meld.type === 'ankan';
  return {
    kind: isChi ? 'shuntsu' : isKan ? 'kantsu' : 'koutsu',
    tile: isChi ? Math.min(...tiles) : tiles[0],
    tiles,
    concealed,
    isKan,
    open: !concealed,
    source: 'meld',
    meldType: meld.type,
  };
}

/**
 * 枚举和牌张在拆解中的全部合法「角色」。
 *
 * 角色取值：
 *   - `-1`           和牌张补成雀头（单骑听）
 *   - `i`（0 起）    和牌张位于 `decom.mentsu[i]` 内（该面子由和牌张补成）
 *
 * 同一张牌可能落在不同的面子里（例：`1111m23m…` 的 1m 既可能在 `111m` 也可能在 `123m`），
 * 不同角色会得到不同的听牌形与不同的明暗刻判定，因此**必须逐个枚举后取高点**
 * （yaku.js 会为每个角色各评估一次）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} decom 拆解方案
 * @returns {number[]} 角色数组（去重、雀头在最前、其余按下标升序）
 * @throws {RangeError} 和牌张不在任何面子 / 雀头中（拆解与和牌张不自洽）时抛出
 */
export function enumerateWinRoles(ctx, decom) {
  const w = ctx.winTile;
  const roles = [];
  if (decom.pair === w) roles.push(-1);
  for (let i = 0; i < decom.mentsu.length; i++) {
    if (decom.mentsu[i].tiles.includes(w)) roles.push(i);
  }
  if (roles.length === 0) {
    throw new RangeError(
      `enumerateWinRoles: 和牌张 ${tileToStr(w)} 不在拆解结果中（拆解与 winTile 不自洽）`,
    );
  }
  return roles;
}

/**
 * 用指定角色构建「面子统一视图」。
 *
 * 面子顺序固定为：**先副露（按 melds 顺序），后暗牌拆解（按 decom.mentsu 顺序）**。
 * 因此 `role` 是 `decom.mentsu` 的下标（与副露无关），-1 表示雀头。
 *
 * 荣和补成的刻子在这里被降级为明刻（§1.8(6)）：`concealed = false`，`open` 仍为 false
 * （它不是副露，不影响门清 / 断幺九等判定，只影响符数与暗刻计数）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} decom 拆解方案
 * @param {number} role 和牌张角色（-1 或 mentsu 下标）
 * @returns {HandView} 面子统一视图
 * @throws {RangeError} role 与拆解不自洽、或面子总数不是 4 时抛出
 */
export function buildViewWithRole(ctx, decom, role) {
  if (!Number.isInteger(role) || role < -1 || role >= decom.mentsu.length) {
    throw new RangeError(`buildViewWithRole: 非法角色 ${String(role)}`);
  }
  if (role === -1 && decom.pair !== ctx.winTile) {
    throw new RangeError('buildViewWithRole: role = -1 要求雀头就是和牌张（单骑听）');
  }
  if (role >= 0 && !decom.mentsu[role].tiles.includes(ctx.winTile)) {
    throw new RangeError('buildViewWithRole: 指定面子不含和牌张，与 winTile 不自洽');
  }
  /** @type {MentsuView[]} */
  const mentsu = ctx.melds.map(meldToView);
  for (let i = 0; i < decom.mentsu.length; i++) {
    const m = decom.mentsu[i];
    const tiles = m.tiles.map(normalizeIndex);
    const isWinMentsu = i === role;
    // 荣和补成的刻子算明刻；顺子照旧是暗顺子（天凤原文）
    const ronCompleted = isWinMentsu && m.type === 'koutsu' && !ctx.isTsumo;
    mentsu.push({
      kind: m.type,
      tile: m.type === 'shuntsu' ? Math.min(...tiles) : tiles[0],
      tiles,
      concealed: !ronCompleted,
      isKan: false,
      open: false,
      source: 'decom',
      ronCompleted,
    });
  }
  if (mentsu.length !== 4) {
    throw new RangeError(
      `buildViewWithRole: 面子数应为 4，实际 ${mentsu.length}（副露 ${ctx.melds.length} + 暗牌拆解 ${decom.mentsu.length}）`,
    );
  }
  return { pair: decom.pair, mentsu, isMenzen: isMenzen(ctx.melds), meldCount: ctx.melds.length, role };
}

/**
 * 判定和牌张在拆解中的听牌形（单骑 / 嵌张 / 边张 / 两面 / 双碰）。
 *
 * 判据（标准口径）：
 *   - 补成雀头 → 单骑；补成刻子 → 双碰；补成顺子则看位置：
 *     中间张 → 嵌张；`123` 的 3 或 `789` 的 7 → 边张；其余 → 两面。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} decom 拆解方案
 * @param {number} role 和牌张角色
 * @returns {WaitInfo} 听牌形信息
 * @throws {RangeError} 角色与拆解不自洽时抛出
 */
export function classifyWinTile(ctx, decom, role) {
  const w = ctx.winTile;
  if (role === -1) {
    if (decom.pair !== w) throw new RangeError('classifyWinTile: role = -1 要求雀头就是和牌张');
    return {
      type: 'tanki',
      fu: 2,
      label: '单骑',
      ryanmen: false,
      desc: `和牌张 ${tileToStr(w)} 补成雀头（单骑听 +2 符）`,
    };
  }
  const m = decom.mentsu[role];
  if (!m) throw new RangeError(`classifyWinTile: 角色 ${String(role)} 越界`);
  const tiles = m.tiles.map(normalizeIndex);
  if (!tiles.includes(w)) {
    throw new RangeError('classifyWinTile: 指定面子不含和牌张，与 winTile 不自洽');
  }
  if (m.type === 'koutsu') {
    return {
      type: 'shanpon',
      fu: 0,
      label: '双碰',
      ryanmen: false,
      desc: `和牌张 ${tileToStr(w)} 补成刻子（双碰听 0 符；荣和时该刻子按明刻计）`,
    };
  }
  const rank = tiles[0] % 9; // 顺子在花色内的起始序号（0 = 123 … 6 = 789）
  if (tiles[1] === w) {
    return {
      type: 'kanchan',
      fu: 2,
      label: '嵌张',
      ryanmen: false,
      desc: `和牌张 ${tileToStr(w)} 是顺子的中间张（嵌张听 +2 符）`,
    };
  }
  if (tiles[2] === w) {
    if (rank === 0) {
      return {
        type: 'penchan',
        fu: 2,
        label: '边张',
        ryanmen: false,
        desc: `12${tileToStr(w)} 型，只能等 ${tileToStr(w)}（边张听 +2 符）`,
      };
    }
    return {
      type: 'ryanmen',
      fu: 0,
      label: '两面',
      ryanmen: true,
      desc: `和牌张 ${tileToStr(w)} 是顺子的高端张（两面听 0 符）`,
    };
  }
  if (rank === 6) {
    return {
      type: 'penchan',
      fu: 2,
      label: '边张',
      ryanmen: false,
      desc: `${tileToStr(w)}89 型，只能等 ${tileToStr(w)}（边张听 +2 符）`,
    };
  }
  return {
    type: 'ryanmen',
    fu: 0,
    label: '两面',
    ryanmen: true,
    desc: `和牌张 ${tileToStr(w)} 是顺子的低端张（两面听 0 符）`,
  };
}

/**
 * 雀头符明细。
 *
 * 雀头符 =（三元牌 ? 2 : 0）+（自风 ? 2 : 0）+（场风 ? 2 : 0），连风牌按两项各 2 相加；
 * `rules.renfonPairFu === 2` 时连风牌只算 2 符（少数线下规则）。
 *
 * @param {number} pair 雀头牌索引
 * @param {object} ctx 归一化后的 Context
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @returns {{fu: number, label: string, note: string}} 明细
 */
export function pairFu(pair, ctx, rules) {
  if (pair >= DRAGON_START) {
    return {
      fu: 2,
      label: `三元牌（${DRAGON_NAMES[pair]}）`,
      note: '三元牌雀头 +2 符（§2.1）',
    };
  }
  const isSeat = pair === ctx.seatWind;
  const isRound = pair === ctx.roundWind;
  if (isSeat && isRound) {
    const fu = rules[RENFON_PAIR_FU] === 2 ? 2 : 4;
    return {
      fu,
      label: `连风牌（${WIND_NAMES[pair]}，自风 = 场风）`,
      note:
        fu === 4
          ? '自风与场风为同一种风牌，役牌雀头符各 +2 共 4 符（天凤 / 雀魂 / 雀姬口径，§2.4）'
          : '本规则集采用「连风牌雀头 2 符」的线下通用口径（§2.4）',
    };
  }
  if (isSeat) return { fu: 2, label: `自风牌（${WIND_NAMES[pair]}）`, note: '自风雀头 +2 符' };
  if (isRound) return { fu: 2, label: `场风牌（${WIND_NAMES[pair]}）`, note: '场风雀头 +2 符' };
  return {
    fu: 0,
    label: `无符雀头（${tileToStr(pair)}）`,
    note: pair >= HONOR_START ? '客风雀头 0 符' : '数牌雀头 0 符',
  };
}

/**
 * 雀头是否为役牌（三元牌 / 自风 / 场风）——平和的必要条件之一。
 *
 * @param {number} pair 雀头牌索引
 * @param {object} ctx 归一化后的 Context
 * @returns {boolean} 是役牌雀头返回 true
 */
export function isYakuhaiPair(pair, ctx) {
  return pair >= DRAGON_START || pair === ctx.seatWind || pair === ctx.roundWind;
}

/**
 * 单个面子的符数（顺子 0 符）。
 *
 * @param {MentsuView} m 面子视图
 * @returns {number} 符数（0 / 2 / 4 / 8 / 16 / 32）
 */
export function mentsuFu(m) {
  if (m.kind === 'shuntsu') return 0;
  const yaochu = m.tile >= HONOR_START || m.tile % 9 === 0 || m.tile % 9 === 8;
  if (m.kind === 'kantsu') {
    if (m.concealed) return yaochu ? 32 : 16;
    return yaochu ? 16 : 8;
  }
  if (m.concealed) return yaochu ? 8 : 4;
  return yaochu ? 4 : 2;
}

/**
 * 面子符的明细项（含中文标签；顺子返回 0 符项，便于教程展示「顺子 0 符」）。
 *
 * @param {MentsuView} m 面子视图
 * @returns {FuItem} 明细项
 */
export function mentsuFuItem(m) {
  const fu = mentsuFu(m);
  const yaochu = m.tile >= HONOR_START || m.tile % 9 === 0 || m.tile % 9 === 8;
  const kindLabel = m.kind === 'shuntsu' ? '顺子' : m.kind === 'kantsu' ? (m.concealed ? '暗槓' : '明槓') : m.concealed ? '暗刻' : '明刻';
  const label = `面子：${yaochu && m.kind !== 'shuntsu' ? '幺九' : ''}${kindLabel}（${
    m.kind === 'shuntsu' ? `${tileToStr(m.tiles[0])}${tileToStr(m.tiles[1])}${tileToStr(m.tiles[2])}` : tileToStr(m.tile)
  }）`;
  /** @type {string|undefined} */
  let note;
  if (m.kind !== 'shuntsu') {
    const base = yaochu ? '幺九牌（1/9 数牌 + 全部字牌）' : '中张牌（2–8）';
    if (m.kind === 'kantsu') {
      note = m.concealed ? `暗槓：${base} 32/16 符（§2.1）` : `明槓（含加槓）：${base} 16/8 符（§2.1）`;
    } else {
      note = m.concealed ? `暗刻：${base} 8/4 符` : `明刻：${base} 4/2 符`;
    }
    if (m.ronCompleted) note += '；荣和补成的刻子按明刻计（§1.8(6)）';
    else if (m.open) note += '；副露面子';
  }
  return { label, fu, ...(note ? { note } : {}) };
}

/**
 * 平和判定。
 *
 * 三条件缺一不可（§1.8(3)）：门清、4 面子全为顺子、雀头非役牌、听牌形为两面。
 * 注意：**任何副露（含暗杠）都不成立平和** —— 吃碰明槓加槓是副露；暗杠虽保留门清，
 * 但「4 面子全为顺子」这一条已经不满足。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>, winMentsu?: number}} decom 拆解方案
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集
 * @returns {boolean} 成立平和返回 true
 */
export function isPinfu(ctx, decom, rules) {
  resolveRules(rules); // 校验规则集（平和与规则集无关，但保持调用一致性）
  if (ctx.melds.length > 0) return false;
  if (decom.mentsu.some((m) => m.type !== 'shuntsu')) return false;
  if (isYakuhaiPair(decom.pair, ctx)) return false;
  const roles =
    decom.winMentsu === undefined ? enumerateWinRoles(ctx, decom) : [validateRole(ctx, decom, decom.winMentsu)];
  return roles.some((role) => classifyWinTile(ctx, decom, role).ryanmen);
}

/**
 * 校验并返回 `decom.winMentsu`。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} decom 拆解方案
 * @param {number} role 角色
 * @returns {number} 原样返回 role
 * @throws {RangeError} 角色与拆解不自洽时抛出
 */
function validateRole(ctx, decom, role) {
  if (!Number.isInteger(role) || role < -1 || role >= decom.mentsu.length) {
    throw new RangeError(`calcFu: decom.winMentsu = ${String(role)} 非法（应为 -1 或 0–${decom.mentsu.length - 1}）`);
  }
  if (role === -1 && decom.pair !== ctx.winTile) {
    throw new RangeError('calcFu: decom.winMentsu = -1 要求雀头即和牌张（单骑听）');
  }
  if (role >= 0 && !decom.mentsu[role].tiles.includes(ctx.winTile)) {
    throw new RangeError('calcFu: decom.winMentsu 指定的面子不含和牌张，与 winTile 不自洽');
  }
  return role;
}

/**
 * 未指定 `decom.winMentsu` 时，为拆解挑选一个默认的和牌张角色。
 *
 * 选择基准与「高点法」一致：**先比番（平和 +1 番优先），番相同再比符**。
 * 平和与符的取舍之所以放在这里，是因为「平和自摸 20 符」本身就是符数规则，
 * 两者必须用同一口径，否则会出现「判平和却按嵌张算符」的自相矛盾。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} decom 拆解方案
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @returns {number} 选中的角色
 */
export function pickWinRole(ctx, decom, rules) {
  const roles = enumerateWinRoles(ctx, decom);
  let best = roles[0];
  let bestKey = null;
  for (const role of roles) {
    const pinfu = isPinfu(ctx, { ...decom, winMentsu: role }, rules) ? 1 : 0;
    const fu = computeFu(ctx, decom, rules, role).fu;
    const key = [pinfu, fu];
    if (bestKey === null || key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = role;
      bestKey = key;
    }
  }
  return best;
}

/**
 * 构建面子统一视图（公开入口）。
 *
 * `decom.winMentsu` 已给出时按该角色构建；未给出时用 `pickWinRole` 取高点角色。
 *
 * @param {object} ctx 归一化后的 Context（或原始 Context，内部会先归一化）
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>, winMentsu?: number}} decom 拆解方案
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集
 * @returns {HandView} 面子统一视图
 */
export function buildHandView(ctx, decom, rules) {
  // normalizeContext 对已归一化的 Context 是幂等的，这里统一再走一遍以保证独立调用也安全
  const c = normalizeContext(ctx);
  const r = resolveRules(rules);
  const role = decom.winMentsu === undefined ? pickWinRole(c, decom, r) : validateRole(c, decom, decom.winMentsu);
  return buildViewWithRole(c, decom, role);
}

/**
 * 计算符数（主函数）。
 *
 * @param {object} ctx 和牌上下文（Context 约定见 yaku.js 的 detectYaku）
 *   - 必需：`hand`（含和牌张的 34 计数数组，不含副露）、`winTile`
 *   - 常用：`melds`、`isTsumo`、`roundWind`、`seatWind`
 *   - 特殊：`yakumanCount`（> 0 时直接返回 0 符，役满不参与符计算）
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>, winMentsu?: number}|null} decom
 *   拆解方案：标准形传 `decomposeStandard()` 的结果（可附带 `winMentsu` 指定和牌张角色）；
 *   **七对子 / 国士无双传 `null`**（这两种形没有面子拆解）。
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集（缺省 = 雀魂四人段位场）
 * @returns {FuResult} `{fu, raw, items, isFixed}`
 *   - `fu` 最终符数；`raw` 加符项合计（未切上）；`items` 逐项明细；`isFixed` 是否为规则固定值
 *   - 役满：`{fu: 0, raw: 0, items: [役满项], isFixed: true}`
 *   - 七对子：`{fu: 25, raw: 25, items: [七对子固定符], isFixed: true}`
 *   - 平和自摸：`{fu: 20, raw: 22, items: [副底 20, 自摸 2(舍弃)], isFixed: true}`
 * @throws {TypeError} `decom` 为 null 且手牌既非七对子也非国士时抛出（不静默返回假数据）
 * @throws {RangeError} 角色 / 面子数与和牌张不自洽时抛出
 */
export function calcFu(ctx, decom, rules) {
  const c = normalizeContext(ctx);
  const r = resolveRules(rules);

  // 役满不参与符计算（§1.8(9)、§2.7）：固定点数结算，符数无意义
  if (c.yakumanCount > 0) {
    return {
      fu: 0,
      raw: 0,
      items: [
        {
          label: '役满',
          fu: 0,
          note: `役满 ×${c.yakumanCount}：按固定点数结算（子 32000 / 亲 48000 的整数倍），不计算符数（§1.8(9)）`,
        },
      ],
      isFixed: true,
    };
  }

  if (decom === null || decom === undefined) {
    if (isChiitoi(c.hand)) {
      return {
        fu: CHIITOI_FU,
        raw: CHIITOI_FU,
        items: [
          {
            label: '七对子固定符',
            fu: CHIITOI_FU,
            note: '七对子固定 25 符：不加副底 / 门清荣和 / 自摸 / 单骑符，也不做切上（§2.5）',
          },
        ],
        isFixed: true,
      };
    }
    if (isKokushi(c.hand)) {
      return {
        fu: 0,
        raw: 0,
        items: [{ label: '国士无双（役满）', fu: 0, note: '役满按固定点数结算，不计算符数（§1.8(9)）' }],
        isFixed: true,
      };
    }
    throw new TypeError(
      'calcFu: decom 为 null 时手牌必须是七对子形或国士无双形（标准形请传 decomposeStandard 的结果）',
    );
  }

  const role = decom.winMentsu === undefined ? pickWinRole(c, decom, r) : validateRole(c, decom, decom.winMentsu);
  return computeFu(c, decom, r, role);
}

/**
 * 符数计算的内部实现（角色已确定，不再做任何角色选择，故可安全递归调用）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<{type: string, tiles: number[]}>}} decom 拆解方案
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {number} role 和牌张角色
 * @returns {FuResult} 符数结果
 */
function computeFu(ctx, decom, rules, role) {
  const view = buildViewWithRole(ctx, decom, role);
  /** @type {FuItem[]} */
  const items = [];
  items.push({ label: '副底（底符）', fu: BASE_FU, note: '任何和牌都加（§2.1）' });

  if (view.isMenzen && !ctx.isTsumo) {
    items.push({ label: '门清荣和', fu: MENZEN_RON_FU, note: '门清状态荣和 +10 符；暗杠不破坏门清（§2.1）' });
  }
  if (ctx.isTsumo) {
    items.push({
      label: '自摸',
      fu: TSUMO_FU,
      note: ctx.isRinshan ? '自摸 +2 符；岭上开花同样加 2 符（天凤明确）' : '自摸 +2 符（门清 / 副露都加）',
    });
  }

  const wait = classifyWinTile(ctx, decom, role);
  items.push({
    label: `听牌形：${wait.label}`,
    fu: wait.fu,
    note: wait.desc,
  });

  const pf = pairFu(decom.pair, ctx, rules);
  items.push({ label: `雀头：${pf.label}`, fu: pf.fu, note: pf.note });

  for (const m of view.mentsu) items.push(mentsuFuItem(m));

  const pinfu = isPinfu(ctx, { ...decom, winMentsu: role }, rules);
  const raw = items.reduce((sum, it) => sum + it.fu, 0);

  // 平和自摸固定 20 符：舍弃自摸 2 符，且跳过一切切上（§2.5、陷阱①）
  if (pinfu && ctx.isTsumo) {
    return { fu: PINFU_TSUMO_FU, raw, items, isFixed: true };
  }

  // 一般形最低 30 符：唯一可能是「副露平和形」的 20 符（荣和）或 22 符（自摸）
  let total = raw;
  if (total < MIN_STANDARD_FU) {
    items.push({
      label: '一般形最低符',
      fu: MIN_STANDARD_FU - total,
      note: `一般形总符不足 ${MIN_STANDARD_FU} 符时抬到 ${MIN_STANDARD_FU} 符（副露平和形荣和 20 / 自摸 22 → 30，§2.5、陷阱⑦）`,
    });
    total = MIN_STANDARD_FU;
  }

  return { fu: Math.ceil(total / 10) * 10, raw: total, items, isFixed: false };
}
