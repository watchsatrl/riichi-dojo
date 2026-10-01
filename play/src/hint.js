/**
 * hint.js —— 给玩家的提示
 *
 * 只按**最常用的和牌方式**推荐：门清做牌 → 听牌 → 立直 → 荣和。
 * 刻意不做押引判断、不看点数状况、不读对手 —— 那些是另一个层次的东西，
 * 混进来只会让新手看不懂「为什么推荐这张」。
 *
 * ─── 理由是怎么来的（说清楚，免得误解）─────────────────────────
 * **没有语言模型，没有「生成」。** 每一条理由都是：
 *
 *     手写的句子模板  +  引擎算出来的数字/真假值  +  几个条件分支
 *
 * 每个数字都可追溯（向听数、进张、听牌张、役种都来自 engine），
 * 每句话的措辞都是预先写死的。代价是模板不知道上下文，会在边界情况说错话 ——
 * 下面 `settledYaku` 和 `describeTile` 两个函数就是专门补这个漏的。
 */

import { cloneHand } from '../../engine/tiles.js';
import { shanten } from '../../engine/shanten.js';
import { discardUkeire } from '../../engine/waits.js';
import { isAgari } from '../../engine/agari.js';
import { canRonReasons } from '../../engine/furiten.js';
import { SAKURA_4P } from '../../engine/rules.js';
import { tileName, rankOf, suitOf } from '../../ui/tiles.js';

const SHANTEN_LABEL = (n) => (n <= 0 ? '听牌' : n === 1 ? '一向听' : n === 2 ? '两向听' : `${n} 向听`);

const windOf = (state, seat) => (seat - state.dealer + 4) % 4;

/* ══ 这张牌在手里是什么角色 ═════════════════════════════════════ */

/**
 * 描述某张牌的结构位置。
 *
 * 为什么需要它：光说「有效进张 24 张」是在给数字，不是在给理由。
 * 人教练会说「九萬和手里其他牌都挨不着」——这个判断引擎早就算得出来，
 * 只是我之前没把它说出来。
 */
export function describeTile(count, tile) {
  if (count[tile] >= 3) return '它属于一个刻子，打掉就把刻子拆了';
  if (count[tile] === 2) return '它是对子的一半，留着可以做雀头';
  if (tile >= 27) return '字牌只能靠凑刻子，这张身边没有同类';

  const s = suitOf(tile);
  const r = rankOf(tile);
  const has = (rr) => rr >= 1 && rr <= 9 && count[s * 9 + rr - 1] > 0;
  // 同花色里隔两张以内才算「搭得上」。
  // 注意 has() 收的是**点数**不是偏移量 —— 一开始写成 `.some(has)` 直接传
  // -2/-1/1/2，等于去查点数 -2、-1 的位置，任何牌都会被判成孤张。
  if (![-2, -1, 1, 2].some((d) => has(r + d))) return '它和手里其他牌都挨不着，是一张孤张';
  return '它和旁边的牌能搭上，打掉它等于拆掉一个搭子';
}

/* ══ 已经板上钉钉的役 ═══════════════════════════════════════════ */

/**
 * 这手牌里**已经确定**的役。
 *
 * 用途只有一个：**避免误报**。
 * 早先的警告只看「有没有副露」，结果碰了白（役牌已经在手、方向清清楚楚）的人
 * 也会被告知「还没看出役在哪」。数字（向听数）是对的，但由数字推出的那句话
 * 是我断言的，而断言没覆盖到这种情况。
 *
 * 这里只列「无论后面怎么打都跑不掉」的役 —— 宁可不报，也不能误报。
 */
export function settledYaku(state, seat) {
  const p = state.players[seat];
  const melds = p.melds || [];
  const all = p.hand.slice();
  for (const m of melds) for (const t of m.tiles) all[t]++;

  const out = [];
  const round = state.roundWind;
  const own = 27 + windOf(state, seat);

  if (all[31] >= 3) out.push('役牌・白');
  if (all[32] >= 3) out.push('役牌・發');
  if (all[33] >= 3) out.push('役牌・中');
  if (all[round] >= 3) out.push('役牌・场风');
  if (all[own] >= 3) out.push('役牌・自风');

  // 断幺九：一张幺九牌、一张字牌都没有
  if (all.every((n, t) => n === 0 || (t < 27 && rankOf(t) >= 2 && rankOf(t) <= 8))) {
    out.push('断幺九');
  }

  // 一色系：只用一种花色（+ 字牌）
  const suits = new Set();
  let honor = false;
  for (let t = 0; t < 34; t++) {
    if (!all[t]) continue;
    if (t >= 27) honor = true;
    else suits.add(suitOf(t));
  }
  if (suits.size === 1) out.push(honor ? '混一色' : '清一色');

  // 门清：听牌后立直就有役，所以永远有退路
  if (!melds.length) out.push('门前清（听牌立直即有役）');

  return out;
}

/* ══ 引擎查询 ═══════════════════════════════════════════════════ */

/** 加一张牌之后能和的那些牌 */
function winningTiles(hand13, meldCount) {
  const out = [];
  for (let t = 0; t < 34; t++) {
    if (hand13[t] >= 4) continue;
    const c = hand13.slice();
    c[t]++;
    if (isAgari(c, meldCount)) out.push(t);
  }
  return out;
}

/** 荣和判定用的上下文骨架（字段与判定器一致，缺一个都会算错役） */
function ctxFor(state, seat, hand, winTile) {
  const p = state.players[seat];
  return {
    hand,
    melds: p.melds || [],
    winTile,
    isTsumo: false,
    roundWind: state.roundWind,
    seatWind: 27 + windOf(state, seat),
    isRiichi: false, isDoubleRiichi: false, isIppatsu: false, isChankan: false,
    isRinshan: false, isHaitei: false, isHoutei: false, isTenhou: false, isChiihou: false,
    doraIndicators: state.doraIndicators || [], uraIndicators: [], redCount: 0,
    isNagashiMangan: false,
    pond: p.pond || [],
  };
}

/** 打掉某张牌之后，听什么、有没有役。只对推荐的那一张算 —— 全算一遍会卡。 */
function lookAhead(state, seat, discardTile) {
  const p = state.players[seat];
  const meldCount = (p.melds || []).length;
  const hand13 = cloneHand(p.hand);
  hand13[discardTile]--;

  const waits = winningTiles(hand13, meldCount);
  if (!waits.length) return { tenpai: false, waits: [], yaku: [] };

  const yaku = new Set();
  for (const w of waits) {
    const c = hand13.slice();
    c[w]++;
    const r = canRonReasons(ctxFor(state, seat, c, w), SAKURA_4P);
    if (r.ok) for (const y of r.yaku.list) yaku.add(y.name);
  }
  return { tenpai: true, waits, yaku: [...yaku] };
}

/** 向听最小、进张最多；同分时取最靠前的一个（提示每次都该给同样的答案） */
function pickBest(hand, meldCount, allowed) {
  const opts = discardUkeire(hand, meldCount).filter((o) => !allowed || allowed.has(o.discard));
  if (!opts.length) return null;

  let best = opts[0];
  for (const o of opts) {
    if (o.shanten < best.shanten) best = o;
    else if (o.shanten === best.shanten && o.total > best.total) best = o;
  }
  const tied = opts.filter((o) => o.shanten === best.shanten && o.total === best.total);
  return { ...tied[0], tiedCount: tied.length };
}

/* ══ 主入口 ═════════════════════════════════════════════════════ */

/**
 * 生成一条提示。
 * @returns {null|{action:object, title:string, lines:string[], warning:string|null, highlight:number|null}}
 */
export function buildHint(state, seat, legal) {
  if (!legal || !legal.length) return null;
  const p = state.players[seat];
  const hand = cloneHand(p.hand);
  const meldCount = (p.melds || []).length;
  const myDiscardTurn = legal.some((a) => a.type === 'discard');
  const allowed = new Set(legal.filter((a) => a.type === 'discard').map((a) => a.tile));
  const settled = settledYaku(state, seat);

  /* ① 能和就和 —— 唯一不用想的选择 */
  const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
  if (win) {
    return {
      action: win,
      title: win.type === 'tsumo' ? '自摸，和牌' : '荣和',
      lines: [
        win.type === 'tsumo'
          ? '自己摸到了和牌张。三家都要付你点数。'
          : '别人打出的牌正好是你的和牌张。放铳的那一家一个人付全部点数。',
        '能和就和 —— 这是整套规则里唯一不需要权衡的决定。',
      ],
      warning: null,
      highlight: null,
    };
  }

  /* ② 立直：门清听牌时，这是最常用的和牌方式 */
  if (legal.some((a) => a.type === 'riichi') && myDiscardTurn) {
    const best = pickBest(hand, meldCount, allowed);
    if (best) {
      return {
        action: { type: 'riichi', tile: best.discard },
        title: `宣告立直，打 ${tileName(best.discard)}`,
        lines: [
          `${tileName(best.discard)}${describeTile(hand, best.discard)}，打掉之后 ${SHANTEN_LABEL(best.shanten)}，有效进张 ${best.total} 张。`,
          '立直交 1000 点作抵押，换来 1 番。',
          '但对新手来说它更重要的是：**门清听牌立直之后，别人打出来你就能和** —— '
            + '立直本身就是一个役，解决了「凑齐却没役」的问题。',
        ],
        warning: null,
        highlight: best.discard,
      };
    }
  }

  /* ③ 轮到决定要不要鸣牌 */
  if (!myDiscardTurn) {
    const call = legal.find((a) => ['chi', 'pon', 'kan'].includes(a.type));
    if (call) {
      const isYakuhai = call.tile != null
        && [27 + windOf(state, seat), state.roundWind, 31, 32, 33].includes(call.tile);
      return {
        action: legal.find((a) => a.type === 'pass') || null,
        title: isYakuhai ? `可以碰 ${tileName(call.tile)}` : '过，先不鸣牌',
        lines: isYakuhai
          ? [
            `这张 ${tileName(call.tile)} 是**役牌**，碰下去本身就是一个役。`,
            '但碰完之后暗牌只剩 10 张，能做的变化就少了 —— 手牌离听牌还远的话，先不碰也不亏。',
          ]
          : [
            '最常用的和牌方式是**门前清**：不鸣牌，靠立直拿役。',
            '鸣牌会让暗牌少 3 张，还可能把役鸣没 —— 新手先不鸣最稳。',
            '例外：能凑出**役牌**（三元牌 白發中，或场风、自风的刻子）时才值得碰。',
          ],
        warning: null,
        highlight: null,
      };
    }
    return {
      action: legal.find((a) => a.type === 'pass') || null,
      title: '过',
      lines: ['现在没有需要做的事，跳过就好。'],
      warning: null,
      highlight: null,
    };
  }

  /* ④ 打牌：向听最小 → 进张最多 */
  const best = pickBest(hand, meldCount, allowed);
  if (!best) {
    return {
      action: null,
      title: '没有可打的牌',
      lines: ['合法动作里没有打牌选项，这是状态机的问题，不是你打错了。'],
      warning: null,
      highlight: null,
    };
  }

  const after = lookAhead(state, seat, best.discard);
  const lines = [
    `${tileName(best.discard)}${describeTile(hand, best.discard)}。`,
    `打掉它之后：${SHANTEN_LABEL(best.shanten)}，有效进张 ${best.total} 张。`,
    best.tiedCount > 1
      ? `有 ${best.tiedCount} 张牌效果完全相同，随便打哪张都行。`
      : '这是唯一的最优解。',
  ];

  let warning = null;

  if (after.tenpai) {
    lines.push(`打掉之后听：${after.waits.map(tileName).join('、')}`);
    if (after.yaku.length) {
      lines.push(`能和的话，役是：${after.yaku.join('、')}`);
    } else if (!meldCount) {
      lines.push('这手牌目前没有役，但你是门清 —— 听牌后**宣告立直**就有役了。');
    } else {
      warning = '⚠ 你已经鸣过牌，这样听牌**没有役**：就算别人打出你听的牌，也不能和。'
        + '需要往役牌或断幺九的方向改。';
    }
  } else if (best.shanten <= 2 && meldCount && !settled.length) {
    // 只有在「确实看不出役」时才唠叨。
    // 早先这里只判断「有没有副露」，于是碰了白（役牌已经在手）的人也会被误报。
    warning = '⚠ 你鸣过牌，但还没看出役在哪。鸣牌之后「凑齐却没役」是新手最常见的死法 —— '
      + '先确认这手牌能做出什么役，再决定要不要继续鸣。';
  } else if (settled.length) {
    lines.push(`你这手牌已经有 ${settled.join('、')} —— 方向是清楚的。`);
  }

  // 振听：说得出原因才帮得上忙，所以点明「为什么不能荣和」
  if (p.furiten) {
    warning = '⚠ 你现在**振听**：别人打出你听的牌也不能荣和，只能自摸。'
      + '常见原因是自己的牌河里有你要的牌，或者之前见逃过。'
      + (warning ? ` ${warning}` : '');
  }

  return {
    action: { type: 'discard', tile: best.discard },
    title: `打 ${tileName(best.discard)}`,
    lines,
    warning,
    highlight: best.discard,
  };
}
