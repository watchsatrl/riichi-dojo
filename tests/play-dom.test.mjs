/**
 * 端到端测试（真实 DOM）
 * =====================================================================
 * 把构建好的 play/index.html 整个丢进 jsdom 里跑：
 *   落地页（关卡列表）→ 进关卡 → 做任务 → 记进度 → 自由对局 → 点牌打完一局
 *
 * 这一层是不可省的：纯函数渲染测试一行 app.js 都没执行过，事件委托、
 * 按钮点击、模式切换、游戏循环、计时器调度全是空白。之前正是靠它抓到
 * 一个会让界面直接卡死的死循环。
 *
 * 计时器被换成手动队列，一局牌才能在毫秒级跑完，而不是等 AI 的假停顿。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(resolve(import.meta.dirname, '../play/index.html'), 'utf8');

function boot() {
  const errors = [];
  let seq = 0;

  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // 必须给 url：不给的话文档是 opaque origin，localStorage 一访问就抛
    // SecurityError，进度存不进去，测试也没法读回来验证。
    url: 'https://mahjong.local/',
    beforeParse(window) {
      const timers = new Map();
      window.setTimeout = (fn) => { const id = ++seq; timers.set(id, fn); return id; };
      window.clearTimeout = (id) => { timers.delete(id); };
      window.__drainTimers = (limit = 3000) => {
        let n = 0;
        while (timers.size && n < limit) {
          const [id, fn] = [...timers.entries()][0];
          timers.delete(id);
          fn();
          n++;
        }
        return n;
      };
      // 光靠「drain 之后界面还对」验不出定时器有没有清干净 ——
      // 因为 advance() 开头有 `if (!S) return`，没清的定时器醒来也只是什么都不做。
      // 所以直接把待触发数量暴露出来。
      window.__pendingTimers = () => timers.size;
      window.scrollTo = () => {};
      window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
      window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
    },
  });

  return { dom, win: dom.window, errors };
}

const $ = (dom, sel) => dom.window.document.querySelector(sel);
const $$ = (dom, sel) => [...dom.window.document.querySelectorAll(sel)];
const click = (el) => { assert.ok(el, '要点的元素不存在'); el.click(); };

/** 从落地页走到牌桌 */
function enterGame(dom) {
  if ($(dom, '[data-free-play]')) {
    click($(dom, '[data-free-play]'));       // 关卡列表 → 对局设置
  }
  click($(dom, '[data-start]'));             // 设置 → 牌桌
}

/** 一直推进到本局结束（AI 自动走，玩家 AI 代打） */
function playHand(dom, win) {
  let myDiscards = 0;
  for (let r = 0; r < 500; r++) {
    win.__drainTimers();
    if ($(dom, '.overlay')) return myDiscards;

    const tiles = $$(dom, '[data-discard]').filter((b) => !b.disabled);
    if (tiles.length) { tiles[0].click(); myDiscards++; continue; }

    const acts = $$(dom, '[data-action]');
    if (acts.length) { acts[acts.length - 1].click(); continue; }
    break;
  }
  return myDiscards;
}

/* ═══ 1. 落地页 ═════════════════════════════════════════════════ */

test('落地页：默认显示关卡列表，基础篇与进阶篇都在', () => {
  const { dom, errors } = boot();

  assert.ok($(dom, '.home'), '落地页应当显示关卡列表');
  const tiers = $$(dom, '.tier-head h2').map((e) => e.textContent);
  assert.ok(tiers.some((t) => t.includes('基础篇')), `没看到基础篇：${tiers.join(',')}`);
  assert.ok(tiers.some((t) => t.includes('进阶篇')), `没看到进阶篇：${tiers.join(',')}`);

  // 基础篇必须是「必做」，进阶篇必须标「选做」
  const tags = $$(dom, '.tier-tag').map((e) => e.textContent);
  assert.ok(tags.includes('必做'), '没有标出必做的篇章');
  assert.ok(tags.includes('选做'), '没有标出选做的篇章');

  assert.ok($$(dom, '[data-level]').length >= 12, '关卡卡片数量不对');
  assert.ok($(dom, '[data-free-play]'), '没有自由对局入口');

  assert.deepEqual(errors, [], `页面报错：${errors.join(' | ')}`);
});

/* ═══ 2. 关卡页的结构 ═══════════════════════════════════════════ */

test('关卡页：有目标、有动手任务、有讲解，且讲解默认折叠', () => {
  const { dom, errors } = boot();

  click($$(dom, '[data-level]')[0]);        // 第 1 关：认牌

  assert.ok($(dom, '.ls-title'), '没有渲染出关卡标题');
  assert.ok($(dom, '.ls-goal'), '没有渲染出「这一关要学会」');
  assert.ok($(dom, '.board'), '没有渲染出动手区');
  assert.ok($(dom, '.task'), '没有渲染出任务组件');

  const details = $(dom, '.lesson-details');
  assert.ok(details, '没有渲染出讲解区');
  assert.equal(details.hasAttribute('open'), false, '任务没做完时讲解不该自动展开');

  click($(dom, '[data-home]'));
  assert.ok($(dom, '.home'), '返回按钮没有回到关卡列表');

  assert.deepEqual(errors, [], `页面报错：${errors.join(' | ')}`);
});

/* ═══ 3. 完成任务 → 记进度 ══════════════════════════════════════ */

test('关卡：三段落结构齐全，答对全部任务后记进度并标已通过', () => {
  const { dom, errors, win } = boot();

  // 第 2 关是纯形状判断，点一下就出结果，最适合做这个用例
  const lv2 = $$(dom, '[data-level]').find((b) => /和牌长什么样/.test(b.textContent));
  click(lv2);

  // 结构必须是「动手 → 讲解 → 再练一次」
  const steps = $$(dom, '.ls-h2').map((e) => e.textContent.replace(/^\d/, '').trim());
  assert.deepEqual(steps, ['动手做', '讲解', '再练一次'],
    `关卡结构应为「动手做 / 讲解 / 再练一次」，实为 ${steps.join(' / ')}`);

  const tasks = $$(dom, '.task');
  assert.equal(tasks.length, 4, `第 2 关应有 4 个任务（2 动手 + 2 再练），实为 ${tasks.length}`);

  // 动手：123m456m789m123p55s 是标准和牌形
  click(tasks[0].querySelector('[data-ans="1"]'));
  assert.ok(/答对了/.test(tasks[0].textContent), '动手第 1 题判定异常');
  // 动手：差一张，不是和牌形
  click(tasks[1].querySelector('[data-ans="0"]'));
  assert.ok(/答对了/.test(tasks[1].textContent), '动手第 2 题判定异常');

  // 再练：1133557799m1122p 是七对子 → 也是和牌形
  click(tasks[2].querySelector('[data-ans="1"]'));
  assert.ok(/答对了/.test(tasks[2].textContent),
    `再练第 1 题（七对子）判定异常：${tasks[2].textContent.slice(-120)}`);
  // 再练：19m19p19s11223344z 既非标准形也非七对子
  click(tasks[3].querySelector('[data-ans="0"]'));
  assert.ok(/答对了/.test(tasks[3].textContent), '再练第 2 题判定异常');

  // 进度落库
  const store = win.localStorage.getItem('mahjong-progress-v1') || '';
  for (const k of ['b2-a', 'b2-b', 'b2-r1', 'b2-r2']) {
    assert.ok(store.includes(k), `任务 ${k} 没写进 localStorage：${store}`);
  }

  // 全部做完 → 讲解自动展开
  assert.equal($(dom, '.lesson-details').hasAttribute('open'), true, '任务全做完后讲解没有自动展开');

  // 回列表 → 这一关标成已通过
  click($(dom, '[data-home]'));
  const card = $$(dom, '[data-level]').find((b) => /和牌长什么样/.test(b.textContent));
  assert.ok(card.classList.contains('done'), '返回列表后该关卡没有标记为已通过');

  assert.deepEqual(errors, [], `页面报错：${errors.join(' | ')}`);
});

/* ═══ 4. 自由对局 ═══════════════════════════════════════════════ */

test('自由对局：能从关卡列表进设置、开打、打完一局', () => {
  const { dom, errors, win } = boot();

  enterGame(dom);
  assert.ok($(dom, '.table'), '没有渲染出牌桌');
  assert.equal($$(dom, '.seat').length, 4, '牌桌应当有 4 个座位面板');
  assert.ok($(dom, '.myhand'), '没有渲染出自己的手牌区');

  const myDiscards = playHand(dom, win);
  assert.ok(myDiscards > 0, '玩家一张牌都没打出去');
  assert.ok($(dom, '.overlay'), '一整局跑完也没出现结算浮层');

  assert.deepEqual(errors, [], `对局过程中报错：${errors.join(' | ')}`);
});

/* ═══ 5. 对局中随时能翻思路卡 ═══════════════════════════════════ */

test('对局：思路卡按钮能打开决策流程，且包含三问', () => {
  const { dom, errors } = boot();
  enterGame(dom);

  click($(dom, '[data-help]'));
  const panel = $(dom, '.help-panel');
  assert.ok(panel, '思路卡没有打开');
  const text = panel.textContent;
  assert.ok(/我离和牌还有多远/.test(text), '思路卡缺少第一问');
  assert.ok(/我在做什么役/.test(text), '思路卡缺少第二问');
  assert.ok(/有人立直吗/.test(text), '思路卡缺少第三问');
  assert.ok(/打牌前/.test(text) && /碰/.test(text), '思路卡缺少动作前自检');

  assert.deepEqual(errors, [], `报错：${errors.join(' | ')}`);
});

/* ═══ 6. 连续多局 + 点数守恒 ════════════════════════════════════ */

test('自由对局：连续打多局，四家点数 + 供托 恒为 100000', () => {
  const { dom, errors, win } = boot();
  enterGame(dom);

  let hands = 0;
  for (let r = 0; r < 4000 && hands < 6; r++) {
    win.__drainTimers();

    if ($(dom, '.overlay')) {
      if ($(dom, '.help-panel')) break;                    // 思路卡开着，不是结算
      const scores = $$(dom, '.seat-head .score').map((e) => Number(e.textContent.replace(/[^\d-]/g, '')));
      const sticks = Number(($(dom, '.center .sticks')?.textContent ?? '').match(/(\d+)\s*$/)?.[1] ?? 0);
      if (scores.length === 4) {
        assert.equal(scores.reduce((a, b) => a + b, 0) + sticks, 100000,
          `第 ${hands} 局后点数不守恒`);
      }
      hands++;
      const next = $(dom, '[data-next]');
      if (!next) break;
      next.click();
      if ($(dom, '.home')) break;                          // 终局回到列表
      continue;
    }

    const tiles = $$(dom, '[data-discard]').filter((b) => !b.disabled);
    if (tiles.length) { tiles[0].click(); continue; }
    const acts = $$(dom, '[data-action]');
    if (acts.length) { acts[acts.length - 1].click(); continue; }
    break;
  }

  assert.ok(hands >= 3, `只完成了 ${hands} 局`);
  assert.deepEqual(errors, [], `报错：${errors.join(' | ')}`);
});

/* ═══ 7. 从关卡直接进对局（第 4 关的通关方式） ══════════════════ */

test('关卡页：基础篇「先动手」，进阶篇「先看速查表」', () => {
  const { dom, errors } = boot();

  // 基础篇：动手区在讲解之前 —— 先撞墙，再给原理
  click($$(dom, '[data-level]').find((b) => /和牌长什么样/.test(b.textContent)));
  assert.deepEqual($$(dom, '.ls-h2').map((e) => e.textContent.replace(/^\d/, '').trim()),
    ['动手做', '讲解', '再练一次'],
    '基础篇的段落顺序应当是 动手做 → 讲解 → 再练一次');

  click($(dom, '[data-home]'));

  // 进阶篇：速查表在先，自测在后 —— 那些概念没先看过根本答不出来，
  // 硬按「先动手」排会变成猜谜
  click($$(dom, '[data-level]').find((b) => /搞懂「为什么别人打了/.test(b.textContent)));
  const advSteps = $$(dom, '.ls-h2').map((e) => e.textContent.replace(/^\d/, '').trim());
  assert.equal(advSteps[0], '讲解', `进阶篇应当先给速查表，实为 ${advSteps.join(' / ')}`);
  assert.ok(advSteps.includes('自测'), `进阶篇的动手区应标为「自测」，实为 ${advSteps.join(' / ')}`);
  assert.equal($(dom, '.lesson-details').hasAttribute('open'), true, '进阶篇的速查表应当默认展开');

  assert.deepEqual(errors, [], `页面报错：${errors.join(' | ')}`);
});

test('第 2 关：动手之前先给了「面子 / 雀头」的定义和一个完整范例', () => {
  const { dom } = boot();
  click($$(dom, '[data-level]').find((b) => /和牌长什么样/.test(b.textContent)));

  const board = $(dom, '.board');
  // 术语表必须在，且覆盖四个核心词
  const dl = board.querySelector('dl.terms');
  assert.ok(dl, '动手之前没有术语表');
  const defined = [...dl.querySelectorAll('dt')].map((e) => e.textContent);
  for (const t of ['面子', '雀头', '顺子', '刻子']) {
    assert.ok(defined.includes(t), `术语表缺少「${t}」`);
  }

  // 范例必须在任务之前：读者要先看到一个拆开的完整例子
  const firstTask = board.querySelector('.task');
  assert.ok(firstTask, '没有找到任务');
  const before = board.innerHTML.split('class="task"')[0];
  assert.ok(/顺子 123m/.test(before), '动手之前没有给出拆解范例的图注');
  assert.ok(before.includes('mj-tile'), '范例里没有画出牌');
});

test('退出对局：要二次确认；确认后回关卡列表，计时器不再把对局拉起来', () => {
  const { dom, errors, win } = boot();
  enterGame(dom);
  assert.ok($(dom, '.table'), '应当先进入牌桌');

  /*
   * 必须先制造出「有待触发的计时器」的局面，否则这条测试是空的。
   * 开局时轮到人类、advance() 会直接返回，一个计时器都没有；
   * 打出一张牌之后才轮到 AI，这时才有 setTimeout 在排队。
   */
  const tiles = $$(dom, '[data-discard]').filter((b) => !b.disabled);
  assert.ok(tiles.length, '开局应当有可打的牌');
  tiles[0].click();
  assert.ok(win.__pendingTimers() > 0,
    '打牌之后应当有 AI 的计时器在排队 —— 没有的话这条用例验不出东西');

  // 点退出 → 弹确认，牌桌还在
  click($(dom, '[data-exit]'));
  assert.ok($(dom, '.confirm'), '没有弹出二次确认 —— 手滑就丢掉一局');
  assert.ok(/退出这一局/.test($(dom, '.confirm').textContent));
  assert.ok($(dom, '.table'), '确认之前不该离开牌桌');

  // 选「继续打」→ 回到牌桌
  click($(dom, '.confirm [data-exit-cancel]'));
  assert.ok(!$(dom, '.confirm'), '点「继续打」之后确认层没关掉');
  assert.ok($(dom, '.table'), '点「继续打」之后应当还在牌桌');

  // 再来一次，这次确认退出
  click($(dom, '[data-exit]'));
  click($(dom, '.confirm [data-exit-confirm]'));
  assert.ok($(dom, '.home'), '确认退出后应当回到关卡列表');
  assert.ok(!$(dom, '.table'), '退出后牌桌应当消失');

  // 关键：待触发的计时器必须清干净。
  // 只断言「drain 之后界面还对」不够 —— advance() 开头有 `if (!S) return`，
  // 没清的定时器醒来也只是什么都不做，照样能通过。所以直接数数量。
  assert.equal(win.__pendingTimers(), 0,
    `退出后还留着 ${win.__pendingTimers()} 个待触发的计时器没清掉`);

  win.__drainTimers();
  assert.ok($(dom, '.home'), '退出后计时器又把对局拉起来了');

  assert.deepEqual(errors, [], `报错：${errors.join(' | ')}`);
});

test('退出对局：中途退出不该算作第 4 关的「打完一局」', () => {
  const { dom, errors, win } = boot();

  click($$(dom, '[data-level]').find((b) => /一局牌怎么走完/.test(b.textContent)));
  click($(dom, '[data-goto-game]'));
  assert.ok($(dom, '.table'), '没有从关卡切到牌桌');

  // 打一步就退出
  win.__drainTimers();
  const tiles = $$(dom, '[data-discard]').filter((b) => !b.disabled);
  if (tiles.length) tiles[0].click();

  click($(dom, '[data-exit]'));
  click($(dom, '.confirm [data-exit-confirm]'));

  const store = win.localStorage.getItem('mahjong-progress-v1') || '';
  assert.ok(!store.includes('b4-play'),
    '中途退出却把「打完一局」记成通过了 —— pendingTask 没清干净');

  assert.deepEqual(errors, [], `报错：${errors.join(' | ')}`);
});

test('第 4 关：从关卡里点「去打一局」，打完一局即通关', () => {
  const { dom, errors, win } = boot();

  const lv4 = $$(dom, '[data-level]').find((b) => /一局牌怎么走完/.test(b.textContent));
  click(lv4);

  click($(dom, '[data-goto-game]'));
  assert.ok($(dom, '.table'), '没有从关卡切到牌桌');

  playHand(dom, win);

  const store = win.localStorage.getItem('mahjong-progress-v1') || '';
  assert.ok(store.includes('b4-play'), `打完一局没有记录通关：${store}`);
  assert.deepEqual(errors, [], `报错：${errors.join(' | ')}`);
});
