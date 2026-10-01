import { tileSVG, handHTML, tilesFromCount, tileName, tileCode, baseIdx, isRedIdx } from '../../ui/tiles.js';
import { initWidgets } from './ui-widgets.js';
import { initVerdict, refreshAllVerdicts } from './ui-verdict.js';
import { initDiscard } from './ui-discard.js';
import { LESSONS } from './lessons/index.js';
/**
 * app.js —— 教程外壳：目录、路由、装配。
 *
 * 路由用 location.hash（#l00），这样浏览器前进/后退和刷新都能停在原处。
 * 每讲是一个纯函数，返回 HTML 字符串，放在 lessons/ 目录下。
 * 重渲染不保留局部状态，练习组件的状态由 ui-widgets.js 自己的 Map 持有，
 * 所以切走再切回来等于重置 —— 这是预期行为。
 */


/* ── 未完成讲次的占位 ──────────────────────────────────────────── */

function lessonTodo(les) {
  return `
<div class="lesson-head">
  <div class="kicker">第 ${les.num} 讲</div>
  <h1>${les.title}</h1>
</div>
<div class="note">
<p>这一讲的内容已经规划好，但还没写。目前先完成<strong>第 0–1 讲</strong>作为样章，用来确认讲解语气和交互手感。</p>
</div>
<p>如果你对后面的讲次顺序、详略、或者某一讲该讲什么有想法，现在改代价最小。</p>
`;
}

/* ── 渲染 ──────────────────────────────────────────────────────── */

function sidebarHTML(currentId) {
  const groups = [];
  for (const les of LESSONS) {
    let g = groups.find((x) => x.name === les.group);
    if (!g) { g = { name: les.group, items: [] }; groups.push(g); }
    g.items.push(les);
  }

  return `
<div class="sidebar-title">日本麻将 · 零基础入门</div>
<div class="sidebar-sub">交互式教程 · 雀魂规则</div>
${groups.map((g) => `
<div class="nav-group">${g.name}</div>
${g.items.map((les) => `
<a class="nav-item${les.id === currentId ? ' active' : ''}" href="#${les.id}">
  <span class="nav-num">${les.num}</span><span>${les.title}${les.todo ? '<span class="nav-wip">待写</span>' : ''}</span>
</a>`).join('')}`).join('')}
`;
}

function render() {
  const id = (location.hash || '#l00').slice(1);
  const les = LESSONS.find((l) => l.id === id) || LESSONS[0];
  document.getElementById('app').innerHTML = `
<div class="layout">
  <aside class="sidebar">${sidebarHTML(les.id)}</aside>
  <main class="content">${les.todo ? lessonTodo(les) : les.render()}</main>
</div>`;
  // 判定器是引擎驱动的，必须等 DOM 就位后再算第一遍
  refreshAllVerdicts();
  window.scrollTo(0, 0);
}

initWidgets();
initVerdict();
initDiscard();
window.addEventListener('hashchange', render);
render();

// 方便在浏览器控制台里调试牌面渲染
window.MJ = { tileSVG, handHTML, tilesFromCount, tileName, tileCode, baseIdx, isRedIdx, LESSONS };
