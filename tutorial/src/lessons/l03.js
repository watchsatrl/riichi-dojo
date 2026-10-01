import { handHTML, tileSVG } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { gallery, breakdown, inlineHand } from './_helpers.js';
/**
 * 第 3 讲 —— 一局牌怎么走
 *
 * 教学要点：
 *   1. 座次的空间映射（下家在右、上家在左、逆时针）—— 这个教反了，
 *      读者第一次实战就会懵，所以专门画了张桌子图。
 *      （依据：中文维基《日本麻将规则》「左手侧为上家，右手侧为下家」；
 *        RCR 竞技规则「庄家右手家（下家）门风为南风」）
 *   2. 手牌张数的守恒：13 张 ⇄ 摸完 14 张 ⇄ 打完 13 张。
 *      理解了这一条，就理解了「为什么和牌是 14 张」。
 *   3. 鸣牌是「插队」，不是「多摸一张」。
 */


/* 桌面座次图。手画 SVG 而不是用图片，理由和牌面一样：单文件不能带外部资源。 */
function tableDiagram() {
  const arrow = (x1, y1, x2, y2) => {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const pt = (d, r) => `${(x2 - Math.cos(ang + d) * r).toFixed(1)},${(y2 - Math.sin(ang + d) * r).toFixed(1)}`;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b03a2e" stroke-width="2.2" stroke-linecap="round"/>`
         + `<polygon points="${x2},${y2} ${pt(0.45, 9)} ${pt(-0.45, 9)}" fill="#b03a2e"/>`;
  };
  const seat = (x, y, w, l1, l2, strong) => `
    <rect x="${x}" y="${y}" width="${w}" height="56" rx="8"
          fill="${strong ? '#f6e6e2' : '#fffefb'}" stroke="${strong ? '#b03a2e' : '#cec4ac'}" stroke-width="1.5"/>
    <text class="mj-kn" x="${x + w / 2}" y="${y + 24}" text-anchor="middle" font-size="15"
          fill="${strong ? '#b03a2e' : '#242019'}" font-weight="${strong ? 700 : 500}">${l1}</text>
    <text x="${x + w / 2}" y="${y + 43}" text-anchor="middle" font-size="12" fill="#8d8574">${l2}</text>`;

  return `<svg class="table-diagram" viewBox="0 0 420 340" role="img" aria-label="四人座次与行动顺序">
    <rect x="115" y="95" width="190" height="150" rx="10" fill="#dfeae2" stroke="#b9cfc1" stroke-width="1.5"/>
    <text x="210" y="165" text-anchor="middle" font-size="13" fill="#2f6b4f" font-weight="600">行动顺序</text>
    <text x="210" y="186" text-anchor="middle" font-size="12" fill="#5c8a72">逆时针</text>

    ${seat(150, 268, 120, '你', '东家 · 亲家', true)}
    ${seat(316, 142, 96, '下家', '南家', false)}
    ${seat(150, 16, 120, '对家', '西家', false)}
    ${seat(8, 142, 96, '上家', '北家', false)}

    ${arrow(296, 264, 330, 228)}
    ${arrow(330, 112, 296, 76)}
    ${arrow(124, 76, 90, 112)}
    ${arrow(90, 228, 124, 264)}
  </svg>
  <p class="fig-note" style="text-align:center">
    <strong>下家在你的右边，上家在你的左边。</strong>行动方向是逆时针：你 → 下家 → 对家 → 上家 → 你。
  </p>`;
}

export function lesson03() {
  return `
<div class="lesson-head">
  <div class="kicker">第 3 讲</div>
  <h1>一局牌怎么走</h1>
  <p class="lede">前两讲都在看「静态」的牌。这一讲把镜头拉远，看这 14 张牌是怎么一张一张走到你手里的。</p>
</div>

<h2>一、四个人，四个座位</h2>

<p>日麻是四个人打。四个人不是随便坐的——<strong>座位决定了你这一局的「自风」，也决定了你能吃谁的牌。</strong></p>

${tableDiagram()}

<table>
<thead><tr><th>称呼</th><th>位置</th><th>含义</th></tr></thead>
<tbody>
<tr><td><strong>上家</strong></td><td>你的<strong>左边</strong></td><td>在你<strong>之前</strong>行动的人。你只能吃他的牌</td></tr>
<tr><td><strong>下家</strong></td><td>你的<strong>右边</strong></td><td>在你<strong>之后</strong>行动的人</td></tr>
<tr><td><strong>对家</strong></td><td>你的<strong>对面</strong></td><td>隔着桌子的人</td></tr>
</tbody>
</table>

<h3>亲家与子家</h3>

<p>四个人里有一个是<strong>亲家</strong>（也叫庄家，日语「親」），另外三个是<strong>子家</strong>（「子」）。</p>

<div class="key">
<p>亲家和子家的区别，只有两条，但都影响很大：</p>
<ul style="margin-bottom:0">
<li>亲家和牌时，<strong>拿到的点数比别人多一半</strong>（第 6 讲会算）</li>
<li>亲家和牌或流局时听牌，<strong>可以连庄</strong>——继续当亲家再来一局</li>
</ul>
</div>

<p>所以四个人都很在意「谁是亲家」。开局时四个人的座位会按东南西北排好，<strong>亲家的自风是東</strong>，然后按逆时针依次是南、西、北。</p>

<div class="note">
<p>回忆第 2 讲的役牌：<strong>场风</strong>是这一场固定的（东场就是東），<strong>自风</strong>是你在这一局的位置决定的。东场的东家是「连风牌」，東刻子算 2 番；东场的南家拿南刻子只算 1 番（自风），拿東刻子也只算 1 番（场风）。</p>
</div>

<h2>二、一局从配牌开始</h2>

<p>洗牌砌墙之后，每人发 <strong>13 张</strong>牌。然后由<strong>亲家先摸一张</strong>，再从手里打出一张。</p>

<div class="tip">
<p><strong>为什么是 13 张？</strong>回忆第 1 讲：和牌形是 14 张（4 面子 + 1 雀头 = 12 + 2）。</p>
<p style="margin-bottom:0">所以设计成「手里永远保持 13 张，摸一张就变成 14 张」——<strong>如果这 14 张正好凑成和牌形，你就自摸了。</strong>整个游戏就是这个「13 ⇄ 14」的循环。</p>
</div>

<h2>三、摸打循环：整个游戏的心跳</h2>

<p>轮到你的回合，只有两个动作，按顺序：</p>

<p class="formula"><strong>摸一张</strong>（手里变成 14 张）&nbsp;→&nbsp;<strong>打一张</strong>（手里回到 13 张）</p>

<p>打出去的牌会摆在你面前，排成一排，这叫<strong>牌河</strong>。牌河不是随便码的——第 4 讲「振听」和第 9 讲「防守」，读的就是别人的牌河。</p>

<h3>什么叫「一巡」</h3>

<p>四个人每人各行动一次，叫<strong>一巡</strong>。日麻一局大约有 18 巡，牌就摸完了。</p>

<div class="warn">
<p>如果<strong>牌全部摸完都没人和牌</strong>，这一局就<strong>荒牌流局</strong>。这是很常见的结果——事实上日麻大约有 15%~20% 的局是流局的，比新手想象的频繁得多。</p>
</div>

<h2>四、鸣牌：插队</h2>

<p>正常的循环是你一张我一张。但有三种操作可以<strong>打乱顺序</strong>，用别人打出的牌来提前凑好面子，这叫<strong>鸣牌</strong>：</p>

<table>
<thead><tr><th>动作</th><th>做什么</th><th>能对谁用</th></tr></thead>
<tbody>
<tr><td><strong>吃</strong>（チー）</td><td>凑顺子</td><td><strong>只有上家</strong>（你左边那家）</td></tr>
<tr><td><strong>碰</strong>（ポン）</td><td>凑刻子</td><td>任何一家</td></tr>
<tr><td><strong>杠</strong>（カン）</td><td>凑四张</td><td>任何一家（暗杠是自己手里四张）</td></tr>
</tbody>
</table>

<h3>鸣牌的优先级</h3>

<p>如果<strong>不止一个人</strong>想要同一张牌，按这个顺序裁定：</p>

<p class="formula"><strong>和牌&nbsp;&gt;&nbsp;碰 / 杠&nbsp;&gt;&nbsp;吃</strong></p>

<p>也就是说：如果有人能和这张牌，那他优先，别人都别想动；如果没人能和，就轮到碰/杠；最后才轮到吃。</p>

<h3>鸣牌之后必须立刻打一张</h3>

<p>吃过或碰过之后，手里的牌会多出来一张，所以要<strong>马上打掉一张</strong>，重新回到 13 张。然后<strong>跳过其他人的回合，直接轮到你继续</strong>——这就是「插队」的意思。</p>

<div class="warn">
<p><strong>食替（喰い替え）是禁止的。</strong>意思是：吃牌之后，<strong>不能马上打出刚刚吃进来的那张牌所组成的顺子里的牌</strong>。</p>
<p>举例：你手里有 ${inlineHand([20, 21, 22])} 三索四索五索，吃进上家的 ${inlineHand([23])} 六索凑成 456 索——此时你<strong>不能打三索</strong>（那等于退回去）。但打别的牌可以；这一巡打别的，<strong>下一巡再打三索就不受限制</strong>。</p>
<p style="margin-bottom:0">另外，如果打出的牌<strong>和吃进来的牌组不成顺子</strong>，就不算食替。比如手里 ${inlineHand([19, 20, 21, 22, 23, 24])} 二索到七索，吃进八索之后打二索<strong>是允许的</strong>（二索和八索凑不成顺子）。</p>
</div>

<h2>五、立直：门清时的保底番种</h2>

<p>如果你<strong>一次都没鸣牌</strong>（这叫<strong>门清</strong>），并且已经听牌了，就可以宣告<strong>立直</strong>：</p>

<ul>
<li>交出 <strong>1000 点</strong>作为抵押，放在桌上</li>
<li>之后<strong>只能摸什么打什么</strong>，不能再换牌（除非摸到能杠的牌）</li>
<li>换来 <strong>1 番</strong>——而且别人放铳给你时，你能多翻开一张「里宝牌」</li>
</ul>

<p>立直是日麻最有辨识度的规则。第 5 讲会专门展开。</p>

<h2>六、一局怎么结束</h2>

<p>三种结局：</p>

<table>
<thead><tr><th>结局</th><th>什么时候发生</th></tr></thead>
<tbody>
<tr><td><strong>有人和牌</strong></td><td>某人自摸，或某人打出的牌被别人和了</td></tr>
<tr><td><strong>荒牌流局</strong></td><td>牌全部摸完，谁都没和</td></tr>
<tr><td><strong>中途流局</strong></td><td>满足特定条件时提前结束，共四种（见下）</td></tr>
</tbody>
</table>

<h3>四种中途流局</h3>

<table>
<thead><tr><th>名称</th><th>条件</th></tr></thead>
<tbody>
<tr><td><strong>九种九牌</strong></td><td>配牌后第一次摸牌时，手里有 <strong>9 种以上幺九牌</strong>，且之前没人鸣牌。可以<strong>选择</strong>宣告流局（也可以继续打）</td></tr>
<tr><td><strong>四风连打</strong></td><td>开局第一巡，四个人<strong>打出的第一张牌都是同一种风牌</strong></td></tr>
<tr><td><strong>四家立直</strong></td><td>四个人<strong>全都宣告了立直</strong></td></tr>
<tr><td><strong>四槓散了</strong></td><td>四个人合计开了 <strong>4 个杠</strong>，且没人和牌</td></tr>
</tbody>
</table>

<h3>流局了怎么办：听牌罚符</h3>

<p>荒牌流局时，如果<strong>有人听牌、有人没听</strong>，没听的人要赔点给听牌的人。总额固定 <strong>3000 点</strong>：</p>

<table>
<thead><tr><th>听牌人数</th><th>没听人数</th><th>没听的人怎么付</th><th>每个听牌的人收到</th></tr></thead>
<tbody>
<tr><td>1 人</td><td>3 人</td><td>每人付 1000</td><td><strong>3000 点</strong></td></tr>
<tr><td>2 人</td><td>2 人</td><td>每人付 1500</td><td><strong>1500 点</strong></td></tr>
<tr><td>3 人</td><td>1 人</td><td>付 3000（分给三家）</td><td><strong>1000 点</strong></td></tr>
<tr><td>0 人或 4 人</td><td>—</td><td>不发生支付</td><td>—</td></tr>
</tbody>
</table>

<div class="tip">
<p>注意<strong>总额永远是 3000 点</strong>，只是听牌的人越多、每个人分到的越少。所以流局时「只有我一个人听牌」是最赚的。</p>
</div>

<h2>七、这一局之后</h2>

<p>一局结束后，下一局怎么开始，取决于两件事：</p>

<table>
<thead><tr><th>情况</th><th>结果</th></tr></thead>
<tbody>
<tr><td>亲家<strong>和牌</strong>，或流局时亲家<strong>听牌</strong></td><td><strong>连庄</strong>——亲家不变，<strong>本场 +1</strong>（连庄越多，和牌时加的点越多）</td></tr>
<tr><td>子家<strong>和牌</strong>，或流局时亲家<strong>没听</strong></td><td><strong>亲家轮转</strong>——亲家位置移到下家，本场归零</td></tr>
</tbody>
</table>

<p>亲家轮转一圈（四个人都当过一次亲家），就叫<strong>一圈</strong>。东场打完是南场，南场打完通常就结束了——这就是「半庄战」。</p>

<h2>八、练习</h2>

${exercise({
  q: `你可以「吃」谁的牌？`,
  options: ['上家（左边）', '下家（右边）', '对家', '任何一家'],
  answer: 0,
  hint: '看看桌面示意图里，吃这个动作的箭头是从哪边来的。',
  explain: '<p><strong>只能吃上家（你左边那家）的牌。</strong>这是吃和碰最大的区别——碰可以对任何一家用，吃不行。</p><p>原因在于顺序：吃是用一张牌凑顺子，而顺子的推进方向和行动方向一致，所以只有「上一家」的牌才有意义。</p>',
})}

${exercise({
  q: `轮到你时，你摸了一张牌。此刻你手里有几张牌？`,
  options: ['13 张', '14 张', '15 张', '不一定'],
  answer: 1,
  hint: '回想那个「13 ⇄ 14」的循环。',
  explain: '<p><strong>14 张。</strong>摸牌之后、打牌之前，你手里是 14 张——这正是和牌形需要的张数。所以自摸的时刻，就是你手里短暂拥有 14 张的时刻。</p><p>打完一张，回到 13 张，等下一巡。</p>',
})}

${exercise({
  q: `你手里有 ${handHTML([20, 21, 22], { size: 'md' })}（三四五索），吃进上家的 ${handHTML([23], { size: 'md' })}（六索）凑成顺子。下面哪张牌你<strong>不能马上打</strong>？`,
  options: [
    tileSVG(20, { size: 'lg' }),
    tileSVG(27, { size: 'lg' }),
    tileSVG(9, { size: 'lg' }),
  ],
  answer: 0,
  hint: '食替禁止的是「把刚吃进来的顺子拆掉」。',
  explain: '<p>不能打 <strong>三索</strong>。你刚用三索四索五索 + 六索组成了 456 索顺子，马上打三索等于把顺子拆回去，这就是<strong>食替</strong>，被禁止。</p><p>打東或一筒都没问题——它们和吃进来的六索组不成顺子。而且就算你这一巡打了别的牌，<strong>下一巡再打三索也不受限制</strong>。</p>',
})}

${exercise({
  q: `这一局亲家没和牌，流局时亲家<strong>没有听牌</strong>。下一局谁是亲家？`,
  options: ['还是原来那家', '亲家的下家（右边那家）', '亲家的上家（左边那家）', '重新抽签决定'],
  answer: 1,
  hint: '亲家只有在和牌或流局听牌时才能保住位置。',
  explain: '<p><strong>亲家的下家</strong>——亲家位置按行动顺序（逆时针）传给下一个人。</p><p>记忆方法：<strong>亲家「守住」位置靠和牌或听牌</strong>；两样都没有，位置就传下去，本场也归零。</p>',
})}

${exercise({
  q: `开局第一巡，四家打出的第一张牌都是 ${inlineHand([27])} 東。会发生什么？`,
  options: ['照常继续', '四风连打，流局', '四槓散了，流局', '九种九牌，流局'],
  answer: 1,
  hint: '看中途流局那张表。',
  explain: '<p><strong>四风连打</strong>，这一局立刻流局。条件就是开局第一巡四家打出的第一张牌是同一种风牌。</p><p>这是四种中途流局里最少见的一种——概率比你想象中还低。</p>',
})}

<h2>小结</h2>
<ul>
<li>座次：<strong>下家在右、上家在左、对家在对面</strong>，行动逆时针</li>
<li><strong>上家 = 你左边那家</strong>，<strong>只有他的牌你能吃</strong></li>
<li>配牌 13 张；循环是<strong>摸一张（14）→ 打一张（13）</strong></li>
<li>鸣牌优先级：<strong>和牌 &gt; 碰/杠 &gt; 吃</strong>；鸣牌后必须立刻打一张</li>
<li><strong>食替禁止</strong>：不能马上拆掉刚吃成的顺子</li>
<li>结束方式：和牌 / 荒牌流局 / 中途流局（九种九牌、四风连打、四家立直、四槓散了）</li>
<li>流局听牌罚符共 <strong>3000 点</strong>；亲家<strong>和牌或听牌才连庄</strong></li>
</ul>

<p>到这里「入门」部分就结束了：你认识了牌、认得了和牌形、知道了必须有役、也看懂了整局流程。</p>

<p>下一讲进入一个新手最容易被坑、也最少被讲清楚的概念：<strong>振听——为什么别人打了我能和的牌，却不让我和？</strong></p>
`;
}
