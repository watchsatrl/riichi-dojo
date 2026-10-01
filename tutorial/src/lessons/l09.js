import { exercise } from '../ui-widgets.js';
import { inlineHand } from './_helpers.js';
/**
 * 第 9 讲 —— 防守：什么时候该弃和
 *
 * 教学要点：
 *   1. 先把「为什么要防守」量化。新手不弃和，通常不是不懂，而是没意识到
 *      放铳一次的代价抵得上好几把和牌。
 *   2. 现物是唯一「绝对安全」的牌，这一点直接由第 4 讲的振听规则推出——
 *      两讲在这里闭环。
 *   3. 筋、壁都是概率性推理，必须明确说清「它降低概率但不保证安全」，
 *      不能像很多地摊教材那样讲成铁律。
 *
 * 点数对照用的是第 6 讲的速查表，数值已由 score-table.test 校验。
 */


export function lesson09() {
  return `
<div class="lesson-head">
  <div class="kicker">第 9 讲</div>
  <h1>防守：什么时候该弃和</h1>
  <p class="lede">上一讲教你怎么最快和牌。这一讲讲一件反直觉的事：<strong>有时候正确答案是「这把我不要了」。</strong></p>
</div>

<h2>一、先算一笔账</h2>

<p>新手最常见的错误不是打错牌，而是<strong>该跑的时候还在冲</strong>。原因通常很简单：没算过放铳到底有多贵。</p>

<p>关键在这条规则：<strong>荣和时，放铳的人一个人付全部点数。</strong>自摸则是三家分摊。</p>

<table>
<thead><tr><th>同样的手牌（子家 30 符 3 番）</th><th class="num">你付多少</th></tr></thead>
<tbody>
<tr><td>别人<strong>自摸</strong>，你是子家</td><td class="num">1000</td></tr>
<tr><td>你<strong>放铳</strong>给别人荣和</td><td class="num"><strong>3900</strong></td></tr>
</tbody>
</table>

<p>同一手牌，<strong>放铳的代价接近自摸分摊时的四倍</strong>。而这还只是 3 番的小牌。</p>

<p>如果对方是<strong>立直 + 门清自摸 + 断幺九 + 宝牌</strong>这种常见组合，很容易到满贯——那放铳一次就是 <strong>8000 点</strong>，相当于你连和两三把才补得回来。</p>

<div class="key">
<p><strong>日麻的胜负，一半取决于你和了多少把，另一半取决于你放了多少铳。</strong></p>
<p style="margin-bottom:0">高手和新手的差距，很多时候不在进攻，而在<strong>知道什么时候停手</strong>。</p>
</div>

<h2>二、现物：唯一绝对安全的牌</h2>

<p>回忆第 4 讲的振听规则：<strong>对手的牌河里已经出现过的牌，他永远不能荣和。</strong></p>

<p>也就是说——</p>

<div class="key">
<p>如果某张牌<strong>在对手的牌河里</strong>，那么你打这张牌，<strong>对他百分之百安全</strong>。</p>
<p style="margin-bottom:0">这叫<strong>现物</strong>。它是唯一有「绝对」两个字的安全牌。</p>
</div>

<p>注意是<strong>对那个人</strong>安全，不是对所有人。你打一张在 A 牌河里的牌，对 A 安全，但 B 可能正好等这张。</p>

<div class="tip">
<p><strong>所以弃和时的第一件事：打开每个人的牌河，找一张同时出现在所有人牌河里的牌。</strong></p>
<p style="margin-bottom:0">那种牌叫「全员现物」，打出去绝对安全。找不到的话，至少要避开<strong>立直那家</strong>的牌河之外的牌。</p>
</div>

<h2>三、筋：第二层推理</h2>

<p>现物往往不够用——有时候手里一张现物都没有。这时可以退而求其次用<strong>筋</strong>。</p>

<p>先看两面的形状：${inlineHand([10, 11])} 二筒三筒等<strong>一筒或四筒</strong>；${inlineHand([13, 14])} 五筒六筒等<strong>四筒或七筒</strong>。</p>

<p>注意它们都以 4 为中心。<strong>1-4-7、2-5-8、3-6-9 这三组，就是三条「筋」。</strong></p>

<p>推理是这样的：</p>

<ul>
<li>假设对手牌河里有 <strong>4 筒</strong>（现物）</li>
<li>如果他正在等「1筒/4筒」的两面，那么 4 筒会是他自己的和牌张——他打了 4 筒，就进了振听，<strong>根本荣和不了</strong></li>
<li>所以：<strong>他不是在等 1 筒/4 筒</strong></li>
<li>同理，他也不会在等 4 筒/7 筒</li>
<li>结论：<strong>1 筒和 7 筒相对安全</strong>——这就是「4 的筋」</li>
</ul>

<div class="warn">
<p><strong>但筋不是安全牌，只是「相对没那么危险」。</strong></p>
<p>因为对手完全可能是别的形状：${inlineHand([9, 11])} 一筒三筒<strong>嵌张等二筒</strong>、${inlineHand([9, 9])} <strong>对子等一筒</strong>、或者干脆<strong>单骑等一筒</strong>。这些形状都不受「4 是现物」的影响。</p>
<p style="margin-bottom:0">很多教材把筋讲成铁律，这是错的。<strong>筋只是把危险度从「高」降到「中」。</strong></p>
</div>

<h2>四、壁：数牌</h2>

<p>另一个纯概率的推理是<strong>壁</strong>（也叫「ノーチャンス」）。</p>

<p>如果某种牌<strong>四张全都看得见</strong>（在你手里、在牌河里、在副露里），那么谁也凑不出需要它的两面或嵌张。</p>

<p>举例：${inlineHand([13, 13, 13, 13])} 四张五筒全部可见。那么：</p>

<ul>
<li>没有人能用 ${inlineHand([12, 13])} 四筒五筒 等三筒/六筒（五筒没了）</li>
<li>也没有人能用 ${inlineHand([13, 14])} 五筒六筒 等四筒/七筒</li>
<li>所以<strong>三筒和七筒变得安全很多</strong></li>
</ul>

<div class="note">
<p>和筋一样，壁也只是<strong>降低</strong>危险度，不是消除。对手仍然可能用嵌张或单骑等到这些牌。</p>
</div>

<h2>五、到底该押还是该降</h2>

<p>光知道「哪些牌安全」不够，还要判断<strong>该不该用安全牌</strong>。如果有人立直了，你有三个选择：</p>

<table>
<thead><tr><th>选择</th><th>做什么</th><th>什么时候</th></tr></thead>
<tbody>
<tr>
  <td><strong>押</strong>（攻）</td>
  <td>继续打危险牌，追自己的和牌</td>
  <td>自己手牌很大 / 已经听牌 / 对方威胁不大</td>
</tr>
<tr>
  <td><strong>降</strong>（守）</td>
  <td>只打安全牌，放弃和牌</td>
  <td>自己手牌小且远 / 点数落后需要保命</td>
</tr>
<tr>
  <td><strong>兜</strong>（且战且退）</td>
  <td>优先打安全牌，但不拆掉自己的牌型</td>
  <td>最多的情况——既不硬冲也不放弃</td>
</tr>
</tbody>
</table>

<p>判断时看这四件事：</p>

<ol>
<li><strong>自己的向听数</strong>：听牌了可以适度押；两向听以上基本该降</li>
<li><strong>对手的威胁程度</strong>：立直 &gt; 副露（碰/杠）&gt; 门清没立直</li>
<li><strong>巡目</strong>：还剩几巡？只剩三四巡的话，拼上去也来不及了</li>
<li><strong>点数状况</strong>：你是第一名还是最后一名？领先时保守，落后时该拼</li>
</ol>

<div class="tip">
<p><strong>一个对新手最实用的简化规则：</strong></p>
<p>只要有人立直，而你还没听牌——<strong>默认降。</strong></p>
<p style="margin-bottom:0">除非你手牌已经很大（比如清一色方向），或者点数落后到必须拼。先养成「别人立直我就先保命」的习惯，胜率会立刻上升。等这个习惯稳了，再学怎么精细地押。</p>
</div>

<h2>六、一个很多人不知道的省钱技巧</h2>

<p>如果局面已经无望，你还有一个目标：<strong>流局时别付不听罚符。</strong></p>

<p>回忆第 3 讲：荒牌流局时，没听牌的人要赔点给听牌的人。所以终盘时<strong>「听牌」本身就是有价值的</strong>——哪怕那个听牌毫无胜算。</p>

<div class="key">
<p><strong>振听听牌也算听牌。</strong>第 4 讲说过：振听不能荣和，但流局时照样算听牌，照样收罚符。</p>
<p style="margin-bottom:0">所以到了最后几巡，如果和牌无望，<strong>想办法凑出一个听牌形</strong>（哪怕是振听、哪怕是形式听牌），就能避免付那 1000～3000 点。</p>
</div>

<p>这是日麻里少数「已知赢不了还能赚钱」的地方，也是新手最容易忽略的。</p>

<h2>七、练习</h2>

${exercise({
  q: `对家的牌河里有一张 ${inlineHand([13])} 五筒。你打五筒，对家能和吗？`,
  options: ['能，他可能正好等这张', '不能，这是他的现物'],
  answer: 1,
  hint: '回忆第 4 讲：自己的牌河里有这张牌，意味着什么？',
  explain: '<p><strong>不能。</strong>五筒在对家自己的牌河里，他处于舍牌振听，<strong>根本不能荣和</strong>。</p><p>所以五筒对他是<strong>绝对安全</strong>的——现物是唯一有「绝对」两个字的安全牌。</p>',
})}

${exercise({
  q: `四筒是对家的现物。那么按「筋」的推理，下面哪张牌相对安全？`,
  options: ['二筒（4 的筋）', '一筒（4 的筋）', '三筒（4 的筋）', '六筒（4 的筋）'],
  answer: 1,
  hint: '三条筋是 1-4-7、2-5-8、3-6-9。四筒属于哪一条？',
  explain: '<p><strong>一筒。</strong>筋的分组是 <strong>1-4-7 / 2-5-8 / 3-6-9</strong>，四筒和一筒同一条筋（七筒也是）。</p><p>二筒属于 2-5-8 那条，三筒属于 3-6-9 那条，都不在四筒的筋上。</p>',
})}

${exercise({
  q: `你打出一张「一筒」，因为四筒是对家的现物。对家一定不能和这张一筒吗？`,
  options: ['一定不能，筋是铁律', '不一定，他可能用嵌张或单骑等一筒'],
  answer: 1,
  hint: '「筋」排除的是哪一种听牌形？其他形状呢？',
  explain: '<p><strong>不一定。</strong>筋只排除了<strong>两面听</strong>（1筒/4筒那一形）。对家完全可能是：</p><ul><li>${inlineHand([9, 11])} 嵌张等二筒——但这不影响一筒</li><li>${inlineHand([9, 9])} 对子等一筒</li><li>单骑等一筒</li></ul><p>所以筋只是把危险度从「高」降到「中」，<strong>不是安全牌</strong>。</p>',
})}

${exercise({
  q: `四张 ${inlineHand([13])} 五筒全部已经可见（你手里两张、牌河里两张）。这对哪些牌的安全性有帮助？`,
  options: ['四筒和六筒', '三筒和七筒', '一筒和九筒', '没有任何帮助'],
  answer: 1,
  hint: '谁能用到五筒？两面形是哪两个？',
  explain: '<p><strong>三筒和七筒。</strong>五筒全没了，所以没人能组成「四筒五筒等三筒/六筒」或「五筒六筒等四筒/七筒」的两面——而这两种两面正好会等到三筒和七筒。</p><p>这叫<strong>壁</strong>。但同样只是降低危险度，嵌张和单骑仍然可能。</p>',
})}

${exercise({
  q: `有人立直了，而你现在是两向听，手里也没有大牌。比较合理的做法是？`,
  options: ['继续冲，争取先和', '优先打安全牌，放弃这一把'],
  answer: 1,
  hint: '两向听离听牌还差几步？对方立直意味着什么？',
  explain: '<p><strong>优先打安全牌。</strong>两向听要连进两张有效牌才能听牌，而对方已经听牌了——你追上的概率很低，但放铳的风险是实在的。</p><p>这就是新手最该养成的习惯：<strong>别人立直 + 自己没听牌 = 默认降。</strong></p>',
})}

${exercise({
  q: `终盘了，你这把肯定和不了。下面哪种做法最省钱？`,
  options: ['随便打，反正和不了', '想办法凑一个振听听牌形'],
  answer: 1,
  hint: '流局时，振听算不算听牌？',
  explain: '<p><strong>凑一个振听听牌形。</strong>因为振听<strong>也算听牌</strong>——流局时能收罚符，不用付那 1000～3000 点。</p><p>这是日麻里少数「明知赢不了还能赚钱」的地方，很多新手完全不知道。</p>',
})}

<h2>小结</h2>
<ul>
<li>荣和是<strong>放铳者一个人付全部</strong>；同样一手牌，放铳的代价接近自摸分摊的四倍</li>
<li><strong>现物</strong>（对方牌河里的牌）是唯一<strong>绝对安全</strong>的牌</li>
<li><strong>筋</strong>（1-4-7 / 2-5-8 / 3-6-9）只排除两面听，<strong>不是铁律</strong></li>
<li><strong>壁</strong>（某张牌四张全见）能显著降低相邻牌的危险度</li>
<li>三个选择：<strong>押 / 降 / 兜</strong>；看自己的向听、对手威胁、巡目、点数</li>
<li>新手简化规则：<strong>有人立直 + 自己没听牌 → 默认降</strong></li>
<li>终盘无望时，<strong>凑一个振听听牌形也能省罚符</strong></li>
</ul>

<p>最后一讲把前面九讲串起来：<strong>新手最常犯的错误，以及怎么复盘。</strong></p>
`;
}
