/**
 * progress.js —— 关卡进度
 *
 * 只记「哪些任务通过了」，不记别的。通关判定由关卡自己按任务清单算，
 * 这样加一关、改一个任务都不需要动这里。
 *
 * 进度存在 localStorage，刷新不丢。读写都包了 try —— 隐私模式下
 * localStorage 会直接抛异常，不该因此让整个游戏打不开。
 */

const STORE_KEY = 'mahjong-progress-v1';

const solved = new Set();
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const k of arr) solved.add(k);
  } catch { /* 隐私模式 / 存储禁用：静默降级为「本次会话有效」 */ }
}

function save() {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify([...solved]));
  } catch { /* 同上 */ }
}

export function isSolved(key) {
  load();
  return solved.has(key);
}

export function markSolved(key) {
  load();
  if (!key || solved.has(key)) return false;
  solved.add(key);
  save();
  return true;
}

export function resetProgress() {
  load();
  solved.clear();
  save();
}

export function solvedCount(keys) {
  load();
  return keys.filter((k) => solved.has(k)).length;
}

/** 一关是否通过：它的全部任务都完成了才算 */
export function isLevelDone(level) {
  const keys = level.tasks || [];
  return keys.length > 0 && keys.every((k) => isSolved(k));
}

/** 一个篇章的完成度 */
export function tierProgress(levels) {
  const total = levels.length;
  const done = levels.filter(isLevelDone).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

/**
 * 把进度事件接到进度表上。
 * ui-widgets / tasks 通过 `mj:solved` 事件上报，这里统一落库。
 */
export function initProgress() {
  document.addEventListener('mj:solved', (ev) => {
    const key = ev.detail?.key;
    if (markSolved(key)) {
      document.dispatchEvent(new CustomEvent('mj:progress-changed', { detail: { key } }));
    }
  });
}
