/**
 * ui-widgets.js —— 练习组件
 *
 * 设计取向（这是教程有没有用的关键）：
 *   - 答错不直接给答案，先给一个「往哪想」的提示，允许重试
 *   - 连错两次才揭示答案并展开讲解
 *   - 答对后必定展开讲解 —— 因为「蒙对」和「懂了」是两回事
 *
 * 交互用事件委托挂在 document 上，所以每次重渲染 innerHTML 都不会丢绑定。
 */

import { play } from '../../ui/audio.js';

const state = new Map();
let seq = 0;
let bound = false;

/**
 * 生成一道练习。
 * @param {object} cfg
 * @param {string} cfg.q          题干（可含 HTML，比如牌面）
 * @param {string[]} cfg.options  选项（可含 HTML）
 * @param {number|number[]} cfg.answer 正确选项下标；传数组即为多选
 * @param {string} [cfg.explain]  答对后展开的讲解
 * @param {string} [cfg.hint]     答错时的提示
 * @param {string} [cfg.key]      稳定标识。给了它，答对时会在 document 上派发
 *                                `mj:solved` 事件（关卡系统靠它记录通关进度）
 */
export function exercise(cfg) {
  const id = 'ex' + (++seq);
  const multi = Array.isArray(cfg.answer);
  const answers = (multi ? cfg.answer : [cfg.answer]).slice();

  state.set(id, {
    key: cfg.key || null,
    multi,
    answers,
    explain: cfg.explain || '',
    hint: cfg.hint || '再想想。',
    picked: new Set(),
    tries: 0,
    solved: false,
  });

  const opts = cfg.options
    .map((o, i) => `<button type="button" class="ex-opt" data-ex="${id}" data-i="${i}">${o}</button>`)
    .join('');

  return `<div class="ex" id="${id}">
  <div class="ex-q">${cfg.q}</div>
  <div class="ex-opts">${opts}</div>
  <div class="ex-fb" data-fb="${id}"></div>
  <div class="ex-actions">
    ${multi ? `<button type="button" class="btn" data-submit="${id}">确认</button>` : ''}
    <button type="button" class="btn" data-reset="${id}">重做</button>
  </div>
</div>`;
}

function feedback(box, kind, html) {
  const fb = box.querySelector('[data-fb]');
  fb.className = `ex-fb show ${kind}`;
  fb.innerHTML = html;
}

function lockAll(box) {
  box.querySelectorAll('.ex-opt').forEach((o) => { o.disabled = true; });
  const s = box.querySelector('[data-submit]');
  if (s) s.disabled = true;
}

function evaluate(id) {
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box) return;

  const picked = [...st.picked];
  const correct = picked.length === st.answers.length && picked.every((i) => st.answers.includes(i));

  if (correct) {
    st.solved = true;
    box.querySelectorAll('.ex-opt').forEach((o, i) => {
      o.classList.remove('no');
      if (st.answers.includes(i)) o.classList.add('ok');
    });
    lockAll(box);
    feedback(box, 'ok', `<strong>答对了。</strong>${st.explain}`);
    play('correct');
    announce(st, true);
    return;
  }

  st.tries += 1;
  play('wrong');
  box.querySelectorAll('.ex-opt').forEach((o, i) => {
    if (st.picked.has(i) && !st.answers.includes(i)) o.classList.add('no');
  });

  if (st.tries >= 2) {
    st.solved = true;
    box.querySelectorAll('.ex-opt').forEach((o, i) => {
      o.classList.remove('no');
      if (st.answers.includes(i)) o.classList.add('ok');
    });
    lockAll(box);
    feedback(box, 'no', `<strong>还是不对。</strong>正确答案已经标出来了。${st.explain}`);
    announce(st, false);
  } else {
    feedback(box, 'no', `<strong>不对。</strong>${st.hint}`);
  }
}

/**
 * 答对（或连错两次看到答案）时通知外部。
 * 用事件而不是直接调用关卡模块，是为了让 ui-widgets 保持独立 ——
 * 教程页面没有关卡系统，也得能正常跑。
 */
function announce(st, firstTry) {
  if (!st.key) return;
  document.dispatchEvent(new CustomEvent('mj:solved', {
    detail: { key: st.key, firstTry },
  }));
}

function onPick(btn) {
  const id = btn.dataset.ex;
  const st = state.get(id);
  if (!st || st.solved) return;

  const box = document.getElementById(id);
  const i = Number(btn.dataset.i);

  if (st.multi) {
    if (st.picked.has(i)) { st.picked.delete(i); btn.classList.remove('picked'); }
    else { st.picked.add(i); btn.classList.add('picked'); }
    return;
  }

  st.picked.clear();
  box.querySelectorAll('.ex-opt').forEach((o) => o.classList.remove('no'));
  st.picked.add(i);
  evaluate(id);
}

function onSubmit(id) {
  const st = state.get(id);
  if (!st || st.solved) return;
  if (!st.picked.size) return;
  evaluate(id);
}

function onReset(id) {
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box) return;
  st.picked.clear();
  st.tries = 0;
  st.solved = false;
  box.querySelectorAll('.ex-opt').forEach((o) => {
    o.disabled = false;
    o.className = 'ex-opt';
  });
  const s = box.querySelector('[data-submit]');
  if (s) s.disabled = false;
  const fb = box.querySelector('[data-fb]');
  fb.className = 'ex-fb';
  fb.innerHTML = '';
}

/** 全局只绑定一次；用事件委托，重渲染不会丢绑定 */
export function initWidgets() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const opt = t.closest('.ex-opt');
    if (opt && !opt.disabled) return onPick(opt);
    const sub = t.closest('[data-submit]');
    if (sub) return onSubmit(sub.dataset.submit);
    const rst = t.closest('[data-reset]');
    if (rst) return onReset(rst.dataset.reset);
  });
}
