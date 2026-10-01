import { tileSVG, handHTML, tileCode, tileName } from '../../../ui/tiles.js';
/**
 * lessons/_helpers.js —— 各讲共用的排版零件
 *
 * 单独抽出来是因为「一排牌 + 图注」和「把一手牌拆成面子」这两种排版
 * 在 11 讲里会重复上百次，各写一遍必然走样。
 */


/** 一排牌，每张下面标日麻标准记法 —— 顺便把记号教了 */
export function gallery(indices, size = 'lg', capFn = tileCode) {
  return `<div class="tile-row">${indices
    .map((i) => `<figure>${tileSVG(i, { size })}<figcaption>${capFn(i)}</figcaption></figure>`)
    .join('')}</div>`;
}

/** 一排牌，下面标中文牌名 */
export function galleryNamed(indices, size = 'lg') {
  return gallery(indices, size, tileName);
}

/**
 * 把一手牌按拆解结果分组显示，组间用「+」连起来，每组下面写它是什么。
 * 这个「+」不是装饰：它是这一讲要教的核心句式 ——
 * 「4 个面子 + 1 个雀头」，视觉上必须先说出来。
 * @param {number[][]} groups 每组是一个牌索引数组
 * @param {string[]} labels   与 groups 一一对应的说明
 */
export function breakdown(groups, labels, size = 'md') {
  const cells = [];
  groups.forEach((g, i) => {
    if (i > 0) cells.push('<div class="bd-sep">+</div>');
    cells.push(`<figure>${handHTML(g, { size, plain: true })}<figcaption>${labels[i] || ''}</figcaption></figure>`);
  });
  return `<div class="tile-row breakdown">${cells.join('')}</div>`;
}

/** 一手牌，整块显示 */
export function hand(tiles, size = 'lg') {
  return handHTML(tiles, { size });
}

/**
 * 把「桌上的副露」和「手里的暗牌」分成两行画出来。
 *
 * 为什么必须分开：**副露的定义就是「亮出来摆在桌上的牌」，和暗牌是两堆东西。**
 * 压成一行 14 张会同时犯两个错 —— 读者分不清哪几组是鸣来的；而且「14 张全在手上」
 * 按定义就是门清，题目等于自我否定。
 *
 * 这个函数是被读者抓出来的：第 1 讲有一道「这手牌有几组副露」，图却是一排平铺的
 * 14 张，正确答案「3 组」从图上根本推不出来。
 *
 * @param {number[][]} melds     副露，每组一个牌索引数组
 * @param {number[]}   concealed 手里的暗牌
 */
export function handWithMelds(melds, concealed, opts = {}) {
  const size = opts.size || 'lg';
  const row = (label, inner) => `<div class="hw-row"><span class="hw-label">${label}</span>${inner}</div>`;

  const meldInner = (melds && melds.length)
    ? melds.map((g) => `<span class="hand">${g.map((t) => tileSVG(t, { size })).join('')}</span>`).join('')
    : '<span class="hw-none">没有鸣牌</span>';

  return `<div class="hand-with-melds">
  ${row('桌上 · 副露', meldInner)}
  ${row('手里 · 暗牌', handHTML(concealed, { size }))}
</div>`;
}

/** 行内小牌（正文里夹一张牌用） */
export function inline(idx) {
  return tileSVG(idx, { size: 'sm' });
}

/** 一组行内小牌 */
export function inlineHand(tiles) {
  return `<span class="inline-hand">${tiles.map((t) => tileSVG(t, { size: 'sm' })).join('')}</span>`;
}
