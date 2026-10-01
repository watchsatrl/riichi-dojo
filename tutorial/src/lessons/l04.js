import { handHTML, tileSVG } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { gallery, breakdown, inlineHand } from './_helpers.js';
/**
 * 第 4 讲 —— 振听
 *
 * 教学要点：
 *   1. 最反直觉、也最少被讲清的一点：振听禁的不是「那一张」，而是**全部荣和**。
 *      依据：中文维基《日本麻将规则》「无法荣和不仅意味着无法荣和导致振听的一张牌，
 *      而是所有可能荣和的牌均无法荣和」。这一条如果讲错，读者会一直算错牌。
 *   2. 振听 ≠ 没听牌。振听也算听牌，流局照样收罚符 —— 这是很实用的知识点。
 *   3. 三种振听要分清「永久 / 临时」，同巡振听的解除时机各平台还有分歧。
 */


/** 牌河（舍牌区）—— 振听这一讲必须能看见「自己的牌河」 */
function pond(tiles, label) {
  return `<figure class="pond">
    <span class="hand pond-tiles">${tiles.map((t) => tileSVG(t, { size: 'md' })).join('')}</span>
    <figcaption>${label}</figcaption>
  </figure>`;
}

export function lesson04() {
  return `
<div class="lesson-head">
  <div class="kicker">第 4 讲</div>
  <h1>振听</h1>
  <p class="lede">你听牌了。别人打出了你正等的那张牌。然而「和」的按钮是灰的。</p>
</div>

<p>这不是 bug，也不是你数错了——这是日麻里最容易被误解、也最少被讲清楚的一条规则：<strong>振听（フリテン）</strong>。</p>

<h2>一、先看一个场景</h2>

<p>你门清听牌，手牌是这样（等一萬或四萬，<strong>两面听</strong>）：</p>

${handHTML([1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 20, 27, 27], { size: 'lg' })}

${breakdown(
  [[1, 2], [3, 4, 5], [15, 16, 17], [18, 19, 20], [27, 27]],
  ['搭子 23m（等 1m / 4m）', '顺子 456m', '顺子 789p', '顺子 123s', '雀头 東'],
)}

<p>而你的牌河里，已经躺着一张 ${inlineHand([0])} <strong>一萬</strong>——你前几巡打掉过它：</p>

<div class="pond-row">${pond([0, 22, 31, 5, 13, 29], '你的牌河（已经打出去的牌）')}</div>

<div class="warn">
<p>现在别人打出一萬：<strong>你不能和。</strong></p>
<p style="margin-bottom:0">别人打出四萬：<strong>你也不能和。</strong> ← 这一条才是关键</p>
</div>

<h2>二、振听禁的不是「那一张」，是「全部」</h2>

<div class="key">
<p>振听状态下：<strong>不能荣和，但可以自摸。</strong></p>
<p style="margin-bottom:0">而且——<strong>不能荣和的不只是导致振听的那张牌，而是你所有能和的牌，一张都不能荣和。</strong></p>
</div>

<p>这是振听最反直觉的地方，也是新手算牌时最常出错的地方。很多人以为「我打过一萬，那一萬不能和，四萬总还能和吧」——<strong>不行，四萬也不能和。</strong></p>

<p>看一个更极端的例子。假设你立直时是这个牌型：</p>

${handHTML([1, 1, 3, 4, 5, 6, 7, 14, 15, 16, 23, 24, 25], { size: 'lg' })}

<p>它听 <strong>三萬、六萬、九萬</strong>三个面。以和「三萬」为例，补上那张之后拆解成这样：</p>

${breakdown(
  [[1, 1], [2, 3, 4], [5, 6, 7], [14, 15, 16], [23, 24, 25]],
  ['雀头 2m', '顺子 345m', '顺子 678m', '顺子 678p', '顺子 678s'],
)}

<p>和「六萬」是 456m + 678m，和「九萬」是 456m + 789m——三面都能成。而你在立直之前，某一巡打出过一张 ${inlineHand([8])} 九萬。</p>

<div class="warn">
<p>结果是：<strong>三萬、六萬、九萬——三张全部不能荣和。</strong></p>
<p style="margin-bottom:0">你只能<strong>自摸</strong>。别人打出任何一张都没用。</p>
</div>

<p>六萬明明不在你的牌河里，为什么也不能和？<strong>因为振听判定的是「状态」，不是「单张牌」。</strong>一旦进入振听状态，整手牌的荣和资格就被冻结了。</p>

<h2>三、三种振听</h2>

<p>触发振听有三种情况。它们的<strong>持续时间和解除方式完全不同</strong>，这是最需要分清的地方。</p>

<table>
<thead><tr><th>种类</th><th>什么时候进入</th><th>持续多久</th><th>怎么解除</th></tr></thead>
<tbody>
<tr>
  <td><strong>舍牌振听</strong><br><span style="font-size:13px;color:#8d8574">最常见</span></td>
  <td>你的<strong>牌河</strong>里存在任何一张<br>「你现在能和的牌」</td>
  <td>持续到本局结束</td>
  <td><strong>换听</strong>——只要改变听牌，<br>使新听的牌都不在牌河里，就自动解除</td>
</tr>
<tr>
  <td><strong>同巡振听</strong><br><span style="font-size:13px;color:#8d8574">临时</span></td>
  <td>这一巡有人打出你能和的牌，<br>你<strong>见逃</strong>了（没和）</td>
  <td>只持续到<br>你下一次打牌</td>
  <td>自己打出一张牌即解除</td>
</tr>
<tr>
  <td><strong>立直振听</strong><br><span style="font-size:13px;color:#8d8574">最严重</span></td>
  <td>立直之后，见逃了别人<br>打出的和牌张</td>
  <td><strong>直到本局结束</strong></td>
  <td><strong>无法解除</strong>——立直不能换牌，<br>所以只能等自摸</td>
</tr>
</tbody>
</table>

<h3>为什么「同巡振听」是临时的</h3>

<p>因为它惩罚的是「<strong>见逃</strong>」这个动作——你明明能和，却选择不和（想等一张更大的）。所以只冻结到你下一次行动为止，是一个「警告」。</p>

<p>而舍牌振听和立直振听是<strong>结构性</strong>的，它们来源于你（或规则）已经做过的决定，所以要冻结到本局结束或换听。</p>

<div class="note">
<p><strong>振听只判定「牌河」里的牌。</strong>也就是说：</p>
<ul style="margin-bottom:0">
<li>你<strong>加杠</strong>亮出来的牌，不算</li>
<li>三麻里<strong>拔北</strong>拔出来的牌，不算</li>
</ul>
<p style="margin-bottom:0">这些都不进牌河，所以不构成振听。</p>
</div>

<h3>几个容易被忽略的细节</h3>

<ul>
<li><strong>振听立直是允许的。</strong>你可以明知自己振听还宣告立直——只是这样你就只能自摸了。</li>
<li><strong>没有役而无法荣和，也算振听。</strong>比如你听一张牌，但那手牌一个役都没有——别人打出来你不能和（无役），此时你已经进入同巡振听，<strong>接下来这一巡别人打别的和牌张，你同样不能和</strong>（虽然本来就无役）。这叫<strong>形式听牌</strong>。</li>
<li><strong>同巡振听的解除时机各平台略有分歧</strong>：天凤和雀魂是「自己打牌时解除」，WRC 竞技规则是「自己摸牌或鸣牌时解除」。本教程采用<strong>雀魂口径</strong>。</li>
</ul>

<h2>四、为什么要有这条规则</h2>

<p>假设没有振听：你可以<strong>故意不和</strong>别人打出的小牌，等着自摸一张大的，或者等着牌型变好再和。这样「和牌」就变成了随时可以反悔的事情，整局游戏的推进会被拖住。</p>

<p>振听的本质是一句约束：</p>

<p class="formula"><strong>你打出去的牌，等于你宣布「我不要它」。<br>别人再打出来，你就不能反悔说要。</strong></p>

<p>这条约束还有一个重要的副作用：<strong>它让「打过什么牌」变成了可以读的信息</strong>。第 9 讲「防守」的整套理论，地基就是振听——你打过某张牌，那张牌对你就绝对安全。</p>

<h2>五、怎么避免振听</h2>

<div class="tip">
<p><strong>打牌之前，先看一眼自己听什么。</strong></p>
<p>尤其是<strong>听牌前的那一两巡</strong>：你手上那些「多余的、准备打掉的」牌里，很可能就有你未来的和牌张。打掉它，就等于把自己的听牌锁死一半。</p>
<p style="margin-bottom:0">最常见的翻车方式：你在做两面听，手上多一张边张，随手打了——结果那张正好是你后来的听牌之一。</p>
</div>

<p>还有一点很实用：<strong>振听不等于没听牌。</strong>流局时振听照样算听牌，照样能收听牌罚符。所以到了终盘，<strong>「振听听牌」比「没听牌」好得多</strong>——这在第 9 讲会变成一条重要的实战技巧。</p>

<h2>六、练习</h2>

${exercise({
  q: `你听 ${inlineHand([0])} 一萬和 ${inlineHand([3])} 四萬两面。你的牌河里有一张一萬。此时上家打出四萬，你能和吗？`,
  options: ['能，四萬不在我牌河里', '不能，振听中所有牌都不能荣和'],
  answer: 1,
  hint: '振听冻结的是「整手牌的荣和资格」，还是「某一张牌」？',
  explain: '<p><strong>不能和。</strong>这是振听最反直觉的地方——<strong>振听禁的不是那一张牌，而是全部荣和</strong>。</p><p>你牌河里有 1m，就进入了舍牌振听，此时<strong>1m 和 4m 都不能荣和</strong>，只能自摸。</p>',
})}

${exercise({
  q: `你听三萬、六萬、九萬三面，但立直之前打过九萬。别人打出这些牌时，你能荣和哪一张？${gallery([2, 5, 8], 'lg')}`,
  options: ['三萬', '六萬', '九萬', '三张都不能荣和'],
  answer: 3,
  hint: '这不是「哪一张被禁」，而是「荣和资格还在不在」。',
  explain: '<p><strong>三张全部不能荣和。</strong>进入振听状态后，整手牌失去荣和资格，和你牌河里具体是哪张无关。</p><p>六萬明明不在你牌河里，也一样不能和。这手牌只能等自摸三萬、六萬或九萬。</p>',
})}

${exercise({
  q: `这一巡，对家打出了你能和的牌，但你选择见逃（没有和）。下一巡轮到你之前，上家又打出你另一张和牌张——你能和吗？`,
  options: ['能，是不同的一张', '不能，你处于同巡振听'],
  answer: 1,
  hint: '见逃和牌会触发哪一种振听？它能持续多久？',
  explain: '<p><strong>不能和。</strong>见逃会立刻让你进入<strong>同巡振听</strong>，在你自己打出一张牌之前，<strong>别人打什么你都不能荣和</strong>。</p><p>等你下次打牌后，同巡振听解除，就又能荣和了。（注意：如果你已经立直，见逃就变成<strong>立直振听</strong>，那就解除不了了。）</p>',
})}

${exercise({
  q: `你处于舍牌振听状态，但后来摸到一张牌，打出之后<strong>改变了听牌</strong>，新听的两张牌都不在你的牌河里。现在你能荣和了吗？`,
  options: ['能，舍牌振听随换听解除', '不能，舍牌振听是永久的'],
  answer: 0,
  hint: '舍牌振听的根源是「你听的牌在你牌河里」。如果不再听那张了呢？',
  explain: '<p><strong>能荣和了。</strong>舍牌振听是「你听的牌 ∩ 你的牌河 ≠ 空」造成的。一旦换听，交集变空，振听自动解除。</p><p>但要注意：<strong>立直振听不能这样解除</strong>——因为立直之后你不允许换牌。</p>',
})}

${exercise({
  q: `你知道自己振听，此时能宣告<strong>立直</strong>吗？`,
  options: ['能，振听立直是允许的', '不能，振听时禁止立直'],
  answer: 0,
  hint: '振听限制的是「荣和」，立直限制的是「换牌」——两者冲突吗？',
  explain: '<p><strong>可以立直。</strong>三大平台都承认「振听立直」。</p><p>但这是个很亏的选择：立直之后你不能换牌，所以<strong>振听也永远解除不了</strong>，整局只能靠自摸。所以在振听状态下要不要立直，是一个需要权衡的判断。</p>',
})}

<h2>小结</h2>
<ul>
<li><strong>振听 = 不能荣和，但可以自摸</strong></li>
<li>⚠️ 振听禁的是<strong>全部荣和</strong>，不是「导致振听的那一张」</li>
<li><strong>舍牌振听</strong>：牌河里有自己听的牌 → 换听可解除</li>
<li><strong>同巡振听</strong>：这一巡见逃 → 自己下次打牌后解除</li>
<li><strong>立直振听</strong>：立直后见逃 → <strong>无法解除</strong>，只能自摸</li>
<li>振听只判定<strong>牌河</strong>；加杠、拔北不算</li>
<li>振听<strong>也算听牌</strong>，流局照样收罚符</li>
<li>避免方法：<strong>打牌前先看自己听什么</strong>，尤其听牌前那一两巡</li>
</ul>

<p>「入门」到这里就真正结束了。你已经知道：牌是什么、和牌长什么样、为什么需要役、一局怎么走、以及为什么有时候不能和。</p>

<p>从下一讲开始是「进阶」——<strong>番与符</strong>：和牌之后，屏幕上那个点数到底是怎么算出来的。</p>
`;
}
