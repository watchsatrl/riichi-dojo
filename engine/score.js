/**
 * 日本麻将牌理引擎 —— 点数计算（点数計算）
 * =====================================================================
 *
 * 【规则依据】research/yaku-fu-score.md §3 全节 + §4 实现陷阱 ④⑤。
 *
 * 【公式】
 *   基本点 = 符 × 2^(番 + 2)   ← 指数里的 2 是「场ゾロ」，无条件附加的 2 番
 *   子家荣和 = 基本点 × 4      亲家荣和 = 基本点 × 6
 *   子家自摸 = 亲付 基本点 × 2 / 子付 基本点 × 1
 *   亲家自摸 = 每家付 基本点 × 2
 *   基本点 > 2000 时一律取 2000（满贯）；5 番以上不再走公式，按番数定值。
 *
 * 【两条「进位」不要混淆（陷阱⑨）】
 *   1. **符数切上**：加符项合计向上取整到 10（在 fu.js 里做）；
 *   2. **点数切上**：每一笔实际支付额向上取整到 100（在本模块里做），
 *      **由支付方各自承担零头**（先算总额再分摊是错的），因此会出现「自摸比荣和更赚」。
 *
 * 【切上满贯】`rules.kiriageMangan` 只影响基本点恰为 1920 的两种牌型
 *   （4 番 30 符 / 3 番 60 符）；因公式自然超过 2000 的（4 番 40 符、3 番 70 符）本来就是满贯。
 */

import { KIRIAGE_MANGAN, RON_LIMIT, resolveRules } from './rules.js';

/** 本场每本的点数 @type {number} */
export const HONBA_POINTS = 300;
/** 自摸时本场每家分摊的点数（300 / 3） @type {number} */
export const HONBA_PER_PLAYER = HONBA_POINTS / 3;
/** 每根立直棒的点数 @type {number} */
export const RIICHI_STICK_POINTS = 1000;
/** 满贯的基本点（也是公式封顶值） @type {number} */
export const MANGAN_BASIC = 2000;

/**
 * 向上取整到 100 点（点数的零头进位，不是四舍五入）。
 *
 * @param {number} x 点数
 * @returns {number} 进位后的点数
 */
function ceil100(x) {
  return Math.ceil(x / 100) * 100;
}

/**
 * 按番数 / 符数求基本点与满贯界限。
 *
 * @param {number} han 番数
 * @param {number} fu 符数（番数 ≥ 5 时不参与计算）
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {number} yakumanCount 役满倍数（0 表示非役满役）
 * @returns {{basic: number, limit: string|null, limitName: string|null, byFormula: boolean}} 界限信息
 *   - `limit` 取值：`null` / `'mangan'` / `'haneman'` / `'baiman'` / `'sanbaiman'` / `'yakuman'`（倍数 ≥2 时为 `'yakuman2'`…）
 *   - `byFormula` 是否由公式算出（false = 按番数或役满定值）
 */
export function resolveLimit(han, fu, rules, yakumanCount) {
  const r = resolveRules(rules);
  if (yakumanCount > 0) {
    const name = yakumanCount === 1 ? '役满' : `${yakumanCount} 倍役满`;
    return {
      basic: 8000 * yakumanCount,
      limit: yakumanCount === 1 ? 'yakuman' : `yakuman${yakumanCount}`,
      limitName: name,
      byFormula: false,
    };
  }
  if (han >= 13) return { basic: 8000, limit: 'yakuman', limitName: '累计役满', byFormula: false };
  if (han >= 11) return { basic: 6000, limit: 'sanbaiman', limitName: '三倍满', byFormula: false };
  if (han >= 8) return { basic: 4000, limit: 'baiman', limitName: '倍满', byFormula: false };
  if (han >= 6) return { basic: 3000, limit: 'haneman', limitName: '跳满', byFormula: false };
  if (han >= 5) return { basic: 2000, limit: 'mangan', limitName: '满贯', byFormula: false };

  let basic = fu * 2 ** (han + 2);
  if (r[KIRIAGE_MANGAN] && ((fu === 30 && han === 4) || (fu === 60 && han === 3))) basic = MANGAN_BASIC;
  if (basic > MANGAN_BASIC) basic = MANGAN_BASIC;
  const isMangan = basic === MANGAN_BASIC;
  return {
    basic,
    limit: isMangan ? 'mangan' : null,
    limitName: isMangan ? '满贯' : null,
    byFormula: true,
  };
}

/**
 * 校验符数是否合法。
 *
 * 规则：一般形的符数是 20–110 之间的整十数（七对子 25 除外，平和自摸 20 已含在整十内）。
 * **不设 110 上限**：`yaku-fu-score.md` §2.2 称「理论最大 110 符」，但那只覆盖「最多两个杠」的
 * 常见形态；3 个幺九暗杠（32×3）+ 副底 20 + 门清荣和 10 已可得 130 符，引擎不能拒绝这种合法输入。
 *
 * @param {number} fu 符数
 * @returns {number} 原值
 * @throws {RangeError} 非法时抛出
 */
function validateFu(fu) {
  if (!Number.isInteger(fu) || fu < 20) {
    throw new RangeError(`calcScore: 符数必须是不小于 20 的整数，收到 ${String(fu)}`);
  }
  if (fu !== 25 && fu % 10 !== 0) {
    throw new RangeError(`calcScore: 符数应向上取整到 10（七对子 25 除外），收到 ${String(fu)}`);
  }
  return fu;
}

/**
 * 点数计算主函数。
 *
 * @param {{han: number, fu: number, isDealer?: boolean, isTsumo?: boolean,
 *          honba?: number, riichiSticks?: number, yakumanCount?: number}} input 输入
 *   - `han` 番数（含宝牌；累计役满请直接传 ≥ 13 的番数。**无役不能和牌**，han < 1 会抛错）
 *   - `fu` 符数（番数 ≥ 5 时被忽略，可传 0 —— 例：流局满贯、役满）
 *   - `isDealer` 是否亲家（庄家）
 *   - `isTsumo` 是否自摸
 *   - `honba` 本场数（積み棒），每本 300 点：荣和由放铳者全付，自摸三家各 100
 *   - `riichiSticks` 场上立直棒根数，每根 1000 点，**全部归和牌者**
 *   - `yakumanCount` 【扩展】役满倍数（双倍役满传 2）；> 0 时按 8000 × 倍数 结算
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集（缺省 = 雀魂四人段位场）
 * @returns {{
 *   basic: number, limit: string|null, limitName: string|null,
 *   payments: {ron?: number, all?: number, dealer?: number, child?: number},
 *   basePayments: {ron?: number, all?: number, dealer?: number, child?: number},
 *   total: number, detail: string
 * }} 点数结果
 *   - `payments` **各家实际支付额（已含本场 300 的部分，且已各自进位到 100）**；
 *     子家自摸为 `{dealer, child}`（亲家付 dealer、每个子家付 child），亲家自摸为 `{all}`
 *   - `basePayments` 不含本场的纯点数，便于教学对照速查表
 *   - `total` 和牌者总收入 = 三家支付额之和 + 立直棒
 *   - `detail` 中文说明串（教程直接显示）
 * @throws {TypeError} 入参不是对象时抛出
 * @throws {RangeError} 番数为 0、符数非法、本场 / 立直棒为负数或非整数时抛出
 * @example
 *   calcScore({ han: 3, fu: 30, isDealer: false, isTsumo: false });
 *   // → { basic: 960, limit: null, payments: { ron: 3900 }, total: 3900, ... }
 */
export function calcScore(input, rules) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('calcScore: 入参必须是对象 { han, fu, isDealer, isTsumo, honba, riichiSticks }');
  }
  const r = resolveRules(rules);
  const { han, fu, isDealer = false, isTsumo = false, honba = 0, riichiSticks = 0, yakumanCount = 0 } = input;

  if (!Number.isInteger(han) || han < 0) {
    throw new RangeError(`calcScore: han 必须是非负整数，收到 ${String(han)}`);
  }
  if (!Number.isInteger(yakumanCount) || yakumanCount < 0) {
    throw new RangeError(`calcScore: yakumanCount 必须是非负整数，收到 ${String(yakumanCount)}`);
  }
  if (han < 1 && yakumanCount < 1) {
    throw new RangeError(
      'calcScore: 番数必须 ≥ 1（宝牌不计入起和番，无役不能和牌）；流局满贯请传 han = 5',
    );
  }
  if (!Number.isInteger(honba) || honba < 0) {
    throw new RangeError(`calcScore: honba 必须是非负整数，收到 ${String(honba)}`);
  }
  if (!Number.isInteger(riichiSticks) || riichiSticks < 0) {
    throw new RangeError(`calcScore: riichiSticks 必须是非负整数，收到 ${String(riichiSticks)}`);
  }
  const usedFu = yakumanCount > 0 || han >= 5 ? fu : validateFu(fu);
  if (!Number.isInteger(usedFu) || usedFu < 0) {
    throw new RangeError(`calcScore: fu 必须是非负整数，收到 ${String(fu)}`);
  }

  const lim = resolveLimit(han, usedFu, r, yakumanCount);
  const basic = lim.basic;

  // ---------- 纯点数（不含本场）----------
  /** @type {{ron?: number, all?: number, dealer?: number, child?: number}} */
  const basePayments = {};
  if (!isTsumo) {
    basePayments.ron = ceil100(basic * (isDealer ? 6 : 4));
  } else if (isDealer) {
    basePayments.all = ceil100(basic * 2);
  } else {
    basePayments.dealer = ceil100(basic * 2);
    basePayments.child = ceil100(basic);
  }

  // ---------- 加本场：荣和由放铳者全付；自摸三家各 100 × 本场 ----------
  /** @type {{ron?: number, all?: number, dealer?: number, child?: number}} */
  const payments = {};
  const honbaTotal = HONBA_POINTS * honba;
  if (!isTsumo) {
    payments.ron = basePayments.ron + honbaTotal;
  } else if (isDealer) {
    payments.all = basePayments.all + HONBA_PER_PLAYER * honba;
  } else {
    payments.dealer = basePayments.dealer + HONBA_PER_PLAYER * honba;
    payments.child = basePayments.child + HONBA_PER_PLAYER * honba;
  }

  const paid = isTsumo
    ? isDealer
      ? payments.all * 3
      : payments.child * 2 + payments.dealer
    : payments.ron;
  const total = paid + riichiSticks * RIICHI_STICK_POINTS;

  return {
    basic,
    limit: lim.limit,
    limitName: lim.limitName,
    payments,
    basePayments,
    total,
    detail: buildDetail({
      han,
      fu: usedFu,
      isDealer,
      isTsumo,
      honba,
      riichiSticks,
      lim,
      payments,
      basePayments,
      total,
      yakumanCount,
    }),
  };
}

/**
 * 生成中文说明串（教程显示用）。
 *
 * @param {object} info 组装信息
 * @returns {string} 说明串
 */
function buildDetail(info) {
  const { han, fu, isDealer, isTsumo, honba, riichiSticks, lim, basePayments, total, yakumanCount } = info;
  const honbaTotal = HONBA_POINTS * honba;
  const seat = isDealer ? '亲家' : '子家';
  const way = isTsumo ? '自摸' : '荣和';
  const head =
    yakumanCount > 0
      ? `${seat} ${lim.limitName}（${yakumanCount} 倍）${way}`
      : `${seat} ${han}番${lim.byFormula ? `${fu}符` : ''} ${way}`;
  const formula = lim.byFormula
    ? `${fu}×2^${han + 2} = ${fu * 2 ** (han + 2)} → 基本点 ${lim.basic}`
    : `${lim.limitName} → 基本点 ${lim.basic}${han >= 5 && yakumanCount === 0 ? '（5 番以上不再看符数）' : ''}`;
  let pay;
  if (!isTsumo) {
    pay = `放铳者支付 ${basePayments.ron}`;
  } else if (isDealer) {
    pay = `三家各支付 ${basePayments.all}（合计 ${basePayments.all * 3}）`;
  } else {
    pay = `亲家支付 ${basePayments.dealer}、子家各支付 ${basePayments.child}（合计 ${
      basePayments.dealer + basePayments.child * 2
    }）`;
  }
  const parts = [`${head} = ${formula} → ${pay}`];
  if (honba > 0) {
    parts.push(
      isTsumo
        ? `本场 ${honba}：三家各加 ${HONBA_PER_PLAYER * honba}（共 +${honbaTotal}）`
        : `本场 ${honba}：放铳者加付 ${honbaTotal}`,
    );
  }
  if (riichiSticks > 0) {
    parts.push(`立直棒 ${riichiSticks} 根归和牌者（+${riichiSticks * RIICHI_STICK_POINTS}）`);
  }
  parts.push(`和牌者收入 ${total}`);
  return parts.join('，');
}

/**
 * 多家荣和（双响 / 三家和）的结算裁决 —— `rules.ronLimit` 的消费点。
 *
 * - `rules.ronLimit === false`（雀魂 / 天凤默认）→ **全部结算**，两家都和
 * - `rules.ronLimit === true`（JPML / WRC 等竞技规则）→ **头跳**，只有离放铳者最近的一家成立
 *
 * 立直棒的归属：两家全和时由**离放铳者最近的一家**取得（天凤「上家取り」、雀魂「头跳家取得」）。
 * 天凤的「三家和 = 途中流局」属于**流局判定**而非结算，不在本函数职责内，由游戏层处理。
 *
 * @param {Array<{seat: number}>} winners 候选和牌者，**必须按「放铳者的下家方向顺序」排列**（最近的在前）
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集
 * @returns {{winners: Array<object>, rejected: Array<object>, limitApplied: boolean, riichiStickSeat: number|null}}
 *   - `winners` 实际结算的和牌者；`rejected` 因头跳被排除者
 *   - `riichiStickSeat` 取得全部立直棒的座位（无和牌者时为 null）
 * @throws {TypeError} winners 不是数组时抛出
 */
export function settleMultiRon(winners, rules) {
  if (!Array.isArray(winners)) throw new TypeError('settleMultiRon: winners 必须是数组');
  const r = resolveRules(rules);
  for (const w of winners) {
    if (w === null || typeof w !== 'object' || !Number.isInteger(w.seat)) {
      throw new TypeError('settleMultiRon: 每个和牌者都需要整数 seat 字段');
    }
  }
  if (winners.length <= 1) {
    return {
      winners: winners.slice(),
      rejected: [],
      limitApplied: false,
      riichiStickSeat: winners.length === 1 ? winners[0].seat : null,
    };
  }
  if (r[RON_LIMIT]) {
    return {
      winners: winners.slice(0, 1),
      rejected: winners.slice(1),
      limitApplied: true,
      riichiStickSeat: winners[0].seat,
    };
  }
  return {
    winners: winners.slice(),
    rejected: [],
    limitApplied: false,
    riichiStickSeat: winners[0].seat,
  };
}
