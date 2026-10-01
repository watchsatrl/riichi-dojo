/**
 * 役种 / 符数 / 点数 / 振听模块验证
 * =====================================================================
 * 这四个模块由子任务产出，但没有随附测试。而教程第 2、5、6 讲里的每一个
 * 数字和每一句「这手牌有/没有 X 役」都直接依赖它们，所以必须独立钉一遍。
 *
 * 这个文件因此承担双重作用：既验证引擎，也验证**教程有没有把规则讲错**。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHand } from '../engine/tiles.js';
import { detectYaku } from '../engine/yaku.js';
import { decomposeStandard } from '../engine/agari.js';
import { calcFu } from '../engine/fu.js';
import { calcScore } from '../engine/score.js';
import { canRonReasons } from '../engine/furiten.js';
import { SAKURA_4P } from '../engine/rules.js';

/** 构造和牌上下文。默认东场南家，避免连风牌干扰。 */
function ctx(handStr, opts = {}) {
  return {
    hand: parseHand(handStr),
    melds: opts.melds || [],
    winTile: opts.winTile,
    isTsumo: !!opts.isTsumo,
    roundWind: opts.roundWind ?? 27,
    seatWind: opts.seatWind ?? 28,
    isRiichi: !!opts.isRiichi,
    isDoubleRiichi: false,
    isIppatsu: false,
    isChankan: false,
    isRinshan: false,
    isHaitei: false,
    isHoutei: false,
    isTenhou: false,
    isChiihou: false,
    doraIndicators: opts.doraIndicators || [],
    uraIndicators: [],
    redCount: opts.redCount || 0,
    isNagashiMangan: false,
    pond: opts.pond || [],
  };
}

const names = (res) => res.list.map((y) => y.name);

/* ═══ 役种判定 ═══════════════════════════════════════════════════ */

test('第2讲例题①：副露后无役 —— 骨架完整但不给和', () => {
  const c = ctx('234s789s11z', {
    melds: [{ type: 'chi', tiles: [0, 1, 2] }, { type: 'chi', tiles: [12, 13, 14] }],
    winTile: 24,
  });
  const res = detectYaku(c, SAKURA_4P);
  assert.equal(res.hasYaku, false, `不该有役，却检出：${names(res).join('、')}`);
});

test('第2讲例题②：3 张宝牌但无役 —— 仍然不能和', () => {
  const c = ctx('789s11z', {
    melds: [
      { type: 'pon', tiles: [20, 20, 20] },
      { type: 'chi', tiles: [0, 1, 2] },
      { type: 'chi', tiles: [12, 13, 14] },
    ],
    winTile: 24,
    doraIndicators: [19],
  });
  const res = detectYaku(c, SAKURA_4P);
  assert.equal(res.hasYaku, false, '宝牌不该构成起和条件');
  assert.equal(res.doraHan, 3, `应计 3 张宝牌，实得 ${res.doraHan}`);
});

test('第2讲例题③：断幺九成立', () => {
  const res = detectYaku(ctx('234m567m345p678s55s', { winTile: 25 }), SAKURA_4P);
  assert.ok(names(res).includes('断幺九'), `断幺九未检出：${names(res).join('、')}`);
});

test('第2讲例题④：白刻子 = 役牌；東做雀头不给番', () => {
  const c = ctx('234m567p789s11z', {
    melds: [{ type: 'pon', tiles: [31, 31, 31] }],
    winTile: 24,
  });
  const res = detectYaku(c, SAKURA_4P);
  assert.ok(names(res).includes('役牌:白'), `役牌白未检出：${names(res).join('、')}`);
  assert.ok(!names(res).some((n) => n.includes('東')), '東做雀头不该给番');
});

test('第2讲：无役听牌（123m 999m 456p 789s + 8s）确实无役', () => {
  // 这是我在教程里手写、并一度写反答案的那道例题，这里用程序钉死
  const res = detectYaku(ctx('123m999m456p789s8s', { winTile: 25 }), SAKURA_4P);
  assert.equal(res.hasYaku, false, `应为无役，却检出：${names(res).join('、')}`);
});

test('第2讲：平和成立（门清 + 全顺子 + 非役牌雀头 + 两面）', () => {
  const res = detectYaku(ctx('123m456m789m234p88s', { winTile: 12 }), SAKURA_4P);
  assert.ok(names(res).includes('平和'), `平和未检出：${names(res).join('、')}`);
});

test('连风牌刻子算 2 番（东场东家的東刻）', () => {
  const c = ctx('234m567p789s22s', {
    melds: [{ type: 'pon', tiles: [27, 27, 27] }],
    winTile: 25,
    roundWind: 27, seatWind: 27,
  });
  const han = detectYaku(c, SAKURA_4P).list
    .filter((y) => y.name.startsWith('役牌'))
    .reduce((s, y) => s + y.han, 0);
  assert.equal(han, 2, `连风牌应为 2 番，实得 ${han}`);
});

/* ═══ 符数计算 ═══════════════════════════════════════════════════ */

test('第5讲：平和自摸固定 20 符（不加自摸的 2 符）', () => {
  const res = detectYaku(ctx('123m456m789m234p88s', { winTile: 12, isTsumo: true }), SAKURA_4P);
  assert.equal(res.fu, 20, `平和自摸应为 20 符，实得 ${res.fu}`);
});

test('第5讲：七对子固定 25 符', () => {
  const res = detectYaku(ctx('1133557799m1122p', { winTile: 10 }), SAKURA_4P);
  assert.ok(names(res).includes('七对子'), `七对子未检出：${names(res).join('、')}`);
  assert.equal(res.fu, 25, `七对子应为 25 符，实得 ${res.fu}`);
});

test('第5讲例题：双暗刻 + 嵌张 + 自摸 = 32 → 切上 40 符', () => {
  const c = ctx('444m345p456p777s88s', { winTile: 13, isTsumo: true });
  assert.equal(detectYaku(c, SAKURA_4P).fu, 40, '应为 40 符');

  // 同时直接验证 calcFu 的逐项明细
  const d = decomposeStandard(c.hand, 0)[0];
  assert.ok(d, '这手牌应能拆解成标准形');
  const fu = calcFu(c, d, SAKURA_4P);
  assert.equal(fu.raw, 32, `加符合计应为 32，实得 ${fu.raw}`);
  assert.equal(fu.fu, 40, `切上后应为 40，实得 ${fu.fu}`);
});

/* ═══ 点数计算 ═══════════════════════════════════════════════════ */

test('第6讲：30符3番 子家荣和 = 3900', () => {
  assert.equal(calcScore({ han: 3, fu: 30, isDealer: false, isTsumo: false }, SAKURA_4P).total, 3900);
});

test('第6讲：30符3番 亲家自摸 = 2000 全', () => {
  assert.equal(calcScore({ han: 3, fu: 30, isDealer: true, isTsumo: true }, SAKURA_4P).payments.all, 2000);
});

test('第6讲：40符3番 子家自摸 = 1300 / 2600', () => {
  const p = calcScore({ han: 3, fu: 40, isDealer: false, isTsumo: true }, SAKURA_4P).payments;
  assert.equal(p.child, 1300);
  assert.equal(p.dealer, 2600);
});

test('第6讲：雀魂不采用切上满贯 —— 30符4番 = 7700，不是 8000', () => {
  assert.equal(calcScore({ han: 4, fu: 30, isDealer: false, isTsumo: false }, SAKURA_4P).total, 7700);
});

test('第6讲：5 番起封顶满贯，符数不再影响点数', () => {
  assert.equal(calcScore({ han: 5, fu: 30, isDealer: false, isTsumo: false }, SAKURA_4P).total, 8000);
  assert.equal(calcScore({ han: 5, fu: 70, isDealer: false, isTsumo: false }, SAKURA_4P).total, 8000);
});

test('第6讲：本场 + 立直棒 计入总额', () => {
  const r = calcScore(
    { han: 2, fu: 30, isDealer: false, isTsumo: false, honba: 1, riichiSticks: 2 },
    SAKURA_4P,
  );
  assert.equal(r.total, 2000 + 300 + 2000);
});

/* ═══ 振听诊断 ═══════════════════════════════════════════════════ */

test('诊断器：能区分「无役」与「能和」', () => {
  const noYaku = ctx('234s789s11z', {
    melds: [{ type: 'chi', tiles: [0, 1, 2] }, { type: 'chi', tiles: [12, 13, 14] }],
    winTile: 24,
  });
  const r1 = canRonReasons(noYaku, SAKURA_4P);
  assert.equal(r1.ok, false);
  assert.equal(r1.hasYaku, false);

  const r2 = canRonReasons(ctx('234m567m345p678s55s', { winTile: 25 }), SAKURA_4P);
  assert.equal(r2.ok, true, `应能和，理由：${r2.reasons.join(' / ')}`);
});

test('诊断器：舍牌振听时，不在牌河里的和牌张同样不能荣和', () => {
  // 听 1m / 4m 两面（原本 23m456m789p123s11z），自己牌河里已有一张 1m
  // —— 此时荣和 4m 也**不能**和，因为振听冻结的是全部荣和
  const c = ctx('234m456m789p123s11z', { winTile: 3, pond: [0] });
  const res = canRonReasons(c, SAKURA_4P);
  assert.equal(res.isFuriten, true, `应判定为振听，理由：${res.reasons.join(' / ')}`);
  assert.equal(res.ok, false, '振听时应禁止全部荣和，与具体是哪张无关');
});
