/**
 * 日本麻将牌理引擎 —— 规则开关与预设规则集
 * =====================================================================
 *
 * 【依据】research/yaku-fu-score.md（§1.7 双倍役满 / §1.8(4) 食断 / §1.8(7) 国士抢暗杠 /
 *   §2.4 连风牌雀头符 / §3.3 切上满贯 / §1.5 流局满贯）
 *   + research/rules-variants.md（§1.2 多家和牌：雀魂「全和」/ 天凤「双响全和」/ 竞技「头跳」）。
 *
 * 【设计约定】
 *   1. 每个开关以 camelCase 字符串常量导出（`KUITAN` 等），**不要**在调用处硬编码字符串，
 *      这样拼写错误会在 import 阶段就暴露，而不是静默取到 undefined（undefined 一律按默认值处理）。
 *   2. 规则集是**扁平对象** `{ [开关id]: 值 }`，可直接 JSON 序列化，便于存档 / 与界面双向绑定。
 *   3. mergeRules / makeRules 返回 `Object.freeze` 过的对象：规则集在整局游戏中不应被就地修改，
 *      需要变体时用 mergeRules 生成新对象。
 *   4. 数值型开关（如 RENFON_PAIR_FU）在 mergeRules 时校验取值，非法值抛 RangeError 而不是静默接受。
 */

/**
 * 食断（喰い断）：副露后「断幺九」是否仍然成立。
 *
 * - `true`  有食断 —— 雀魂四人段位场（官方规则「有食断」）、天凤「有食断」桌、RCR 欧洲竞技规则
 * - `false` 无食断 —— 天凤「无食断」桌、部分雀庄与团体赛
 *
 * 依据：yaku-fu-score.md §1.8(4)（断幺九与副露）。
 * 引擎内消费点：yaku.js（断幺九的成立判定）。
 *
 * @type {string}
 */
export const KUITAN = 'kuitan';

/**
 * 切上满贯：基本点恰为 1920 的两种牌型（4 番 30 符 / 3 番 60 符）是否抬到满贯的 2000。
 *
 * - `true`  采用 —— 天凤**雀荘战**（官方明文列为雀荘战差异项）、M 联赛、多数团体赛
 * - `false` 不采用 —— 天凤**段位战**、雀魂段位场、RCR（4 番 30 符 = 子 7700 / 亲 11600）
 *
 * 依据：yaku-fu-score.md §3.3。注意「切上满贯」与「按公式自然超过 2000 的满贯」
 * （4 番 40 符 = 2560、3 番 70 符 = 2240）是两件事，后者不受本开关影响。
 * 引擎内消费点：score.js。
 *
 * @type {string}
 */
export const KIRIAGE_MANGAN = 'kiriageMangan';

/**
 * 连风牌雀头的符数（自风 = 场风，且该风牌作雀头）。
 *
 * - `4` 天凤（官方原文「連風牌は4符」，高可信）、雀姬、雀魂、日本プロ麻雀連盟（JPML）
 * - `2` 一般线下规则 / 多数雀庄 / 关东标准
 *
 * 依据：yaku-fu-score.md §2.4。注意连风雀头**不构成任何役**，只影响符数，但会**破坏平和**
 * （雀头是役牌）。引擎内消费点：fu.js。
 *
 * @type {string}
 */
export const RENFON_PAIR_FU = 'renfonPairFu';

/**
 * 双倍役满认定：四暗刻单骑 / 国士无双十三面 / 纯正九莲宝灯 / 大四喜 是否按 2 倍役满计。
 *
 * - `true`  雀魂系 —— 上述四项各按双倍役满（百度百科 + 社区共识，中可信，见 §1.7）
 * - `false` 天凤系 —— 官方役一覧脚注「四暗刻単騎・国士無双十三面待ち等はすべてシングル役満」
 *
 * 依据：yaku-fu-score.md §1.7。**役满之间的复合**（如大四喜 + 字一色 = 2 倍）不受本开关影响，
 * 两种规则集都允许。引擎内消费点：yaku.js。
 *
 * @type {string}
 */
export const DOUBLE_YAKUMAN = 'doubleYakuman';

/**
 * 国士无双能否抢暗杠。
 *
 * - `true`  可以 —— 雀魂役种表「枪杠…（国士无双可以抢暗杠）」
 * - `false` 不可以 —— 天凤官方明确「他家暗杠的牌不能和国士」
 *
 * 依据：yaku-fu-score.md §1.8(7)（两平台相反）。`false` 时，若上层传入
 * `ctx.isChankan = true` 且 `ctx.chankanIsAnkan = true`，抢槓役不成立。引擎内消费点：yaku.js。
 *
 * @type {string}
 */
export const KOKUSHI_CHANKAN_ANKAN = 'kokushiChankanAnkan';

/**
 * 是否承认流局满贯（流局満貫 / 形式テンパイならず）。
 *
 * - `true`  雀魂、天凤均承认（天凤明确「自己鸣过牌也成立」，须「自己的牌河没有被鸣牌」）
 * - `false` 部分线下规则不承认
 *
 * 依据：yaku-fu-score.md §1.5。成立与否由游戏层判定后经 `ctx.isNagashiMangan` 传入，
 * 引擎只负责按满贯结算。引擎内消费点：yaku.js。
 *
 * @type {string}
 */
export const NAGASHI_MANGAN = 'nagashiMangan';

/**
 * 多家荣和（双响 / 三家和）是否采用头跳（頭跳ね）。
 *
 * - `false` **无头跳 = 全部结算** —— 雀魂（双响、三家和均为「全和」）、天凤（双响全和）
 * - `true`  有头跳 —— 只有放铳者下家方向最近的一家成立（JPML、WRC 等竞技规则）
 *
 * 依据：research/rules-variants.md §1.2。天凤的「三家和 = 途中流局」属于**流局判定**，
 * 与结算无关，由游戏层处理。引擎内消费点：score.js 的 settleMultiRon()。
 *
 * @type {string}
 */
export const RON_LIMIT = 'ronLimit';

/**
 * 是否承认「人和」（子家第一巡摸牌前荣和）。
 *
 * - `true`  RCR 欧洲竞技规则（列为一役，**5 番**，即满贯）
 * - `false` 天凤**无此役**；雀魂段位场亦无（仅古役 / 友人场）
 *
 * 依据：yaku-fu-score.md §1.6。默认 `false`：主流线上平台都不承认，避免「凭空多出满贯」。
 * 引擎内消费点：yaku.js。
 *
 * @type {string}
 */
export const RENHOU = 'renhou';

/**
 * 国士无双十三面听的振听口径。
 *
 * - `true`  天凤式：十三面听时**河里有任何幺九牌即 13 面全振听**（13 牌振聴対象）
 * - `false` 少数规则：只有河中出现过的那一张牌不能荣和（其余 12 面仍可荣和）
 *
 * 依据：yaku-fu-score.md §1.8(7)（天凤为高可信，其余标 `[待核实]`）。
 * 默认取天凤口径；本开关是本引擎中唯一影响振听判定的规则位。引擎内消费点：furiten.js。
 *
 * @type {string}
 */
export const KOKUSHI_13_FURITEN = 'kokushi13Furiten';

/**
 * 全部开关的规格表（校验用）。
 * @type {Readonly<Record<string, {kind: 'boolean'|'enum', values?: number[]}>>}
 */
const RULE_SPECS = Object.freeze({
  [KUITAN]: { kind: 'boolean' },
  [KIRIAGE_MANGAN]: { kind: 'boolean' },
  [RENFON_PAIR_FU]: { kind: 'enum', values: [2, 4] },
  [DOUBLE_YAKUMAN]: { kind: 'boolean' },
  [KOKUSHI_CHANKAN_ANKAN]: { kind: 'boolean' },
  [NAGASHI_MANGAN]: { kind: 'boolean' },
  [RON_LIMIT]: { kind: 'boolean' },
  [RENHOU]: { kind: 'boolean' },
  [KOKUSHI_13_FURITEN]: { kind: 'boolean' },
});

/** 全部合法开关 id @type {ReadonlyArray<string>} */
export const RULE_KEYS = Object.freeze(Object.keys(RULE_SPECS));

/**
 * 雀魂四人段位场默认规则集。
 *
 * 取值依据（逐条）：
 *   - kuitan `true`（官方规则「有食断」）
 *   - kiriageMangan `false`（§3.3，中可信：雀魂 4 番 30 符 = 7700）
 *   - renfonPairFu `4`（§2.4，中可信）
 *   - doubleYakuman `true`（§1.7：四暗刻单骑 / 国士十三面 / 纯正九莲 / 大四喜）
 *   - kokushiChankanAnkan `true`（§1.8(7)：雀魂国士可抢暗杠）
 *   - nagashiMangan `true`
 *   - ronLimit `false`（rules-variants §1.2：双响、三家和均全部结算）
 *   - renhou `false`（段位场无）
 *   - kokushi13Furiten `true`（天凤口径；雀魂未取得官方页，取主流口径）
 *
 * @type {Readonly<Record<string, boolean|number>>}
 */
export const SAKURA_4P = Object.freeze({
  [KUITAN]: true,
  [KIRIAGE_MANGAN]: false,
  [RENFON_PAIR_FU]: 4,
  [DOUBLE_YAKUMAN]: true,
  [KOKUSHI_CHANKAN_ANKAN]: true,
  [NAGASHI_MANGAN]: true,
  [RON_LIMIT]: false,
  [RENHOU]: false,
  [KOKUSHI_13_FURITEN]: true,
});

/**
 * 天凤四人段位战默认规则集。
 *
 * 与雀魂的差异（逐条）：
 *   - kiriageMangan `false`（官方把切上满贯只列在雀荘战差异项 → 段位战不采用）
 *   - doubleYakuman `false`（官方脚注 `すべてシングル役満`）
 *   - kokushiChankanAnkan `false`（官方：他家暗杠不能和国士）
 *   - ronLimit `false`（双响全和；三家和为途中流局，见 rules-variants §1.2）
 *   - renfonPairFu `4`（官方原文「連風牌は4符」，高可信）
 *
 * @type {Readonly<Record<string, boolean|number>>}
 */
export const TENHOU_4P = Object.freeze({
  [KUITAN]: true,
  [KIRIAGE_MANGAN]: false,
  [RENFON_PAIR_FU]: 4,
  [DOUBLE_YAKUMAN]: false,
  [KOKUSHI_CHANKAN_ANKAN]: false,
  [NAGASHI_MANGAN]: true,
  [RON_LIMIT]: false,
  [RENHOU]: false,
  [KOKUSHI_13_FURITEN]: true,
});

/**
 * 校验单个开关的取值。
 *
 * @param {string} key 开关 id
 * @param {unknown} value 取值
 * @returns {boolean|number} 原值（已通过校验）
 * @throws {RangeError} 键名未知或取值非法时抛出
 */
function validateRule(key, value) {
  const spec = RULE_SPECS[key];
  if (!spec) {
    throw new RangeError(
      `未知的规则开关 "${key}"；合法键为：${RULE_KEYS.join(', ')}`,
    );
  }
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new RangeError(`规则开关 "${key}" 必须是布尔值，收到 ${JSON.stringify(value)}`);
    }
    return value;
  }
  if (!spec.values.includes(/** @type {number} */ (value))) {
    throw new RangeError(
      `规则开关 "${key}" 只能是 ${spec.values.join(' 或 ')}，收到 ${JSON.stringify(value)}`,
    );
  }
  return /** @type {number} */ (value);
}

/**
 * 以 base 为底、用 overrides 覆盖，生成新的规则集。
 *
 * @param {Record<string, boolean|number>} base 基础规则集（通常是 SAKURA_4P / TENHOU_4P）
 * @param {Record<string, boolean|number>} [overrides] 覆盖项（只写需要改的开关）
 * @returns {Readonly<Record<string, boolean|number>>} 新的冻结规则集
 * @throws {TypeError|RangeError} base 非对象、overrides 含有未知键或非法值时抛出
 */
export function mergeRules(base, overrides) {
  if (base === null || typeof base !== 'object') {
    throw new TypeError('mergeRules: base 必须是规则集对象');
  }
  const out = {};
  for (const key of RULE_KEYS) {
    if (base[key] === undefined) {
      throw new RangeError(`mergeRules: base 缺少规则开关 "${key}"`);
    }
    out[key] = validateRule(key, base[key]);
  }
  if (overrides !== undefined && overrides !== null) {
    if (typeof overrides !== 'object') throw new TypeError('mergeRules: overrides 必须是对象');
    for (const [key, value] of Object.entries(overrides)) {
      out[key] = validateRule(key, value);
    }
  }
  return Object.freeze(out);
}

/**
 * 生成规则集：以**雀魂四人段位场**为默认，按 overrides 覆盖。
 *
 * 这是引擎内部（yaku / fu / score / furiten）与外部调用的统一入口：
 * 传 `undefined` 与传 `makeRules()` 等价，都得到一套完整的合法规则集。
 *
 * @param {Record<string, boolean|number>} [overrides] 覆盖项
 * @returns {Readonly<Record<string, boolean|number>>} 冻结的规则集
 * @throws {RangeError} 覆盖项含未知键或非法值时抛出
 * @example
 *   const r = makeRules({ [KIRIAGE_MANGAN]: true });  // 雀魂默认 + 切上满贯
 */
export function makeRules(overrides) {
  return mergeRules(SAKURA_4P, overrides);
}

/**
 * 归一化外部传入的 rules：未传时用默认（雀魂四人），传了则与默认合并
 * （缺失的开关补默认值，未知键仍然报错）。
 *
 * @param {Record<string, boolean|number>|undefined|null} [rules] 外部规则集
 * @returns {Readonly<Record<string, boolean|number>>} 完整规则集
 */
export function resolveRules(rules) {
  if (rules === undefined || rules === null) return SAKURA_4P;
  return mergeRules(SAKURA_4P, rules);
}
