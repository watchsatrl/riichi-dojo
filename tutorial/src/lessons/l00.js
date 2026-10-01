import { tileSVG, handHTML } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { gallery } from './_helpers.js';
/**
 * 第 0 讲 —— 认识一副麻将牌
 *
 * 这一讲的唯一目标：随便拿一张牌给你，你能立刻说出它是什么。
 * 不讲任何规则，避免新手在还没有「牌感」的时候就被规则淹没。
 */


export function lesson00() {
  return `
<div class="lesson-head">
  <div class="kicker">第 0 讲</div>
  <h1>认识一副麻将牌</h1>
  <p class="lede">这一讲不讲任何规则，只有一个目标：随便拿一张牌给你，你能立刻说出它是什么。</p>
</div>

<p>日本麻将一共 <strong>34 种</strong>牌，每种 <strong>4 张</strong>，合计 <strong>136 张</strong>。这 34 种分成两大类：<strong>数牌</strong>（带数字的）和<strong>字牌</strong>（不带数字的）。</p>

<h2>一、数牌：萬子、筒子、索子</h2>

<p>数牌有三个「花色」，日语叫 <strong>萬子（マンズ）</strong>、<strong>筒子（ピンズ）</strong>、<strong>索子（ソーズ）</strong>。每个花色都是从 1 到 9，各 4 张。所以数牌一共 27 种、108 张。</p>

<h3>萬子 — 牌面上写着汉字数字</h3>
${gallery([0, 1, 2, 3, 4, 5, 6, 7, 8])}

<h3>筒子 — 牌面画的是圆圈</h3>
${gallery([9, 10, 11, 12, 13, 14, 15, 16, 17])}

<div class="note">
<p>注意看图注里的 <code>1m</code>、<code>9p</code> 这种写法——这是日麻通用的记牌法：数字 + 字母，<code>m</code> = 萬子、<code>p</code> = 筒子、<code>s</code> = 索子、<code>z</code> = 字牌。后面所有讲解和练习都用这套记号，几秒钟就能习惯。</p>
</div>

<h3>索子 — 牌面画的是竹节</h3>
${gallery([18, 19, 20, 21, 22, 23, 24, 25, 26])}

<div class="warn">
<p><strong>一索（<code>1s</code>）是个例外</strong>——它在真实牌面上画的不是竹节，而是<strong>一只鸟</strong>。这是九种索子里唯一不成规律的一张，很多新手第一次见到会认不出来。记住：<strong>画着鸟的那张就是一索</strong>。</p>
</div>

<h2>二、字牌：七种，没有数字</h2>

<p>字牌一共 7 种、28 张。前四种是<strong>风牌</strong>，后三种是<strong>三元牌</strong>：</p>

${gallery([27, 28, 29, 30, 31, 32, 33])}

<div class="note">
<p>字牌的记号是 <code>1z</code> 到 <code>7z</code>，按上面这个顺序数：東=1z、南=2z、西=3z、北=4z、白=5z、發=6z、中=7z。</p>
<p><strong>白</strong>在真牌上通常不写字，而是一个空心方框——这也是新手容易认错的一张。</p>
</div>

<h2>三、赤牌：红色的 5</h2>

<p>日本麻将里有一种特殊的牌叫<strong>赤牌（赤ドラ）</strong>：把一张普通的 5 染成红色。它<strong>不是额外的第 5 张牌</strong>，而是把原本 4 张里的 1 张替换掉，所以整副牌仍然是 136 张。</p>

${gallery([34, 35, 36])}

<p>赤牌的作用是「白送一番」，和牌时手里有赤牌就能多算一番。这是纯粹的好东西，没有副作用。</p>

<div class="warn">
<p>赤牌的数量<strong>是规则可配置的</strong>。本教程和配套游戏采用<strong>雀魂默认规则：3 张</strong>（赤五萬、赤五筒、赤五索各一张）。你在别的平台上也可能遇到「4 张」甚至「无赤」的牌桌，那是不同的规则设置，不是你看错了。</p>
</div>

<h2>四、两个会一直用到的分类</h2>

<p>接下来讲役的时候，「幺九牌」和「中张牌」这两个词会反复出现，现在先建立印象：</p>

<table>
<thead><tr><th>分类</th><th>包含什么</th><th>种类数</th></tr></thead>
<tbody>
<tr><td><strong>幺九牌</strong>（ヤオチュウ）</td><td>老头牌（1 和 9 的数牌）+ 全部 7 种字牌</td><td>6 + 7 = <strong>13 种</strong></td></tr>
<tr><td><strong>中张牌</strong></td><td>2 到 8 的数牌</td><td><strong>21 种</strong></td></tr>
</tbody>
</table>

<p>拆开看是这样：</p>

<p><strong>老头牌</strong>（6 种，就是所有 1 和 9）：</p>
${gallery([0, 8, 9, 17, 18, 26], 'md')}

<p><strong>把它们和 7 种字牌合起来，就是「幺九牌」，一共 13 种</strong>——这个数字很重要，后面讲<strong>国士无双</strong>（役满）时会直接用到：国士无双要的正是这 13 种牌各一张。</p>

<h2>五、练习</h2>

${exercise({
  q: `这张牌读作什么？${handHTML([22], { size: 'xl' })}`,
  options: ['五萬', '五筒', '五索', '五索（赤）'],
  answer: 2,
  hint: '看牌面画的是圆圈还是竹节。',
  explain: '<p>牌面是竹节 → 索子；数字是 5 → <strong>五索（<code>5s</code>）</strong>。如果它是红色的，那才是赤五索。</p>',
})}

${exercise({
  q: `下面这些牌里，哪些属于<strong>幺九牌</strong>？（多选）`,
  options: [
    tileSVG(0, { size: 'lg' }),
    tileSVG(4, { size: 'lg' }),
    tileSVG(17, { size: 'lg' }),
    tileSVG(27, { size: 'lg' }),
    tileSVG(20, { size: 'lg' }),
  ],
  answer: [0, 2, 3],
  hint: '幺九牌 = 1 和 9 的数牌 + 全部字牌。中间数字的牌不算。',
  explain: '<p>一萬（1）✓、九筒（9）✓、東（字牌）✓ —— 这三张是幺九牌。</p><p>五萬（5）和 三索（3）都是中张牌，不算。</p>',
})}

${exercise({
  q: `这一手牌里有几张<strong>字牌</strong>？${handHTML([0, 1, 2, 27, 27, 31, 13, 22, 33], { size: 'lg' })}`,
  options: ['2 张', '3 张', '4 张', '5 张'],
  answer: 2,
  hint: '字牌没有数字，只有東南西北白發中这七种。',
  explain: '<p>東、東、白、中 —— 一共 <strong>4 张</strong>。注意東出现了两次要数两次，牌是按张算的不是按种算的。</p>',
})}

${exercise({
  q: `按雀魂默认规则，一副牌里有几张赤牌？`,
  options: ['1 张', '3 张', '4 张', '7 张'],
  answer: 1,
  hint: '赤牌只有「5」才有。',
  explain: '<p>雀魂默认是 <strong>3 张</strong>：赤五萬、赤五筒、赤五索各一张。有些规则用 4 张（多一张赤五筒），也有完全不用赤牌的规则。</p>',
})}

<h2>小结</h2>
<ul>
<li>34 种 × 4 张 = 136 张</li>
<li>数牌 27 种：萬子 <code>m</code>、筒子 <code>p</code>、索子 <code>s</code>，各 1–9</li>
<li>字牌 7 种：東南西北 白發中，记作 <code>1z</code>–<code>7z</code></li>
<li>赤牌 3 张，是染红的 5，不是额外的牌</li>
<li><strong>幺九牌 13 种</strong>（1、9 的数牌 + 字牌）；其余 21 种是中张牌</li>
<li>认牌地标：<strong>画着鸟的是一索</strong>，<strong>空心方框的是白</strong></li>
</ul>

<p>下一讲开始进入正题：<strong>什么样的 14 张牌算「和了」</strong>。</p>
`;
}
