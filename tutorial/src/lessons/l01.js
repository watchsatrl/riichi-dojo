import { handHTML } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { gallery, breakdown, inlineHand, handWithMelds } from './_helpers.js';
/**
 * 第 1 讲 —— 和牌的形态
 *
 * 教学要点：
 *   1. 和牌是一副「骨架」：4 个面子 + 1 个雀头。先给形状，不给条件。
 *   2. 必须在这一讲就明确区分「和牌形」和「能和牌」——这是新手第一次
 *      崩溃的地方（凑齐了骨架却不让和），提前打预防针比事后解释有效。
 *   3. 杠是四张但只算一个面子，先埋一句，不展开。
 */


export function lesson01() {
  return `
<div class="lesson-head">
  <div class="kicker">第 1 讲</div>
  <h1>和牌的形态</h1>
  <p class="lede">什么样的 14 张牌，才算「和了」？这一讲只回答形状问题。</p>
</div>

<div class="key">
<p>先记住一句话：<strong>和牌是一副骨架 —— 4 个「面子」加 1 个「雀头」。</strong></p>
<p style="margin-bottom:0">这一讲只讲骨架长什么样。<strong>就算你摆出了标准骨架，也不一定能和</strong>——那是下一讲「役」的内容。这个区分现在就要建立，否则下一讲你会很困惑。</p>
</div>

<h2>一、两个零件：面子和雀头</h2>

<p>整副牌里，能组成「一组」的只有两种方式。</p>

<h3>零件 A：面子 —— 三张牌一组</h3>

<p>面子有两种做法。第一种是<strong>顺子</strong>：<strong>同一个花色</strong>、数字<strong>连续</strong>的三张牌。</p>

${gallery([1, 2, 3], 'lg')}
<p class="fig-note">同花色、数字连续 → 顺子 <code>234m</code></p>

${gallery([10, 11, 12], 'lg')}
<p class="fig-note">换个花色也一样 → 顺子 <code>234p</code></p>

<div class="warn">
<p>顺子<strong>不能跨花色</strong>。${inlineHand([8, 9, 10])} 看上去「连续」，但九萬是萬子、一筒和二筒是筒子，<strong>这不是顺子</strong>。</p>
<p style="margin-bottom:0">顺子也<strong>不能绕圈</strong>：${inlineHand([7, 8, 0])} 不是顺子——九萬后面没有「十萬」，接不回一萬。字牌则完全不能组顺子。</p>
</div>

<p>第二种是<strong>刻子</strong>：<strong>三张完全一样</strong>的牌。</p>

${gallery([27, 27, 27], 'lg')}
<p class="fig-note">三张一模一样 → 刻子。字牌做刻子同样成立</p>

${gallery([22, 22, 22], 'lg')}
<p class="fig-note">数牌做刻子也一样 → 刻子</p>

<h3>零件 B：雀头 —— 两张一样的牌</h3>

<p>雀头（也叫「头」）最简单：<strong>两张完全一样</strong>的牌。它只有一种做法，就是一对。</p>

${gallery([7, 7], 'lg')}
<p class="fig-note">八萬 八萬 → 雀头</p>

<div class="note">
<p>整副牌每种只有 4 张，所以：<strong>一种牌最多凑出一个刻子（3 张），第 4 张就多出来了</strong>。这一点后面讲「杠」和「七对子」时都会用到。</p>
</div>

<h2>二、和牌的骨架：4 个面子 + 1 个雀头</h2>

<p>把零件拼起来，就是一个标准的和牌形：</p>

<p class="formula">4 个面子 × 3 张 &nbsp;+&nbsp; 1 个雀头 × 2 张 &nbsp;=&nbsp; 12 + 2 &nbsp;=&nbsp; <strong>14 张</strong></p>

<p>看一个例子。下面这手牌是标准的和牌形：</p>

${handHTML([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 22], { size: 'lg' })}

<p>它之所以成立，是因为可以完整地拆成 4 个面子和 1 个雀头：</p>

${breakdown(
  [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11], [22, 22]],
  ['顺子 123m', '顺子 456m', '顺子 789m', '顺子 123p', '雀头 5s'],
)}

<p>再看一个<strong>全是刻子</strong>的例子，骨架是一样的：</p>

${handHTML([0, 0, 0, 17, 17, 17, 27, 27, 27, 31, 31, 31, 33, 33], { size: 'lg' })}

${breakdown(
  [[0, 0, 0], [17, 17, 17], [27, 27, 27], [31, 31, 31], [33, 33]],
  ['刻子 1m', '刻子 9p', '刻子 東', '刻子 白', '雀头 中'],
)}

<p>骨架里<strong>顺子和刻子可以随便混搭</strong>，只要总数是 4 个面子、1 个雀头就行。</p>

<h3>什么不是和牌形</h3>

<p>下面这手牌有 14 张，但<strong>不是</strong>和牌形：</p>

${handHTML([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 22, 22, 24], { size: 'lg' })}

<p>前三组都很顺：123m、456m、789m。但剩下的 ${inlineHand([9, 10])} ${inlineHand([22, 22])} ${inlineHand([24])} 里，<strong>1p 和 2p 凑不成面子</strong>（缺一张 3p），5s5s 当了雀头，7s 就孤零零地剩下了。</p>

<p>换句话说：它<strong>离和牌只差一张</strong>——摸到或吃到 3p，把 ${inlineHand([9, 10])} 补成顺子，就成立了。这种「差一张」的状态叫<strong>听牌</strong>，第 3 讲会专门讲。</p>

<h2>三、两个例外：不走骨架的和牌形</h2>

<p>上面那套「4 面子 + 1 雀头」覆盖了绝大多数和牌，但有<strong>两个特殊形态</strong>不走这个骨架。</p>

<h3>例外一：七对子</h3>

<p><strong>七对子</strong>就是<strong>七个对子</strong>，一个面子都不要：</p>

${handHTML([0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 9, 9, 27, 27], { size: 'lg' })}

<p>2 + 2 + 2 + 2 + 2 + 2 + 2 = 14 张，成立。</p>

<div class="warn">
<p><strong>四张一样的牌不能拆成两个对子。</strong>七对子要求<strong>七种不同的牌</strong>，每种各两张。</p>
<p>下面这手牌看着像七个对子，其实只有 <strong>6 种</strong>牌（東占了四张），<strong>不是七对子</strong>：</p>
<p style="margin-bottom:0">${handHTML([27, 27, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32], { size: 'md' })}</p>
</div>

<h3>例外二：国士无双</h3>

<p><strong>国士无双</strong>要求把 <strong>13 种幺九牌各拿一张</strong>，再从中随便挑一种多拿一张凑够 14 张：</p>

${handHTML([0, 8, 9, 17, 18, 26, 27, 27, 28, 29, 30, 31, 32, 33], { size: 'lg' })}

<p>数一数：一萬、九萬、一筒、九筒、一索、九索，加上東南西北白發中——正好 13 种幺九牌，其中東拿了两张。</p>

<p>还记得第 0 讲说过「幺九牌一共 13 种」吗？国士无双要的就是这 13 种，<strong>一张不多一张不少</strong>。</p>

<h2>四、副露：把面子提前摆出来</h2>

<p>打牌过程中，你可以用别人打出的牌来<strong>提前固定</strong>一个面子，这叫<strong>鸣牌</strong>，摆出来的牌叫<strong>副露</strong>。三种方式：</p>

<table>
<thead><tr><th>动作</th><th>做什么</th><th>关键限制</th></tr></thead>
<tbody>
<tr><td><strong>吃</strong>（チー）</td><td>用别人的牌凑<strong>顺子</strong></td><td>只能吃<strong>上家</strong>（左手边）打的牌，而且只有数牌能组顺子</td></tr>
<tr><td><strong>碰</strong>（ポン）</td><td>用别人的牌凑<strong>刻子</strong></td><td>任何一家打的牌都可以碰</td></tr>
<tr><td><strong>杠</strong>（カン）</td><td>凑<strong>四张</strong>一样的牌</td><td>四张，但<strong>仍然只算一个面子</strong></td></tr>
</tbody>
</table>

<p>副露之后，你手里的暗牌会变少，但<strong>骨架不变</strong>。看这个例子：</p>

<p><strong>已经副露的（摆在桌上）：</strong></p>
${breakdown(
  [[27, 27, 27], [12, 13, 14], [26, 26, 26]],
  ['碰 東', '吃 456p', '碰 9s'],
)}

<p><strong>手里还剩的（暗牌）：</strong></p>
${breakdown([[0, 1, 2], [22, 22]], ['顺子 123m', '雀头 5s'])}

<p>3 组副露 + 手里 1 个面子 + 1 个雀头 = <strong>4 面子 1 雀头，仍然是标准骨架</strong>。</p>

<div class="note">
<p>副露是<strong>有代价</strong>的：它会让你失去很多役（下一讲就会看到）。但它能大幅加快凑齐骨架的速度。<strong>「要不要鸣牌」是日麻最核心的判断之一</strong>，第 8 讲会专门讲。</p>
</div>

<h2>五、练习</h2>

${exercise({
  q: `下面这三张牌是什么？${handHTML([13, 14, 15], { size: 'xl' })}`,
  options: ['顺子', '刻子', '雀头', '什么都不是'],
  answer: 0,
  hint: '看它们是不是同一个花色、数字连不连续。',
  explain: '<p>五筒、六筒、七筒 —— 同花色且连续，是<strong>顺子</strong>（<code>567p</code>）。</p>',
})}

${exercise({
  q: `这手牌是<strong>和牌形</strong>吗？${handHTML([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 22, 22, 24], { size: 'lg' })}`,
  options: ['是，标准骨架', '不是，凑不齐 4 个面子', '是，七对子', '是，国士无双'],
  answer: 1,
  hint: '试着把它拆成 4 个面子和 1 个雀头。',
  explain: '<p>123m、456m、789m 占了 3 个面子，剩下一筒、二筒、5s5s、7s —— 一筒二筒缺一张三筒凑不成面子，7s 也是孤张。所以<strong>凑不齐 4 个面子</strong>。</p><p>它离和牌只差一张三筒，属于「听牌」。</p>',
})}

${exercise({
  q: `这手牌是<strong>七对子</strong>吗？${handHTML([27, 27, 27, 27, 28, 28, 29, 29, 30, 30, 31, 31, 32, 32], { size: 'lg' })}`,
  options: ['是，七个对子', '不是，只有六种牌'],
  answer: 1,
  hint: '数一数有几种不同的牌，而不是有几对。',
  explain: '<p>東有四张 —— 但<strong>四张一样的牌只能算一种</strong>，不能拆成两个对子。所以这手牌只有東、南、西、北、白、發 <strong>6 种</strong>牌，凑不满七对子要求的 7 种。</p>',
})}

${exercise({
  q: `桌上摆着几组副露？你手里还剩几张暗牌？${handWithMelds(
    [[27, 27, 27], [12, 13, 14], [26, 26, 26]],
    [0, 1, 2, 22, 22],
    { size: 'lg' },
  )}`,
  options: ['3 组副露，手里 5 张', '3 组副露，手里 8 张', '2 组副露，手里 8 张'],
  answer: 0,
  hint: '别把两行加起来数 —— 副露是「桌上」那一行，暗牌是「手里」那一行。',
  explain: '<p>桌上摆着 <strong>3 组副露</strong>：碰 東、吃 456p、碰 9s，所以手里只剩 <strong>5 张</strong>暗牌（123m + 55s）。</p>'
    + '<p><strong>关键：副露不占你手里的 13 张。</strong>每鸣一组，手里的暗牌就少 3 张 —— '
    + '这也是为什么鸣牌能加快凑齐骨架。</p>',
})}

${exercise({
  q: `国士无双需要几种<strong>不同</strong>的牌？`,
  options: ['7 种', '9 种', '13 种', '14 种'],
  answer: 2,
  hint: '回忆第 0 讲：幺九牌一共有多少种？',
  explain: '<p><strong>13 种</strong>——就是全部幺九牌（1 和 9 的数牌各 6 种，加上 7 种字牌）。国士无双要求这 13 种各一张，再挑一种多拿一张凑够 14 张。</p>',
})}

<h2>小结</h2>
<ul>
<li>面子的两种做法：<strong>顺子</strong>（同花色连续三张）、<strong>刻子</strong>（三张相同）</li>
<li><strong>雀头</strong> = 两张相同</li>
<li>标准骨架 = <strong>4 面子 + 1 雀头 = 14 张</strong></li>
<li>两个例外：<strong>七对子</strong>（7 个对子，且必须 7 种不同）、<strong>国士无双</strong>（13 种幺九牌各一张 + 1）</li>
<li><strong>副露</strong>（吃/碰/杠）把面子提前固定，骨架不变；杠是 4 张但只算 1 个面子</li>
<li>⚠️ <strong>「和牌形」不等于「能和牌」</strong>——还差「役」这一关</li>
</ul>

<p>下一讲就是那关键的一关：<strong>为什么我明明凑齐了骨架，还是不让和？</strong></p>
`;
}
