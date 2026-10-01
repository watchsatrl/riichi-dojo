import { tileSVG, tilesFromCount, tileName } from '../../ui/tiles.js';
import { play } from '../../ui/audio.js';
import { parseHand } from '../../engine/tiles.js';
import { discardUkeire } from '../../engine/waits.js';
/**
 * ui-discard.js —— 交互式「该打哪张」训练器
 *
 * 教程里第二种引擎驱动的组件。
 * 牌效率如果只给结论，读者学不会；必须让他先自己选一张，
 * 再告诉他「你选的这张，进张比最优解少了 4 张」。
 *
 * 所有数字都由引擎的 discardUkeire 现算 —— 教程里不出现任何手写的进张数，
 * 所以不可能算错，也不可能和引擎漂移。
 */


const state = new Map();
let seq = 0;
let bound = false;

/** 向听数的中文说法 */
export function shantenLabel(n) {
  if (n < 0) return '已经和牌';
  if (n === 0) return '听牌';
  if (n === 1) return '一向听';
  if (n === 2) return '两向听';
  return `${n} 向听`;
}

/** 把进张数组渲染成「牌 × 剩余枚数」 */
function ukeireHTML(list) {
  if (!list || !list.length) return '<span class="dt-none">没有能前进的牌</span>';
  return list
    .slice()
    .sort((a, b) => b.count - a.count || a.tile - b.tile)
    .map((u) => `<span class="dt-uke">${tileSVG(u.tile, { size: 'sm' })}<b>${u.count}</b></span>`)
    .join('');
}

/**
 * 渲染一个「该打哪张」训练器。
 * @param {object} cfg
 * @param {string} cfg.hand   14 张手牌（日麻记法）
 * @param {string} [cfg.title]
 * @param {string} [cfg.key]  给了它，选中最优解时会派发 `mj:solved`（关卡用它记通关）
 */
export function discardTrainer(cfg) {
  const id = 'dt' + (++seq);
  const hand = parseHand(cfg.hand);
  state.set(id, { cfg, hand, picked: null });

  const tiles = tilesFromCount(hand);
  return `<div class="dt" id="${id}">
  ${cfg.title ? `<div class="dt-title">${cfg.title}</div>` : ''}
  <div class="dt-prompt">点一张你想打出去的牌：</div>
  <div class="dt-hand">
    ${tiles.map((t, i) =>
      `<button type="button" class="dt-tile" data-dt="${id}" data-i="${i}">${tileSVG(t, { size: 'xl' })}</button>`,
    ).join('')}
  </div>
  <div class="dt-result" data-dt-result="${id}"></div>
</div>`;
}

/** 算出全部候选打牌，并找出最优解 */
function analyse(hand) {
  const options = discardUkeire(hand, 0);
  const bestShanten = Math.min(...options.map((o) => o.shanten));
  const pool = options.filter((o) => o.shanten === bestShanten);
  const bestTotal = Math.max(...pool.map((o) => o.total));
  return {
    options,
    bestShanten,
    bestTotal,
    best: pool.filter((o) => o.total === bestTotal),
  };
}

function onPick(btn) {
  const id = btn.dataset.dt;
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box) return;

  const idx = Number(btn.dataset.i);
  st.picked = idx;

  const myTile = tilesFromCount(st.hand)[idx];
  const { options, bestShanten, bestTotal, best } = analyse(st.hand);
  const mine = options.find((o) => o.discard === myTile);
  if (!mine) return;

  const isBest = mine.shanten === bestShanten && mine.total === bestTotal;

  // 关卡模式：选中最优解即上报通关
  if (isBest && st.cfg.key) {
    document.dispatchEvent(new CustomEvent('mj:solved', { detail: { key: st.cfg.key, firstTry: true } }));
  }
  play(isBest ? 'correct' : 'wrong');

  box.querySelectorAll('.dt-tile').forEach((b, i) => {
    b.classList.toggle('picked', i === idx);
    b.classList.toggle('optimal', isBest && i === idx);
  });

  const bestList = best.map((b) => tileSVG(b.discard, { size: 'sm' })).join(' ');

  box.querySelector('[data-dt-result]').innerHTML = `
    <div class="dt-verdict ${isBest ? 'yes' : 'no'}">
      ${isBest ? '✓ 这是最优解之一' : '△ 还有更好的选择'}
    </div>
    <table class="dt-table">
      <thead><tr><th>打的牌</th><th>结果</th><th>有效进张</th><th class="num">剩余枚数</th></tr></thead>
      <tbody>
        <tr>
          <td class="nowrap">${tileSVG(myTile, { size: 'md' })} ${tileName(myTile)}</td>
          <td class="nowrap">${shantenLabel(mine.shanten)}</td>
          <td>${ukeireHTML(mine.ukeire)}</td>
          <td class="num">${mine.total}</td>
        </tr>
        ${isBest ? '' : `<tr class="best">
          <td class="nowrap">最优 ${bestList}</td>
          <td class="nowrap">${shantenLabel(bestShanten)}</td>
          <td>${ukeireHTML(best[0].ukeire)}</td>
          <td class="num">${bestTotal}</td>
        </tr>`}
      </tbody>
    </table>
    <div class="dt-note">进张枚数已经扣掉你自己手里占用的张数——剩下多少张，就是接下来有几次机会。</div>`;
}

export function initDiscard() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const b = t.closest('.dt-tile');
    if (b) onPick(b);
  });
}
