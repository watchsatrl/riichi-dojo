import { tileSVG } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { discardTrainer } from '../ui-discard.js';
import { breakdown, inlineHand } from './_helpers.js';
/**
 * 第 8 讲 —— 牌效率：该打哪张
 *
 * 教学要点：
 *   1. 先给两个可量化的概念（向听数、进张数），把「凭感觉打牌」变成「能算的东西」。
 *   2. 搭子好坏表用的是名义枚数（两面 8 / 嵌张 4 / 边张 4 / 双碰 4 / 单骑 3），
 *      这些是所有教材一致的常数，不依赖引擎。
 *   3. 训练器里的进张数全部由引擎现算，本讲的散文里刻意不写具体进张数，
 *      避免出现「教程写 8 张、引擎算 7 张」的漂移。
 */


export function lesson08() {
  return `
<div class="lesson-head">
  <div class="kicker">第 8 讲</div>
  <h1>牌效率：该打哪张</h1>
  <p class="lede">前七讲都在讲「牌该怎么算」。从这一讲开始讲「牌该怎么打」。</p>
</div>

<h2>一、把「感觉」变成两个数字</h2>

<p>新手打牌最常见的状态是：盯着 14 张牌，凭直觉摸一张打一张。这一讲要给你两个可以<strong>真正算出来</strong>的数字，从此每一手都有依据。</p>

<div class="key">
<p><strong>向听数</strong>——你离和牌还差几步。</p>
<p style="margin-bottom:0"><strong>进张数</strong>——有多少张牌能让你往前走一步。</p>
</div>

<h2>二、向听数：离和牌还有几步</h2>

<p>向听数的定义很简单：<strong>再摸进几张有效的牌，就能听牌</strong>。</p>

<table>
<thead><tr><th>向听数</th><th>含义</th></tr></thead>
<tbody>
<tr><td><strong>0 向听</strong></td><td><strong>听牌</strong>——再进一张就能和</td></tr>
<tr><td><strong>1 向听</strong></td><td>再进一张就能听牌</td></tr>
<tr><td><strong>2 向听</strong></td><td>再进两张才能听牌</td></tr>
<tr><td>…</td><td>以此类推</td></tr>
</tbody>
</table>

<p>配牌（刚发完 13 张）时，平均是 <strong>3 到 4 向听</strong>。所以一局牌的过程，就是把这个数字从 3 推到 0 的过程。</p>

<div class="tip">
<p><strong>向听数会告诉你一件很重要的事：现在该进攻还是该退。</strong></p>
<p style="margin-bottom:0">如果你已经两向听、而别人已经立直，那你这手牌大概率追不上了——这时候的目标就从「和牌」变成「别放铳」。第 9 讲专门讲这个。</p>
</div>

<h2>三、进张数：有几张牌能让你前进</h2>

<p>光看向听数不够。<strong>同样是 1 向听，有的手牌有 20 张牌能让你前进，有的只有 4 张。</strong></p>

<p>这个数字叫<strong>进张数</strong>（也叫「受け入れ」）。算的时候要<strong>扣掉已经看得见的牌</strong>——包括你手里的、以及别人打出来和副露出来的。</p>

<div class="note">
<p>为什么必须扣掉？因为一副牌每种只有 4 张。你手里已经捏着 2 张 5s，那外面就只剩 2 张，不是 4 张。</p>
</div>

<h2>四、搭子：面子的一半</h2>

<p>要凑成面子，先要有<strong>搭子</strong>——差一张就能成面子的两张牌。搭子的形状决定了它有多好：</p>

<table>
<thead><tr><th>形状</th><th>例子</th><th>等什么</th><th class="num">名义枚数</th></tr></thead>
<tbody>
<tr>
  <td><strong>两面</strong><span class="tag tag-free">最好</span></td>
  <td>${inlineHand([11, 12])} 3p4p</td>
  <td>2p 或 5p，<strong>两种牌</strong></td>
  <td class="num"><strong>8</strong></td>
</tr>
<tr>
  <td><strong>嵌张</strong></td>
  <td>${inlineHand([11, 13])} 3p5p</td>
  <td>只有 4p，一种牌</td>
  <td class="num">4</td>
</tr>
<tr>
  <td><strong>边张</strong></td>
  <td>${inlineHand([9, 10])} 1p2p</td>
  <td>只有 3p（等不到 0p）</td>
  <td class="num">4</td>
</tr>
<tr>
  <td><strong>对子</strong></td>
  <td>${inlineHand([22, 22])} 5s5s</td>
  <td>碰或摸成刻子；也是雀头候选</td>
  <td class="num">4</td>
</tr>
<tr>
  <td><strong>单骑</strong></td>
  <td>${inlineHand([25])} 8s</td>
  <td>再摸一张 8s 做雀头</td>
  <td class="num">3</td>
</tr>
</tbody>
</table>

<div class="warn">
<p><strong>两边和边张看起来都是「等一张」，差别很大。</strong></p>
<p>${inlineHand([9, 10])} 一筒二筒只能等三筒，等到了就是一个 123 的顺子，<strong>没有第二种可能</strong>。</p>
<p style="margin-bottom:0">而 ${inlineHand([10, 11])} 二筒三筒能等一筒也能等四筒——<strong>两种牌，整整一倍的进张</strong>。所以搭子要尽量留两面。</p>
</div>

<div class="note">
<p>「名义枚数」是不考虑已见牌的理论值。实战里要按第 3 节的方法扣掉看得见的牌——比如你要等的 5s 已经被人碰过了，那实际枚数就是 <strong>0</strong>，这个搭子等于废了。</p>
</div>

<h2>五、判断流程</h2>

<p>拿到 14 张牌要打一张，按这个顺序想：</p>

<ol>
<li><strong>有没有孤张？</strong>和谁都不挨着的牌（比如旁边什么都没有的幺九、字牌）——<strong>先打它</strong>。</li>
<li><strong>有没有比两面差的搭子？</strong>嵌张、边张优先于孤张保留，但不如两面。</li>
<li><strong>打完之后的向听数是多少？</strong>如果打 A 会从听牌退回一向听，而打 B 能保持听牌——除非打 B 的听牌形极差，否则<strong>打 B</strong>。</li>
<li><strong>向听数一样时，比进张数。</strong>谁能让更多张牌帮你前进，就打另一张。</li>
</ol>

<div class="tip">
<p><strong>上面这个顺序是「牌效率」的骨架，但它只回答了「怎么最快和牌」。</strong></p>
<p style="margin-bottom:0">实战里还要考虑三件事：<strong>打点</strong>（快不一定赚得多）、<strong>安全度</strong>（打出去的牌会不会放铳）、<strong>巡目</strong>（还剩几巡）。这些是第 9 讲的内容。<strong>先学会跑得快，再学会跑得稳。</strong></p>
</div>

<h2>六、自己试试</h2>

<p>下面两个训练器是<strong>真的在算</strong>——你点一张牌，它会用引擎算一遍那张牌的向听数和进张数，并告诉你有没有更好的选择。</p>

${discardTrainer({
  title: '第 1 题：先看有没有孤张',
  hand: '234m567m34p6789s11z',
})}

${discardTrainer({
  title: '第 2 题：这手牌你在第 1 讲见过',
  hand: '123m456m789m12p55s7s',
})}

<div class="note">
<p>训练器的排序标准是<strong>「先比向听数，再比进张数」</strong>——这是牌效率的第一近似。</p>
<p style="margin-bottom:0">所以它可能会推荐一个「快但小」的选择。真实对局里，如果快的那条路只有 1000 点、慢一点的那条有 8000 点，慢的往往更值。这一点第 9 讲会展开。</p>
</div>

<h2>七、练习</h2>

${exercise({
  q: `「0 向听」是什么意思？`,
  options: ['还没有听牌', '已经听牌', '已经和牌', '一向听的反面'],
  answer: 1,
  hint: '向听数数的是「还差几步到听牌」。',
  explain: '<p><strong>已经听牌。</strong>向听数数的是「离听牌还差几张有效牌」——差 0 张就是已经听牌了。</p><p>和牌本身在引擎里用 <code>-1</code> 表示（「再退一步就是和牌」）。</p>',
})}

${exercise({
  q: `下面哪个搭子的进张最多？`,
  options: [`${inlineHand([11, 12])} 3p4p（两面）`, `${inlineHand([11, 13])} 3p5p（嵌张）`, `${inlineHand([9, 10])} 1p2p（边张）`, `${inlineHand([22, 22])} 5s5s（对子）`],
  answer: 0,
  hint: '看那张表里「等什么」那一列——有几种牌能等到？',
  explain: '<p><strong>两面 3p4p 最好，名义 8 张。</strong>因为它能等 2p 和 5p 两种牌，各 4 张。</p><p>嵌张、边张、对子都只有一种牌能等到（4 张），单骑只有 3 张。</p>',
})}

${exercise({
  q: `你要等的 5s 已经被对家碰走了。这个 4s6s 嵌张搭子还有效进张吗？`,
  options: ['有，还剩 4 张', '有，还剩 3 张', '没有了，实际枚数是 0'],
  answer: 2,
  hint: '一副牌里 5s 一共几张？对家碰走了几张？',
  explain: '<p><strong>实际进张是 0。</strong>5s 一共 4 张，对家碰走 3 张——如果第 4 张也已经在牌河或别人手里，这个搭子就是死的。</p><p>这就是为什么算进张必须<strong>扣掉已见的牌</strong>。光看「嵌张 = 4 张」的名义值会严重高估。</p>',
})}

${exercise({
  q: `手里有一对 ${inlineHand([31, 31])} 白和一张孤零零的 ${inlineHand([8])} 九萬。只看牌效率，先打哪张？`,
  options: ['打白', '打九萬'],
  answer: 1,
  hint: '白是对子（可以碰、可以做雀头），九萬和谁都不挨着。',
  explain: '<p><strong>打九萬。</strong>孤张九萬和手里任何牌都组不成搭子；而白是对子，既能碰成刻子，也能当雀头。</p><p>而且白是<strong>役牌</strong>——做成刻子白送 1 番。所以这对白比普通对子还值钱。</p>',
})}

${exercise({
  q: `同一手牌，打 A 会从听牌退回一向听，打 B 能保持听牌。按牌效率应该打哪张？`,
  options: ['打 A，因为 A 更安全', '打 B，保持听牌', '一样，随便'],
  answer: 1,
  hint: '听牌和一向听，哪个离和牌更近？',
  explain: '<p><strong>打 B。</strong>听牌是 0 向听，一向听是 1 向听——差一整步。除非 B 的听牌形极差（比如单骑等一张已经绝了的牌），否则保持听牌。</p><p>注意这只是<strong>牌效率</strong>的答案。如果打 B 会点炮，打 A 是安全牌，那实战里该打 A——那是第 9 讲要讲的权衡。</p>',
})}

<h2>小结</h2>
<ul>
<li><strong>向听数</strong> = 离听牌还差几步；<strong>进张数</strong> = 有多少张牌能让你前进</li>
<li>判断顺序：<strong>孤张 &gt; 差搭子 &gt; 向听数 &gt; 进张数</strong></li>
<li>搭子优先级：<strong>两面（8） &gt; 嵌张 / 边张 / 对子（4） &gt; 单骑（3）</strong></li>
<li>进张必须<strong>扣掉已见的牌</strong>，否则会严重高估</li>
<li>⚠️ 牌效率只回答「<strong>怎么最快和牌</strong>」，不回答「该不该和」</li>
</ul>

<p>下一讲就是牌效率的对立面——<strong>有时候，正确答案是「这把我不要了」。</strong></p>
`;
}
