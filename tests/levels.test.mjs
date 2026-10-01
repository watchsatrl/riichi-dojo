/**
 * 关卡内容校验
 * =====================================================================
 * 关卡里的每一手牌、每一个答案都是我手挑的。手挑就会挑错 ——
 * 之前在第 2 讲就写反过一道「无役听牌」的答案。
 *
 * 这个文件把那些手挑的判断钉死：形状题直接问引擎「是不是和牌形」，
 * 荣和题直接问引擎「能不能荣和」，把手数错、花色写错、张数不对全部拦下。
 *
 * 另外检查结构性的东西：任务 key 唯一、每关都有动手区和再练区、
 * 打牌训练器的手牌必须是 14 张。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { TIERS, ALL_LEVELS, MINDSET, mindsetCardHTML } from '../play/src/levels/registry.js';
import { parseHand } from '../engine/tiles.js';
import { isAgari } from '../engine/agari.js';
import { canRonReasons } from '../engine/furiten.js';
import { SAKURA_4P } from '../engine/rules.js';

const total = (c) => c.reduce((a, b) => a + b, 0);

/* ═══ 结构 ═══════════════════════════════════════════════════════ */

test('关卡结构：两篇齐全，基础篇 6 关、进阶篇 6 关', () => {
  assert.equal(TIERS.length, 2, '应当有基础篇与进阶篇');
  const [basic, adv] = TIERS;
  assert.equal(basic.levels.length, 6, `基础篇应有 6 关，实为 ${basic.levels.length}`);
  assert.equal(adv.levels.length, 6, `进阶篇应有 6 关，实为 ${adv.levels.length}`);
  assert.equal(basic.required, true, '基础篇必须是必做');
  assert.equal(adv.required, false, '进阶篇必须是选做');
});

test('关卡结构：任务 key 全局唯一，且每关都声明了任务', () => {
  const seen = new Map();
  for (const lv of ALL_LEVELS) {
    assert.ok(Array.isArray(lv.tasks) && lv.tasks.length > 0, `第 ${lv.id} 关没有声明任务`);
    for (const k of lv.tasks) {
      assert.ok(!seen.has(k), `任务 key「${k}」重复：${seen.get(k)} 与 ${lv.id}`);
      seen.set(k, lv.id);
    }
  }
});

test('关卡结构：基础篇每一关都有「动手」和「再练一次」', () => {
  for (const lv of TIERS[0].levels) {
    assert.equal(typeof lv.board, 'function', `基础篇 ${lv.id} 缺少动手区`);
    assert.equal(typeof lv.retry, 'function', `基础篇 ${lv.id} 缺少「再练一次」`);
    assert.ok(lv.goal && lv.goal.length > 4, `基础篇 ${lv.id} 缺少一句话目标`);
  }
  for (const lv of TIERS[1].levels) {
    assert.equal(typeof lv.board, 'function', `进阶篇 ${lv.id} 缺少动手区`);
    assert.equal(typeof lv.retry, 'function', `进阶篇 ${lv.id} 缺少「再练一次」`);
  }
});

test('关卡结构：任务 key 与实际渲染出的任务数一致', () => {
  for (const lv of ALL_LEVELS) {
    const html = (lv.board ? lv.board() : '') + (lv.retry ? lv.retry() : '');
    // 第 4 关的动手区是一个「去打一局」按钮，不是可数的小任务，跳过
    if (/data-goto-game/.test(html)) continue;

    const exCount = (html.match(/class="ex"/g) || []).length;       // 选择题
    const taskCount = (html.match(/class="task"/g) || []).length;   // 形状题 / 荣和题 / 认牌测验
    const dtCount = (html.match(/class="dt"/g) || []).length;       // 打牌训练器
    const declared = lv.tasks.length;
    const rendered = exCount + taskCount + dtCount;

    assert.equal(rendered, declared,
      `第 ${lv.id} 关声明了 ${declared} 个任务，实际渲染出 ${rendered} 个`
      + `（选择题 ${exCount} / 任务组件 ${taskCount} / 打牌训练器 ${dtCount}）`);
  }
});

/* ═══ 手挑的牌必须真的成立 ═══════════════════════════════════════ */

const H = (s) => parseHand(s);

test('第 2 关：四手形状题的答案与引擎一致', () => {
  // b2-a 标准骨架
  assert.equal(isAgari(H('123m456m789m123p55s'), 0), true, 'b2-a 应是和牌形');
  // b2-b 差一张
  assert.equal(isAgari(H('123m456m789m12p55s7s'), 0), false, 'b2-b 不该是和牌形');
  // b2-r1 七对子（不走 4 面子 1 雀头，但也是和牌形）
  assert.equal(isAgari(H('1133557799m1122p'), 0), true, 'b2-r1 是七对子，应判为和牌形');
  // b2-r2 四对 + 六张孤张
  assert.equal(isAgari(H('19m19p19s11223344z'), 0), false, 'b2-r2 不该是和牌形');
});

test('第 3 关：四手荣和题的有役/无役与引擎一致', () => {
  const 无役 = {
    hand: H('234s789s11z'),
    melds: [{ type: 'chi', tiles: [0, 1, 2] }, { type: 'chi', tiles: [12, 13, 14] }],
    winTile: 24, isTsumo: false,
  };
  // b3-a：副露后无役
  assert.equal(canRonReasons(无役, SAKURA_4P).ok, false, 'b3-a 应判为不能和（无役）');
  // b3-b：断幺九，门清荣和
  assert.equal(canRonReasons({ hand: H('234m567m345p678s55s'), winTile: 25 }, SAKURA_4P).ok, true,
    'b3-b 有断幺九，应判为能和');
  // b3-r1：碰白 = 役牌
  assert.equal(canRonReasons({
    hand: H('234m567p789s11z'), melds: [{ type: 'pon', tiles: [31, 31, 31] }], winTile: 24,
  }, SAKURA_4P).ok, true, 'b3-r1 有役牌白，应判为能和');
  // b3-r2：无役（这是当初在教程里被我写反答案的那一手）
  assert.equal(canRonReasons({ hand: H('123m999m456p789s8s'), winTile: 25 }, SAKURA_4P).ok, false,
    'b3-r2 应判为不能和（无役）');
});

test('打牌训练器的手牌必须是 14 张，且每种牌不超过 4 张', () => {
  const hands = [
    '234m567m34p6789s11z', '123m456m789m12p55s7s',
    '234m567m345p67s11z9s', '111m234p567p789s2z9s',
  ];
  for (const s of hands) {
    const c = H(s);
    assert.equal(total(c), 14, `「${s}」应为 14 张，实为 ${total(c)}`);
    assert.ok(c.every((n) => n <= 4), `「${s}」里出现了超过 4 张的牌`);
  }
});

test('第 6 关再练第 2 题：打掉九萬之后确实听 2p / 5p', () => {
  const c = new Array(34).fill(0);
  for (const t of [1, 2, 3, 4, 5, 6, 11, 12, 23, 24, 25, 27, 27]) c[t]++;   // 打掉 9m 后的 13 张
  assert.equal(total(c), 13, '打掉九萬后应剩 13 张');

  for (const [tile, name] of [[10, '2p'], [13, '5p']]) {
    const withIt = c.slice();
    withIt[tile]++;
    assert.ok(isAgari(withIt, 0), `打掉九萬后摸 ${name} 应当能和——否则「听 2p/5p」这句讲解是错的`);
  }

  // 反向确认：九萬本身不是和牌张（否则「孤张」的说法站不住）
  const with9m = c.slice();
  with9m[8]++;
  assert.equal(isAgari(with9m, 0), false, '九萬不应该是有效牌，否则它就不是孤张');
});

/* ═══ 课程完整性：不能在讲之前就用 ═════════════════════════════ */

/**
 * 被追踪的术语 —— 一个从没打过麻将的人光看字面猜不出意思的那些。
 * 「碰」「吃」这种单字虽然也是行话，但它们的解释挂在「鸣牌」条目里，所以不单列。
 */
const TRACKED = [
  '面子', '雀头', '顺子', '刻子', '和牌形',
  '役', '宝牌', '副露', '鸣牌', '立直', '流局', '听牌',
  '向听数', '进张', '孤张', '搭子',
  '振听', '番', '符', '现物', '自摸', '荣和',
];

/** 一屏 HTML 里「定义了哪些术语」：术语表条目 + 牌面图例的标签 */
function introducedBy(html) {
  const out = new Set();
  for (const m of html.matchAll(/<dl class="terms">([\s\S]*?)<\/dl>/g)) {
    for (const d of m[1].matchAll(/<dt>([^<]+)<\/dt>/g)) out.add(d[1].trim());
  }
  for (const m of html.matchAll(/<span class="tl-label">([^<]+)<\/span>/g)) out.add(m[1].trim());
  return out;
}

test('课程完整性：动手区不能出现还没讲过的术语', () => {
  const available = new Set();
  const problems = [];

  for (const tier of TIERS) {
    for (const lv of tier.levels) {
      const board = lv.board ? lv.board() : '';
      const own = introducedBy(board);

      if (tier.id === 'basic') {
        // 基础篇：动手区排在讲解之前，所以只能用「本关动手区自己讲的」或「更早讲过的」。
        // 这一条是被读者骂出来的 —— 第 2 关原本直接让一个没打过麻将的人判断
        // 「4 个面子 + 1 个雀头」，而他从没见过「面子」这个词。
        const usable = new Set([...available, ...own]);
        for (const t of TRACKED) {
          if (board.includes(t) && !usable.has(t)) {
            problems.push(`【${lv.id}】动手区用了「${t}」，但这一关之前没有讲过它`);
          }
        }
      } else {
        // 进阶篇：速查表排在自测之前，所以术语必须能在本关速查表里找到
        const lesson = lv.lesson ? lv.lesson() : '';
        for (const t of TRACKED) {
          if (board.includes(t) && !lesson.includes(t)) {
            problems.push(`【${lv.id}】自测用了「${t}」，但本关速查表里没有它`);
          }
        }
      }

      for (const t of own) available.add(t);
      if (lv.lesson) for (const t of introducedBy(lv.lesson())) available.add(t);
    }
  }

  assert.deepEqual(problems, [], `发现 ${problems.length} 处术语超纲：\n  - ` + problems.join('\n  - '));
});

test('课程完整性：基础篇的动手区只用「正式定义过」的术语', () => {
  // 只查基础篇的动手区与再练区。
  // 进阶篇不查 —— 它的速查表本身就是定义（由上一个测试保证术语确实在里面）。
  // 也不查讲解正文 —— 正文是用散文解释事情的，不该被术语表的粒度绑住。
  const defined = new Set();
  for (const lv of ALL_LEVELS) {
    if (lv.board) for (const t of introducedBy(lv.board())) defined.add(t);
    if (lv.lesson) for (const t of introducedBy(lv.lesson())) defined.add(t);
  }

  const used = new Set();
  for (const lv of TIERS[0].levels) {
    const all = (lv.board ? lv.board() : '') + (lv.retry ? lv.retry() : '');
    for (const t of TRACKED) if (all.includes(t)) used.add(t);
  }

  const missing = [...used].filter((t) => !defined.has(t));
  assert.deepEqual(missing, [],
    `基础篇的动手区用到了这些术语，但它们从没被正式定义过：${missing.join('、')}`);
});

/* ═══ 练习的图必须画得出题目问的东西 ═══════════════════════════ */

/**
 * 这一类 bug 的表现是「题目问的属性，图里根本看不出来」。
 *
 * 已经踩过一次：第 1 讲有一道「这手牌有几组副露」，图却是一排平铺的 14 张。
 * 副露的定义就是「亮出来摆在桌上的牌」，压成一行之后读者分不清哪几组是鸣来的；
 * 而且 14 张全在手上按定义就是门清，题目等于自我否定 —— 正确答案从图上推不出来，
 * 只能靠猜或者看答案。
 *
 * 所以：**凡是题干问到「副露 / 鸣牌」又画了牌的题，图里必须有独立于暗牌的副露块。**
 */
test('练习完整性：问到副露的题，图里必须把副露和暗牌分开画', () => {
  const problems = [];

  const sources = [];
  for (const lv of ALL_LEVELS) {
    if (lv.lesson) sources.push([`${lv.id} 讲解`, lv.lesson()]);
    if (lv.board) sources.push([`${lv.id} 动手`, lv.board()]);
    if (lv.retry) sources.push([`${lv.id} 再练`, lv.retry()]);
  }

  for (const [where, html] of sources) {
    const dom = new JSDOM(`<body>${html}</body>`);
    for (const box of dom.window.document.querySelectorAll('.ex, .task')) {
      const q = (box.querySelector('.ex-q') || box.querySelector('.task-body') || box).textContent || '';
      if (!/副露|鸣牌/.test(q)) continue;
      if (!box.querySelector('.mj-tile')) continue;        // 没画牌的题不适用

      const grouped = box.querySelector('.hand-with-melds')   // 通用分组渲染
        || box.querySelector('.task-lbl');                    // 判定器那种带标签的行
      if (!grouped) {
        problems.push(`【${where}】题干提到了副露，但图里只有一排平铺的牌，看不出哪几组是鸣来的`);
      }
    }
    dom.window.close();
  }

  assert.deepEqual(problems, [], `发现 ${problems.length} 处图文不符：\n  - ` + problems.join('\n  - '));
});

/* ═══ 思路卡 ═════════════════════════════════════════════════════ */

test('思路卡：三问 + 三条动作前自检，且渲染出的 HTML 与数据一致', () => {
  assert.equal(MINDSET.perTurn.length, 3, '「每一巡三问」必须是三条');
  assert.equal(MINDSET.before.length, 3, '「动作前自检」必须是三条');

  const html = mindsetCardHTML();
  for (const x of MINDSET.perTurn) assert.ok(html.includes(x.q), `思路卡缺少「${x.q}」`);
  for (const x of MINDSET.before) {
    assert.ok(html.includes(x.act), `思路卡缺少动作「${x.act}」`);
    assert.ok(html.includes(x.q), `思路卡缺少自检「${x.q}」`);
  }
  // 三问里必须覆盖「距离 / 役 / 威胁」这三个决策维度，
  // 缺任何一个，玩家就会漏掉一整类判断
  const all = MINDSET.perTurn.map((x) => x.q).join('');
  assert.ok(/多远/.test(all), '缺「离和牌多远」这一问');
  assert.ok(/什么役/.test(all), '缺「做什么役」这一问');
  assert.ok(/立直/.test(all), '缺「有没有人立直」这一问');
});
