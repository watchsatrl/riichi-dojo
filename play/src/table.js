/**
 * table.js —— 牌桌渲染（纯函数，从 view 对象生成 HTML）
 *
 * 刻意只依赖一个扁平的 view 对象，而不是直接吃状态机内部结构。
 * 这样状态机的字段怎么改，都只需要动 adapter.js 一处。
 *
 * 方位约定（和教程第 3 讲一致）：
 *   下家在你的右边，上家在左边，行动逆时针。
 *   所以相对座位：bottom = 自己，right = 下家(+1)，top = 对家(+2)，left = 上家(+3)。
 */

import { tileSVG, tilesFromCount, tileName } from '../../ui/tiles.js';

const WINDS = ['東', '南', '西', '北'];
const SEAT_NAME = ['你', '下家', '对家', '上家'];

/** 相对方位：自己 → 右(下家) → 上(对家) → 左(上家) */
const relSeat = (seat, me) => (seat - me + 4) % 4;

function meldHTML(meld, size) {
  return `<span class="meld">${meld.tiles.map((t) => tileSVG(t, { size })).join('')}</span>`;
}

function pondHTML(pond, called, lastIdx, size) {
  if (!pond || !pond.length) return '';
  const cells = pond.map((t, i) => {
    const cls = ['cell', called && called[i] ? 'called' : '', i === lastIdx ? 'last' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}">${tileSVG(t, { size })}</span>`;
  }).join('');
  return `<div class="pond">${cells}</div>`;
}

/** 其他三家的面板 */
function opponentHTML(p, view) {
  const rel = relSeat(p.seat, view.mySeat);
  const area = rel === 1 ? 'seat-right' : rel === 2 ? 'seat-top' : 'seat-left';
  const hidden = p.hand && p.hand.length
    ? p.hand.map(() => tileSVG(-1, { size: 'md' })).join('')
    : '';
  const isDealer = p.seat === view.dealer;

  return `<div class="seat ${area}${p.seat === view.turn ? ' active' : ''}${isDealer ? ' dealer' : ''}">
  <div class="seat-head">
    <span class="wind">${WINDS[p.wind]}</span>
    <span class="who">${SEAT_NAME[rel]}</span>
    ${p.riichi ? '<span class="riichi">立直</span>' : ''}
    ${p.furiten ? '<span class="furiten">振听</span>' : ''}
    <span class="score">${p.score}</span>
  </div>
  <div class="hand-row">${hidden}</div>
  ${p.melds && p.melds.length ? `<div class="melds-row">${p.melds.map((m) => meldHTML(m, 'md')).join('')}</div>` : ''}
</div>`;
}

/**
 * 中央：四家的牌河 + 场次信息。
 *
 * 牌河必须摆在桌子中间 —— 这是麻将的物理事实：打出的牌落在桌子中央，四家各占一条边。
 * 早先把牌河塞进各家的座位面板里，6 列挤在 190px 宽的栏里，既看不出是谁打的，
 * 也数不清张数。
 */
function centerHTML(view) {
  const me = view.mySeat;
  const byRel = {};
  for (const p of view.players) byRel[(p.seat - me + 4) % 4] = p;

  // rel: 0 = 自己(下) · 1 = 下家(右) · 2 = 对家(上) · 3 = 上家(左)
  const zone = (rel, area) => {
    const p = byRel[rel];
    if (!p) return '';
    return `<div class="pond-zone pz-${area}">${pondHTML(p.pond, p.pondCalled, p.lastPondIdx, 'md')}</div>`;
  };

  const sticks = view.riichiSticks || 0;
  return `<div class="center">
  ${zone(2, 'top')}
  ${zone(3, 'left')}
  <div class="center-info">
    <div class="round">${WINDS[view.roundWind]}${view.handNumber + 1}局 · ${view.honba}本场</div>
    <div class="walls">${view.wallRemaining}</div>
    <div class="walls-lbl">余 牌</div>
    <div class="sticks">
      <span>供托 <span class="stick-dots">${sticks ? '｜'.repeat(sticks) : '—'}</span> ${sticks * 1000}</span>
    </div>
  </div>
  ${zone(1, 'right')}
  ${zone(0, 'bottom')}
</div>`;
}

/** 自己的面板：只放副露（牌河已经移到桌子中间） */
function selfPanelHTML(p, view) {
  const isDealer = p.seat === view.dealer;
  return `<div class="seat seat-bottom${p.seat === view.turn ? ' active' : ''}${isDealer ? ' dealer' : ''}">
  <div class="seat-head">
    <span class="wind">${WINDS[p.wind]}</span>
    <span class="who">你</span>
    ${p.riichi ? '<span class="riichi">立直</span>' : ''}
    ${p.furiten ? '<span class="furiten">振听</span>' : ''}
    <span class="score">${p.score}</span>
  </div>
  ${p.melds && p.melds.length ? `<div class="melds-row">${p.melds.map((m) => meldHTML(m, 'lg')).join('')}</div>` : ''}
</div>`;
}

/** 自己的手牌（可点击）+ 动作按钮 */
function myHandHTML(view) {
  const me = view.players[view.mySeat];
  const tiles = tilesFromCount(me.hand);
  const drawn = me.drawnTile;

  // 摸到的牌单独放在右边，和整理好的手牌隔开 —— 这是真实牌桌的习惯
  const handTiles = drawn == null ? tiles : (() => {
    const c = tiles.slice();
    const i = c.lastIndexOf(drawn);
    if (i >= 0) c.splice(i, 1);
    return c;
  })();

  // 哪些牌现在能打，直接**从合法动作集合推**，不要靠 phase 猜。
  // 状态机在摸完牌后仍然报 phase='draw'，但此刻打牌已经合法 ——
  // 早先按 phase 判断，导致 14 张牌全是灰的，一局都打不出去。
  const discardable = new Set(
    (view.legal || []).filter((a) => a.type === 'discard').map((a) => a.tile),
  );
  const canDiscard = discardable.size > 0;

  const btn = (t, cls) => {
    const ok = canDiscard && discardable.has(t);
    // 提示推荐的那张牌加一圈描边，眼睛不用在 14 张里找
    const hinted = view.hintTile != null && t === view.hintTile;
    return `<button type="button" class="tile-btn${cls}${hinted ? ' hinted' : ''}" data-discard="${t}"${ok ? '' : ' disabled'}>${tileSVG(t, { size: 'xl' })}</button>`;
  };

  return `<div class="myhand">
  <div class="myhand-row">${handTiles.map((t) => btn(t, '')).join('')}${drawn == null ? '' : btn(drawn, ' drawn')}</div>
  <div class="actions">${actionButtonsHTML(view)}</div>
</div>`;
}

/**
 * 动作按钮。
 * 打牌不在这里 —— 它是靠点手牌触发的。状态机把 discard 也列进合法动作，
 * 渲染时必须滤掉，否则会冒出一排写着「discard」的按钮。
 */
function actionButtonsHTML(view) {
  const acts = (view.legal || []).filter((a) => a.type !== 'discard');
  if (!acts.length) {
    const canDiscard = (view.legal || []).some((a) => a.type === 'discard');
    return canDiscard
      ? '<span class="hint">点上面的一张牌打出</span>'
      : '<span class="hint">等待其他家…</span>';
  }

  return acts.map((a) => {
    const label = {
      tsumo: '自摸', ron: '荣和', chi: '吃', pon: '碰', kan: '杠',
      riichi: '立直', kyuushu: '九种九牌', pass: '过',
    }[a.type] || a.type;

    const cls = (a.type === 'tsumo' || a.type === 'ron') ? 'act primary'
      : a.type === 'pass' ? 'act ghost' : 'act';

    // 吃有多个方案时，把用哪两张写进按钮，让玩家能选
    const extra = a.type === 'chi' && a.tiles
      ? ' ' + a.tiles.map((t) => tileName(t)).join('')
      : '';

    return `<button type="button" class="${cls}" data-action='${JSON.stringify(a)}'>${label}${extra}</button>`;
  }).join('');
}

/** 顶部状态条 */
function topbarHTML(view) {
  const dora = (view.doraIndicators || []).map((t) => tileSVG(t, { size: 'sm' })).join('');
  const ura = view.riichiSticks > 0 && view.uraIndicators && view.uraIndicators.length
    ? `<span class="ura">${view.uraIndicators.map((t) => tileSVG(t, { size: 'sm' })).join('')}</span>` : '';

  return `<div class="topbar">
  <span class="stat"><span class="lbl">宝牌指示牌</span><span class="dora">${dora}</span></span>
  ${ura ? `<span class="stat">${ura}</span>` : ''}
  <span class="grow"></span>
  <span class="stat"><span class="lbl">牌山剩余</span><span class="val">${view.wallRemaining}</span></span>
</div>`;
}

/**
 * 上一帧的状态签名。
 *
 * 为什么需要它：整个牌桌是**每次事件都整块重建 innerHTML** 的，而 CSS 动画在
 * 元素被重建时会重新播一遍 —— 结果就是牌河里最后一张牌、刚摸进来的那张，
 * 每渲染一次就重新「啪」地落一次，看着像抽搐。
 *
 * 所以只在「这一帧和上一帧确实不一样」时才挂上会触发动画的类。
 * 代价是牌局中途插入无关重渲染（比如开关思路卡）不会补播动画 —— 那本来也不该播。
 */
let lastSignature = null;

function signatureOf(view) {
  const p = view.players.map((x) =>
    `${x.seat}:${x.pond ? x.pond.length : 0}/${x.hand ? x.hand.length : 0}/${x.melds ? x.melds.length : 0}/${x.riichi ? 1 : 0}/${x.score}`);
  return `${view.turn}|${view.phase}|${p.join('|')}|${view.legal ? view.legal.length : 0}`;
}

/** 整张桌子 */
export function renderTable(view, hintHTML = '') {
  const sig = signatureOf(view);
  const changed = sig !== lastSignature;
  lastSignature = sig;

  const opponents = view.players
    .filter((p) => p.seat !== view.mySeat)
    .map((p) => opponentHTML(p, view))
    .join('');

  const me = view.players[view.mySeat];

  return `${topbarHTML(view)}
<div class="table${changed ? ' anim' : ''}">
  ${opponents}
  ${centerHTML(view)}
  ${selfPanelHTML(me, view)}
</div>
${hintHTML}
${myHandHTML(view)}`;
}

/** 测试用：清掉签名记忆，避免用例之间互相影响 */
export function resetTableAnimation() {
  lastSignature = null;
}

/**
 * 结算浮层。
 *
 * 注意状态机的结算对象是「一局」而不是「一家」：
 *   和牌 → { type:'win',  winners: [...], deltas }   ← 雀魂无头跳，可能有多家
 *   流局 → { type:'draw', kind, tenpai, deltas }
 * 所以这里必须遍历 winners，不能假设只有一个和牌者。
 */

const DRAW_KIND = {
  exhaustive: '荒牌流局',
  kyuushu: '九种九牌',
  suufonrenda: '四风连打',
  suuchariichi: '四家立直',
  sukanagare: '四槓散了',
  nagashi: '流局满贯',
};

const deltaRow = (view, deltas) => `<div class="deltas">${view.players.map((p, i) =>
  `<span class="d ${deltas[i] > 0 ? 'up' : deltas[i] < 0 ? 'down' : ''}">${WINDS[p.wind]} ${deltas[i] > 0 ? '+' : ''}${deltas[i]}</span>`,
).join('')}</div>`;

function whoName(seat, view) {
  return seat === view.mySeat ? '你' : SEAT_NAME[relSeat(seat, view.mySeat)];
}

export function renderResult(view) {
  const r = view.result;
  if (!r) return '';

  if (r.type === 'draw') {
    const tenpai = (r.tenpai || []).map((t, i) => (t ? WINDS[view.players[i].wind] : null)).filter(Boolean);
    return `<div class="overlay"><div class="result">
  <h2>${DRAW_KIND[r.kind] || '流局'}</h2>
  <div class="sub">听牌：${tenpai.length ? tenpai.join('、') : '无人听牌'}</div>
  ${deltaRow(view, r.deltas || [0, 0, 0, 0])}
  <div class="acts"><button type="button" class="act primary" data-next>下一局</button></div>
</div></div>`;
  }

  const winners = r.winners || [];
  const multi = winners.length > 1;
  const title = multi
    ? `${winners.map((w) => whoName(w.seat, view)).join('、')} 同时和牌`
    : `${whoName(winners[0].seat, view)}和牌`;

  const blocks = winners.map((w) => {
    const yaku = (w.yaku || []).map((y) =>
      `<div class="yaku-line"><span>${y.name}</span><span class="han">${y.isYakuman ? '役满' : y.han + ' 番'}</span></div>`,
    ).join('')
      + (w.doraHan ? `<div class="yaku-line"><span>宝牌</span><span class="han">${w.doraHan} 番</span></div>` : '');

    return `<div class="sub">${w.isTsumo ? '自摸' : '荣和'}　${w.fu} 符 ${w.totalHan ?? w.han} 番${w.limitName ? '　（' + w.limitName + '）' : ''}</div>
  <div class="yaku-list">${yaku || '<div class="yaku-line"><span>（无役）</span></div>'}</div>
  <div class="total">${(w.payments?.total ?? 0).toLocaleString()} 点</div>`;
  }).join('<hr style="border:0;border-top:1px solid rgba(120,200,160,.2);margin:14px 0">');

  return `<div class="overlay"><div class="result">
  <h2>${title}</h2>
  ${blocks}
  ${deltaRow(view, r.deltas || [0, 0, 0, 0])}
  <div class="acts"><button type="button" class="act primary" data-next>下一局</button></div>
</div></div>`;
}

/** 事件播报（右下角小窗） */
export function renderLog(lines) {
  return `<div class="log">${lines.slice(-6).map((l) => `<div>${l}</div>`).join('')}</div>`;
}

export { WINDS, SEAT_NAME, relSeat };
