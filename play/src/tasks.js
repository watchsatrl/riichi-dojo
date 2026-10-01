/**
 * tasks.js —— 关卡里的「动手任务」
 *
 * 每个任务自己判定对错、自己上报完成（派发 `mj:solved`）。
 * 关卡只负责列出它包含哪些任务 key，不关心任务内部长什么样。
 *
 * 设计原则：**先让玩家动手，再给结论**。所以每个任务都是先答、再看讲解，
 * 而不是先把道理讲完再问。
 */

import { tileSVG, tileName, tileCode, suitOf, rankOf, baseIdx } from '../../ui/tiles.js';
import { play } from '../../ui/audio.js';
import { parseHand } from '../../engine/tiles.js';
import { canRonReasons } from '../../engine/furiten.js';
import { isAgari } from '../../engine/agari.js';
import { SAKURA_4P } from '../../engine/rules.js';

const state = new Map();
let seq = 0;
let bound = false;

const fire = (key, firstTry) =>
  document.dispatchEvent(new CustomEvent('mj:solved', { detail: { key, firstTry } }));

/* ══ 认牌测验 ═══════════════════════════════════════════════════ */

/** 出三个「容易看错」的干扰项：同数字不同花色 / 同花色的相邻数字 */
function distractors(idx) {
  const b = baseIdx(idx);
  const out = [];
  if (suitOf(b) === 3) {
    // 字牌：拿其他字牌当干扰
    for (let i = 27; i <= 33; i++) if (i !== b) out.push(i);
  } else {
    // 数牌：优先同数字的其他花色（最容易混），再补同花色的相邻数字
    for (let s = 0; s < 3; s++) {
      const t = s * 9 + (rankOf(b) - 1);
      if (t !== b) out.push(t);
    }
    for (const d of [1, -1]) {
      const r = rankOf(b) + d;
      if (r >= 1 && r <= 9) out.push((suitOf(b)) * 9 + (r - 1));
    }
  }
  // 洗牌后取三个
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, 3);
}

/**
 * 认牌测验：连答若干题，全对才通过。
 * 干扰项刻意选「同数字不同花色」，因为那正是新手最容易看错的地方。
 */
export function tileQuiz(cfg) {
  const id = 'tq' + (++seq);
  const rounds = cfg.rounds || 5;
  state.set(id, { kind: 'quiz', key: cfg.key, rounds, at: 0, wrong: 0, answer: -1, options: [] });
  return `<div class="task" id="${id}" data-task="${id}">
  <div class="task-head">${cfg.title || '认牌测验'}　<span class="task-prog" data-prog="${id}"></span></div>
  <div class="task-body" data-body="${id}"></div>
  <div class="task-fb" data-fb="${id}"></div>
</div>`;
}

function nextQuizRound(id) {
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box) return;

  if (st.at >= st.rounds) {
    box.querySelector('[data-body]').innerHTML = '<div class="task-done">✓ 全部答对，这一关过了</div>';
    box.querySelector('[data-prog]').textContent = `${st.rounds} / ${st.rounds}`;
    box.querySelector('[data-fb]').className = 'task-fb';
    box.querySelector('[data-fb]').innerHTML = '';
    st.done = true;
    fire(st.key, st.wrong === 0);
    return;
  }

  const ans = Math.floor(Math.random() * 34);
  const opts = [ans, ...distractors(ans)];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  st.answer = ans;
  st.options = opts;

  box.querySelector('[data-prog]').textContent = `${st.at} / ${st.rounds}`;
  box.querySelector('[data-body]').innerHTML = `
    <div class="task-q">这张牌是什么？${tileSVG(ans, { size: 'xl' })}</div>
    <div class="task-opts">${opts.map((t, i) =>
      `<button type="button" class="ex-opt" data-tq="${id}" data-i="${i}">${tileName(t)}</button>`).join('')}</div>`;
}

/* ══ 「能和吗」判定任务 ═════════════════════════════════════════ */

/**
 * 给一手牌和上下文，让玩家判断能不能和 —— 由引擎裁决，不是写死的答案。
 * @param {object} cfg
 * @param {string} cfg.hand     和牌形（含和牌张）
 * @param {Array}  [cfg.melds]
 * @param {number} cfg.winTile
 * @param {boolean} cfg.expect  正确答案（仅用于给反馈文案；判定仍以玩家选择为准）
 */
export function verdictTask(cfg) {
  const id = 'tv' + (++seq);
  const ctx = {
    hand: parseHand(cfg.hand),
    melds: cfg.melds || [],
    winTile: cfg.winTile,
    isTsumo: !!cfg.isTsumo,
    roundWind: cfg.roundWind ?? 27,
    seatWind: cfg.seatWind ?? 28,
    isRiichi: false, isDoubleRiichi: false, isIppatsu: false, isChankan: false,
    isRinshan: false, isHaitei: false, isHoutei: false, isTenhou: false, isChiihou: false,
    doraIndicators: cfg.dora || [], uraIndicators: [], redCount: 0, isNagashiMangan: false,
    pond: cfg.pond || [],
  };
  const res = canRonReasons(ctx, SAKURA_4P);

  state.set(id, { kind: 'verdict', key: cfg.key, res, expect: !!cfg.expect, answered: false });

  const hand = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < ctx.hand[t]; k++) hand.push(t);

  return `<div class="task" id="${id}" data-task="${id}">
  <div class="task-head">${cfg.title || '这手牌能和吗'}</div>
  <div class="task-body">
    <div class="task-row"><span class="task-lbl">手牌</span><span class="hand">${hand.map((t) => tileSVG(t, { size: 'lg' })).join('')}</span></div>
    ${(cfg.melds || []).length ? `<div class="task-row"><span class="task-lbl">已亮出的牌</span>${cfg.melds.map((m) =>
      `<span class="hand">${m.tiles.map((t) => tileSVG(t, { size: 'lg' })).join('')}</span>`).join('')}</div>` : ''}
    <div class="task-row"><span class="task-lbl">别人打出</span><span class="hand">${tileSVG(cfg.winTile, { size: 'lg' })}</span></div>
    <div class="task-opts">
      <button type="button" class="ex-opt" data-tv="${id}" data-ans="1">能和</button>
      <button type="button" class="ex-opt" data-tv="${id}" data-ans="0">不能和</button>
    </div>
  </div>
  <div class="task-fb" data-fb="${id}"></div>
</div>`;
}

/* ══ 「这是和牌形吗」任务 ═══════════════════════════════════════ */

/**
 * 只判断「形状」：4 面子 1 雀头 / 七对子 / 国士，**不看役**。
 * 第 1 关必须把形状和役分开教 —— 新手的第一堵墙正是分不清这两件事。
 */
export function shapeTask(cfg) {
  const id = 'ts' + (++seq);
  const melds = cfg.melds || [];
  const hand = parseHand(cfg.hand);
  const truth = isAgari(hand, melds.length);

  state.set(id, { kind: 'shape', key: cfg.key, truth, answered: false });

  const tiles = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < hand[t]; k++) tiles.push(t);

  return `<div class="task" id="${id}" data-task="${id}">
  <div class="task-head">${cfg.title || '这是和牌形吗'}</div>
  <div class="task-body">
    <div class="task-row"><span class="task-lbl">手牌</span><span class="hand">${tiles.map((t) => tileSVG(t, { size: 'lg' })).join('')}</span></div>
    ${melds.length ? `<div class="task-row"><span class="task-lbl">已亮出的牌</span>${melds.map((m) =>
      `<span class="hand">${m.tiles.map((t) => tileSVG(t, { size: 'lg' })).join('')}</span>`).join('')}</div>` : ''}
    <div class="task-opts">
      <button type="button" class="ex-opt" data-ts="${id}" data-ans="1">是和牌形</button>
      <button type="button" class="ex-opt" data-ts="${id}" data-ans="0">不是</button>
    </div>
  </div>
  <div class="task-fb" data-fb="${id}"></div>
</div>`;
}

/* ══ 事件处理 ═══════════════════════════════════════════════════ */

function onQuizPick(btn) {
  const id = btn.dataset.tq;
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box || st.done) return;

  const picked = st.options[Number(btn.dataset.i)];
  const fb = box.querySelector('[data-fb]');

  if (picked === st.answer) {
    play('correct');
    fb.className = 'task-fb ok';
    fb.innerHTML = `<strong>对。</strong>${tileName(st.answer)}（<code>${tileCode(st.answer)}</code>）`;
    st.at++;
    setTimeout(() => nextQuizRound(id), 480);
  } else {
    play('wrong');
    st.wrong++;
    fb.className = 'task-fb no';
    fb.innerHTML = `<strong>不对。</strong>你选的是 ${tileName(picked)}，再看一眼它画的是圆圈、竹节还是汉字。`;
    box.querySelectorAll('.ex-opt').forEach((o) => {
      if (st.options[Number(o.dataset.i)] === picked) o.classList.add('no');
    });
  }
}

function onVerdictPick(btn) {
  const id = btn.dataset.tv;
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box || st.answered) return;
  st.answered = true;

  const said = btn.dataset.ans === '1';
  const truth = st.res.ok;
  const fb = box.querySelector('[data-fb]');

  box.querySelectorAll('.ex-opt').forEach((o) => {
    o.disabled = true;
    if ((o.dataset.ans === '1') === truth) o.classList.add('ok');
    else if (o === btn) o.classList.add('no');
  });

  const yaku = st.res.yaku.list.map((y) => y.name).join('、');
  const why = [];
  if (!st.res.isAgari) why.push('连和牌形都不是');
  if (!st.res.hasYaku) why.push('没有役（宝牌不算役）');
  if (st.res.isFuriten) why.push('振听');

  fb.className = `task-fb ${said === truth ? 'ok' : 'no'}`;
  play(said === truth ? 'correct' : 'wrong');
  fb.innerHTML = `<strong>${said === truth ? '答对了。' : '不对。'}</strong>`
    + (truth
      ? `能和——成立役种：${yaku || '（无）'}`
      : `不能和——${why.join('；') || '原因不明'}。`)
    + (st.res.reasons?.length ? `<div class="task-why">${st.res.reasons.join('<br>')}</div>` : '');

  if (said === truth) fire(st.key, true);
}

function onShapePick(btn) {
  const id = btn.dataset.ts;
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box || st.answered) return;
  st.answered = true;

  const said = btn.dataset.ans === '1';
  const fb = box.querySelector('[data-fb]');
  box.querySelectorAll('.ex-opt').forEach((o) => {
    o.disabled = true;
    if ((o.dataset.ans === '1') === st.truth) o.classList.add('ok');
    else if (o === btn) o.classList.add('no');
  });

  fb.className = `task-fb ${said === st.truth ? 'ok' : 'no'}`;
  play(said === st.truth ? 'correct' : 'wrong');
  fb.innerHTML = `<strong>${said === st.truth ? '答对了。' : '不对。'}</strong>`
    + (st.truth ? '这手牌能拆成 4 个面子 + 1 个雀头。' : '拆不出 4 个面子 1 个雀头，也不是七对子或国士无双。')
    + '<div class="task-why">注意：这一关只看<b>形状</b>。形状对了不代表能和 —— 还要有「役」，那是下一关。</div>';

  if (said === st.truth) fire(st.key, true);
}

export function initTasks() {
  if (bound) return;
  bound = true;

  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const q = t.closest('[data-tq]');
    if (q) return onQuizPick(q);
    const v = t.closest('[data-tv]');
    if (v) return onVerdictPick(v);
    const s = t.closest('[data-ts]');
    if (s) return onShapePick(s);
  });

  // 页面每次重渲染后，把测验的第一题铺上
  document.addEventListener('mj:tasks-mounted', () => {
    for (const [id, st] of state) {
      if (st.kind === 'quiz' && !st.done && !st.options.length) nextQuizRound(id);
    }
  });
}

/** 供关卡渲染完后调用 */
export function mountTasks() {
  document.dispatchEvent(new CustomEvent('mj:tasks-mounted'));
}
