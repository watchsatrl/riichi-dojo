/**
 * 和了 / 流局结算测试 —— 直接执行：
 *   node tests/game-settle.test.mjs
 *
 * 覆盖：不听罚符三档、流局满贯、途中流局不收付、本场加点、立直棒归属、
 * 包牌（只包包牌役满那一部分）、连庄 / 轮庄 / 终局判定、击飞、顺位马与同点顺位。
 */

import {
  createGame,
  settleWin,
  settleDraw,
  advanceHand,
  isNagashiMangan,
  renchanOf,
  rank1Seat,
  computeRanking,
  seatWindOf,
  PAO_YAKU,
} from '../game/index.js';
import { parseHand, strToTile, tileToStr, handToStr, totalTiles } from '../engine/index.js';

// ---------------------------------------------------------------------------
// 极简测试框架
// ---------------------------------------------------------------------------
let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    failures.push([name, err]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function assertEq(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || '值不相等'}：实际 ${sa}，期望 ${sb}`);
}
function assertThrows(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(msg || '本应抛错但没有');
}
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** 造一个干净的对局状态（点数 25000 × 4） */
function newState(over = {}) {
  return createGame({ seed: over.seed === undefined ? 20260930 : over.seed, ...over });
}

/** 把四个座位的点数设成指定值（总和 + 供托必须仍是 100000） */
function setScores(state, scores) {
  const total = scores.reduce((a, b) => a + b, 0) + state.riichiSticks * 1000;
  assert(total === 100000, `测试点数总和 + 供托应为 100000，实际 ${total}`);
  for (let s = 0; s < 4; s++) state.players[s].score = scores[s];
}

// ===========================================================================
// 1. 不听罚符（rules.md §10.3）
// ===========================================================================
test('不听罚符三档数值：1 听 / 2 听 / 3 听 / 0 听 / 4 听', () => {
  const cases = [
    { tenpai: [true, false, false, false], deltas: [3000, -1000, -1000, -1000] },
    { tenpai: [true, true, false, false], deltas: [1500, 1500, -1500, -1500] },
    { tenpai: [true, true, true, false], deltas: [1000, 1000, 1000, -3000] },
    { tenpai: [false, false, false, false], deltas: [0, 0, 0, 0] },
    { tenpai: [true, true, true, true], deltas: [0, 0, 0, 0] },
  ];
  for (const c of cases) {
    const state = newState();
    const r = settleDraw(state, 'exhaustive', c.tenpai);
    assertEq(r.deltas, c.deltas, `听牌分布 ${JSON.stringify(c.tenpai)} 的罚符`);
    assertEq(sum(r.deltas), 0, '罚符总和应为 0');
    assertEq(r.kind, 'exhaustive', 'kind 应保持 exhaustive');
  }
});

test('途中流局一律不产生收付（§10.1）', () => {
  for (const kind of ['kyuushu', 'suufonrenda', 'suuchariichi', 'sukanagare']) {
    const state = newState();
    const r = settleDraw(state, kind, [true, false, false, false]);
    assertEq(r.deltas, [0, 0, 0, 0], `${kind} 不应有收付`);
    assertEq(r.payments, [], `${kind} 不应有支付明细`);
    assertEq(r.kind, kind, 'kind 应原样返回');
  }
  assertThrows(() => settleDraw(newState(), 'bogus', [false, false, false, false]), '未知流局种类应抛错');
});

// ===========================================================================
// 2. 流局满贯（rules.md §10.4）
// ===========================================================================
function nagashiState() {
  const state = newState();
  // 座位 1 牌河全是幺九牌且未被鸣；其余三家正常
  state.players[1].pond = [strToTile('1m'), strToTile('9p'), strToTile('1z'), strToTile('2z')];
  state.players[1].pondCalled = [false, false, false, false];
  for (const s of [0, 2, 3]) {
    state.players[s].pond = [strToTile('5m'), strToTile('6p')];
    state.players[s].pondCalled = [false, false];
  }
  return state;
}

test('流局满贯成立判定：全幺九 + 未被鸣（自己鸣牌不影响）', () => {
  const state = nagashiState();
  assertEq(isNagashiMangan(state, 1), true, '全幺九未被鸣应成立');
  assertEq(isNagashiMangan(state, 0), false, '含中张牌不成立');
  state.players[1].pondCalled[1] = true;
  assertEq(isNagashiMangan(state, 1), false, '自己的牌河被鸣走则不成立');
  state.players[1].pondCalled[1] = false;
  // 自己鸣过牌不影响成立（§10.4 常见误解纠正）
  state.players[1].melds = [{ type: 'pon', tiles: [0, 0, 0], calledTile: 0 }];
  assertEq(isNagashiMangan(state, 1), true, '自己鸣牌不影响流局满贯');
  assertEq(isNagashiMangan(state, 1) && state.rules.nagashiMangan, true, '规则开关默认开启');
});

test('流局满贯：按满贯清算，替代听牌清算', () => {
  const state = nagashiState();
  const r = settleDraw(state, 'exhaustive', [false, false, false, false]);
  assertEq(r.kind, 'nagashi', '有流满时应升级为 nagashi');
  assertEq(r.nagashiSeats, [1], '只有座位 1 成立');
  // 座位 1 是子家（庄家 0）→ 满贯自摸：亲家付 4000、子家各付 2000
  assertEq(r.deltas, [-4000, 8000, -2000, -2000], '满贯自摸的收付');
  assertEq(sum(r.deltas), 0, '总和应为 0');
  // 不听罚符不再发生（tenpai 全 false 也没有 3000 的收付）
  assert(!r.payments.some((p) => p.amount === 1000 && p.seat === 0), '不应同时进行听牌清算');
});

test('流局满贯：多家同时成立时各自按满贯自摸清算', () => {
  const state = nagashiState();
  state.players[2].pond = [strToTile('1s'), strToTile('9s')];
  state.players[2].pondCalled = [false, false];
  const r = settleDraw(state, 'exhaustive', [false, false, false, false]);
  assertEq(r.nagashiSeats, [1, 2], '座位 1、2 都成立');
  assertEq(r.kind, 'nagashi', 'kind 应为 nagashi');
  assertEq(sum(r.deltas), 0, '总和应为 0');
  assertEq(r.deltas[1] > 0 && r.deltas[2] > 0, true, '两家都应得分');
  assertEq(r.deltas[0] < 0 && r.deltas[3] < 0, true, '其余两家都应支付');
});

// ===========================================================================
// 3. 和了结算：本场与立直棒（rules.md §2.4 / §2.5 / §9）
// ===========================================================================
/** 造一个「子家断幺九荣和」的和了上下文 */
function tanyaoRonState() {
  const state = newState({ seed: 7 });
  state.players[1].melds = [{ type: 'chi', tiles: [1, 2, 3], calledTile: 3 }]; // 234m
  state.players[1].menzen = false;
  return state;
}

test('荣和：放铳者全额支付本场 300 × 本场（§2.4）', () => {
  const ctxOf = () => ({
    hand: parseHand('567m234p55s678s'),
    winTile: strToTile('8s'),
    isTsumo: false,
    discarder: 0,
  });
  const s0 = tanyaoRonState();
  s0.honba = 0;
  const r0 = settleWin(s0, 1, ctxOf());
  assertEq(r0.payments.ron, undefined, 'payments 明细里用 breakdown 表达');
  assertEq(r0.payments.breakdown, [{ seat: 0, amount: 1000 }], '子家 1 番 30 符 = 1000');
  assertEq(r0.deltas, [-1000, 1000, 0, 0], '放铳者全额、其余不动');

  const s2 = tanyaoRonState();
  s2.honba = 3;
  const r2 = settleWin(s2, 1, ctxOf());
  assertEq(r2.payments.breakdown, [{ seat: 0, amount: 1900 }], '3 本场：1000 + 300 × 3');
  assertEq(r2.deltas, [-1900, 1900, 0, 0], '本场由放铳者全付');
});

test('自摸：本场三家各付 100 × 本场（§2.4）', () => {
  const state = newState({ seed: 8 });
  state.players[1].melds = [{ type: 'chi', tiles: [1, 2, 3], calledTile: 3 }];
  state.players[1].menzen = false;
  state.honba = 2;
  const r = settleWin(state, 1, {
    hand: parseHand('567m234p55s678s'),
    winTile: strToTile('8s'),
    isTsumo: true,
    discarder: null,
  });
  // 子家 1 番 30 符 自摸 = 300 / 500，含 2 本场 → 亲家 700、子家各 500
  assertEq(r.payments.breakdown, [
    { seat: 0, amount: 700 },
    { seat: 2, amount: 500 },
    { seat: 3, amount: 500 },
  ], '自摸三家各付 100 × 本场');
  assertEq(r.deltas, [-700, 1700, -500, -500], '和牌者收入 = 三家支付之和');
});

test('立直棒全部归和牌者（§2.5）', () => {
  const state = tanyaoRonState();
  state.players[2].score -= 3000;
  state.riichiSticks = 3;
  const r = settleWin(state, 1, {
    hand: parseHand('567m234p55s678s'),
    winTile: strToTile('8s'),
    isTsumo: false,
    discarder: 0,
  });
  assertEq(r.riichiSticksTaken, 3, '应取走 3 根立直棒');
  assertEq(r.deltas[1], 1000 + 3000, '和牌者收入含全部立直棒');
  assertEq(sum(r.deltas), 3000, 'deltas 之和 = 供托总额（供托由调用方清零）');
});

test('多家和牌：立直棒归头跳家（takesSticks 控制，§6.5）', () => {
  const state = tanyaoRonState();
  state.players[2].melds = [{ type: 'chi', tiles: [1, 2, 3], calledTile: 3 }]; // 座位 2 同样副露断幺九
  state.players[2].menzen = false;
  state.players[2].score -= 1000;
  state.riichiSticks = 1;
  const ctx = { hand: parseHand('567m234p55s678s'), winTile: strToTile('8s'), isTsumo: false, discarder: 0 };
  const head = settleWin(state, 1, { ...ctx, takesSticks: true });
  const second = settleWin(state, 2, { ...ctx, takesSticks: false });
  assertEq(head.riichiSticksTaken, 1, '头跳家取走立直棒');
  assertEq(second.riichiSticksTaken, 0, '第二家不取立直棒');
  assertEq(head.deltas[1], 2000, '头跳家 = 1000 荣和 + 1000 立直棒');
  assertEq(second.deltas[2], 1000, '第二家只有荣和点数');
  assertEq(second.deltas[0], -1000, '放铳者向每家各付一份全额（§6.5 / 附录 C-6）');
});

// ===========================================================================
// 4. 包牌（rules.md §11.1）
// ===========================================================================
/** 大三元 + 字一色：白白白 發發發（副露）+ 中中中 東東東 南南（暗牌），荣和「中」 */
function paoCase(isTsumo) {
  const state = newState({ seed: 9 });
  state.players[1].melds = [
    { type: 'pon', tiles: [31, 31, 31], calledTile: 31 }, // 白白白
    { type: 'pon', tiles: [32, 32, 32], calledTile: 32 }, // 發發發
  ];
  state.players[1].menzen = false;
  state.players[1].paoBy = 3; // 座位 3 打出「中」让和牌者凑成
  const ctx = {
    hand: parseHand('777z111z22z'), // 中中中 東東東 南南
    winTile: 33,
    isTsumo,
    discarder: isTsumo ? null : 0,
  };
  return { state, r: settleWin(state, 1, ctx) };
}

test('包牌：大三元 + 字一色复合时只包「大三元」那一部分（荣和）', () => {
  const { state, r } = paoCase(false);
  assertEq(PAO_YAKU, ['daisangen', 'daisuushii'], '雀魂包牌役满 = 大三元 / 大四喜（四槓子不包）');
  assertEq(r.yakumanCount, 2, '大三元 + 字一色 = 2 倍役满');
  assertEq(r.yaku.map((y) => y.id).sort(), ['daisangen', 'tsuuiisou'], '役种应含大三元与字一色');
  // 子家 2 倍役满荣和 = 8000 × 2 × 4 = 64000
  assertEq(r.deltas[1], 64000, '和牌者收入 64000');
  assertEq(r.pao, { seat: 3, amount: 16000 }, '包牌部分（大三元 1 倍）折半 = 16000');
  assertEq(r.deltas[3], -16000, '包牌者只付包牌役满的一半');
  assertEq(r.deltas[0], -48000, '放铳者付「包牌役满一半 16000 + 字一色全额 32000」');
  assertEq(sum(r.deltas), 0, '总收支平衡');
  assertEq(state.players[1].paoBy, 3, '包牌者记录在玩家状态上');
});

test('包牌：自摸时包牌者支付包牌役满全额（其余役满正常三家分摊）', () => {
  const { r } = paoCase(true);
  assertEq(r.yakumanCount, 2, '大三元 + 字一色');
  // 包牌部分（大三元 1 倍）子家自摸全额 = 8000 × 4 = 32000，由包牌者全付
  assertEq(r.pao, { seat: 3, amount: 32000 }, '包牌者支付包牌役满全额');
  // 其余部分（字一色 1 倍）正常三家分摊：亲 16000、子各 8000
  assertEq(r.deltas, [-16000, 64000, -8000, -32000 - 8000], '包牌者还要承担字一色里自己的那一份');
  assertEq(sum(r.deltas), 0, '总收支平衡');
});

test('包牌：无包牌者时按普通役满结算（对照）', () => {
  const state = newState({ seed: 10 });
  state.players[1].melds = [
    { type: 'pon', tiles: [31, 31, 31], calledTile: 31 },
    { type: 'pon', tiles: [32, 32, 32], calledTile: 32 },
  ];
  const r = settleWin(state, 1, {
    hand: parseHand('777z111z22z'),
    winTile: 33,
    isTsumo: false,
    discarder: 0,
    paoBy: null,
  });
  assertEq(r.pao, null, '没有包牌者');
  assertEq(r.deltas, [-64000, 64000, 0, 0], '放铳者全额支付 2 倍役满');
});

test('包牌：四槓子不在包牌之列（雀魂口径）', () => {
  assert(!PAO_YAKU.includes('suukantsu'), '四槓子不包牌（§11.1）');
});

// ===========================================================================
// 5. 连庄 / 轮庄（rules.md §2.6）
// ===========================================================================
function withResult(state, result) {
  state.result = result;
  return state;
}

test('连庄判定：庄家和牌 / 子家和牌 / 荒牌流局 / 途中流局', () => {
  const state = newState({ seed: 11 });
  assertEq(state.dealer, 0, '东风战东一局庄家是座位 0');
  assertEq(renchanOf(state, { type: 'win', winners: [{ seat: 0 }] }), true, '庄家和牌 → 连庄');
  assertEq(renchanOf(state, { type: 'win', winners: [{ seat: 2 }] }), false, '子家和牌 → 轮庄');
  assertEq(
    renchanOf(state, { type: 'win', winners: [{ seat: 1 }, { seat: 0 }] }),
    true,
    '多家和牌中含庄家 → 连庄（§2.6）',
  );
  assertEq(renchanOf(state, { type: 'draw', kind: 'exhaustive', tenpai: [true, false, false, false] }), true, '荒牌流局庄家听牌 → 连庄');
  assertEq(renchanOf(state, { type: 'draw', kind: 'exhaustive', tenpai: [false, true, false, false] }), false, '荒牌流局庄家不听 → 轮庄');
  for (const kind of ['kyuushu', 'suufonrenda', 'suuchariichi', 'sukanagare']) {
    assertEq(renchanOf(state, { type: 'draw', kind, tenpai: [false, false, false, false] }), true, `途中流局 ${kind} → 一律连庄`);
  }
  assertEq(renchanOf(state, { type: 'draw', kind: 'nagashi', tenpai: [false, false, false, false] }), false, '流局满贯：庄家不听则轮庄');
});

test('advanceHand：连庄则本场 +1、局数不变；轮庄则本场归零、局数 +1', () => {
  const s1 = withResult(newState({ seed: 12, handNumber: 2 }), { type: 'win', winners: [{ seat: 2 }] });
  const a1 = advanceHand(s1);
  assertEq(a1.renchan, true, '庄家（座位 2）和牌应连庄');
  assertEq(a1.nextHandNumber, 2, '局数不变');
  assertEq(a1.nextHonba, 1, '本场 +1');
  assertEq(s1.dealer, 2, '亲家不变');
  assertEq(a1.gameOver, false, '不应终局');

  const s2 = withResult(newState({ seed: 13, handNumber: 2 }), { type: 'win', winners: [{ seat: 3 }] });
  const a2 = advanceHand(s2);
  assertEq(a2.renchan, false, '子家和牌应轮庄');
  assertEq(a2.nextHandNumber, 3, '局数 +1');
  assertEq(a2.nextHonba, 0, '本场归零');
  assertEq(s2.dealer, 3, '亲家轮转到下一家');
  assertEq(s2.roundWind, 27, '仍在东风场');
});

test('advanceHand：荒牌流局亲家听牌连庄、不听轮庄', () => {
  const s1 = withResult(newState({ seed: 14, handNumber: 5 }), {
    type: 'draw',
    kind: 'exhaustive',
    tenpai: [false, true, false, false],
  });
  const a1 = advanceHand(s1);
  assertEq(a1.renchan, true, '庄家（座位 1）听牌 → 连庄');
  assertEq(a1.nextHonba, 1, '本场 +1');
  assertEq(a1.nextHandNumber, 5, '局数不变（仍是南二局）');

  const s2 = withResult(newState({ seed: 15, handNumber: 5 }), {
    type: 'draw',
    kind: 'exhaustive',
    tenpai: [true, false, false, false],
  });
  const a2 = advanceHand(s2);
  assertEq(a2.renchan, false, '庄家不听 → 轮庄');
  assertEq(a2.nextHonba, 0, '本场归零');
  assertEq(a2.nextHandNumber, 6, '局数 +1');
  assertEq(s2.roundWind, 28, '南二局场风应是南（2z = 28）');
});

// ===========================================================================
// 6. 终局判定（rules.md §12.1 / §12.2 / §12.3）
// ===========================================================================
test('终局：击飞（严格小于 0）优先，0 点继续', () => {
  const s1 = withResult(newState({ seed: 21, handNumber: 3 }), { type: 'win', winners: [{ seat: 0 }] });
  setScores(s1, [-100, 50100, 25000, 25000]);
  const a1 = advanceHand(s1);
  assertEq(a1.gameOver, true, '负分应立刻终局');
  assertEq(a1.reason, 'hakofuri', '原因应是击飞');
  assert(s1.ranking !== null, '应给出顺位');
  assertEq(s1.ranking[0].seat, 1, '一位应是最高分者');

  const s2 = withResult(newState({ seed: 22, handNumber: 3 }), { type: 'win', winners: [{ seat: 0 }] });
  setScores(s2, [0, 50000, 25000, 25000]);
  const a2 = advanceHand(s2);
  assertEq(a2.gameOver, false, '0 点不应终局');
  assertEq(a2.reason, null, '不应有终局原因');
});

test('终局：半庄到南四结束（有人达 30000 且庄家未连庄）', () => {
  const state = withResult(newState({ seed: 23, handNumber: 7, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 1 }], // 子家和牌 → 不连庄
  });
  setScores(state, [20000, 32000, 25000, 23000]);
  const a = advanceHand(state);
  assertEq(a.renchan, false, '子家和牌不连庄');
  assertEq(a.gameOver, true, '有人达 30000 且庄家未连庄 → 终局');
  assertEq(a.reason, 'someone_over', '原因 someone_over');
});

test('终局：南四无人达 30000 → 西入继续', () => {
  const state = withResult(newState({ seed: 24, handNumber: 7, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  setScores(state, [26000, 26000, 25000, 23000]);
  const a = advanceHand(state);
  assertEq(a.gameOver, false, '无人达返点 → 进入加时（西入）');
  assertEq(a.nextHandNumber, 8, '应推进到西一局');
  assertEq(state.roundWind, 29, '西一场风应是西（3z = 29）');
});

test('终局：西四结束时强制结算（打满最大局数）', () => {
  const state = withResult(newState({ seed: 25, handNumber: 11, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  setScores(state, [26000, 26000, 25000, 23000]);
  const a = advanceHand(state);
  assertEq(a.gameOver, true, '西四结束应强制终局');
  assertEq(a.reason, 'max_round', '原因 max_round');
});

test('终局：南四庄家连庄且为一位 → 终局（连庄优先的例外）', () => {
  const state = withResult(newState({ seed: 26, handNumber: 7, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 3 }], // 庄家（座位 3 = 南四局庄家）和牌
  });
  setScores(state, [20000, 20000, 20000, 40000]);
  const a = advanceHand(state);
  assertEq(a.renchan, true, '庄家和牌 → 连庄');
  assertEq(rank1Seat(state), 3, '庄家是一位');
  assertEq(a.gameOver, true, '庄家连庄且为一位 → 终局（§12.1 ④）');
  assertEq(a.reason, 'dealer_top_renchan', '原因 dealer_top_renchan');
});

test('终局：南四庄家连庄但不是一位 → 连庄优先，继续', () => {
  const state = withResult(newState({ seed: 27, handNumber: 7, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 3 }],
  });
  setScores(state, [40000, 20000, 20000, 20000]);
  const a = advanceHand(state);
  assertEq(a.renchan, true, '庄家和牌 → 连庄');
  assertEq(rank1Seat(state), 0, '一位是座位 0');
  assertEq(a.gameOver, false, '连庄优先，继续（§12.1 ③）');
  assertEq(a.nextHandNumber, 7, '仍打南四局');
  assertEq(a.nextHonba, 1, '本场 +1');
});

test('终局：东风战东四结束（有人达 30000）/ 无人达则南入', () => {
  const s1 = withResult(newState({ seed: 28, handNumber: 3, length: 'tonpuu' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  setScores(s1, [20000, 32000, 25000, 23000]);
  const a1 = advanceHand(s1);
  assertEq(a1.gameOver, true, '东风战东四有人达 30000 → 终局');
  assertEq(a1.reason, 'someone_over', 'reason someone_over');

  const s2 = withResult(newState({ seed: 29, handNumber: 3, length: 'tonpuu' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  setScores(s2, [26000, 26000, 25000, 23000]);
  const a2 = advanceHand(s2);
  assertEq(a2.gameOver, false, '无人达 30000 → 南入');
  assertEq(a2.nextHandNumber, 4, '应推进到南一局');
  assertEq(s2.roundWind, 28, '南一场风应是南');

  const s3 = withResult(newState({ seed: 30, handNumber: 7, length: 'tonpuu' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  setScores(s3, [26000, 26000, 25000, 23000]);
  const a3 = advanceHand(s3);
  assertEq(a3.gameOver, true, '东风战南四结束应强制终局');
  assertEq(a3.reason, 'max_round', 'reason max_round');
});

// ===========================================================================
// 7. 顺位与马点（rules.md §12.3 / §12.4）
// ===========================================================================
test('终局：顺位马 [15,5,-5,-15]，精算 =（点数-25000)/1000 + 马点', () => {
  const state = withResult(newState({ seed: 31, handNumber: 7, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  setScores(state, [32000, 24000, 20000, 24000]);
  const a = advanceHand(state);
  assertEq(a.gameOver, true, '应终局');
  const rk = state.ranking;
  assertEq(rk.map((r) => r.rank), [1, 2, 3, 4], '顺位应为 1-4');
  assertEq(rk.map((r) => r.seat), [0, 1, 3, 2], '同点时（24000）按东一局座次：座位 1 在座位 3 之前');
  assertEq(rk.map((r) => r.uma), [15, 5, -5, -15], '马点');
  assertEq(rk[0].points, 22, '32000 一位 → (32000-25000)/1000 + 15 = 22');
  assertEq(rk[1].points, 4, '24000 二位 → -1 + 5 = 4');
  assertEq(rk[3].points, -20, '20000 四位 → -5 - 15 = -20');
  assertEq(sum(rk.map((r) => r.points)), 0, '雀魂不另算オカ：精算合计 = (总分 - 100000)/1000 = 0');
});

test('终局：桌上剩余立直棒判给一位（§2.5，雀魂 top_takes_all）', () => {
  const state = withResult(newState({ seed: 32, handNumber: 7, length: 'hanchan' }), {
    type: 'win',
    winners: [{ seat: 1 }],
  });
  state.riichiSticks = 2;
  setScores(state, [26000, 30000, 24000, 18000]); // 98000 + 2000 供托 = 100000
  const a = advanceHand(state);
  assertEq(a.gameOver, true, '应终局');
  assertEq(state.riichiSticks, 0, '供托应清零');
  assertEq(state.players[state.ranking[0].seat].score, 30000 + 2000, '一位应获得全部剩余立直棒');
  assertEq(state.ranking[0].seat, 1, '一位应是座位 1');
  assertEq(sum(state.players.map((p) => p.score)), 100000, '点数总和守恒');
});

test('computeRanking：同点按东一局座次（§2.3）', () => {
  const state = newState({ seed: 33 });
  setScores(state, [25000, 25000, 25000, 25000]);
  const rk = computeRanking(state);
  assertEq(rk.map((r) => r.seat), [0, 1, 2, 3], '全同时按座次 0,1,2,3');
  assertEq(rank1Seat(state), 0, '一位应是座位 0');
});

test('seatWindOf：自风随庄家逆时针排列（§1.4）', () => {
  const state = newState({ seed: 34, handNumber: 2 }); // 庄家 = 座位 2
  assertEq(state.dealer, 2, '东三局庄家应为座位 2');
  assertEq(seatWindOf(state, 2), 27, '庄家自风 = 東');
  assertEq(seatWindOf(state, 3), 28, '下家自风 = 南');
  assertEq(seatWindOf(state, 0), 29, '对家自风 = 西');
  assertEq(seatWindOf(state, 1), 30, '上家自风 = 北');
});

// ===========================================================================
// 8. 结算的健壮性
// ===========================================================================
test('settleWin：牌形不能和牌 / 张数不符 / 荣和缺放铳者 都要抛错', () => {
  const state = newState({ seed: 41 });
  assertThrows(
    () => settleWin(state, 0, { hand: parseHand('123m456p789s1122z'), winTile: strToTile('1z'), isTsumo: false, discarder: 1 }),
    '无役的牌形应抛错',
  );
  assertThrows(
    () => settleWin(state, 0, { hand: parseHand('123m456p789s11z'), winTile: strToTile('1z'), isTsumo: true }),
    '张数不符应抛错',
  );
  assertThrows(
    () =>
      settleWin(state, 0, {
        hand: parseHand('234m567m234p55s678s'),
        winTile: strToTile('8s'),
        isTsumo: false,
      }),
    '荣和未给 discarder 应抛错',
  );
  assertThrows(() => advanceHand(newState({ seed: 42 })), '没有本局结果时 advanceHand 应抛错');
});

test('settleWin：役满时不加算宝牌（§7.7）', () => {
  const state = newState({ seed: 43 });
  state.players[1].melds = [
    { type: 'pon', tiles: [31, 31, 31], calledTile: 31 },
    { type: 'pon', tiles: [32, 32, 32], calledTile: 32 },
  ];
  state.doraIndicators = [strToTile('7z')]; // 中的宝牌是白 → 和牌者手里 3 张白
  const r = settleWin(state, 1, {
    hand: parseHand('777z111z22z'),
    winTile: 33,
    isTsumo: false,
    discarder: 0,
  });
  assertEq(r.yakumanCount, 2, '仍按 2 倍役满结算');
  assertEq(r.doraHan, 0, '役满不与宝牌复合');
  assertEq(r.deltas[1], 64000, '点数不因宝牌变化');
});

test('settleDraw：不听罚符不吃牌山状态（纯计算）', () => {
  const state = newState({ seed: 44 });
  const before = state.players.map((p) => p.score);
  settleDraw(state, 'exhaustive', [true, false, false, false]);
  assertEq(state.players.map((p) => p.score), before, 'settleDraw 只返回 deltas，不改点数');
});

test('settleWin：立直和牌时里宝牌计入；未立直时不计（§3.5）', () => {
  const base = () => {
    const state = newState({ seed: 45 });
    state.doraIndicators = [strToTile('4s')]; // 宝牌 = 5s（和牌者手里 2 张）
    state.uraIndicators = [strToTile('6s')]; // 里宝牌 = 7s（和牌者手里 1 张）
    return state;
  };
  const ctx = { hand: parseHand('234m567m234p55s678s'), winTile: strToTile('8s'), isTsumo: false, discarder: 0 };
  const noRiichi = settleWin(base(), 1, ctx);
  assertEq(noRiichi.doraHan, 2, '未立直只计表宝牌 2 张');
  assertEq(noRiichi.yaku.map((y) => y.id).sort(), ['pinfu', 'tanyao'], '门清平和断幺九');
  const s2 = base();
  s2.players[1].riichi = true;
  const withRiichi = settleWin(s2, 1, ctx);
  assertEq(withRiichi.doraHan, 3, '立直和牌时表宝牌 2 + 里宝牌 1');
  assertEq(withRiichi.han, noRiichi.han + 1, '立直多 1 番真役');
  assert(withRiichi.deltas[1] > noRiichi.deltas[1], '立直和牌收入应更高');
});

// ---------------------------------------------------------------------------
console.log(`\n通过 ${pass} / 失败 ${failures.length}`);
for (const [name, err] of failures) {
  console.error(`\nFAIL: ${name}\n  ${err.message}`);
  if (process.env.MJ_VERBOSE) console.error(err.stack);
}
if (failures.length > 0) process.exit(1);
