/**
 * 提示功能的校验
 * =====================================================================
 * 提示是给新手看的建议 —— **错的建议比没有建议糟糕得多**。所以这里要钉住两件事：
 *
 *   ① 提示给出的动作**必须真的在合法动作集合里**。绝不能自己造一个。
 *      这条 AI 上已经栽过一次：它先算最优打牌再直接用，但立直之后只能摸切，
 *      于是生成了非法动作，接上真实状态机立刻炸。
 *
 *   ② 输出的数字必须来自引擎。向听数、进张、听牌张都现算，
 *      提示和判定器不可能给出互相矛盾的说法。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHint, describeTile, settledYaku } from '../play/src/hint.js';
import { parseHand } from '../engine/tiles.js';
import { shanten } from '../engine/shanten.js';
import { discardUkeire } from '../engine/waits.js';
import {
  createGame, startHand, legalActions, applyAction, isHandOver, isGameOver,
} from '../game/index.js';
import { chooseAction, chooseDiscard } from '../play/src/ai.js';

/** 造一个够 buildHint 用的最小状态 */
function makeState({ hand, melds = [], legal, roundWind = 27, dealer = 0, pond = [], furiten = false }) {
  const players = [0, 1, 2, 3].map((seat) => ({
    seat,
    hand: seat === 0 ? parseHand(hand) : new Array(34).fill(0),
    melds: seat === 0 ? melds : [],
    pond: seat === 0 ? pond : [],
    riichi: false,
    furiten,
    score: 25000,
  }));
  return { players, roundWind, dealer, doraIndicators: [], turn: 0, phase: 'draw', aiLevel: [0, 2, 2, 2], legal };
}

const discards = (...tiles) => tiles.map((tile) => ({ type: 'discard', tile }));

/* ═══ 优先级 ═════════════════════════════════════════════════════ */

test('提示：能和就和 —— 这是唯一不用权衡的决定', () => {
  const st = makeState({
    hand: '123m456m789m123p55s',
    legal: [{ type: 'ron', tile: 22 }, ...discards(0, 1, 2)],
  });
  const h = buildHint(st, 0, st.legal);
  assert.equal(h.action.type, 'ron', '能荣和时应当推荐荣和');
});

test('提示：门清听牌时优先推荐立直，并且带上要打的那张', () => {
  // 234m567m34p678s11z + 9m 已经听 2p/5p，打 9m 即可立直
  const st = makeState({
    hand: '234m567m34p678s11z9m',
    legal: [{ type: 'riichi' }, ...discards(8, 10, 13)],
  });
  const h = buildHint(st, 0, st.legal);
  assert.equal(h.action.type, 'riichi', '门清听牌应当推荐立直');
  assert.notEqual(h.action.tile, undefined, '立直必须同时给出要打的牌');
  assert.ok([8, 10, 13].includes(h.action.tile), `立直报的牌 ${h.action.tile} 不在合法打牌里`);
});

test('提示：该鸣牌时按「最常用的和牌方式」建议不鸣', () => {
  const st = makeState({
    hand: '234m567m34p678s11z',
    legal: [{ type: 'pon', tile: 11 }, { type: 'pass' }],
  });
  const h = buildHint(st, 0, st.legal);
  assert.equal(h.action.type, 'pass', '新手向的提示应当建议先不鸣牌');
  assert.ok(h.lines.join('').includes('门前清'), '建议不鸣时必须说明理由');
});

/* ═══ 数字必须来自引擎 ═══════════════════════════════════════════ */

test('提示：推荐的打牌就是牌效率最优解，和引擎现算的结果一致', () => {
  const hands = [
    '234m567m34p6789s11z', '123m456m789m12p55s7s',
    '234m567m345p67s11z9s', '111m234p567p789s2z9s',
    '19m19p19s1234567z1m', '22334455m678p234s',
  ];
  for (const s of hands) {
    const hand = parseHand(s);
    const tiles = [];
    for (let t = 0; t < 34; t++) for (let k = 0; k < hand[t]; k++) tiles.push(t);
    const st = makeState({ hand: s, legal: discards(...tiles) });
    const h = buildHint(st, 0, st.legal);

    // 独立算一遍最优解：向听最小 → 进张最多
    const opts = discardUkeire(hand, 0);
    const bestSh = Math.min(...opts.map((o) => o.shanten));
    const bestTot = Math.max(...opts.filter((o) => o.shanten === bestSh).map((o) => o.total));
    const mine = opts.find((o) => o.discard === h.action.tile);

    assert.ok(mine, `「${s}」推荐的 ${h.action.tile} 不合法`);
    assert.equal(mine.shanten, bestSh, `「${s}」推荐的牌向听数不是最小`);
    assert.equal(mine.total, bestTot, `「${s}」推荐的牌进张数不是最多`);

    // 没有别的选择严格更优 —— 这正是「最优解」的定义，反过来验证一遍
    const strictlyBetter = opts.filter((o) =>
      o.shanten < mine.shanten || (o.shanten === mine.shanten && o.total > mine.total));
    assert.equal(strictlyBetter.length, 0,
      `「${s}」还有 ${strictlyBetter.length} 个更好的选择，提示没找到最优解`);
  }
});

/* ═══ 绝不造动作 ═════════════════════════════════════════════════ */

test('提示：给出的动作必须真的在合法集合里（绝不自己造）', () => {
  // 立直之后只能摸切：合法集合里只有一张牌，提示必须挑它，不能报别的
  const st = makeState({
    hand: '234m567m34p678s11z9m',
    legal: discards(8),
  });
  const h = buildHint(st, 0, st.legal);
  assert.equal(h.action.type, 'discard');
  assert.equal(h.action.tile, 8, '立直摸切时提示必须报唯一合法的那个');
});

test('提示：没有合法动作时不硬给建议', () => {
  const st = makeState({ hand: '234m567m34p678s11z9m', legal: [] });
  assert.equal(buildHint(st, 0, []), null, '没有合法动作应当返回 null');
});

/* ═══ 新手最容易死的那一处 ═══════════════════════════════════════ */

test('提示：鸣过牌又没役时必须警告 —— 这是新手最常见的死法', () => {
  // 吃过 123p（1 组副露），暗牌 11 张 = 234m 567s 678p + 東 + 9m
  // 打掉一张孤张后听单骑。这手牌刻意选成**一个役都没有**：
  //   有 1p → 不是断幺九；東是雀头不是刻子 → 不算役牌；
  //   123p/234m/567s 不同花色 → 没有一气通贯也没有三色同顺；
  //   鸣过牌 → 没有立直、平和、门前清自摸。
  // （第一版我随手写了 123m+456m+789m，那正好是一气通贯 —— 反倒把用例写废了。）
  const hand = '234m567s678p1z9m';
  const c = parseHand(hand);
  const tiles = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < c[t]; k++) tiles.push(t);
  assert.equal(tiles.length, 11, '一组的副露配 11 张暗牌才是打牌前的正确张数');

  const st = makeState({
    hand,
    melds: [{ type: 'chi', tiles: [9, 10, 11] }],   // 1p2p3p
    legal: discards(...tiles),
  });
  const h = buildHint(st, 0, st.legal);

  // 打掉 9m(8) 或東(27) 都能听单骑，两者等价 —— 提示挑哪个都算对
  assert.ok([8, 27].includes(h.action.tile),
    `应当推荐打掉孤张 9m(8) 或東(27)，实际推荐了 ${h.action.tile}`);
  assert.ok(h.warning, '鸣过牌又听无役，必须报红色警告 —— 不允许静悄悄地推荐一张牌');
  assert.ok(/役/.test(h.warning), '警告里必须点明「役」这个原因');
});

test('提示：副露张数不对时不该硬算（防御性）', () => {
  // 1 组副露却只有 9 张暗牌 —— 这在真实牌局里不可能出现，
  // 但提示是纯函数，喂进坏数据也不能崩
  const st = makeState({
    hand: '456m789m11z9m',
    melds: [{ type: 'chi', tiles: [0, 1, 2] }],
    legal: discards(8, 9, 10, 11, 12, 27),
  });
  assert.doesNotThrow(() => buildHint(st, 0, st.legal));
});

test('提示：门清听牌无役时说明「立直就有役」，而不是吓唬玩家', () => {
  // 234m567m34p678s11z 打 9m 后听 2p/5p，本身没有役
  const st = makeState({
    hand: '234m567m34p678s11z9m',
    legal: discards(8, 10, 13),
  });
  const h = buildHint(st, 0, st.legal);
  const said = h.lines.join('');
  assert.ok(/立直/.test(said), '门清无役时应当指出立直能解决，而不是只说「没有役」');
  assert.equal(h.warning, null, '门清无役不该报红色警告 —— 立直就能解决，吓唬新手是错的');
});

/* ═══ 说得出「为什么是这张」 ═════════════════════════════════════ */

test('提示：说得出这张牌在手里是什么角色 —— 而不只是丢一个数字', () => {
  const d = (hand, tile) => describeTile(parseHand(hand), tile);

  // 9s 孤零零一张（手里没有 7s/8s）
  assert.ok(/孤张/.test(d('234m567m234p11z55s9s', 26)), '9s 应当是孤张');
  // 5s 有两张
  assert.ok(/对子/.test(d('234m567m234p11z55s9s', 22)), '两张 5s 应当是对子的一半');
  // 5s 有三张
  assert.ok(/刻子/.test(d('234m567m234p11z555s', 22)), '三张 5s 应当是刻子');
  // 3p4p 搭得上
  assert.ok(/搭子/.test(d('234m567m34p11z55s78s', 11)), '3p 和 4p 应当算搭子');
  // 单个字牌
  assert.ok(/字牌/.test(d('234m567m234p1z55s78s', 27)), '单张東应当被点明是字牌');
});

test('提示：打牌建议里确实带上了「为什么」这句', () => {
  const hand = '234m567m34p6789s11z';
  const c = parseHand(hand);
  const tiles = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < c[t]; k++) tiles.push(t);
  const st = makeState({ hand, legal: discards(...tiles) });
  const h = buildHint(st, 0, st.legal);
  const first = h.lines[0];
  assert.ok(/孤张|搭子|对子|刻子|字牌/.test(first),
    `第一条理由必须说明这张牌是什么角色，实际是「${first}」`);
});

/* ═══ 已经确定的役：用来避免误报 ═════════════════════════════════ */

test('提示：认得出手里已经到手的役', () => {
  const y = (hand, melds = [], dealer = 0) =>
    settledYaku(makeState({ hand, melds, legal: [], dealer }), 0);

  assert.ok(y('234m567m234p1z9s', [{ type: 'pon', tiles: [31, 31, 31] }]).some((x) => /白/.test(x)),
    '碰了白应当认出役牌白');
  assert.ok(y('234m567m234p55s6m').some((x) => /断幺九/.test(x)), '全中张应当认出断幺九');
  assert.ok(y('123m456m789m1122m').some((x) => /清一色/.test(x)), '全萬子应当认出清一色');
  assert.ok(y('123m456m789m11m1z').some((x) => /混一色/.test(x)), '萬子+字牌应当认出混一色');
  assert.ok(y('234m567m234p11z55s9s').some((x) => /门前清/.test(x)), '没有副露应当认出可以立直');
});

test('提示：碰了白（役牌已在手）就不该再唠叨「没役」—— 这是之前的误报', () => {
  // 碰了白，但手牌离听牌还有两步：早先只看「有没有副露」，
  // 于是役牌明明在手的玩家也会被告知「还没看出役在哪」。
  const hand = '234m56m23p11z2z9s';
  const c = parseHand(hand);
  const tiles = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < c[t]; k++) tiles.push(t);
  const st = makeState({ hand, melds: [{ type: 'pon', tiles: [31, 31, 31] }], legal: discards(...tiles) });
  const h = buildHint(st, 0, st.legal);

  assert.equal(h.warning, null,
    `手里明明有役牌白，却报了「没役」的警告：${h.warning}`);
  assert.ok(h.lines.join('').includes('役牌'),
    '既然认出了已经在手的役，就该把方向说出来，而不是沉默');
});

test('提示：门清手牌也不会被唠叨 —— 立直永远是一条退路', () => {
  const hand = '19m19p19s1234z5678z'.slice(0, 14);   // 随便一手远得很的牌
  const st = makeState({ hand: '19m19p19s1234567z1m', legal: [] });
  const st2 = makeState({ hand: '19m19p19s1234567z1m', legal: discards(0, 1, 9, 10, 18, 19, 27) });
  const h = buildHint(st2, 0, st2.legal);
  if (h && h.warning) {
    assert.ok(!/还没看出役/.test(h.warning),
      '门清手牌不该被告知「没看出役在哪」—— 立直就是役');
  }
});

/* ═══ 振听 ═══════════════════════════════════════════════════════ */

test('提示：振听时必须说清楚「为什么不能荣和」', () => {
  const hand = '234m567m34p678s11z9m';
  const c = parseHand(hand);
  const tiles = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < c[t]; k++) tiles.push(t);
  const st = makeState({ hand, legal: discards(...tiles), furiten: true, pond: [10] });
  const h = buildHint(st, 0, st.legal);

  assert.ok(h.warning, '振听时必须报警');
  assert.ok(/振听/.test(h.warning), '警告要点明是振听');
  assert.ok(/自摸/.test(h.warning), '要告诉玩家振听时还能自摸 —— 否则他会以为整手牌废了');
});

/* ═══ 稳定性 ═════════════════════════════════════════════════════ */

test('提示：同样的局面每次给同样的答案（不能点一下变一个）', () => {
  const mk = () => makeState({
    hand: '234m567m34p6789s11z',
    legal: discards(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 27),
  });
  const a = buildHint(mk(), 0, mk().legal);
  for (let i = 0; i < 5; i++) {
    const b = buildHint(mk(), 0, mk().legal);
    assert.equal(b.action.tile, a.action.tile, '同一局面给了不同的建议');
    assert.equal(b.title, a.title);
  }
});

/* ═══ 端到端：真牌局里每一步都必须合法 ═══════════════════════════ */

test('提示：在真实牌局里逐手校验，给出的动作永远是合法的', () => {
  let checked = 0;
  let withAction = 0;
  let wrong = 0;

  for (const seed of [1, 7, 12345, 999, 20260101]) {
    const S = createGame({ seed, aiLevel: [0, 2, 2, 2] });
    startHand(S);

    for (let step = 0; step < 3000; step++) {
      if (isGameOver(S) || isHandOver(S)) break;

      // 人类座位有决策时就检查提示
      const mine = legalActions(S, 0);
      if (mine.length) {
        const h = buildHint(S, 0, mine);
        checked++;
        if (h && h.action) {
          withAction++;
          const ok = mine.some((a) =>
            a.type === h.action.type
            && (a.tile === undefined || h.action.tile === undefined || a.tile === h.action.tile));
          if (!ok) {
            wrong++;
            assert.fail(`种子 ${seed}：提示给出 ${JSON.stringify(h.action)}，`
              + `但合法动作只有 ${JSON.stringify(mine)}`);
          }
        }
      }

      // 让某个座位推进一步
      let moved = false;
      for (let s = 0; s < 4 && !moved; s++) {
        const seat = (S.turn + s) % 4;
        const legal = legalActions(S, seat);
        if (!legal.length) continue;
        const act = chooseAction(S, seat, legal);
        if (act) { applyAction(S, seat, act); moved = true; break; }
        const d = chooseDiscard(S, seat, legal);
        if (d != null) { applyAction(S, seat, { type: 'discard', tile: d }); moved = true; break; }
        applyAction(S, seat, legal[0]);
        moved = true;
      }
      if (!moved) break;
    }
  }

  assert.ok(checked >= 40, `只检查了 ${checked} 次人类决策，覆盖不够`);
  // 光看 checked 不够：如果 buildHint 哪天开始一律返回 null，
  // 「动作永远合法」就成了句废话。所以还要确认真的给出了建议。
  assert.ok(withAction >= 30,
    `检查了 ${checked} 次决策，但只有 ${withAction} 次真的给出了建议 —— `
    + '这条「动作永远合法」的断言会变成空测试');
  assert.equal(wrong, 0);
});
