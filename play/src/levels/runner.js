/**
 * levels/runner.js —— 关卡界面
 *
 * 两屏：
 *   关卡列表（home）—— 分基础/进阶两篇，显示进度
 *   关卡本体（level）—— 目标 → 动手 → 讲解 → 上一关/下一关
 *
 * 「讲解」默认折叠，做完任务才自动展开。顺序不能反：先讲后练会变成背书，
 * 先练后讲才会变成思路。
 */

import { TIERS, ALL_LEVELS, findLevel, tierOf } from './registry.js';
import { isLevelDone, isSolved, tierProgress } from '../progress.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/* ── 关卡列表 ──────────────────────────────────────────────────── */

export function renderHome(hasSave) {
  const totalLevels = ALL_LEVELS.length;
  const doneLevels = ALL_LEVELS.filter(isLevelDone).length;
  const allBasicDone = TIERS[0].levels.every(isLevelDone);

  const tierHTML = TIERS.map((tier) => {
    const p = tierProgress(tier.levels);
    return `<section class="tier">
  <div class="tier-head">
    <h2>${tier.name}${tier.required ? '<span class="tier-tag">必做</span>' : '<span class="tier-tag optional">选做</span>'}</h2>
    <span class="tier-prog">${p.done} / ${p.total}</span>
  </div>
  <p class="tier-desc">${tier.desc}</p>
  <div class="level-grid">
    ${tier.levels.map((lv) => {
      const done = isLevelDone(lv);
      return `<button type="button" class="level-card${done ? ' done' : ''}" data-level="${lv.id}">
  <span class="lv-mark">${done ? '✓' : '·'}</span>
  <span class="lv-text">
    <b>${esc(lv.title)}</b>
    <span>${esc(lv.goal)}</span>
  </span>
</button>`;
    }).join('')}
  </div>
</section>`;
  }).join('');

  return `<div class="home">
  <header class="home-head">
    <h1>日本麻将</h1>
    <p class="home-sub">不会打麻将也能从这里开始。<b>基础篇 6 关</b>走完，你就能自己打完一局。</p>
    <div class="home-prog">
      <div class="bar"><i style="width:${Math.round((doneLevels / totalLevels) * 100)}%"></i></div>
      <span>${doneLevels} / ${totalLevels} 关</span>
    </div>
  </header>

  ${tierHTML}

  <section class="tier">
    <div class="tier-head"><h2>自由对局</h2>
      ${allBasicDone ? '' : '<span class="tier-tag optional">建议先过基础篇</span>'}
    </div>
    <p class="tier-desc">四人半庄，你坐东家，另外三家由 AI 操作。对局里随时能翻「思路」卡。</p>
    <div class="home-actions">
      <button type="button" class="act primary" data-free-play>开始对局</button>
      ${hasSave ? '<button type="button" class="act ghost" data-reset>清空关卡进度</button>' : ''}
    </div>
  </section>
</div>`;
}

/* ── 关卡本体 ──────────────────────────────────────────────────── */

export function renderLevel(id) {
  const lv = findLevel(id);
  if (!lv) return renderHome(false);

  const tier = tierOf(lv);
  const idx = ALL_LEVELS.indexOf(lv);
  const prev = ALL_LEVELS[idx - 1] || null;
  const next = ALL_LEVELS[idx + 1] || null;
  const done = isLevelDone(lv);
  const allDone = (lv.tasks || []).every(isSolved);

  // 进阶篇是「速查表 + 自测」，不是「先撞墙」—— 那些概念没先看过根本答不出来，
  // 硬按「先动手」排会变成猜谜。所以两篇的段落顺序不同。
  const lessonFirst = tier.id === 'advanced';

  const section = (title, html, extra = {}) => ({ title, html, ...extra });

  const boardSec = lv.board ? section(
    lessonFirst ? '自测' : '动手做',
    `${lessonFirst ? '<p class="board-lede">看完上面的速查表，用一道题验一下。</p>' : ''}
     <div class="board">${lv.board()}</div>`,
  ) : null;

  const lessonSec = lv.lesson ? section(
    '讲解',
    `<details class="lesson-details"${(lessonFirst || allDone) ? ' open' : ''}>
      <summary>${allDone ? '任务已完成，展开看原理' : '做完下面的任务再展开（也可以现在就看）'}</summary>
      <div class="lesson-inner">${lv.lesson()}</div>
    </details>`,
  ) : null;

  const retrySec = lv.retry ? section(
    '再练一次',
    `<p class="board-lede">换一批题，把看懂的东西用一遍。看懂和会做是两件事。</p>
     <div class="board">${lv.retry()}</div>`,
  ) : null;

  // 顺序由篇章决定，不是靠事后排序 —— 之前写成「先 push 讲解再 sort」，
  // 而 sort 只在进阶篇执行，结果基础篇的讲解跑到动手前面去了。
  const sections = (lessonFirst
    ? [lessonSec, boardSec, retrySec]
    : [boardSec, lessonSec, retrySec]
  ).filter(Boolean);

  const bodyHTML = sections.map((s, i) => `<section class="ls-block">
    <h2 class="ls-h2"><span class="step">${i + 1}</span>${s.title}</h2>
    ${s.html}
  </section>`).join('');

  // 整个关卡页套在 .lesson-body 里 —— 那套浅色纸面样式是教程里验证过的，
  // 长段中文在深色背景上读着累，所以「学习」用亮底、「对局」用暗底。
  return `<div class="lesson-body level-screen">
  <header class="ls-head">
    <button type="button" class="act ghost back" data-home>← 关卡列表</button>
    <span class="ls-crumb">${tier.name} · 第 ${idx + 1} 关${done ? ' · <b class="ok">已通过</b>' : ''}</span>
  </header>

  <h1 class="ls-title">${esc(lv.title)}</h1>
  <p class="ls-goal"><span class="goal-tag">这一关要学会</span>${esc(lv.goal)}</p>

  ${bodyHTML}

  <nav class="ls-nav">
    ${prev ? `<button type="button" class="act ghost" data-level="${prev.id}">← ${esc(prev.title)}</button>` : '<span></span>'}
    ${next ? `<button type="button" class="act${allDone ? ' primary' : ''}" data-level="${next.id}">${esc(next.title)} →</button>`
      : '<button type="button" class="act primary" data-home>回到关卡列表</button>'}
  </nav>
</div>`;
}
