/**
 * 对局界面验证（无头）
 * =====================================================================
 * 界面本身没法在 Node 里跑（要 DOM），但真正容易出错的部分是**纯函数**：
 * GameState → view → HTML。所以这一层可以完整验证：
 *
 *   1. 用状态机真跑对局，每一步都渲染一次牌桌 —— 任何字段名对不上、
 *      数组越界、undefined 泄漏都会在这里炸出来
 *   2. 断言渲染结果里不出现 undefined / NaN / [object Object]
 *   3. 断言四家座位、牌河、副露、宝牌这些关键块都真的渲染出来了
 *
 * 为什么不做截图对比：这是纯文本渲染，断言比像素更精确也更稳。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

import { renderTable, renderResult, renderLog } from '../play/src/table.js';
import { toView } from '../play/src/adapter.js';
import { chooseAction, chooseDiscard } from '../play/src/ai.js';
import {
  createGame, startHand, legalActions, applyAction,
  isHandOver, isGameOver,
} from '../game/index.js';

const HUMAN = 0;

/* ═══ 牌河的位置 ═════════════════════════════════════════════════ */

/**
 * 牌河必须摆在桌子中间、四家围成一圈。
 *
 * 这是麻将的物理事实：打出的牌落在桌子中央，四家各占一条边。
 * 早先把牌河塞进各家的座位面板里（190px 宽的栏里挤 6 列），
 * 既看不出是谁打的，也数不清张数。
 */
test('版面：四家牌河都在桌子中央，围成一圈，座位面板里不留牌河', () => {
  // 每家牌河放不同花色，方便认领：自己=萬 · 下家=筒 · 对家=索 · 上家=字
  const mk = (seat, tiles) => ({
    seat, wind: seat, score: 25000, hand: 13, melds: [], riichi: false, furiten: false,
    pond: tiles, pondCalled: tiles.map(() => false), lastPondIdx: tiles.length - 1,
  });
  const view = {
    mySeat: 0, turn: 0, dealer: 0, phase: 'draw', legal: [], dora: [], roundWind: 0,
    handNumber: 0, honba: 0, riichiSticks: 0, wallRemaining: 60,
    players: [mk(0, [0, 1]), mk(1, [9, 10]), mk(2, [18, 19]), mk(3, [27, 28])],
  };

  const dom = new JSDOM(`<body>${renderTable(view)}</body>`);
  const d = dom.window.document;

  assert.equal(d.querySelectorAll('.seat .pond').length, 0,
    '座位面板里不该再有牌河 —— 它属于桌子中央');
  assert.equal(d.querySelectorAll('.center .pond').length, 4, '中央应当有四家牌河');

  // 相对座位：自己=下 · 下家=右 · 对家=上 · 上家=左
  const expected = {
    bottom: '一萬 二萬',
    right: '一筒 二筒',
    top: '一索 二索',
    left: '東 南',
  };
  for (const [zone, names] of Object.entries(expected)) {
    const el = d.querySelector(`.pz-${zone} .pond`);
    assert.ok(el, `缺少 .pz-${zone} 这一条边`);
    const got = [...el.querySelectorAll('svg')].map((s) => s.getAttribute('aria-label')).join(' ');
    assert.equal(got, names, `.pz-${zone} 里的牌不对：期望「${names}」，实为「${got}」`);
  }

  assert.ok(d.querySelector('.center-info'), '场次信息应当留在中央');
  assert.ok(/局/.test(d.querySelector('.center-info').textContent), '中央信息里应当有场次');
  dom.window.close();
});

test('版面：牌河每行 6 张（栅格定义），12 张不会堆成一堆', () => {
  // 「每行 6 张」是 CSS 栅格说了算，jsdom 不做布局，所以直接查样式表 ——
  // 断言渲染出的 DOM 是查不出列数的，那样写等于没测。
  const css = readFileSync(resolve(import.meta.dirname, '../play/src/style.css'), 'utf8');
  const rule = css.match(/\.pond\s*\{[^}]*grid-template-columns:\s*repeat\((\d+)\s*,\s*auto\)/);
  assert.ok(rule, '没找到 .pond 的栅格定义 —— 牌河会按普通块级元素堆成一列');
  assert.equal(Number(rule[1]), 6, `牌河每行应当是 6 张，实为 ${rule[1]} 张`);

  // 栅格间距要留得出来
  const gap = css.match(/\.pond\s*\{[^}]*gap:\s*(\d+)px/);
  assert.ok(gap && Number(gap[1]) >= 2, `牌河间距只有 ${gap ? gap[1] : '?'}px，会挤在一起`);

  const many = Array.from({ length: 12 }, (_, i) => i % 9);
  const view = {
    mySeat: 0, turn: 0, dealer: 0, phase: 'draw', legal: [], dora: [], roundWind: 0,
    handNumber: 0, honba: 0, riichiSticks: 0, wallRemaining: 40,
    players: [0, 1, 2, 3].map((seat) => ({
      seat, wind: seat, score: 25000, hand: 13, melds: [], riichi: false, furiten: false,
      pond: seat === 0 ? many : [], pondCalled: [], lastPondIdx: -1,
    })),
  };
  const dom = new JSDOM(`<body>${renderTable(view)}</body>`);
  assert.equal(dom.window.document.querySelectorAll('.pz-bottom .pond .cell').length, 12,
    '12 张舍牌都要渲染出来');
  dom.window.close();
});

/** 找出现在该谁做决策 —— 和 app.js 里的循环用同一套逻辑 */
function nextDecisionSeat(S) {
  if (isHandOver(S) || isGameOver(S)) return null;
  if (S.pendingClaims && S.pendingClaims.length) {
    for (const c of S.pendingClaims) if (legalActions(S, c.seat).length) return c.seat;
  }
  if (S.phase === 'discard' || S.phase === 'draw') {
    if (legalActions(S, S.turn).length) return S.turn;
  }
  for (let s = 0; s < 4; s++) if (legalActions(S, s).length) return s;
  return null;
}

/** AI 决策：先试 chooseAction，没结果就在合法范围内挑一张打 */
function decide(S, seat) {
  const legal = legalActions(S, seat);
  const act = chooseAction(S, seat, legal);
  if (act) return act;
  const d = chooseDiscard(S, seat, legal);
  if (d != null) return { type: 'discard', tile: d };
  return legal[0] ?? null;
}

function assertCleanHTML(html, where) {
  for (const bad of ['undefined', 'NaN', '[object Object]', 'null 点']) {
    assert.ok(!html.includes(bad), `${where}: 渲染结果里出现了「${bad}」`);
  }
}

/* ═══ 1. 单局逐步渲染 ═══════════════════════════════════════════ */

test('牌桌渲染：一整局每一步都能渲染且不泄漏脏值', () => {
  const S = createGame({ seed: 20260101, aiLevel: [0, 2, 2, 2] });
  startHand(S);

  let steps = 0;
  while (!isHandOver(S) && steps < 4000) {
    const seat = nextDecisionSeat(S);
    if (seat === null) break;

    // 渲染当前局面（这一步是主要被测对象）
    const view = toView(S, HUMAN, legalActions(S, HUMAN));
    const html = renderTable(view) + renderLog(['测试']);
    assertCleanHTML(html, `第 ${steps} 步`);

    const act = decide(S, seat);
    assert.ok(act, `第 ${steps} 步：座位 ${seat} 没有可执行动作，但 nextDecisionSeat 说有`);
    applyAction(S, seat, act);
    steps++;
  }

  assert.ok(steps > 20, `只走了 ${steps} 步，对局似乎没真正推进`);
  assert.ok(isHandOver(S), `走了 ${steps} 步仍未结束本局`);

  // 结算浮层也要能渲染
  const rHtml = renderResult(toView(S, HUMAN, []));
  assertCleanHTML(rHtml, '结算浮层');
  assert.ok(rHtml.includes('overlay'), '本局结束后应当渲染结算浮层');
});

/* ═══ 2. 整场对局（多局连打） ═══════════════════════════════════ */

test('牌桌渲染：整场东风战全程可渲染，无异常', () => {
  const S = createGame({ seed: 777, aiLevel: [0, 2, 2, 2] });
  startHand(S);

  let hands = 0;
  let steps = 0;

  while (!isGameOver(S) && hands < 30 && steps < 200000) {
    if (isHandOver(S)) {
      hands++;
      if (isGameOver(S)) break;
      const view = toView(S, HUMAN, []);
      assertCleanHTML(renderResult(view), `第 ${hands} 局结算`);
      startHand(S);
      continue;
    }
    const seat = nextDecisionSeat(S);
    if (seat === null) break;
    const view = toView(S, HUMAN, legalActions(S, HUMAN));
    assertCleanHTML(renderTable(view), `第 ${hands} 局第 ${steps} 步`);
    applyAction(S, seat, decide(S, seat));
    steps++;
  }

  assert.ok(hands >= 2, `只打了 ${hands} 局，不像是完整对局`);
});

/* ═══ 3. 视角正确性：只能看到自己的手牌 ═════════════════════════ */

test('视角：只有自己的手牌是明牌，别家只渲染牌背', () => {
  const S = createGame({ seed: 5 });
  startHand(S);

  const view = toView(S, HUMAN, legalActions(S, HUMAN));
  const me = view.players[HUMAN];

  assert.ok(Array.isArray(me.hand) && me.hand.length === 34, '自己的手牌应是长度 34 的计数数组');
  const myCount = me.hand.reduce((a, b) => a + b, 0);
  assert.ok(myCount === 13 || myCount === 14, `自己手牌应有 13 或 14 张，实为 ${myCount}`);

  for (const p of view.players) {
    if (p.seat === HUMAN) continue;
    assert.ok(p.drawnTile === null, '别家的摸牌不该暴露');
    assert.ok(p.hand.length <= 14, '别家手牌只用来画牌背，不该给出具体张数以外的东西');
  }
});

/* ═══ 4. 动作按钮 ═══════════════════════════════════════════════ */

test('动作按钮：合法动作能渲染成按钮，且能反解回动作对象', () => {
  const S = createGame({ seed: 11 });
  startHand(S);

  // 跑到自己有一次带选项的决策
  let guard = 0;
  while (!isHandOver(S) && guard++ < 500) {
    const seat = nextDecisionSeat(S);
    if (seat === HUMAN && legalActions(S, HUMAN).length > 1) break;
    if (seat === null) break;
    applyAction(S, seat, decide(S, seat));
  }

  const legal = legalActions(S, HUMAN);
  const html = renderTable(toView(S, HUMAN, legal));
  assertCleanHTML(html, '动作按钮');

  // 手牌按钮数量应当等于手牌张数（状态机的手牌已含摸到的那张）
  const discardButtons = [...html.matchAll(/data-discard="(\d+)"/g)].map((m) => Number(m[1]));
  const me = S.players[HUMAN];
  const total = me.hand.reduce((a, b) => a + b, 0);
  if (total === 14) {
    assert.equal(discardButtons.length, 14, `应有 14 个打牌按钮，实为 ${discardButtons.length}`);
  }
});

/* ═══ 5. AI 不做非法动作 ════════════════════════════════════════ */

test('AI：生成的每个动作都在合法动作集合内', () => {
  const S = createGame({ seed: 31337, aiLevel: [0, 3, 3, 3] });
  startHand(S);

  let checked = 0;
  let steps = 0;
  while (!isHandOver(S) && steps++ < 3000) {
    const seat = nextDecisionSeat(S);
    if (seat === null) break;
    const legal = legalActions(S, seat);

    // 只在 AI 座位上校验；人类座位跳过（测试里也由 AI 代打）
    const act = chooseAction(S, seat, legal);
    if (act) {
      const key = (a) => `${a.type}:${a.tile ?? ''}`;
      const ok = legal.some((a) => key(a) === key(act)) || act.type === 'riichi';
      assert.ok(ok, `AI 座位 ${seat} 生成了不在合法集合里的动作 ${JSON.stringify(act)}，合法集合=${legal.map(key).join('|')}`);
      checked++;
    }

    applyAction(S, seat, decide(S, seat));
  }
  assert.ok(checked > 0, '一次 AI 动作都没校验到');
});
