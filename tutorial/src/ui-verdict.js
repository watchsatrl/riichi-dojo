import { tileSVG, tilesFromCount } from '../../ui/tiles.js';
import { parseHand, removeTile, cloneHand, totalTiles } from '../../engine/tiles.js';
import { waitingTiles } from '../../engine/waits.js';
import { canRonReasons } from '../../engine/furiten.js';
import { SAKURA_4P } from '../../engine/rules.js';
/**
 * ui-verdict.js —— 交互式「能不能和」判定器
 *
 * 这是整个教程里最重要的交互组件。
 * 新手最大的那堵墙是「我明明凑齐了四面子一雀头，凭什么不让我和」——
 * 而这个组件把墙拆开给他看：能实时切换自摸/荣和、往牌河里加牌，
 * 然后由引擎当场告诉他「不能和，因为无役 / 因为振听」。
 *
 * 关键点：判定不是我写死的，是引擎算出来的（canRonReasons）。
 * 所以教程不可能教错，改了引擎教程就跟着变。
 */


const state = new Map();
let seq = 0;
let bound = false;

const MELD_LABEL = { chi: '吃', pon: '碰', minkan: '明杠', ankan: '暗杠', kakan: '加杠' };

/**
 * 渲染一个判定器面板。
 * @param {object} cfg
 * @param {string} cfg.hand     和牌时的暗牌（日麻记法，含和牌张），如 '234s789s11z'
 * @param {Array}  [cfg.melds]  副露
 * @param {number} cfg.winTile  和牌张索引
 * @param {string} [cfg.title]  场景标题
 * @param {number} [cfg.roundWind] 场风（27=東）
 * @param {number} [cfg.seatWind]  自风
 */
export function judge(cfg) {
  const id = 'jd' + (++seq);
  const hand14 = parseHand(cfg.hand);
  const melds = cfg.melds || [];
  if (cfg.winTile === undefined) throw new Error(`judge(${cfg.hand}): 必须给 winTile`);

  const hand13 = cloneHand(hand14);
  removeTile(hand13, cfg.winTile, 1);
  const waits = waitingTiles(hand13, melds.length, melds);

  state.set(id, {
    cfg,
    hand14,
    hand13,
    melds,
    waits,
    tsumo: false,
    riichi: false,
    pond: new Set(),
  });

  return `<div class="judge" id="${id}">
  ${cfg.title ? `<div class="judge-title">${cfg.title}</div>` : ''}
  <div class="judge-board">
    <div class="judge-row">
      <span class="judge-tag">手中暗牌</span>
      <span class="hand">${tilesFromCount(hand14).map((t) => tileSVG(t, { size: 'lg' })).join('')}</span>
    </div>
    ${melds.length ? `<div class="judge-row">
      <span class="judge-tag">已副露</span>
      ${melds.map((m) => `<span class="hand">${m.tiles.map((t) => tileSVG(t, { size: 'lg' })).join('')}</span>`).join('')}
    </div>` : ''}
    <div class="judge-row">
      <span class="judge-tag">和别人打出的</span>
      <span class="hand">${tileSVG(cfg.winTile, { size: 'lg' })}</span>
    </div>
  </div>

  <div class="judge-controls">
    <button type="button" class="btn jd-toggle" data-jd="${id}" data-key="tsumo">自摸</button>
    <button type="button" class="btn jd-toggle" data-jd="${id}" data-key="riichi">已立直</button>
  </div>

  <div class="judge-pond-block">
    <div class="judge-pond-label">往自己的牌河里加牌（点一下切换）：</div>
    <div class="judge-pond-opts">
      ${waits.map((t) =>
        `<button type="button" class="btn jd-pond" data-jd="${id}" data-tile="${t}">${tileSVG(t, { size: 'sm' })}</button>`,
      ).join('')}
    </div>
  </div>

  <div class="judge-result" data-jd-result="${id}"></div>
</div>`;
}

/** 重新计算并渲染判定结果 */
function update(id) {
  const st = state.get(id);
  const box = document.getElementById(id);
  if (!st || !box) return;

  const c = {
    hand: st.hand14,
    melds: st.melds,
    winTile: st.cfg.winTile,
    isTsumo: st.tsumo,
    roundWind: st.cfg.roundWind ?? 27,
    seatWind: st.cfg.seatWind ?? 28,
    isRiichi: st.riichi,
    isDoubleRiichi: false,
    isIppatsu: false,
    isChankan: false,
    isRinshan: false,
    isHaitei: false,
    isHoutei: false,
    isTenhou: false,
    isChiihou: false,
    doraIndicators: st.cfg.dora || [],
    uraIndicators: [],
    redCount: 0,
    isNagashiMangan: false,
    pond: [...st.pond],
  };

  let res;
  try {
    res = canRonReasons(c, SAKURA_4P);
  } catch (e) {
    box.querySelector('[data-jd-result]').innerHTML =
      `<div class="jd-verdict no">判定出错：${e.message}</div>`;
    return;
  }

  const ok = res.ok;
  const yakuList = res.yaku.list
    .map((y) => `<span class="jd-yaku">${y.name}${y.isYakuman ? '（役满）' : ` ${y.han}番`}</span>`)
    .join('');

  const reasons = res.reasons.map((r) => `<li>${r}</li>`).join('');

  box.querySelector('[data-jd-result]').innerHTML = `
    <div class="jd-verdict ${ok ? 'yes' : 'no'}">
      ${ok ? '✓ 可以和牌' : '✗ 不能和牌'}
    </div>
    <div class="jd-detail">
      <div class="jd-line"><strong>和牌形</strong>：${res.isAgari ? '成立' : '不成立'}</div>
      <div class="jd-line"><strong>有役</strong>：${res.hasYaku ? '是' : '<span class="bad">否</span>'}</div>
      <div class="jd-line"><strong>振听</strong>：${res.isFuriten ? '<span class="bad">是</span>' : '否'}</div>
      ${yakuList ? `<div class="jd-line"><strong>成立役种</strong>：${yakuList}</div>` : ''}
      <ul class="jd-reasons">${reasons}</ul>
    </div>`;

  // 同步按钮状态
  box.querySelectorAll('.jd-toggle').forEach((b) => {
    b.classList.toggle('on', !!st[b.dataset.key]);
  });
  box.querySelectorAll('.jd-pond').forEach((b) => {
    b.classList.toggle('on', st.pond.has(Number(b.dataset.tile)));
  });
}

function onToggle(btn) {
  const st = state.get(btn.dataset.jd);
  if (!st) return;
  st[btn.dataset.key] = !st[btn.dataset.key];
  update(btn.dataset.jd);
}

function onPond(btn) {
  const id = btn.dataset.jd;
  const st = state.get(id);
  if (!st) return;
  const t = Number(btn.dataset.tile);
  if (st.pond.has(t)) st.pond.delete(t); else st.pond.add(t);
  update(id);
}

/** 全局只绑定一次 */
export function initVerdict() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const tog = t.closest('.jd-toggle');
    if (tog) return onToggle(tog);
    const pond = t.closest('.jd-pond');
    if (pond) return onPond(pond);
  });
}

/** 页面渲染完所有判定器后调用一次，初始化显示 */
export function refreshAllVerdicts() {
  for (const id of state.keys()) update(id);
}
