/**
 * ui-tiles.js —— 麻将牌的内联 SVG 渲染器
 *
 * 为什么要现画而不是用图片/字体：
 *   1. 教程要交付成「双击即开的单文件 HTML」，不能带外部资源
 *   2. Unicode 麻将字符（U+1F000 区）在 Windows 上字体支持参差不齐，会掉成豆腐块
 *   3. 现画才能做「赤牌变红」「无效牌变灰」「高亮」这类教学态
 *
 * 索引约定（必须与 mahjong/engine 保持一致，不要改）：
 *   0–8   一萬～九萬 (m)
 *   9–17  一筒～九筒 (p)
 *   18–26 一索～九索 (s)
 *   27–33 東 南 西 北 白 發 中 (z)
 *   34/35/36 = 赤五萬 / 赤五筒 / 赤五索
 */

export const TILE_W = 40;
export const TILE_H = 56;

export const NUM_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
export const HONOR_KANJI = ['東', '南', '西', '北', '白', '發', '中'];
export const SUIT_LABEL = ['萬', '筒', '索', '字'];

const INK = '#242019';
const RED = '#bd3a2c';
const PIN_BLUE = '#1d5da6';
const SOU_GREEN = '#1e7a4c';
const FACE_BG = '#fdfbf3';
const FACE_EDGE = '#c8bfa4';
const BACK_BG = '#2f6b4f';

/** 赤牌索引 → 本体索引 */
export function baseIdx(idx) {
  return idx === 34 ? 4 : idx === 35 ? 13 : idx === 36 ? 22 : idx;
}
export function isRedIdx(idx) { return idx >= 34 && idx <= 36; }
/** 本体索引 → 赤牌索引（只对 5m/5p/5s 有效，其余返回原值） */
export function redIdxOf(idx) {
  return idx === 4 ? 34 : idx === 13 ? 35 : idx === 22 ? 36 : idx;
}

export function suitOf(idx) { const b = baseIdx(idx); return b < 9 ? 0 : b < 18 ? 1 : b < 27 ? 2 : 3; }
export function rankOf(idx) {
  const b = baseIdx(idx);
  return b < 27 ? (b % 9) + 1 : b - 26; // 字牌：東=1 … 中=7
}

/** 中文牌名 */
export function tileName(idx) {
  const r = rankOf(idx), s = suitOf(idx), red = isRedIdx(idx);
  if (s === 3) return HONOR_KANJI[r - 1];
  return (red ? '赤' : '') + NUM_KANJI[r - 1] + SUIT_LABEL[s];
}
/** 日麻标准记法，如 "5m"、"0p"(赤五筒)、"1z"(東) */
export function tileCode(idx) {
  const r = rankOf(idx), s = suitOf(idx);
  if (s === 3) return r + 'z';
  if (isRedIdx(idx)) return '0' + 'mps'[s];
  return r + 'mps'[s];
}

/** 计数数组 → 牌索引数组（升序） */
export function tilesFromCount(count) {
  const out = [];
  for (let i = 0; i < 34; i++) for (let n = 0; n < (count[i] || 0); n++) out.push(i);
  return out;
}

// ── 牌面生成 ─────────────────────────────────────────────────────

/** 筒子：同心圆（外圈描边 + 实心内点），是真实牌面的简化 */
function pin(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${FACE_BG}" stroke="${color}" stroke-width="${(r * 0.36).toFixed(2)}"/>`
       + `<circle cx="${cx}" cy="${cy}" r="${(r * 0.34).toFixed(2)}" fill="${color}"/>`;
}

const PIN_LAYOUT = {
  1: [[20, 28, 10.5]],
  2: [[20, 16, 7.2], [20, 40, 7.2]],
  3: [[9.5, 40, 6.4], [20, 28, 6.4], [30.5, 16, 6.4]],
  4: [[12.5, 17, 6.6], [27.5, 17, 6.6], [12.5, 39, 6.6], [27.5, 39, 6.6]],
  5: [[11.5, 16, 6.0], [28.5, 16, 6.0], [20, 28, 6.0], [11.5, 40, 6.0], [28.5, 40, 6.0]],
  6: [[13, 13.5, 5.8], [27, 13.5, 5.8], [13, 28, 5.8], [27, 28, 5.8], [13, 42.5, 5.8], [27, 42.5, 5.8]],
  7: [[9.5, 12, 4.9], [20, 12, 4.9], [30.5, 12, 4.9], [13.5, 30, 5.4], [26.5, 30, 5.4], [13.5, 44, 5.4], [26.5, 44, 5.4]],
  8: [[13.5, 11, 4.7], [26.5, 11, 4.7], [13.5, 22, 4.7], [26.5, 22, 4.7],
      [13.5, 33, 4.7], [26.5, 33, 4.7], [13.5, 44, 4.7], [26.5, 44, 4.7]],
  9: [[9, 13.5, 5.3], [20, 13.5, 5.3], [31, 13.5, 5.3], [9, 28, 5.3], [20, 28, 5.3], [31, 28, 5.3],
      [9, 42.5, 5.3], [20, 42.5, 5.3], [31, 42.5, 5.3]],
};

function facePin(rank, red) {
  const color = red ? RED : PIN_BLUE;
  // 一筒在真牌上是「红圈蓝心」的招牌牌面，保留这个特征作为记忆锚点
  if (rank === 1 && !red) {
    return `<circle cx="20" cy="28" r="10.5" fill="${FACE_BG}" stroke="${RED}" stroke-width="3.8"/>`
         + `<circle cx="20" cy="28" r="3.6" fill="${PIN_BLUE}"/>`;
  }
  return PIN_LAYOUT[rank].map(([x, y, r]) => pin(x, y, r, color)).join('');
}

/**
 * 索子：一根竹节。
 * 只做三件事——窄长的竖条、圆角、两道竹节线。
 * 试过纺锤形（中间鼓两头收），在小尺寸下会糊成一片叶子，辨识度反而更差；
 * 这一讲的目的是让新手一眼数清张数，形状朴素比形状华丽重要。
 */
function bamboo(cx, cy, h, color) {
  const w = Math.min(4.6, Math.max(3.0, h * 0.32));
  const x = cx - w / 2, y = cy - h / 2;
  const f = (n) => n.toFixed(2);
  // 矮的竹节只画一道节线 —— 两道会把 9 索那种小尺寸切成虚线，新手容易多数一张
  const node = (yy) =>
    `<line x1="${f(x - 0.35)}" y1="${f(yy)}" x2="${f(x + w + 0.35)}" y2="${f(yy)}"`
    + ` stroke="${FACE_BG}" stroke-width="0.75" stroke-linecap="round" opacity="0.8"/>`;
  const nodes = h >= 15 ? [cy - h / 6, cy + h / 6] : [cy];
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(Math.min(w * 0.42, 1.5))}" fill="${color}"/>`
       + nodes.map(node).join('');
}

const SOU_LAYOUT = {
  2: [[20, 15, 18], [20, 41, 18]],
  3: [[20, 12.3, 12.6], [12, 40, 14], [28, 40, 14]],
  4: [[12.5, 15, 18], [27.5, 15, 18], [12.5, 41, 18], [27.5, 41, 18]],
  5: [[11, 12.5, 12.6], [29, 12.5, 12.6], [20, 28, 13.5], [11, 43.5, 12.6], [29, 43.5, 12.6]],
  6: [[12.5, 12.5, 12.6], [27.5, 12.5, 12.6], [12.5, 28, 12.6], [27.5, 28, 12.6], [12.5, 43.5, 12.6], [27.5, 43.5, 12.6]],
  7: [[20, 11, 10.5], [9.5, 27.5, 12.6], [20, 27.5, 12.6], [30.5, 27.5, 12.6],
      [9.5, 43.5, 12.6], [20, 43.5, 12.6], [30.5, 43.5, 12.6]],
  8: [[13.5, 10.8, 9.1], [26.5, 10.8, 9.1], [13.5, 22.4, 9.1], [26.5, 22.4, 9.1],
      [13.5, 34, 9.1], [26.5, 34, 9.1], [13.5, 45.6, 9.1], [26.5, 45.6, 9.1]],
  9: [[9.5, 12.3, 12.6], [20, 12.3, 12.6], [30.5, 12.3, 12.6],
      [9.5, 27.9, 12.6], [20, 27.9, 12.6], [30.5, 27.9, 12.6],
      [9.5, 43.5, 12.6], [20, 43.5, 12.6], [30.5, 43.5, 12.6]],
};

/** 一索在真牌上是一只鸟，是重要的辨识地标，保留 */
function souBird(red) {
  const c = red ? RED : SOU_GREEN;
  const plumes = [-3.4, 0, 3.4].map((dx) =>
    `<path d="M20 48 C${20 + dx * 0.6} 41 ${20 + dx} 34 ${20 + dx * 0.9} 28" stroke="${c}" stroke-width="1.9" fill="none" stroke-linecap="round"/>`
  ).join('');
  return `
    ${plumes}
    <ellipse cx="20" cy="26.5" rx="6.4" ry="8.4" fill="${c}"/>
    <circle cx="20" cy="15.6" r="4.4" fill="${c}"/>
    <path d="M24.3 14.6 L29.6 16.4 L24.3 18.2 Z" fill="#d99a2b"/>
    <path d="M14.6 12.6 C13 9.4 14.6 7.4 17 7.2" stroke="${c}" stroke-width="1.7" fill="none" stroke-linecap="round"/>
    <circle cx="21" cy="14.6" r="1.05" fill="${FACE_BG}"/>`;
}

function faceSou(rank, red) {
  const color = red ? RED : SOU_GREEN;
  if (rank === 1) return souBird(red);
  return SOU_LAYOUT[rank].map(([x, y, h]) => bamboo(x, y, h, color)).join('');
}

function faceMan(rank, red) {
  const c = red ? RED : INK;
  return `<text class="mj-kn" x="20" y="27" text-anchor="middle" font-size="21" fill="${c}">${NUM_KANJI[rank - 1]}</text>`
       + `<text class="mj-kn" x="20" y="49" text-anchor="middle" font-size="18" fill="${red ? RED : '#8c2f24'}">萬</text>`;
}

function faceHonor(rank, red) {
  // 白：真牌是不写字的空牌面（常见设计为空心方框），这里用蓝色双框表示
  if (rank === 5) {
    return `<rect x="9.5" y="11.5" width="21" height="33" rx="2.5" fill="none" stroke="${PIN_BLUE}" stroke-width="2.6"/>`
         + `<rect x="14.2" y="16.5" width="11.6" height="23" rx="1.5" fill="none" stroke="${PIN_BLUE}" stroke-width="1.2" opacity="0.5"/>`;
  }
  const color = red ? RED : rank === 6 ? SOU_GREEN : rank === 7 ? RED : INK;
  return `<text class="mj-kn" x="20" y="40" text-anchor="middle" font-size="28" fill="${color}">${HONOR_KANJI[rank - 1]}</text>`;
}

function faceOf(idx) {
  const b = baseIdx(idx), red = isRedIdx(idx);
  const s = suitOf(b), r = rankOf(b);
  return s === 0 ? faceMan(r, red) : s === 1 ? facePin(r, red) : s === 2 ? faceSou(r, red) : faceHonor(r, red);
}

// ── 对外 API ─────────────────────────────────────────────────────

/**
 * 渲染一张牌。
 * @param {number} idx  牌索引 0–36；传 -1 或 opts.back=true 渲染牌背
 * @param {object} [opts]
 * @param {'xs'|'sm'|'md'|'lg'|'xl'} [opts.size='md']
 * @param {boolean} [opts.back]   渲染牌背
 * @param {boolean} [opts.dim]    灰化（教学里表示"这张不算/已排除"）
 * @returns {string} SVG 字符串
 */
export function tileSVG(idx, opts = {}) {
  const size = opts.size || 'md';
  const cls = ['mj-tile', size, opts.dim ? 'dim' : '', opts.cls || ''].filter(Boolean).join(' ');

  // 牌面分三层：正面、下缘的一圈「厚度」、以及上缘内侧一道高光。
  // 高光很淡（1px、0.5 不透明度）—— 小尺寸下糊不了，但少了它牌就是一张贴纸。
  // 厚度带用比正面暗一档的米色，模拟塑料牌的侧壁。
  const frame = `<rect class="mj-face" x="1" y="1.4" width="38" height="54" rx="5" fill="${FACE_BG}" stroke="${FACE_EDGE}" stroke-width="1.4"/>`
              + `<rect class="mj-edge" x="1.6" y="49.7" width="36.8" height="5.5" rx="2.5" fill="#e7e0ca"/>`
              + `<rect class="mj-hi" x="2.4" y="2.7" width="35.2" height="45.6" rx="3.6" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.5"/>`;

  if (opts.back || idx < 0) {
    return `<svg class="${cls} mj-back" viewBox="0 0 ${TILE_W} ${TILE_H}" role="img" aria-label="牌背">`
         + `<rect class="mj-face" x="1" y="1.4" width="38" height="54" rx="5" fill="${BACK_BG}" stroke="#22503b" stroke-width="1.4"/>`
         + `<rect class="mj-edge" x="1.6" y="49.7" width="36.8" height="5.5" rx="2.5" fill="#255843" opacity="0.85"/>`
         + `<rect class="mj-hi" x="2.4" y="2.7" width="35.2" height="45.6" rx="3.6" fill="none" stroke="#6aa88a" stroke-width="1" opacity="0.35"/>`
         + `<rect x="6" y="7" width="28" height="43" rx="3" fill="none" stroke="#4f9273" stroke-width="1.3"/>`
         + `<circle cx="20" cy="28.5" r="6" fill="none" stroke="#4f9273" stroke-width="1.3"/>`
         + `</svg>`;
  }

  const name = tileName(idx);
  return `<svg class="${cls}" viewBox="0 0 ${TILE_W} ${TILE_H}" role="img" aria-label="${name}">`
       + `<title>${name}</title>${frame}${faceOf(idx)}</svg>`;
}

/**
 * 渲染一手牌。
 * @param {number[]|number[]} tiles 牌索引数组，或长度 34 的计数数组
 * @param {object} [opts] 透传给 tileSVG；额外支持 opts.plain / opts.gap
 */
export function handHTML(tiles, opts = {}) {
  const list = Array.isArray(tiles) && tiles.length === 34 && tiles.every((n) => n >= 0 && n <= 4)
    ? tilesFromCount(tiles)
    : tiles;
  const cls = ['hand', opts.plain ? 'plain' : ''].filter(Boolean).join(' ');
  const inner = list.map((t) => tileSVG(t, opts)).join('');
  const gap = opts.gap ? ` style="gap:${opts.gap}px"` : '';
  return `<span class="${cls}"${gap}>${inner}</span>`;
}

/** 副露（吃/碰/杠）渲染：把牌组用小间距聚拢，组与组之间留大间距 */
export function meldsHTML(melds, opts = {}) {
  if (!melds || !melds.length) return '';
  return melds.map((m) => {
    const tiles = m.type === 'kakan'
      ? [...m.tiles.slice(0, 3), -1]           // 加杠：第四张横放表示
      : m.tiles;
    return `<span class="hand">${tiles.map((t) => tileSVG(t, opts)).join('')}</span>`;
  }).join('');
}

/** 一整行「牌 + 说明」，用于图例 */
export function figureHTML(tiles, caption, opts = {}) {
  return `<figure>${handHTML(tiles, opts)}<figcaption>${caption}</figcaption></figure>`;
}
