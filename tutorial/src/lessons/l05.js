import { handHTML } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { breakdown, inlineHand } from './_helpers.js';
/**
 * 第 5 讲 —— 番与符
 *
 * 教学要点：
 *   1. 「符」是新手最劝退的概念，劝退的原因不是难，而是没人说清它「是什么」。
 *      所以开篇先给一句定性：番是役的等级，符是牌型本身的底分。
 *   2. 面子符那张表有个很省记忆的规律：从「中张明刻 2 符」开始依序加倍，
 *      幺九牌则是中张的两倍。记住 2-4-8-16 和「幺九翻倍」就够了。
 *   3. 必须强调「荣和补成的刻子算明刻」—— 这一条直接影响算符和四暗刻判定。
 *
 * 本讲的三个算符例题取自中文维基《符》条目，数值已核对。
 */


/** 算符明细表：把每一步摊开，这是本讲最重要的可视化 */
function fuSteps(rows) {
  const body = rows.map(([label, fu]) =>
    `<tr><td>${label}</td><td class="num">${fu > 0 ? '+' + fu : fu === 0 ? '0' : ''}</td></tr>`
  ).join('');
  return `<table class="fu-table"><thead><tr><th>加符项</th><th class="num">符</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function lesson05() {
  return `
<div class="lesson-head">
  <div class="kicker">第 5 讲</div>
  <h1>番与符</h1>
  <p class="lede">和牌之后，屏幕上会跳出「30符 2番 2000点」。这一讲拆开前两个数字。</p>
</div>

<h2>一、番和符，是两个互不相干的数字</h2>

<div class="key">
<p><strong>番</strong>衡量的是<strong>你这手牌有多难做</strong>——由「役」累积而成。第 2 讲已经认识过了。</p>
<p style="margin-bottom:0"><strong>符</strong>衡量的是<strong>你这手牌的形状本身值多少</strong>——和役无关，只看牌怎么摆、怎么和。</p>
</div>

<p>两个数字相乘（准确说是符乘上 2 的番次方），才得出最终点数。所以：</p>

<ul>
<li><strong>番越高，点数涨得越快</strong>——每多 1 番，点数大约翻一倍，是<strong>指数级</strong>的</li>
<li><strong>符只在同番之间做微调</strong>——30 符和 40 符差不了太多，是<strong>线性</strong>的</li>
</ul>

<div class="tip">
<p>这个区别决定了实战策略：<strong>能升番就升番，别为了多几符而牺牲番数。</strong>新手常犯的错是为了凑一个暗刻多拿 4 符，结果放掉了一个能升 1 番的机会——后者价值高得多。</p>
</div>

<h2>二、符的构成：从 20 符开始往上加</h2>

<p>算符就是做加法。一共只有六个加项，其中前三个几乎人人都有。</p>

<h3>① 副底：20 符（人人都有）</h3>

<p>只要你以标准形（4 面子 + 1 雀头）和牌，就先拿 <strong>20 符</strong>打底。</p>

<h3>② 门清荣和：+10 符</h3>

<p>没有吃碰杠（<strong>门清</strong>），而且是<strong>荣和</strong>（别人放铳），额外加 10 符。</p>

<p>注意：<strong>自摸不算这一项。</strong></p>

<h3>③ 自摸：+2 符</h3>

<p>自己摸到和牌张，加 2 符。</p>

<div class="note">
<p>② 和 ③ 是<strong>互斥</strong>的：荣和加 10，自摸加 2。所以门清荣和比门清自摸多 8 符——但自摸通常还有「门前清自摸和」这 1 番，两边各有好处。</p>
</div>

<h3>④ 面子符：这张表要记住</h3>

<table>
<thead><tr><th>面子的种类</th><th class="num">中张牌（2–8）</th><th class="num">幺九牌（1、9、字牌）</th></tr></thead>
<tbody>
<tr><td><strong>明刻</strong>（碰出来的）</td><td class="num">2</td><td class="num">4</td></tr>
<tr><td><strong>暗刻</strong>（自己摸齐的）</td><td class="num">4</td><td class="num">8</td></tr>
<tr><td><strong>明杠</strong></td><td class="num">8</td><td class="num">16</td></tr>
<tr><td><strong>暗杠</strong></td><td class="num">16</td><td class="num">32</td></tr>
<tr><td><strong>顺子</strong></td><td class="num">0</td><td class="num">0</td></tr>
</tbody>
</table>

<div class="tip">
<p><strong>不用死记整张表，记住两条规律即可：</strong></p>
<p>① 中张那一列是 <strong>2 → 4 → 8 → 16</strong>，依次加倍（明刻 → 暗刻 → 明杠 → 暗杠）。</p>
<p style="margin-bottom:0">② <strong>幺九牌是中张的两倍</strong>（4 → 8 → 16 → 32）。</p>
</div>

<div class="warn">
<p><strong>荣和补成的刻子，算明刻。</strong></p>
<p>比如你手里有一对 ${inlineHand([31, 31])} 白，别人打出第三张白，你荣和——这个白刻子<strong>按明刻算 4 符</strong>（幺九），不是暗刻的 8 符。</p>
<p style="margin-bottom:0">这条规则还有一个著名后果：<strong>双碰荣和不成四暗刻</strong>。因为荣和补上的那个刻子被算作明刻，你就只有三个暗刻了。第 7 讲会再提到。</p>
</div>

<h3>⑤ 雀头符：只有役牌才加</h3>

<table>
<thead><tr><th>雀头是什么</th><th class="num">符</th></tr></thead>
<tbody>
<tr><td>三元牌（白 / 發 / 中）</td><td class="num">2</td></tr>
<tr><td>场风牌</td><td class="num">2</td></tr>
<tr><td>自风牌</td><td class="num">2</td></tr>
<tr><td><strong>连风牌</strong>（自风 = 场风）</td><td class="num"><strong>4</strong></td></tr>
<tr><td>其他任何牌</td><td class="num">0</td></tr>
</tbody>
</table>

<p>连风牌的 4 符就是「场风 2 + 自风 2」相加的结果。这一项各平台有分歧，<strong>雀魂取 4 符</strong>，本教程照此。</p>

<p>顺带一提：连风牌做雀头会<strong>破坏平和</strong>（平和要求雀头不是役牌），所以这里有个取舍。</p>

<h3>⑥ 听牌形符：看你是怎么和的</h3>

<table>
<thead><tr><th>听牌形</th><th class="num">符</th></tr></thead>
<tbody>
<tr><td><strong>单骑</strong>（等雀头）</td><td class="num">2</td></tr>
<tr><td><strong>嵌张</strong>（如 4、6 等 5）</td><td class="num">2</td></tr>
<tr><td><strong>边张</strong>（如 1、2 等 3）</td><td class="num">2</td></tr>
<tr><td><strong>两面</strong>（等两张）</td><td class="num">0</td></tr>
<tr><td><strong>双碰</strong>（等两张凑刻子）</td><td class="num">0</td></tr>
</tbody>
</table>

<p>记忆方法：<strong>等得越「窄」，符越高</strong>。等一张的（单骑、嵌张、边张）都是 2 符，等两张的（两面、双碰）都是 0 符。</p>

<h2>三、完整算一遍</h2>

<p>看这手牌。门清，自摸了 ${inlineHand([13])} 五筒：</p>

${handHTML([3, 3, 3, 11, 12, 12, 35, 13, 14, 24, 24, 24, 25, 25], { size: 'lg' })}

${breakdown(
  [[3, 3, 3], [11, 12, 13], [12, 35, 14], [24, 24, 24], [25, 25]],
  ['暗刻 4m', '顺子 345p', '顺子 456p', '暗刻 7s', '雀头 8s'],
)}

<p>注意三点：四是<strong>暗刻</strong>（自己摸齐的），七索也是<strong>暗刻</strong>；和牌张五筒嵌在四筒和六筒中间，是<strong>嵌张</strong>；而且这是<strong>自摸</strong>。</p>

${fuSteps([
  ['副底（人人都有）', 20],
  ['自摸', 2],
  ['4m 暗刻（中张）', 4],
  ['7s 暗刻（中张）', 4],
  ['46p 嵌张听', 2],
  ['雀头 8s（不是役牌）', 0],
  ['顺子（不加符）', 0],
])}

<p>合计 <strong>20 + 2 + 4 + 4 + 2 = 32 符</strong>。</p>

<h3>符数要「切上」到十位</h3>

<p>32 符不是一个合法的最终值。<strong>符数一律向上取整到 10 的倍数</strong>：</p>

<p class="formula">32 符 &nbsp;→&nbsp; <strong>40 符</strong></p>

<p>所以这手牌是 <strong>40 符 3 番</strong>（断幺九 + 门前清自摸和 + 赤宝牌 1），第 6 讲会算出它值多少点。</p>

<div class="warn">
<p><strong>「切上」只进不退，而且一律向上。</strong>32 → 40，38 → 40，102 → 110。永远不会出现「32 符算 30 符」。</p>
</div>

<h2>四、三个固定符的例外</h2>

<p>有三种情况<strong>不按上面的加法算</strong>，直接取固定值：</p>

<table>
<thead><tr><th>情况</th><th class="num">固定符</th><th>说明</th></tr></thead>
<tbody>
<tr>
  <td><strong>平和 + 自摸</strong></td><td class="num"><strong>20</strong></td>
  <td>固定 20 符，<strong>不自摸的 2 符、不切上</strong></td>
</tr>
<tr>
  <td><strong>七对子</strong></td><td class="num"><strong>25</strong></td>
  <td>荣和自摸都是 25 符，<strong>不加任何东西、也不切上</strong></td>
</tr>
<tr>
  <td><strong>副露平和形 + 荣和</strong></td><td class="num"><strong>30</strong></td>
  <td>底 20 + 门清荣和 10，刚好 30</td>
</tr>
</tbody>
</table>

<div class="warn">
<p><strong>平和自摸是最经典的一个坑。</strong></p>
<p>很多人的直觉是「平和 20 符 + 自摸 2 符 = 22 符，切上成 30 符」——<strong>错。</strong></p>
<p style="margin-bottom:0">正确做法是：<strong>平和成立且自摸时，直接把最终符数定为 20</strong>，跳过自摸的 2 符，也跳过切上。这一条差一个等级的点数（20 符 2 番自摸是 400/700，30 符 2 番自摸是 500/1000）。</p>
</div>

<div class="note">
<p><strong>七对子为什么是 25 符？</strong>因为它是唯一的「25 符」——不符合「进位到 10」的规律。这是历史遗留的特例，记住就好，别去找规律。</p>
<p style="margin-bottom:0">另外，七对子<strong>不加门清荣和的 10 符，也不加单骑的 2 符</strong>。固定就是 25。</p>
</div>

<h2>五、番和符各自的天花板</h2>

<table>
<thead><tr><th>项目</th><th>范围</th></tr></thead>
<tbody>
<tr><td>番</td><td>1 番（最低，必须有役）～ 13 番（累计役满）以上</td></tr>
<tr><td>符</td><td>20 符（平和自摸）～ <strong>110 符</strong>（理论最高）</td></tr>
</tbody>
</table>

<p>110 符那种牌极其罕见（需要连风雀头 + 明刻 + 两个幺九暗杠），新手一年也遇不到一次。<strong>你实际会遇到的符数，99% 都在 20 到 70 之间。</strong></p>

<h2>六、练习</h2>

${exercise({
  q: `下面哪种面子<strong>不加符</strong>？`,
  options: ['碰出来的中张刻子', '自己摸齐的幺九暗刻', '一个顺子', '暗杠'],
  answer: 2,
  hint: '看那张面子符表里，哪一行的四个格子里全是 0。',
  explain: '<p><strong>顺子永远不加符</strong>（无论中张还是幺九）。这就是为什么「平和」——四个面子全是顺子——符数特别低。</p><p>反过来说，<strong>刻子越多，符越高</strong>。所以「对对和」这类刻子型的手牌，符数天然就高。</p>',
})}

${exercise({
  q: `你手里有一对 ${inlineHand([33, 33])} 中，别人打出第三张中，你荣和凑成刻子。这个刻子按<strong>明刻</strong>还是<strong>暗刻</strong>算符？`,
  options: ['暗刻（8 符）', '明刻（4 符）'],
  answer: 1,
  hint: '这个刻子的第三张是你自己摸到的，还是别人打出来的？',
  explain: '<p><strong>明刻，4 符。</strong>规则是：<strong>荣和补成的刻子算明刻</strong>——因为最后一张不是你摸的。</p><p>这个规则有个著名后果：<strong>双碰荣和不成四暗刻</strong>。荣和补上的那个刻子算明刻，你就只剩三个暗刻了。</p>',
})}

${exercise({
  q: `这手牌：${handHTML([3, 3, 3, 11, 12, 12, 35, 13, 14, 24, 24, 24, 25, 25], { size: 'md' })}，门清自摸五筒。算下来是 32 符，最终应该写成多少符？`,
  options: ['30 符', '32 符', '40 符', '50 符'],
  answer: 2,
  hint: '符数要向上取整到 10 的倍数。',
  explain: '<p><strong>40 符。</strong>符数一律<strong>向上</strong>取整到 10 的倍数：32 → 40。</p><p>注意是向上，不是四舍五入——38 符也是 40 符。</p>',
})}

${exercise({
  q: `你以「平和 + 自摸」和牌，四个顺子、非役牌雀头、两面听。这手牌算多少符？`,
  options: ['20 符', '22 符', '30 符', '0 符'],
  answer: 0,
  hint: '这是三个固定符例外之一。',
  explain: '<p><strong>20 符。</strong>平和自摸是固定 20 符——<strong>不加自摸的 2 符，也不切上</strong>。</p><p>常见的错误算法是「20 + 2 = 22 → 切上 30」。差一个等级：20 符 2 番自摸是 400/700，30 符 2 番自摸是 500/1000。</p>',
})}

${exercise({
  q: `下面哪种情况会得到 <strong>25 符</strong>？`,
  options: ['平和自摸', '七对子', '副露平和形荣和', '国士无双'],
  answer: 1,
  hint: '三种固定符例外里，哪一个的数值不符合「10 的倍数」规律？',
  explain: '<p><strong>七对子</strong>固定 25 符，荣和自摸都一样，不加门清荣和、不加单骑、也不切上。</p><p>它是日麻里唯一一个不以 0 结尾的符数——历史遗留的特例。</p>',
})}

<h2>小结</h2>
<ul>
<li><strong>番 = 难度（指数级）</strong>，<strong>符 = 形状（线性）</strong>；升番远比升符重要</li>
<li>算符是加法：<strong>副底 20</strong>，然后逐项加</li>
<li>面子符记两条：中张 <strong>2-4-8-16</strong> 依次加倍；<strong>幺九翻倍</strong></li>
<li>⚠️ <strong>荣和补成的刻子算明刻</strong></li>
<li>雀头只有<strong>役牌</strong>加符；连风牌 +4（雀魂）</li>
<li>听牌形：等一张的 +2，等两张的 0</li>
<li>符数一律<strong>向上取整到 10</strong></li>
<li>三个例外：<strong>平和自摸 20、七对子 25、副露平和形荣和 30</strong></li>
</ul>

<p>现在你手上有两个数字了：番和符。下一讲把它们变成屏幕上的<strong>点数</strong>。</p>
`;
}
