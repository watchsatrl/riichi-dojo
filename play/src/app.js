/**
 * app.js —— 游戏本体：教学关卡 + 自由对局
 *
 * 四个模式，一个顶层 state 决定渲染哪个：
 *   home  关卡列表（新玩家的落地页）
 *   level 关卡本体（目标 → 动手 → 讲解）
 *   setup 对局设置
 *   game  牌桌
 *
 * 一条贯穿全局的原则：**「现在该做什么」永远问状态机，不靠 phase 猜。**
 * 之前在这里栽过 —— 用 phase 判断该谁打牌，结果摸完牌 phase 还是 'draw'，
 * 界面直接卡死。现在统一走 legalActions。
 */

import { renderTable, renderResult, renderLog } from './table.js';
import { toView } from './adapter.js';
import { chooseAction, chooseDiscard, LEVELS } from './ai.js';
import { buildHint } from './hint.js';
import { renderHome, renderLevel } from './levels/runner.js';
import { findLevel, mindsetCardHTML } from './levels/registry.js';
import { initProgress, markSolved, resetProgress, isSolved } from './progress.js';
import { play, unlock, isEnabled, toggle as toggleAudio } from '../../ui/audio.js';
import { syncBgm, toggleBgm, isBgmEnabled } from '../../ui/chiptune.js';
import { initTasks, mountTasks } from './tasks.js';
import { initWidgets } from '../../tutorial/src/ui-widgets.js';
import { initVerdict } from '../../tutorial/src/ui-verdict.js';
import { initDiscard } from '../../tutorial/src/ui-discard.js';
import {
  createGame, startHand, legalActions, applyAction,
  isHandOver, isGameOver,
} from '../../game/index.js';

const HUMAN = 0;
const SPEED = 420;

let mode = 'home';
let levelId = null;
let S = null;
let logs = [];
let timer = null;
let cfg = { level: 2, seed: null };
let pendingTask = null;      // 从关卡进入对局时，打完一局要记的通关 key
let helpOpen = false;
let hintOpen = false;
let exitAsk = false;         // 退出对局的二次确认

/* ══ 播报文字 ═══════════════════════════════════════════════════ */

const WIND = ['東', '南', '西', '北'];
const NAME = ['你', '下家', '对家', '上家'];
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT = ['萬', '筒', '索'];
const HONOR = ['東', '南', '西', '北', '白', '發', '中'];

function tileCode(t) {
  if (t == null) return '?';
  if (t >= 27) return HONOR[t - 27];
  return CN[t % 9] + SUIT[Math.floor(t / 9)];
}

function logEvents(events) {
  for (const e of events || []) {
    switch (e.type) {
      case 'hand_start': logs.push(`— ${WIND[(e.roundWind ?? 27) - 27]}${e.handNumber + 1}局 ${e.honba}本场 —`); play('handStart'); break;
      case 'draw':         logs.push(`${NAME[e.seat]} 摸牌`); play('draw'); break;
      case 'discard':      logs.push(`${NAME[e.seat]} 打出 ${tileCode(e.tile)}${e.isRiichi ? '（立直）' : ''}`); play('discard'); break;
      case 'meld':         logs.push(`${NAME[e.seat]} ${e.meld?.type === 'chi' ? '吃' : '碰'}`); play('meld'); break;
      case 'kan':          logs.push(`${NAME[e.seat]} 杠`); play('kan'); break;
      case 'riichi':       logs.push(`${NAME[e.seat]} 宣告立直`); play('riichi'); break;
      case 'dora_reveal':  logs.push('翻开新的宝牌指示牌'); play('dora'); break;
      case 'win':          logs.push(`${NAME[e.seat]} 和牌`); play('win'); break;
      case 'draw_end':     logs.push('流局'); play('drawEnd'); break;
      case 'hand_end':     logs.push('—— 本局结束 ——'); break;
      case 'game_over':    logs.push('—— 对局结束 ——'); break;
      default: break;
    }
  }
}

/* ══ 渲染 ═══════════════════════════════════════════════════════ */

function render() {
  const app = document.getElementById('app');
  document.body.className = 'mode-' + mode;   // 学习页要滚动，对局页固定视口

  if (mode === 'home') {
    app.innerHTML = renderHome(true) + `<div class="audio-pair">${audioBtn()}${bgmBtn()}</div>`;
    return;
  }
  if (mode === 'level') {
    app.innerHTML = renderLevel(levelId) + `<div class="audio-pair">${audioBtn()}${bgmBtn()}</div>`;
    mountTasks();                       // 测验的第一题要等 DOM 就位才铺
    return;
  }
  if (mode === 'setup') {
    app.innerHTML = renderSetup() + `<div class="audio-pair">${audioBtn()}${bgmBtn()}</div>`;
    return;
  }

  // game
  const legal = legalActions(S, HUMAN);
  const view = toView(S, HUMAN, legal);
  const over = isHandOver(S) || isGameOver(S);

  // 提示：只在打开时才算（它要做役种判定，不该每帧都跑）
  const hint = hintOpen ? buildHint(S, HUMAN, legal) : null;
  view.hintTile = hint ? hint.highlight : null;

  app.innerHTML = renderTable(view, hint ? hintPanelHTML(hint) : '')
    + renderLog(logs)
    + (over ? renderResult(view) : '')
    + `<div class="side-btns">
        <button type="button" class="hint-btn${hintOpen ? ' on' : ''}" data-hint>提示</button>
        <button type="button" class="help-btn" data-help>思路</button>
        <div class="audio-pair">${audioBtn()}${bgmBtn()}</div>
        <button type="button" class="exit-btn" data-exit>退出对局</button>
      </div>`
    + (exitAsk ? `<div class="overlay" data-exit-cancel>
        <div class="result confirm">
          <h2>退出这一局？</h2>
          ${over
            ? '<div class="sub">这一局已经结束了 —— 退出只会回到关卡列表，点数不会保存。</div>'
            : '<div class="sub">打到一半退出，这一局的进度就没了（没有牌谱回放）。</div>'}
          <div class="acts">
            <button type="button" class="act" data-exit-cancel>继续打</button>
            <button type="button" class="act danger" data-exit-confirm>退出</button>
          </div>
        </div>
      </div>` : '')
    + (helpOpen ? `<div class="overlay help-overlay" data-help-close>
        <div class="result help-panel">
          <h2>思路卡</h2>
          <div class="sub">每一巡照着走一遍，十几局之后就是习惯</div>
          ${mindsetCardHTML()}
          <div class="acts">
            <button type="button" class="act ghost" data-help-close>关上</button>
            <button type="button" class="act ghost" data-home>回关卡列表</button>
          </div>
        </div>
      </div>` : '');
}

/**
 * 离开对局，回到关卡列表。
 *
 * 必须**清掉计时器**：AI 的推进是靠 setTimeout 串起来的，虽然 advance() 开头
 * 有 `if (!S) return`，但留着一条待触发的定时器总归是隐患 —— 退出之后它还会
 * 醒一次，只是恰好什么都不做。清干净更省心。
 *
 * 同时要丢掉 pendingTask：从第 4 关进来的「打完一局即通关」，如果中途退出，
 * 不该在下一次对局结束时被误判为完成。
 */
function quitGame() {
  clearTimeout(timer);
  timer = null;
  S = null;
  logs = [];
  pendingTask = null;
  hintOpen = false;
  helpOpen = false;
  exitAsk = false;
  mode = 'home';
  render();
}

/**
 * 提示面板。
 *
 * 一条提示必须同时给出「打什么」和「为什么」，否则玩家只会照抄，
 * 永远学不会自己判断 —— 这个功能的目的是把人教到不需要它。
 */
function hintPanelHTML(h) {
  return `<div class="hint-panel">
  <div class="hint-head">
    <span class="hint-tag">建议</span>
    <b>${h.title}</b>
    <button type="button" class="hint-close" data-hint aria-label="关掉提示">×</button>
  </div>
  <ul class="hint-lines">${h.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
  ${h.warning ? `<div class="hint-warn">${h.warning}</div>` : ''}
  <div class="hint-foot">按「最常用的和牌方式」给建议：门清做牌 → 听牌 → 立直 → 荣和。不做押引判断。</div>
</div>`;
}

/**
 * 背景音乐开关。和音效分开 —— 音乐是氛围，音效是信息，
 * 想关掉其中一个不该被迫连另一个也关掉。
 */
function bgmBtn() {
  const on = isBgmEnabled();
  return `<button type="button" class="audio-btn${on ? '' : ' off'}" data-bgm
    title="${on ? '关掉背景音乐' : '打开背景音乐'}"
    aria-label="${on ? '关掉背景音乐' : '打开背景音乐'}">
  <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <path d="M7.6 15V5.8l6.8-1.5v9" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linejoin="round" stroke-linecap="round"/>
    <ellipse cx="5.7" cy="15.2" rx="1.9" ry="1.6" fill="currentColor"/>
    <ellipse cx="12.5" cy="13.4" rx="1.9" ry="1.6" fill="currentColor"/>
  </svg>
</button>`;
}

/**
 * 声音开关。固定悬浮在右下角，每个模式都在。
 * 图标用内联 SVG 而不是 emoji —— 和牌面一样，不赌系统字体。
 */
function audioBtn() {
  const on = isEnabled();
  return `<button type="button" class="audio-btn${on ? '' : ' off'}" data-audio
    title="${on ? '关掉声音' : '打开声音'}" aria-label="${on ? '关掉声音' : '打开声音'}">
  <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <path d="M3 7.6h2.9L10 4.1v11.8L5.9 12.4H3z" fill="currentColor"/>
    ${on
      ? '<path d="M12.5 7a4.2 4.2 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
        + '<path d="M14.7 4.9a7.2 7.2 0 0 1 0 10.2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      : '<path d="M12.9 8.1l3.9 3.9M16.8 8.1l-3.9 3.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'}
  </svg>
</button>`;
}

/* ══ 对局设置 ═══════════════════════════════════════════════════ */

function renderSetup() {
  return `<div class="overlay"><div class="result setup">
  <h1>自由对局 · 四人半庄</h1>
  <div class="tagline">雀魂规则 · 牌效率 AI · 随时能翻「思路」卡</div>

  <div class="field">
    <label>对手强度</label>
    <div class="segs">
      ${Object.entries(LEVELS).map(([lv, c]) =>
        `<button type="button" class="seg${Number(lv) === cfg.level ? ' on' : ''}" data-ai-level="${lv}">Lv${lv} ${c.name}</button>`,
      ).join('')}
    </div>
  </div>

  <div class="field">
    <label>随机种子</label>
    <div class="segs">
      <button type="button" class="seg${cfg.seed === null ? ' on' : ''}" data-seed="random">随机</button>
      <button type="button" class="seg${cfg.seed === 20260101 ? ' on' : ''}" data-seed="20260101">固定 20260101</button>
    </div>
  </div>

  <button type="button" class="act primary go" data-start>开始对局</button>
  <div class="acts" style="margin-top:10px">
    <button type="button" class="act ghost" data-home>回关卡列表</button>
  </div>
</div></div>`;
}

/* ══ 游戏循环 ═══════════════════════════════════════════════════ */

function nextDecisionSeat() {
  if (isHandOver(S) || isGameOver(S)) return null;
  if (S.pendingClaims && S.pendingClaims.length) {
    for (const c of S.pendingClaims) if (legalActions(S, c.seat).length) return c.seat;
  }
  for (let s = 0; s < 4; s++) if (legalActions(S, s).length) return s;
  return null;
}

/**
 * 让 AI 走一步。返回 true 表示确实推进了。
 * 必须有返回值：如果「有合法动作却一个都执行不了」，绝不能原地重排计时器 —— 那是死循环。
 */
function stepAI(seat) {
  try {
    const legal = legalActions(S, seat);
    if (!legal.length) return false;

    const act = chooseAction(S, seat, legal);
    if (act) { logEvents(applyAction(S, seat, act)); return true; }

    const d = chooseDiscard(S, seat, legal);
    if (d != null) { logEvents(applyAction(S, seat, { type: 'discard', tile: d })); return true; }

    logEvents(applyAction(S, seat, legal[0]));
    return true;
  } catch (err) {
    logs.push(`⚠ ${err.message}`);
    return false;
  }
}

function onHandFinished() {
  // 从关卡进来的：打完一局就记通关，不管输赢
  if (pendingTask) {
    markSolved(pendingTask);
    pendingTask = null;
  }
}

function advance() {
  clearTimeout(timer);
  if (!S) return;

  if (isGameOver(S)) { render(); return; }
  if (isHandOver(S)) { onHandFinished(); render(); return; }

  const seat = nextDecisionSeat();
  if (seat === null) { onHandFinished(); render(); return; }
  if (seat === HUMAN) { play('yourTurn'); render(); return; }

  timer = setTimeout(() => {
    if (stepAI(seat)) advance();
    else { logs.push('⚠ 对局卡住：该座位声称有合法动作，但一个都执行不了'); render(); }
  }, SPEED);

  render();
}

/* ══ 玩家操作 ═══════════════════════════════════════════════════ */

function onDiscard(tile) {
  try { logEvents(applyAction(S, HUMAN, { type: 'discard', tile })); }
  catch (err) { logs.push(`⚠ ${err.message}`); return; }
  advance();
}

function onAction(action) {
  try {
    if (action.type === 'riichi' && action.tile == null) {
      const me = S.players[HUMAN];
      const d = me.drawnTile != null ? me.drawnTile : chooseDiscard(S, HUMAN, legalActions(S, HUMAN));
      if (d == null) return;
      action = { type: 'riichi', tile: d };
    }
    logEvents(applyAction(S, HUMAN, action));
  } catch (err) { logs.push(`⚠ ${err.message}`); return; }
  advance();
}

function onNextHand() {
  if (isGameOver(S)) { S = null; logs = []; mode = 'home'; render(); return; }
  logs = [];
  logEvents(startHand(S));
  advance();
}

function startGame(taskKey = null) {
  pendingTask = taskKey;
  S = createGame({
    seed: cfg.seed === null ? undefined : cfg.seed,
    aiLevel: [0, cfg.level, cfg.level, cfg.level],
  });
  logs = [];
  mode = 'game';
  logEvents(startHand(S));
  advance();
}

/* ══ 事件 ═══════════════════════════════════════════════════════ */

document.getElementById('app').addEventListener('click', (ev) => {
  const t = ev.target;
  if (!(t instanceof Element)) return;

  // 按钮的触感确认音。只在真的点了可交互元素时响，避免满屏乱响。
  if (t.closest('button, [data-level], [data-action], [data-discard]')) play('click');

  // 导航
  if (t.closest('[data-home]')) {
    clearTimeout(timer); timer = null;
    mode = 'home'; S = null;
    helpOpen = false; hintOpen = false; exitAsk = false;
    render();
    return;
  }

  if (t.closest('[data-audio]')) { toggleAudio(); render(); return; }
  if (t.closest('[data-bgm]')) { toggleBgm(); render(); return; }

  const aiLv = t.closest('[data-ai-level]');
  if (aiLv) { cfg.level = Number(aiLv.dataset.aiLevel); render(); return; }

  const sd = t.closest('[data-seed]');
  if (sd) { cfg.seed = sd.dataset.seed === 'random' ? null : Number(sd.dataset.seed); render(); return; }

  const gotoGame = t.closest('[data-goto-game]');
  if (gotoGame) { startGame(gotoGame.dataset.gotoGame); return; }

  const lvBtn = t.closest('[data-level]');
  if (lvBtn) {
    levelId = lvBtn.dataset.level;
    mode = 'level';
    window.scrollTo(0, 0);
    render();
    return;
  }

  if (t.closest('[data-free-play]')) { mode = 'setup'; render(); return; }
  if (t.closest('[data-start]')) { startGame(null); return; }
  if (t.closest('[data-reset]')) { resetProgress(); render(); return; }
  if (t.closest('[data-next]')) { onNextHand(); return; }

  // 退出对局：先确认，别让人手滑丢掉一局
  if (t.closest('[data-exit]')) { exitAsk = true; render(); return; }
  if (t.closest('[data-exit-confirm]')) { quitGame(); return; }
  const ec = t.closest('[data-exit-cancel]');
  if (ec && (ec === t || ec.classList.contains('overlay'))) { exitAsk = false; render(); return; }

  // 思路卡 / 提示开关
  if (t.closest('[data-hint]')) { hintOpen = !hintOpen; render(); return; }
  if (t.closest('[data-help]')) { helpOpen = true; render(); return; }
  const closer = t.closest('[data-help-close]');
  if (closer && (closer === t || closer.classList.contains('overlay'))) { helpOpen = false; render(); return; }

  // 对局操作
  const dis = t.closest('[data-discard]');
  if (dis && !dis.disabled) { onDiscard(Number(dis.dataset.discard)); return; }
  const act = t.closest('[data-action]');
  if (act) { onAction(JSON.parse(act.dataset.action)); return; }
});

/**
 * 进度变化时**只做定点更新，绝不整页重渲染**。
 *
 * 这里踩过坑：一开始直接 render()，结果完成第一个任务就把第二个任务的 DOM
 * 换掉了 —— 玩家正在做的题瞬间消失，而且新 DOM 用的是新的任务 id，
 * 旧按钮的点击找不到目标，表现为「点了没反应」。
 */
document.addEventListener('mj:progress-changed', () => {
  if (mode !== 'level') return;
  const lv = findLevel(levelId);
  if (!lv) return;
  if ((lv.tasks || []).every(isSolved)) {
    play('levelUp');
    const d = document.querySelector('.lesson-details');
    if (d && !d.open) d.open = true;          // 任务全做完 → 自动展开讲解
    const crumb = document.querySelector('.ls-crumb');
    if (crumb && !crumb.querySelector('.ok')) crumb.insertAdjacentHTML('beforeend', ' · <b class="ok">已通过</b>');
  }
});

/* ══ 启动 ═══════════════════════════════════════════════════════ */

// 浏览器不允许自动播放：AudioContext 必须由用户手势创建。
// 用 pointerdown 而不是 click —— 它在 click 之前触发，第一次点击就有声音。
document.addEventListener('pointerdown', () => { unlock(); syncBgm(); }, { once: true });
document.addEventListener('keydown', () => { unlock(); syncBgm(); }, { once: true });

initProgress();
initWidgets();
initVerdict();
initDiscard();
initTasks();
render();
