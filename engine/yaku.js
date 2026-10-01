import { HAND_SIZE, HONOR_START, cloneHand, doraFromIndicator, isYaochu, tileToStr } from './tiles.js';
import { decomposeStandard, isChiitoi, isKokushi, isKokushi13Tenpai } from './agari.js';
import { buildHandView, calcFu, classifyWinTile, enumerateWinRoles, isMenzen, isPinfu, normalizeContext } from './fu.js';
import { DOUBLE_YAKUMAN, KOKUSHI_CHANKAN_ANKAN, KUITAN, NAGASHI_MANGAN, RENHOU, resolveRules } from './rules.js';
/**
 * 日本麻将牌理引擎 —— 役种判定（役判定）
 * =====================================================================
 *
 * 【规则依据】research/yaku-fu-score.md §1 全节（役种全表 + 9 个特殊情况）
 *   + §4 实现陷阱 ③⑥⑩。所有番数、门清限定、食下取值均按该文档。
 *
 * 【依赖方向】yaku.js → fu.js → tiles.js / agari.js / rules.js（单向，无循环引用）。
 *   面子统一视图、和牌张角色、听牌形分类、平和判定都在 fu.js 里，本模块复用它们，
 *   以保证「平和 1 番」与「平和自摸 20 符」用的是同一判据。
 *
 * 【高点法（必须实现的三层）】
 *   1. 枚举**全部**拆解方案（`decomposeStandard` 会返回多个解，例：111222333m 既是
 *      「111m+222m+333m」也是「123m×3」）；
 *   2. 同一拆解下还要枚举**和牌张的角色**（同一张牌可能落在不同面子里，听牌形与明暗刻随之不同）；
 *   3. 逐方案比较：**先比总番数，番数相同再比符数**，取最高者作为最终结果。
 *   二杯口 vs 七对子、一杯口 vs 二杯口、平和 vs 单骑两面等分歧，都由这一层统一裁决。
 *
 * 【Context 约定（detectYaku 的入参 ctx）】
 * ```js
 * {
 *   hand,            // number[34] 计数数组，**含和牌张**，不含副露
 *   melds,           // 副露数组 [{type:'chi'|'pon'|'minkan'|'ankan'|'kakan', tiles:number[]}]
 *   winTile,         // 和牌张索引（0-33；34/35/36 会被归一到赤 5）
 *   isTsumo,         // 自摸
 *   roundWind,       // 场风 27-30（東南西北）
 *   seatWind,        // 自风 27-30（東南西北）
 *   isRiichi, isDoubleRiichi, isIppatsu,
 *   isChankan,       // 抢槓
 *   chankanIsAnkan,  // 【扩展】被抢的是暗杠（影响国士抢暗杠规则，见 rules.KOKUSHI_CHANKAN_ANKAN）
 *   isRinshan,       // 岭上开花
 *   isHaitei,        // 海底摸月（自摸）
 *   isHoutei,        // 河底捞鱼（荣和）
 *   isTenhou, isChiihou,
 *   isRenhou,        // 【扩展】人和（仅 rules.RENHOU 打开时成立，RCR 5 番）
 *   doraIndicators,  // number[] 宝牌指示牌
 *   uraIndicators,   // number[] 里宝牌指示牌（仅立直时计）
 *   redCount,        // 赤牌张数
 *   isNagashiMangan, // 流局满贯（由游戏层判定后传入）
 *   yakumanCount,    // 【扩展】由调用方指定的役满倍数（一般不必传，detectYaku 内部会填给 calcFu）
 * }
 * ```
 * 手牌张数必须为 `14 - 3 × melds.length`；不是和牌形时返回空结果（`list: []`、`hasYaku: false`），
 * 并在 `notes` 里说明原因 —— 这是**契约**而不是「静默失败」。
 */


/** 三元牌起始索引（白=31 發=32 中=33） @type {number} */
const DRAGON_START = 31;
/** 风牌索引范围 @type {number} */
const WIND_EAST = 27;
const WIND_NORTH = 30;
/** 累计役满的番数门槛（天凤官方 `数え役満は13翻以上`，§3.7） @type {number} */
export const KAZOE_YAKUMAN_HAN = 13;
/** 役满对应的番数（用于 list 中役满条目的 han 字段与 totalHan 换算） @type {number} */
export const YAKUMAN_HAN = 13;

/**
 * 役种定义表。
 *
 * 字段：
 *   - `name`      中文名
 *   - `ja`        日文名
 *   - `han`       门清（或无条件）时的番数；役满为 13
 *   - `hanOpen`   食下番数（副露后的番数）；无此字段表示不降番
 *   - `closedOnly` 门清限定
 *   - `yakuman`   是否役满
 *   - `double`    是否属于「双倍役满候选」（四暗刻单骑 / 国士十三面 / 纯正九莲 / 大四喜，§1.7）
 *   - `note`      规则依据备注
 *
 * @type {Readonly<Record<string, {name: string, ja: string, han: number, hanOpen?: number, closedOnly: boolean, yakuman: boolean, double?: boolean, note?: string}>>}
 */
export const YAKU_DEFS = Object.freeze({
  // ---------------- 一番役 ----------------
  riichi: { name: '立直', ja: '立直', han: 1, closedOnly: true, yakuman: false },
  doubleRiichi: { name: '两立直', ja: '両立直', han: 2, closedOnly: true, yakuman: false, note: '与立直互斥，只计两立直 2 番' },
  ippatsu: { name: '一发', ja: '一発', han: 1, closedOnly: true, yakuman: false, note: '与岭上开花、海底摸月不复合' },
  menzenTsumo: { name: '门前清自摸和', ja: '門前清自摸和', han: 1, closedOnly: true, yakuman: false },
  pinfu: { name: '平和', ja: '平和', han: 1, closedOnly: true, yakuman: false, note: '门清 + 4 顺子 + 非役牌雀头 + 两面听' },
  iipeikou: { name: '一杯口', ja: '一盃口', han: 1, closedOnly: true, yakuman: false, note: '与二杯口互斥' },
  tanyao: { name: '断幺九', ja: '断幺九', han: 1, closedOnly: false, yakuman: false, note: '副露后是否成立由 rules.kuitan 决定' },
  yakuhaiHaku: { name: '役牌:白', ja: '役牌:白', han: 1, closedOnly: false, yakuman: false },
  yakuhaiHatsu: { name: '役牌:發', ja: '役牌:發', han: 1, closedOnly: false, yakuman: false },
  yakuhaiChun: { name: '役牌:中', ja: '役牌:中', han: 1, closedOnly: false, yakuman: false },
  yakuhaiRoundWind: { name: '役牌:场风', ja: '役牌:場風牌', han: 1, closedOnly: false, yakuman: false, note: '与自风牌可叠加（连风刻子 = 2 番）' },
  yakuhaiSeatWind: { name: '役牌:自风', ja: '役牌:門風牌', han: 1, closedOnly: false, yakuman: false },
  chankan: { name: '抢槓', ja: '槍槓', han: 1, closedOnly: false, yakuman: false },
  rinshan: { name: '岭上开花', ja: '嶺上開花', han: 1, closedOnly: false, yakuman: false, note: '与一発、海底摸月不复合' },
  haitei: { name: '海底摸月', ja: '海底摸月', han: 1, closedOnly: false, yakuman: false },
  houtei: { name: '河底捞鱼', ja: '河底撈魚', han: 1, closedOnly: false, yakuman: false },

  // ---------------- 二番役 ----------------
  sanshoku: { name: '三色同顺', ja: '三色同順', han: 2, hanOpen: 1, closedOnly: false, yakuman: false },
  ittsu: { name: '一气通贯', ja: '一気通貫', han: 2, hanOpen: 1, closedOnly: false, yakuman: false },
  chanta: { name: '混全带幺九', ja: '混全帯幺九', han: 2, hanOpen: 1, closedOnly: false, yakuman: false, note: '必须有顺子、必须有字牌' },
  sanshokuDoukou: { name: '三色同刻', ja: '三色同刻', han: 2, closedOnly: false, yakuman: false },
  sankantsu: { name: '三杠子', ja: '三槓子', han: 2, closedOnly: false, yakuman: false },
  toitoi: { name: '对对和', ja: '対々和', han: 2, closedOnly: false, yakuman: false },
  sanankou: { name: '三暗刻', ja: '三暗刻', han: 2, closedOnly: false, yakuman: false, note: '荣和补成的刻子算明刻' },
  shousangen: { name: '小三元', ja: '小三元', han: 2, closedOnly: false, yakuman: false, note: '自动复合两组三元牌役牌，实际最小 4 番' },
  honroutou: { name: '混老头', ja: '混老頭', han: 2, closedOnly: false, yakuman: false, note: '必须有字牌、不能全是字牌；与混全带幺九不复合' },
  chiitoitsu: { name: '七对子', ja: '七対子', han: 2, closedOnly: true, yakuman: false, note: '4 张同牌不能算 2 对；不与二杯口复合，按高点法二选一' },

  // ---------------- 三番役 ----------------
  ryanpeikou: { name: '二杯口', ja: '二盃口', han: 3, closedOnly: true, yakuman: false, note: '与一杯口不复合；允许 4 张同牌' },
  junchan: { name: '纯全带幺九', ja: '純全帯幺九', han: 3, hanOpen: 2, closedOnly: false, yakuman: false },
  honitsu: { name: '混一色', ja: '混一色', han: 3, hanOpen: 2, closedOnly: false, yakuman: false },

  // ---------------- 六番役 ----------------
  chinitsu: { name: '清一色', ja: '清一色', han: 6, hanOpen: 5, closedOnly: false, yakuman: false },

  // ---------------- 特殊（非役满） ----------------
  renhou: { name: '人和', ja: '人和', han: 5, closedOnly: true, yakuman: false, note: 'RCR 5 番（满贯）；天凤无此役，雀魂段位场无，需 rules.renhou 打开' },
  nagashiMangan: { name: '流局满贯', ja: '流局満貫', han: 5, closedOnly: false, yakuman: false, note: '按满贯结算，不计其他役' },

  // ---------------- 役满 ----------------
  tenhou: { name: '天和', ja: '天和', han: 13, closedOnly: true, yakuman: true },
  chiihou: { name: '地和', ja: '地和', han: 13, closedOnly: true, yakuman: true },
  daisangen: { name: '大三元', ja: '大三元', han: 13, closedOnly: false, yakuman: true },
  suuankou: { name: '四暗刻', ja: '四暗刻', han: 13, closedOnly: true, yakuman: true },
  suuankouTanki: { name: '四暗刻单骑', ja: '四暗刻単騎', han: 13, closedOnly: true, yakuman: true, double: true, note: '雀魂双倍役满；天凤为单倍' },
  tsuuiisou: { name: '字一色', ja: '字一色', han: 13, closedOnly: false, yakuman: true },
  ryuuiisou: { name: '绿一色', ja: '緑一色', han: 13, closedOnly: false, yakuman: true, note: '可以没有发' },
  chinroutou: { name: '清老头', ja: '清老頭', han: 13, closedOnly: false, yakuman: true },
  kokushi: { name: '国士无双', ja: '国士無双', han: 13, closedOnly: true, yakuman: true },
  kokushi13: { name: '国士无双十三面', ja: '国士無双十三面待ち', han: 13, closedOnly: true, yakuman: true, double: true, note: '雀魂双倍役满；天凤为单倍' },
  chuuren: { name: '九莲宝灯', ja: '九蓮宝燈', han: 13, closedOnly: true, yakuman: true },
  chuurenPure: { name: '纯正九莲宝灯', ja: '純正九蓮宝燈', han: 13, closedOnly: true, yakuman: true, double: true, note: '雀魂双倍役满；天凤为单倍' },
  suukantsu: { name: '四杠子', ja: '四槓子', han: 13, closedOnly: false, yakuman: true, note: '无包牌' },
  shousuushii: { name: '小四喜', ja: '小四喜', han: 13, closedOnly: false, yakuman: true },
  daisuushii: { name: '大四喜', ja: '大四喜', han: 13, closedOnly: false, yakuman: true, double: true, note: '有包牌；雀魂双倍役满，天凤为单倍' },
});

/**
 * 绿一色的合法牌集合：2/3/4/6/8 索 + 發（§1.6，「可以没有发」）。
 * @type {ReadonlySet<number>}
 */
const GREEN_TILES = Object.freeze(new Set([19, 20, 21, 23, 25, 32]));

/**
 * 构造一个役种条目。
 *
 * @param {string} id 役种 id（YAKU_DEFS 的键）
 * @param {{menzen?: boolean, multiplier?: number, note?: string}} [opts]
 *   - `menzen` 是否门清（false 且该役有食下番数时取食下番数）
 *   - `multiplier` 役满倍数（仅役满用）
 *   - `note` 覆盖默认备注
 * @returns {{id: string, name: string, ja: string, han: number, isYakuman: boolean, closedOnly: boolean, hanOpen?: number, multiplier?: number, note?: string}}
 * @throws {RangeError} id 未定义时抛出（防止拼写错误静默产出空役）
 */
function yakuEntry(id, opts = {}) {
  const d = YAKU_DEFS[id];
  if (!d) throw new RangeError(`yakuEntry: 未定义的役种 id "${id}"`);
  const multiplier = opts.multiplier === undefined ? 1 : opts.multiplier;
  const menzen = opts.menzen !== false;
  const han = d.yakuman
    ? YAKUMAN_HAN * multiplier
    : menzen || d.hanOpen === undefined
      ? d.han
      : d.hanOpen;
  return {
    id,
    name: d.name,
    ja: d.ja,
    han,
    isYakuman: d.yakuman,
    closedOnly: d.closedOnly,
    ...(d.hanOpen !== undefined ? { hanOpen: d.hanOpen } : {}),
    ...(d.yakuman ? { multiplier } : {}),
    ...(opts.note ?? d.note ? { note: opts.note ?? d.note } : {}),
  };
}

/**
 * 索引是否为幺九牌（内部快速版，入参已是 0–33）。
 *
 * @param {number} i 牌索引
 * @returns {boolean} 幺九牌返回 true
 */
function isYaochuIdx(i) {
  return i >= HONOR_START || i % 9 === 0 || i % 9 === 8;
}

/**
 * 索引是否为老头牌（数牌 1 / 9）。
 *
 * @param {number} i 牌索引
 * @returns {boolean} 老头牌返回 true
 */
function isTerminalIdx(i) {
  return i < HONOR_START && (i % 9 === 0 || i % 9 === 8);
}

/**
 * 手牌计数 → 「整手牌」计数（暗牌 + 副露展开）。
 *
 * 与 tiles.js 的 handWithMelds 的区别：这里**不做** 4 张上限校验，
 * 因为上游已经校验过、且此处只是统计用途（性能敏感）。
 *
 * @param {object} ctx 归一化后的 Context
 * @returns {number[]} 长度 34 的整手牌计数
 */
function handWithMeldsCount(ctx) {
  const counts = cloneHand(ctx.hand);
  for (const m of ctx.melds) for (const t of m.tiles) counts[t] += 1;
  return counts;
}

/**
 * 统计宝牌番数（宝牌 + 里宝牌 + 赤宝牌）。
 *
 * 里宝牌只在立直（含两立直）时计入；赤牌张数由调用方给出（计数数组不区分赤 5）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {number[]} counts 整手牌计数（含副露）
 * @returns {number} 宝牌番数合计
 */
function countDora(ctx, counts) {
  let n = 0;
  for (const ind of ctx.doraIndicators) n += counts[doraFromIndicator(ind)];
  if (ctx.isRiichi || ctx.isDoubleRiichi) {
    for (const ind of ctx.uraIndicators) n += counts[doraFromIndicator(ind)];
  }
  return n + ctx.redCount;
}

/**
 * 从手牌中减去一张和牌张（得到和牌前的 13 张形），用于国士十三面 / 纯正九莲的听牌形判定。
 *
 * @param {number[]} hand 归一化后的暗牌计数
 * @param {number} winTile 和牌张索引
 * @returns {number[]} 减一张后的计数数组
 * @throws {RangeError} 手中没有该牌时抛出
 */
function subtractWinTile(hand, winTile) {
  const out = cloneHand(hand);
  if (out[winTile] <= 0) {
    throw new RangeError(`subtractWinTile: 手中没有和牌张 ${tileToStr(winTile)}`);
  }
  out[winTile] -= 1;
  return out;
}

/**
 * 抢槓成立性判定（含国士抢暗杠规则）。
 *
 * 加槓（kakan）被抢是常规抢槓，任何牌型都成立；**暗杠**只有国士无双在
 * `rules.kokushiChankanAnkan === true` 时才允许（§1.8(7)，天凤 / 雀魂相反）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {'standard'|'chiitoi'|'kokushi'} form 和牌形
 * @returns {boolean} 抢槓成立返回 true
 */
function chankanAllowed(ctx, rules, form) {
  if (!ctx.isChankan) return false;
  if (!ctx.chankanIsAnkan) return true;
  return form === 'kokushi' && rules[KOKUSHI_CHANKAN_ANKAN] === true;
}

/**
 * 场景役（与具体牌型无关的役：立直系、自摸、偶然役）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {boolean} menzen 是否门清
 * @param {'standard'|'chiitoi'|'kokushi'} form 和牌形（抢槓规则用）
 * @returns {Array<object>} 役种条目
 */
function situationalYaku(ctx, rules, menzen, form) {
  const out = [];
  if (menzen && ctx.isDoubleRiichi) out.push(yakuEntry('doubleRiichi'));
  else if (menzen && ctx.isRiichi) out.push(yakuEntry('riichi'));
  const riichiLike = menzen && (ctx.isRiichi || ctx.isDoubleRiichi);
  // 一発与岭上开花、海底摸月不复合（§1.1）
  if (ctx.isIppatsu && riichiLike && !ctx.isRinshan && !ctx.isHaitei) out.push(yakuEntry('ippatsu'));
  if (menzen && ctx.isTsumo) out.push(yakuEntry('menzenTsumo'));
  if (chankanAllowed(ctx, rules, form)) out.push(yakuEntry('chankan'));
  if (ctx.isRinshan) out.push(yakuEntry('rinshan'));
  if (ctx.isHaitei) out.push(yakuEntry('haitei'));
  if (ctx.isHoutei) out.push(yakuEntry('houtei'));
  if (rules[RENHOU] && menzen && ctx.isRenhou && !ctx.isTsumo) out.push(yakuEntry('renhou'));
  return out;
}

/**
 * 役满场景项（天和 / 地和）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {boolean} menzen 是否门清
 * @returns {Array<object>} 役满条目
 */
function situationalYakuman(ctx, menzen) {
  const out = [];
  if (menzen && ctx.isTenhou) out.push(yakuEntry('tenhou'));
  if (menzen && ctx.isChiihou) out.push(yakuEntry('chiihou'));
  return out;
}

/**
 * 双倍役满开关下的倍数。
 *
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {boolean} isDouble 该役是否属于双倍候选
 * @returns {number} 1 或 2
 */
function doubleMultiplier(rules, isDouble) {
  return isDouble && rules[DOUBLE_YAKUMAN] ? 2 : 1;
}

/**
 * 统计「相同顺子」的对数（一杯口 = 1 对，二杯口 = 2 对）。
 *
 * 按 §4③ 的规则：相同顺子组数 n 只贡献 `floor(n / 2)` 对，
 * 所以 `123m×3` 只算 1 对（一杯口），`123m×4` 算 2 对（二杯口，且正是 §1.8(8) 允许的 4 张同牌形态）。
 *
 * @param {Array<{kind: string, tile: number}>} mentsu 面子视图
 * @returns {number} 相同顺子对数
 */
function identicalShuntsuPairs(mentsu) {
  const cnt = new Map();
  for (const m of mentsu) {
    if (m.kind !== 'shuntsu') continue;
    cnt.set(m.tile, (cnt.get(m.tile) || 0) + 1);
  }
  let pairs = 0;
  for (const n of cnt.values()) pairs += Math.floor(n / 2);
  return pairs;
}

/**
 * 三色同顺判定。
 *
 * @param {Array<{kind: string, tile: number}>} mentsu 面子视图
 * @returns {boolean} 成立返回 true
 */
function hasSanshokuDoujun(mentsu) {
  const starts = new Set(mentsu.filter((m) => m.kind === 'shuntsu').map((m) => m.tile));
  for (let rank = 0; rank <= 6; rank++) {
    if (starts.has(rank) && starts.has(9 + rank) && starts.has(18 + rank)) return true;
  }
  return false;
}

/**
 * 一气通贯判定（同一花色 123 + 456 + 789）。
 *
 * @param {Array<{kind: string, tile: number}>} mentsu 面子视图
 * @returns {boolean} 成立返回 true
 */
function hasIttsu(mentsu) {
  const starts = new Set(mentsu.filter((m) => m.kind === 'shuntsu').map((m) => m.tile));
  for (let s = 0; s < 3; s++) {
    if (starts.has(s * 9) && starts.has(s * 9 + 3) && starts.has(s * 9 + 6)) return true;
  }
  return false;
}

/**
 * 三色同刻判定。
 *
 * @param {Array<{kind: string, tile: number}>} mentsu 面子视图
 * @returns {boolean} 成立返回 true
 */
function hasSanshokuDoukou(mentsu) {
  const tiles = new Set(mentsu.filter((m) => m.kind !== 'shuntsu').map((m) => m.tile));
  for (let r = 0; r < 9; r++) {
    if (tiles.has(r) && tiles.has(9 + r) && tiles.has(18 + r)) return true;
  }
  return false;
}

/**
 * 花色 / 字牌使用情况。
 *
 * @param {number[]} counts 整手牌计数
 * @returns {{suits: Set<number>, hasHonor: boolean, fullyHonor: boolean}} 统计结果
 */
function suitUsage(counts) {
  const suits = new Set();
  let hasHonor = false;
  let allHonor = true;
  let any = false;
  for (let i = 0; i < HAND_SIZE; i++) {
    if (counts[i] === 0) continue;
    any = true;
    if (i >= HONOR_START) hasHonor = true;
    else {
      suits.add(Math.floor(i / 9));
      allHonor = false;
    }
  }
  return { suits, hasHonor, fullyHonor: any && allHonor };
}

/**
 * 是否全是幺九牌（混老头 / 清老头的必要条件）。
 *
 * @param {number[]} counts 整手牌计数
 * @returns {boolean} 全是幺九牌返回 true
 */
function allYaochu(counts) {
  for (let i = 0; i < HAND_SIZE; i++) {
    if (counts[i] > 0 && !isYaochuIdx(i)) return false;
  }
  return true;
}

/**
 * 是否全是老头牌（清老头）。
 *
 * @param {number[]} counts 整手牌计数
 * @returns {boolean} 全是老头牌返回 true
 */
function allTerminal(counts) {
  for (let i = 0; i < HAND_SIZE; i++) {
    if (counts[i] > 0 && !isTerminalIdx(i)) return false;
  }
  return true;
}

/**
 * 是否全是绿色牌（绿一色）。
 *
 * @param {number[]} counts 整手牌计数
 * @returns {boolean} 成立返回 true
 */
function allGreen(counts) {
  for (let i = 0; i < HAND_SIZE; i++) {
    if (counts[i] > 0 && !GREEN_TILES.has(i)) return false;
  }
  return true;
}

/**
 * 无役时的说明（供教程显示「为什么不能和」）。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @returns {string[]} 说明数组
 */
function noYakuNotes(ctx, rules) {
  const notes = [];
  if (ctx.doraIndicators.length > 0) {
    notes.push('宝牌 / 赤宝牌 / 里宝牌**不计入起和番**：没有真役时不能和牌（§3.7）');
  }
  if (!isMenzen(ctx.melds) && rules[KUITAN] === false) {
    notes.push('本规则集为「无食断」：副露后断幺九不成立，请检查是否只靠断幺九');
  }
  return notes;
}

/**
 * 空结果（非和牌形 / 规则禁止的和牌）。
 *
 * @param {string[]} notes 说明
 * @param {number} doraHan 宝牌番数（非和牌形时也如实报出，便于排查）
 * @returns {object} detectYaku 的返回结构
 */
function emptyResult(notes, doraHan = 0) {
  return {
    list: [],
    han: 0,
    yakumanCount: 0,
    isNagashi: false,
    hasYaku: false,
    doraHan,
    totalHan: 0,
    isKazoeYakuman: false,
    form: null,
    decomposition: null,
    fu: 0,
    fuDetail: null,
    notes,
  };
}

/**
 * 由「役种列表 + 役满倍数」组装中间结果。
 *
 * @param {Array<object>} list 役种条目
 * @param {number} yakumanCount 役满倍数
 * @returns {{list: Array<object>, han: number, yakumanCount: number}} 中间结果
 */
function summarize(list, yakumanCount) {
  let han = 0;
  for (const e of list) {
    if (!e.isYakuman) han += e.han;
  }
  return { list, han, yakumanCount };
}

/**
 * 评估标准形（4 面子 + 1 雀头）的一个具体拆解 + 和牌张角色。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {{pair: number, mentsu: Array<object>, winMentsu: number}} decom 拆解（含角色）
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {number[]} counts 整手牌计数
 * @returns {{list: Array<object>, han: number, yakumanCount: number}} 评估结果
 */
function evalStandard(ctx, decom, rules, counts) {
  const view = buildHandView(ctx, decom, rules);
  const wait = classifyWinTile(ctx, decom, decom.winMentsu);
  const menzen = view.isMenzen;
  const men = view.mentsu;
  const pair = view.pair;

  const shuntsu = men.filter((m) => m.kind === 'shuntsu');
  const koutsuLike = men.filter((m) => m.kind !== 'shuntsu');
  const concealedKoutsu = koutsuLike.filter((m) => m.concealed);
  const kans = men.filter((m) => m.isKan);
  const dragons = koutsuLike.filter((m) => m.tile >= DRAGON_START);
  const winds = koutsuLike.filter((m) => m.tile >= WIND_EAST && m.tile <= WIND_NORTH);

  // ---------- 役满（先判役满：役满不与任何非役满役、也不与宝牌复合，§4⑩） ----------
  const usage = suitUsage(counts);
  const yk = situationalYakuman(ctx, menzen);
  if (dragons.length === 3) yk.push(yakuEntry('daisangen'));
  if (winds.length === 4) {
    yk.push(yakuEntry('daisuushii', { multiplier: doubleMultiplier(rules, true) }));
  } else if (winds.length === 3 && pair >= WIND_EAST && pair <= WIND_NORTH) {
    yk.push(yakuEntry('shousuushii'));
  }
  if (concealedKoutsu.length === 4) {
    if (wait.type === 'tanki') {
      yk.push(yakuEntry('suuankouTanki', { multiplier: doubleMultiplier(rules, true) }));
    } else {
      yk.push(yakuEntry('suuankou'));
    }
  }
  if (kans.length === 4) yk.push(yakuEntry('suukantsu'));
  if (usage.fullyHonor) yk.push(yakuEntry('tsuuiisou'));
  else if (allTerminal(counts)) yk.push(yakuEntry('chinroutou'));
  if (allGreen(counts)) yk.push(yakuEntry('ryuuiisou'));

  // 九莲宝灯（门清限定；暗杠会破坏牌型，故要求完全没有副露）
  if (menzen && ctx.melds.length === 0) {
    const chuuren = findChuuren(ctx.hand);
    if (chuuren >= 0) {
      const hand13 = subtractWinTile(ctx.hand, ctx.winTile);
      const pure = isPureChuuren13(hand13, chuuren);
      yk.push(yakuEntry(pure ? 'chuurenPure' : 'chuuren', pure ? { multiplier: doubleMultiplier(rules, true) } : {}));
    }
  }

  if (yk.length > 0) {
    let count = 0;
    for (const e of yk) count += e.multiplier ?? 1;
    return summarize(yk, count);
  }

  // ---------- 非役满 ----------
  const list = situationalYaku(ctx, rules, menzen, 'standard');

  if (isPinfu(ctx, decom, rules)) list.push(yakuEntry('pinfu'));

  if (menzen) {
    const pairs = identicalShuntsuPairs(men);
    // 一杯口与二杯口互斥：2 对只计二杯口（§1.8(1)）
    if (pairs >= 2) list.push(yakuEntry('ryanpeikou'));
    else if (pairs === 1) list.push(yakuEntry('iipeikou'));
  }

  // 断幺九（含食断规则）
  if (!counts.some((n, i) => n > 0 && isYaochuIdx(i))) {
    if (menzen || rules[KUITAN]) list.push(yakuEntry('tanyao', { menzen }));
  }

  // 役牌（可叠加：连风刻子 = 场风 + 自风 = 2 番）
  for (const m of koutsuLike) {
    if (m.tile === 31) list.push(yakuEntry('yakuhaiHaku'));
    else if (m.tile === 32) list.push(yakuEntry('yakuhaiHatsu'));
    else if (m.tile === 33) list.push(yakuEntry('yakuhaiChun'));
    if (m.tile === ctx.roundWind) list.push(yakuEntry('yakuhaiRoundWind'));
    if (m.tile === ctx.seatWind) list.push(yakuEntry('yakuhaiSeatWind'));
  }

  if (hasSanshokuDoujun(men)) list.push(yakuEntry('sanshoku', { menzen }));
  if (hasIttsu(men)) list.push(yakuEntry('ittsu', { menzen }));
  if (hasSanshokuDoukou(men)) list.push(yakuEntry('sanshokuDoukou'));

  // 全带系：所有面子 + 雀头都含幺九牌
  if (shuntsu.length > 0) {
    const sets = [...men.map((m) => ({ kind: m.kind, tile: m.tile })), { kind: 'pair', tile: pair }];
    const allHaveYaochu = sets.every((s) =>
      s.kind === 'shuntsu' ? s.tile % 9 === 0 || s.tile % 9 === 6 : isYaochuIdx(s.tile),
    );
    const allHaveTerminal = sets.every((s) =>
      s.kind === 'shuntsu' ? s.tile % 9 === 0 || s.tile % 9 === 6 : isTerminalIdx(s.tile),
    );
    if (allHaveTerminal && !usage.hasHonor) list.push(yakuEntry('junchan', { menzen }));
    else if (allHaveYaochu && usage.hasHonor) list.push(yakuEntry('chanta', { menzen }));
  }

  if (kans.length === 3) list.push(yakuEntry('sankantsu'));
  if (shuntsu.length === 0) list.push(yakuEntry('toitoi'));
  if (concealedKoutsu.length === 3) list.push(yakuEntry('sanankou'));
  if (dragons.length === 2 && pair >= DRAGON_START) list.push(yakuEntry('shousangen'));

  // 混老头：全部幺九牌，且既有字牌又有老头牌（全是字牌属字一色，已在役满短路）
  if (allYaochu(counts)) {
    const hasTerminal = counts.some((n, i) => n > 0 && isTerminalIdx(i));
    if (usage.hasHonor && hasTerminal) list.push(yakuEntry('honroutou'));
  }

  if (usage.suits.size === 1) {
    if (usage.hasHonor) list.push(yakuEntry('honitsu', { menzen }));
    else list.push(yakuEntry('chinitsu', { menzen }));
  }

  return summarize(list, 0);
}

/**
 * 求九莲宝灯所在花色。
 *
 * 条件：整手牌只由一种数牌组成，且该花色计数为 1 与 9 各 ≥3、2–8 各 ≥1（共 14 张）。
 *
 * @param {number[]} hand 归一化后的暗牌计数（九莲必须门清无副露，故直接用暗牌）
 * @returns {number} 花色编号（0/1/2）；不成立返回 -1
 */
function findChuuren(hand) {
  for (let s = 0; s < 3; s++) {
    const c = [];
    let total = 0;
    for (let k = 0; k < 9; k++) {
      c[k] = hand[s * 9 + k];
      total += c[k];
    }
    if (total !== 14) continue;
    if (c[0] < 3 || c[8] < 3) continue;
    let ok = true;
    for (let k = 1; k <= 7; k++) {
      if (c[k] < 1) {
        ok = false;
        break;
      }
    }
    if (ok) return s;
  }
  return -1;
}

/**
 * 13 张手牌是否为「纯正九莲宝灯」的听牌形（1112345678999，九面听）。
 *
 * @param {number[]} hand13 和牌前的 13 张计数
 * @param {number} suit 花色编号
 * @returns {boolean} 是纯正九莲的 13 张形返回 true
 */
function isPureChuuren13(hand13, suit) {
  const c = [];
  let total = 0;
  for (let k = 0; k < 9; k++) {
    c[k] = hand13[suit * 9 + k];
    total += c[k];
  }
  if (total !== 13) return false;
  if (c[0] !== 3 || c[8] !== 3) return false;
  for (let k = 1; k <= 7; k++) {
    if (c[k] !== 1) return false;
  }
  return true;
}

/**
 * 评估七对子形。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @param {number[]} counts 整手牌计数
 * @returns {{list: Array<object>, han: number, yakumanCount: number}} 评估结果
 */
function evalChiitoi(ctx, rules, counts) {
  const yk = situationalYakuman(ctx, true);
  const { fullyHonor } = suitUsage(counts);
  if (fullyHonor) yk.push(yakuEntry('tsuuiisou'));
  if (yk.length > 0) {
    let count = 0;
    for (const e of yk) count += e.multiplier ?? 1;
    return summarize(yk, count);
  }

  const list = situationalYaku(ctx, rules, true, 'chiitoi');
  list.push(yakuEntry('chiitoitsu'));
  if (!counts.some((n, i) => n > 0 && isYaochuIdx(i))) list.push(yakuEntry('tanyao'));

  if (allYaochu(counts)) {
    const { hasHonor } = suitUsage(counts);
    const hasTerminal = counts.some((n, i) => n > 0 && isTerminalIdx(i));
    // 混老头与七对子可复合（§1.2）
    if (hasHonor && hasTerminal) list.push(yakuEntry('honroutou'));
  }

  const { suits, hasHonor } = suitUsage(counts);
  if (suits.size === 1) {
    if (hasHonor) list.push(yakuEntry('honitsu'));
    else list.push(yakuEntry('chinitsu'));
  }
  return summarize(list, 0);
}

/**
 * 评估国士无双形。
 *
 * @param {object} ctx 归一化后的 Context
 * @param {Readonly<Record<string, boolean|number>>} rules 规则集
 * @returns {{list: Array<object>, han: number, yakumanCount: number}} 评估结果
 */
function evalKokushi(ctx, rules) {
  const hand13 = subtractWinTile(ctx.hand, ctx.winTile);
  const thirteen = isKokushi13Tenpai(hand13);
  const multiplier = thirteen ? doubleMultiplier(rules, true) : 1;
  const list = [
    yakuEntry(thirteen ? 'kokushi13' : 'kokushi', {
      multiplier,
      note: thirteen
        ? multiplier === 2
          ? '十三面听：本规则集按双倍役满计（雀魂口径，§1.7）'
          : '十三面听：本规则集「すべてシングル役満」，仍按单倍役满计（天凤口径，§1.7）'
        : undefined,
    }),
    ...situationalYakuman(ctx, true),
  ];
  let count = 0;
  for (const e of list) count += e.multiplier ?? 1;
  return summarize(list, count);
}

/**
 * 按「番数优先、同番比符」排序役种列表（役满在前）。
 *
 * @param {Array<object>} list 役种条目
 * @returns {Array<object>} 排序后的新数组
 */
function sortYaku(list) {
  return list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.isYakuman !== b.e.isYakuman) return a.e.isYakuman ? -1 : 1;
      if (a.e.han !== b.e.han) return b.e.han - a.e.han;
      return a.i - b.i;
    })
    .map((x) => x.e);
}

/**
 * 役种判定主函数（高点法）。
 *
 * 流程：枚举全部候选（标准形拆解 × 和牌张角色、七对子、国士无双）
 * → 逐个评估役种并计算符数 → 取「番数最高，同番符数最高」者。
 *
 * @param {object} ctx 和牌上下文（Context 约定见本文件头部注释）
 * @param {Readonly<Record<string, boolean|number>>} [rules] 规则集（缺省 = 雀魂四人段位场）
 * @returns {{
 *   list: Array<{id: string, name: string, ja: string, han: number, isYakuman: boolean, closedOnly: boolean}>,
 *   han: number, yakumanCount: number, isNagashi: boolean, hasYaku: boolean,
 *   doraHan: number, totalHan: number, isKazoeYakuman: boolean,
 *   form: 'standard'|'chiitoi'|'kokushi'|'nagashi'|null, decomposition: object|null,
 *   fu: number, fuDetail: object|null, notes: string[]
 * }} 判定结果
 *   - `list` 役种条目（役满时只含役满；永不含宝牌条目）
 *   - `han` 真役番数合计（**不含宝牌**；役满时为 0）
 *   - `yakumanCount` 役满倍数（多役满复用时累加，双倍役满按 rules 计 2）
 *   - `doraHan` 宝牌 + 赤宝牌 + 里宝牌合计（役满时为 0）
 *   - `totalHan` 点数计算用总番 = `yakumanCount > 0 ? 13 × yakumanCount : han + doraHan`
 *   - `hasYaku` **起和判定**：只看真役（宝牌不计入起和番）
 *   - `fu` / `fuDetail` 由 `calcFu` 得出的符数（高点法比较时使用的同一个值）
 * @throws {TypeError|RangeError} ctx / rules 结构非法时抛出（不静默返回空结果）
 */
export function detectYaku(ctx, rules) {
  const c = normalizeContext(ctx);
  const r = resolveRules(rules);
  const counts = handWithMeldsCount(c);
  const doraHan = countDora(c, counts);

  // ---------- 流局满贯：按满贯结算，且不计其他役（§1.5） ----------
  if (c.isNagashiMangan && r[NAGASHI_MANGAN]) {
    const item = yakuEntry('nagashiMangan');
    return {
      list: [item],
      han: item.han,
      yakumanCount: 0,
      isNagashi: true,
      hasYaku: true,
      doraHan: 0,
      totalHan: item.han,
      isKazoeYakuman: false,
      form: 'nagashi',
      decomposition: null,
      fu: 0,
      fuDetail: null,
      notes: ['流局满贯按满贯点数结算（与符数、宝牌均无关）'],
    };
  }

  // ---------- 张数校验：不是 14 - 3 × 副露数 时不是和牌形 ----------
  const expected = 14 - 3 * c.melds.length;
  let total = 0;
  for (const n of c.hand) total += n;
  if (total !== expected) {
    return emptyResult(
      [`非和牌形：暗牌 ${total} 张，副露 ${c.melds.length} 组时和牌形应为 ${expected} 张`],
      doraHan,
    );
  }

  // ---------- 抢暗杠的合法性（国士抢暗杠规则，§1.8(7)） ----------
  if (c.isChankan && c.chankanIsAnkan) {
    const kokushiShape = c.melds.length === 0 && isKokushi(c.hand);
    if (!(kokushiShape && r[KOKUSHI_CHANKAN_ANKAN])) {
      return emptyResult(
        [
          '暗杠不能被抢槓：只有国士无双在 rules.kokushiChankanAnkan = true（雀魂）时才允许抢暗杠（§1.8(7)）',
        ],
        doraHan,
      );
    }
  }

  // ---------- 枚举候选：标准形（拆解 × 角色）/ 七对子 / 国士无双 ----------
  /** @type {Array<{form: string, decom: object|null}>} */
  const candidates = [];
  if (c.melds.length === 0 && isKokushi(c.hand)) {
    candidates.push({ form: 'kokushi', decom: null });
  }
  if (c.melds.length === 0 && isChiitoi(c.hand)) {
    candidates.push({ form: 'chiitoi', decom: null });
  }
  for (const d of decomposeStandard(c.hand, c.melds.length)) {
    for (const role of enumerateWinRoles(c, d)) {
      candidates.push({ form: 'standard', decom: { ...d, winMentsu: role } });
    }
  }

  if (candidates.length === 0) {
    return emptyResult(['非和牌形：暗牌无法拆成 4 面子 1 雀头，也不是七对子 / 国士无双形'], doraHan);
  }

  /** @type {{score: {list: Array<object>, han: number, yakumanCount: number}, fu: object, cand: object}|null} */
  let best = null;
  for (const cand of candidates) {
    const score =
      cand.form === 'kokushi'
        ? evalKokushi(c, r)
        : cand.form === 'chiitoi'
          ? evalChiitoi(c, r, counts)
          : evalStandard(c, cand.decom, r, counts);
    const fu = calcFu({ ...c, yakumanCount: score.yakumanCount }, cand.decom, r);
    // 高点法：先比番数（役满倍数优先），番数相同再比符数
    const rank = score.yakumanCount > 0 ? 1e6 + score.yakumanCount : score.han + doraHan;
    if (
      best === null ||
      rank > best.rank ||
      (rank === best.rank && fu.fu > best.fu.fu)
    ) {
      best = { score, fu, cand, rank };
    }
  }
  if (best === null) {
    return emptyResult(['非和牌形'], doraHan);
  }

  const isYakuman = best.score.yakumanCount > 0;
  const han = best.score.han;
  // 役满不与宝牌复合（§4⑩）：役满时宝牌番数一律作废
  const finalDora = isYakuman ? 0 : doraHan;
  const totalHan = isYakuman ? YAKUMAN_HAN * best.score.yakumanCount : han + finalDora;
  const list = sortYaku(best.score.list);
  const hasYaku = list.length > 0;
  const isKazoeYakuman = !isYakuman && totalHan >= KAZOE_YAKUMAN_HAN;

  /** @type {string[]} */
  const notes = [];
  if (!hasYaku) notes.push(...noYakuNotes(c, r));
  if (isKazoeYakuman) {
    notes.push(`累计役满：番数合计 ${totalHan} ≥ ${KAZOE_YAKUMAN_HAN} 番（含宝牌，§3.7），按役满点数结算`);
  }
  if (isYakuman && doraHan > 0) {
    notes.push(`役满不与宝牌复合：已忽略 ${doraHan} 番宝牌（§4⑩）`);
  }
  if (best.cand.form === 'chiitoi') {
    notes.push('本解按七对子形取点（高点法在高点比较中选中了它）');
  }

  return {
    list,
    han,
    yakumanCount: best.score.yakumanCount,
    isNagashi: false,
    hasYaku,
    doraHan: finalDora,
    totalHan,
    isKazoeYakuman,
    form: best.cand.form,
    decomposition: best.cand.decom,
    fu: best.fu.fu,
    fuDetail: best.fu,
    notes,
  };
}
