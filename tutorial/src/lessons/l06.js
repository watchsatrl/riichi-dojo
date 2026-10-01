import { handHTML } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
/**
 * 第 6 讲 —— 点数计算
 *
 * 教学要点：
 *   1. 只讲一个公式：基本点 = 符 × 2^(2+番)。所有点数都是它乘 4 / 6 / 2 / 1。
 *      新手被点数表吓退，是因为没人告诉他背后只有一个公式。
 *   2. 速查表给全，但要把「怎么用」讲清楚：先查表，别现场算。
 *   3. 自摸的零头进位方式和荣和不同（每家分别进位），这解释了为什么自摸总额
 *      常比荣和高一点点。
 *
 * 本讲速查表由公式逐格生成，并与 research/yaku-fu-score.md 的表交叉核对。
 */


/** 生成一行的四个格子 */
const row = (fu, han, ron, tsumo, dRon, dTsumo) =>
  `<tr><td><strong>${fu}符 ${han}番</strong></td><td class="num">${ron}</td><td class="num">${tsumo}</td>`
  + `<td class="num">${dRon}</td><td class="num">${dTsumo}</td></tr>`;

export function lesson06() {
  return `
<div class="lesson-head">
  <div class="kicker">第 6 讲</div>
  <h1>点数计算</h1>
  <p class="lede">上一讲你算出了「40 符 3 番」。这一讲把它变成屏幕上的数字。</p>
</div>

<h2>一、只有一个公式</h2>

<p>点数表看起来密密麻麻，但整张表背后<strong>只有一个公式</strong>：</p>

<p class="formula big">基本点 &nbsp;=&nbsp; 符 &nbsp;×&nbsp; 2<sup>(2 + 番)</sup></p>

<p>算出「基本点」之后，剩下全是<strong>乘一个系数</strong>：</p>

<table>
<thead><tr><th>谁和牌</th><th>怎么和</th><th>怎么付</th></tr></thead>
<tbody>
<tr><td rowspan="2"><strong>子家</strong></td><td>荣和</td><td>放铳的人付 <strong>基本点 × 4</strong></td></tr>
<tr><td>自摸</td><td>亲家付 <strong>× 2</strong>，另外两个子家各付 <strong>× 1</strong></td></tr>
<tr><td rowspan="2"><strong>亲家</strong></td><td>荣和</td><td>放铳的人付 <strong>基本点 × 6</strong></td></tr>
<tr><td>自摸</td><td>三家各付 <strong>× 2</strong></td></tr>
</tbody>
</table>

<div class="tip">
<p>为什么亲家收得多？<strong>× 6 对 × 4</strong>，正好是 1.5 倍。这就是第 3 讲说的「亲家和牌拿到的点数比别人多一半」。</p>
</div>

<h3>动手算一个</h3>

<p>上一讲那手牌是<strong>子家 40 符 3 番</strong>。代入公式：</p>

<p class="formula">
基本点 = 40 × 2<sup>(2+3)</sup> = 40 × 32 = <strong>1280</strong>
</p>

<p>然后按支付方式展开：</p>

<table>
<thead><tr><th>情况</th><th>计算</th><th class="num">支付</th></tr></thead>
<tbody>
<tr><td>子家荣和</td><td>1280 × 4 = 5120 → 进位</td><td class="num"><strong>5200</strong></td></tr>
<tr><td>子家自摸</td><td>亲 1280×2=2560→2600；子 1280→1300</td><td class="num"><strong>1300 / 2600</strong></td></tr>
<tr><td>亲家荣和</td><td>1280 × 6 = 7680 → 进位</td><td class="num"><strong>7700</strong></td></tr>
<tr><td>亲家自摸</td><td>1280 × 2 = 2560 → 进位，三家各付</td><td class="num"><strong>2600 全</strong></td></tr>
</tbody>
</table>

<h3>进位规则：一律向上到 100</h3>

<p>算出来的数字不会正好是整百，所以要进位。<strong>一律向上取整到 100</strong>：</p>

<p class="formula">5120 → 5200 &nbsp;&nbsp;|&nbsp;&nbsp; 7680 → 7700 &nbsp;&nbsp;|&nbsp;&nbsp; 1280 → 1300</p>

<div class="warn">
<p><strong>自摸时是「每家分别进位」，不是先加总再进位。</strong></p>
<p>子家自摸 40 符 3 番：亲家付 2560 → <strong>2600</strong>，每个子家付 1280 → <strong>1300</strong>。三家的零头各自向上，所以和牌者实收 <strong>2600 + 1300 + 1300 = 5200</strong>。</p>
<p style="margin-bottom:0">而同样这手牌荣和只有 5200（一家付）。看起来一样，但注意<strong>荣和是 5120 进位成 5200，自摸是三家零头各自进位后凑成 5200</strong>——机制不同，碰巧相等。多数情况下自摸总额会略高一点点。</p>
</div>

<h2>二、满贯：番数太高就不看符了</h2>

<p>符再高也有极限，所以规则给番数设了<strong>封顶</strong>。到了这些番数，<strong>符数直接忽略</strong>：</p>

<table>
<thead><tr><th>等级</th><th>番数</th><th class="num">子家荣和</th><th class="num">子家自摸</th><th class="num">亲家荣和</th><th class="num">亲家自摸</th></tr></thead>
<tbody>
<tr><td><strong>满贯</strong></td><td>5 番<br><span style="font-size:13px;color:#8d8574">或 4番40符以上 / 3番70符以上</span></td><td class="num">8000</td><td class="num">2000 / 4000</td><td class="num">12000</td><td class="num">4000 全</td></tr>
<tr><td><strong>跳满</strong></td><td>6–7 番</td><td class="num">12000</td><td class="num">3000 / 6000</td><td class="num">18000</td><td class="num">6000 全</td></tr>
<tr><td><strong>倍满</strong></td><td>8–10 番</td><td class="num">16000</td><td class="num">4000 / 8000</td><td class="num">24000</td><td class="num">8000 全</td></tr>
<tr><td><strong>三倍满</strong></td><td>11–12 番</td><td class="num">24000</td><td class="num">6000 / 12000</td><td class="num">36000</td><td class="num">12000 全</td></tr>
<tr><td><strong>役满</strong></td><td>13 番以上<br><span style="font-size:13px;color:#8d8574">或役满役种</span></td><td class="num">32000</td><td class="num">8000 / 16000</td><td class="num">48000</td><td class="num">16000 全</td></tr>
</tbody>
</table>

<p>记忆方法：<strong>满贯 8000 起步，往上每个等级 ×1.5 或 ×2</strong>。子家荣和那一列是 <strong>8000 → 12000 → 16000 → 24000 → 32000</strong>。</p>

<div class="note">
<p>注意「满贯」有两种触发方式：<strong>番数到 5 番</strong>，或者<strong>符数太高导致基本点超过 2000</strong>（比如 4 番 40 符的基本点是 2560）。两者取其一就封顶。</p>
</div>

<h2>三、点数速查表</h2>

<p>实战中没人现场算公式，都是查表。<strong>自摸那一列写成「子 / 亲」</strong>——斜杠前是每个子家付的，斜杠后是亲家付的。</p>

<table class="score-table">
<thead>
<tr><th>番符</th><th class="num">子家荣和</th><th class="num">子家自摸<br><span style="font-weight:400;font-size:12px">子 / 亲</span></th><th class="num">亲家荣和</th><th class="num">亲家自摸<br><span style="font-weight:400;font-size:12px">每家付</span></th></tr>
</thead>
<tbody>
${row(20, 1, '700', '200 / 400', '1000', '400 全')}
${row(20, 2, '1300', '400 / 700', '2000', '700 全')}
${row(20, 3, '2600', '700 / 1300', '3900', '1300 全')}
${row(20, 4, '5200', '1300 / 2600', '7700', '2600 全')}
${row(25, 2, '1600', '400 / 800', '2400', '800 全')}
${row(25, 3, '3200', '800 / 1600', '4800', '1600 全')}
${row(25, 4, '6400', '1600 / 3200', '9600', '3200 全')}
${row(30, 1, '1000', '300 / 500', '1500', '500 全')}
${row(30, 2, '2000', '500 / 1000', '2900', '1000 全')}
${row(30, 3, '3900', '1000 / 2000', '5800', '2000 全')}
${row(30, 4, '7700', '2000 / 3900', '11600', '3900 全')}
${row(40, 1, '1300', '400 / 700', '2000', '700 全')}
${row(40, 2, '2600', '700 / 1300', '3900', '1300 全')}
${row(40, 3, '5200', '1300 / 2600', '7700', '2600 全')}
${row(40, 4, '8000', '2000 / 4000', '12000', '4000 全')}
${row(50, 1, '1600', '400 / 800', '2400', '800 全')}
${row(50, 2, '3200', '800 / 1600', '4800', '1600 全')}
${row(50, 3, '6400', '1600 / 3200', '9600', '3200 全')}
${row(50, 4, '8000', '2000 / 4000', '12000', '4000 全')}
${row(60, 1, '2000', '500 / 1000', '2900', '1000 全')}
${row(60, 2, '3900', '1000 / 2000', '5800', '2000 全')}
${row(60, 3, '7700', '2000 / 3900', '11600', '3900 全')}
${row(70, 1, '2300', '600 / 1200', '3400', '1200 全')}
${row(70, 2, '4500', '1200 / 2300', '6800', '2300 全')}
</tbody>
</table>

<p class="fig-note">25 符只有七对子会出现，而七对子最少 2 番，所以没有「25符 1番」这一行。4 番以上符数再高也是满贯，不再单列。</p>

<div class="tip">
<p><strong>不需要背这张表。</strong>记住几个高频的就够了：</p>
<p style="margin-bottom:0"><strong>30符 1番 = 1000</strong>（子家荣和，最常见）&nbsp;·&nbsp; <strong>30符 2番 = 2000</strong> &nbsp;·&nbsp; <strong>30符 3番 = 3900</strong> &nbsp;·&nbsp; <strong>满贯 = 8000</strong></p>
</div>

<h3>「切上满贯」是个开关</h3>

<p>看表里这两行：<strong>30符 4番 = 7700</strong>、<strong>60符 3番 = 7700</strong>。它们的基本点都是 1920，<strong>离满贯的 2000 只差 80</strong>。</p>

<p>有些规则会把这两档<strong>直接算成满贯 8000</strong>，这叫<strong>切上满贯</strong>。</p>

<table>
<thead><tr><th>规则</th><th>30符4番 / 60符3番</th></tr></thead>
<tbody>
<tr><td><strong>雀魂</strong>（本教程采用）</td><td><strong>不切上</strong> → 7700 / 11600</td></tr>
<tr><td>天凤（段位战）</td><td>不切上 → 7700 / 11600</td></tr>
<tr><td>天凤（雀庄战）、部分竞技规则</td><td>切上 → 8000 / 12000</td></tr>
</tbody>
</table>

<h2>四、本场和立直棒</h2>

<p>除了手牌点数，还有两笔额外的：

<table>
<thead><tr><th>项目</th><th>点数</th><th>谁付 / 谁收</th></tr></thead>
<tbody>
<tr>
  <td><strong>本场</strong>（连庄次数）</td>
  <td>每本场 <strong>300 点</strong></td>
  <td>荣和：放铳者<strong>全额</strong>付（300 × 本场数）<br>自摸：三家<strong>各付 100</strong> × 本场数</td>
</tr>
<tr>
  <td><strong>立直棒</strong>（供托）</td>
  <td>每根 <strong>1000 点</strong></td>
  <td>全部归<strong>和牌者</strong>。桌上所有立直棒一次性收走</td>
</tr>
</tbody>
</table>

<div class="note">
<p><strong>本场是怎么来的？</strong>回忆第 3 讲：亲家和牌或流局听牌就连庄，每连一次本场 +1。所以「本场 3」意味着亲家已经连庄 3 次了。</p>
<p style="margin-bottom:0">连庄越久，桌面上的本场和立直棒越多，下一把和牌能拿到的额外点数就越多——这也是为什么<strong>亲家连庄的局会越来越紧张</strong>。</p>
</div>

<h2>五、练习</h2>

${exercise({
  q: `子家 30 符 3 番 荣和，能拿多少点？`,
  options: ['2000 点', '3900 点', '5800 点', '7700 点'],
  answer: 1,
  hint: '基本点 = 30 × 2^(2+3) = 30 × 32，然后子家荣和乘 4。',
  explain: '<p>基本点 = 30 × 2<sup>5</sup> = 30 × 32 = <strong>960</strong>。</p><p>子家荣和 = 960 × 4 = 3840 → 进位到 <strong>3900</strong>。</p>',
})}

${exercise({
  q: `亲家 30 符 3 番 自摸，三家各付多少？`,
  options: ['1000 全', '2000 全', '3900 全', '5800 全'],
  answer: 1,
  hint: '基本点 960，亲家自摸是「三家各付 基本点 × 2」。',
  explain: '<p>基本点 = 960。亲家自摸每家付 960 × 2 = 1920 → 进位 <strong>2000</strong>。</p><p>亲家一共收 2000 × 3 = <strong>6000 点</strong>。这就是亲家的威力。</p>',
})}

${exercise({
  q: `「平和自摸」是 20 符。那么子家 <strong>20 符 2 番 自摸</strong>是多少点？`,
  options: ['400 / 700', '500 / 1000', '700 / 1300', '200 / 400'],
  answer: 0,
  hint: '查速查表里「20符 2番」那一行。',
  explain: '<p><strong>400 / 700</strong>——每个子家付 400，亲家付 700。</p><p>顺便对比一下：如果把平和自摸错算成 30 符，就会变成 500/1000，差了一整个等级。这就是第 5 讲强调「平和自摸固定 20 符」的原因。</p>',
})}

${exercise({
  q: `桌上已经有 2 根立直棒，本场数是 1。子家 30 符 2 番 荣和，实际一共收多少点？`,
  options: ['2000 点', '2300 点', '4300 点', '5300 点'],
  answer: 2,
  hint: '手牌点数 + 本场 + 立直棒，三笔分开算。',
  explain: '<p>30符2番 子家荣和 = <strong>2000</strong>。</p><p>本场 1：放铳者全额付 300 × 1 = <strong>300</strong>。</p><p>立直棒 2 根：全部归和牌者 = <strong>2000</strong>。</p><p>合计 2000 + 300 + 2000 = <strong>4300 点</strong>。</p>',
})}

${exercise({
  q: `为什么「5 番」以后就不再算符了？`,
  options: ['因为符数的上限是 5 番', '因为番数到 5 番就封顶成满贯，符不再影响点数', '因为 5 番以上没有役', '因为符数会被清零'],
  answer: 1,
  hint: '看一下满贯那张表里，满贯对应的基本点是多少。',
  explain: '<p>因为<strong>满贯及以上是封顶值</strong>：满贯固定按基本点 2000 结算，不管你的符数是多少。</p><p>所以「5 番 30 符」和「5 番 70 符」拿到的点数完全一样，都是满贯 8000（子家荣和）。</p>',
})}

<h2>小结</h2>
<ul>
<li><strong>基本点 = 符 × 2<sup>(2+番)</sup></strong>，所有点数都是它乘系数</li>
<li>子家荣和 <strong>×4</strong>、亲家荣和 <strong>×6</strong>；自摸按亲 <strong>×2</strong> / 子 <strong>×1</strong> 分摊</li>
<li>一律<strong>向上进位到 100</strong>；自摸是<strong>每家分别进位</strong></li>
<li><strong>5 番（或基本点超过 2000）= 满贯 8000</strong>，之后跳满 / 倍满 / 三倍满 / 役满</li>
<li>本场 <strong>300 点</strong>（荣和放铳者全付，自摸三家各 100）；<strong>立直棒全归和牌者</strong></li>
<li>30符4番 和 60符3番 都是 <strong>7700</strong>——雀魂<strong>不采用</strong>切上满贯</li>
</ul>

<p>到这里，你已经能完整走完「和牌 → 算番 → 算符 → 算点」的全过程了。</p>

<p>下一讲换个角度：把<strong>全部 40 多种役</strong>摊开成一张图鉴，让你在做牌的时候知道自己在做什么。</p>
`;
}
