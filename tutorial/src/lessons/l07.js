import { handHTML } from '../../../ui/tiles.js';
import { exercise } from '../ui-widgets.js';
import { YAKU_DEFS } from '../../../engine/yaku.js';
import { breakdown, inlineHand } from './_helpers.js';
/**
 * 第 7 讲 —— 役种图鉴
 *
 * 一个刻意的设计决定：本讲的役种表**直接从引擎的 YAKU_DEFS 生成**，
 * 而不是在教程里另抄一份。原因是役种的门清/副露条件和番数最容易出现
 * 「教程写 3 番、引擎算 2 番」这种漂移，而读者会照教程去实战。
 * 生成式保证了单一事实来源。
 */


/** 门清/副露条件 → 中文标签 */
function availability(y) {
  if (y.closedOnly) return '<span class="tag tag-closed">门清限定</span>';
  if (y.hanOpen !== undefined) return `<span class="tag tag-down">副露降为 ${y.hanOpen} 番</span>`;
  return '<span class="tag tag-free">副露不影响</span>';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** 从引擎定义生成一张役种表 */
function yakuTable(filter, opts = {}) {
  const rows = Object.entries(YAKU_DEFS)
    .filter(([, y]) => filter(y))
    .map(([, y]) => {
      const han = y.yakuman
        ? (y.multiplier > 1 ? `${y.multiplier} 倍役满` : '役满')
        : `${y.han} 番`;
      return `<tr>
  <td><strong>${esc(y.name)}</strong><br><span class="ja">${esc(y.ja)}</span></td>
  <td class="han">${han}</td>
  ${opts.noAvailability ? '' : `<td>${availability(y)}</td>`}
  <td>${y.note ? esc(y.note) : '—'}</td>
</tr>`;
    })
    .join('');
  return `<table class="yaku-table">
<thead><tr><th>役名</th><th class="han">番数</th>${opts.noAvailability ? '' : '<th>副露后</th>'}<th>成立条件 / 备注</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

export function lesson07() {
  return `
<div class="lesson-head">
  <div class="kicker">第 7 讲</div>
  <h1>役种图鉴</h1>
  <p class="lede">日麻一共有 40 多种役。但你不必背完——这一讲教你怎么「查」，以及先记住哪几个。</p>
</div>

<h2>一、先建立一个分类直觉</h2>

<p>役看起来五花八门，其实只有四个来源。认出来源，就记住了大半：</p>

<table>
<thead><tr><th>来源</th><th>特点</th><th>例子</th></tr></thead>
<tbody>
<tr>
  <td><strong>① 状况型</strong></td>
  <td>和你的<strong>行为</strong>有关，与牌型无关。最容易拿。</td>
  <td>立直、门前清自摸和、一发、海底摸月、抢槓</td>
</tr>
<tr>
  <td><strong>② 牌型型</strong></td>
  <td>看你的<strong>牌长什么样</strong>。决定了这手牌「做什么方向」。</td>
  <td>断幺九、对对和、清一色、一气通贯、七对子</td>
</tr>
<tr>
  <td><strong>③ 役牌型</strong></td>
  <td>特定的<strong>刻子</strong>白送。最容易上手。</td>
  <td>役牌（白發中 / 场风 / 自风）</td>
</tr>
<tr>
  <td><strong>④ 稀有型</strong></td>
  <td>难度极高，分数极高。</td>
  <td>国士无双、四暗刻、九莲宝灯</td>
</tr>
</tbody>
</table>

<div class="tip">
<p><strong>实战时你其实只做一件事：在①②③里挑一个方向。</strong></p>
<p style="margin-bottom:0">牌型型决定了你的「主线」（比如「这手牌走断幺九」），状况型是顺手白拿的（立直、门清自摸），役牌型是看到就抓的机会。稀有型不用主动追——它们是运气。</p>
</div>

<h2>二、一番役（最常用，先记这些）</h2>

${yakuTable((y) => !y.yakuman && y.han === 1)}

<div class="note">
<p><strong>新手优先掌握这 6 个：立直、门前清自摸和、平和、断幺九、役牌、一杯口。</strong></p>
<p style="margin-bottom:0">它们覆盖了新手期绝大多数和牌。其余的（一发、抢槓、岭上、海底、河底）都是「碰上了就赚到」，不需要主动规划。</p>
</div>

<h2>三、二番役</h2>

${yakuTable((y) => !y.yakuman && y.han === 2)}

<div class="warn">
<p><strong>注意「副露降为 1 番」那一列。</strong>三色同顺、一气通贯、混全带幺九这三个，门清时是 2 番，一旦吃碰就掉到 1 番。</p>
<p style="margin-bottom:0">这就是第 2 讲说的「副露有代价」的具体体现——不只是毁掉立直和平和，有些役本身也会缩水。</p>
</div>

<h2>四、三番与六番</h2>

${yakuTable((y) => !y.yakuman && (y.han === 3 || y.han === 6))}

<p><strong>清一色（6 番）是新手最该认识的「大牌」。</strong>门清 6 番、副露 5 番，做完直接是跳满或满贯级别。而且它的做法非常直观：<strong>整手牌只有一种花色</strong>。</p>

${handHTML([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 13], { size: 'lg' })}

${breakdown(
  [[0, 1, 2], [3, 4, 5], [6, 7, 8], [10, 11, 12], [13, 13]],
  ['顺子 123m', '顺子 456m', '顺子 789m', '顺子 234m', '雀头 5m'],
)}

<p>全是萬子，一共 6 番。代价是做起来慢，而且缺什么牌一眼就被别人看穿。</p>

<h2>五、役满</h2>

<p>役满不看番数，直接按<strong>固定满额</strong>结算（子家 32000 / 亲家 48000）。双倍役满翻倍。</p>

${yakuTable((y) => y.yakuman, { noAvailability: true })}

<div class="warn">
<p><strong>役满不复合普通役。</strong>也就是说，役满手牌里的断幺九、立直、宝牌统统不计——它们被役满「吸收」了。</p>
<p style="margin-bottom:0">但<strong>多个役满之间可以复合</strong>。比如「大四喜 + 字一色」是两个役满，点数翻倍。</p>
</div>

<h2>六、最容易搞错的五条复合规则</h2>

<p>役种单独看都好懂，难的是<strong>两个役碰在一起时算哪个</strong>。这五条是新手最容易栽的：</p>

<h3>① 一杯口 与 二杯口 —— 只算二杯口</h3>

<p>二杯口成立时，一杯口<strong>不重复计</strong>。所以是 3 番，不是 1 + 3 = 4 番。</p>

<h3>② 二杯口 与 七对子 —— 二选一，取高的</h3>

<p>有些牌型两个都成立。这时按<strong>高点法</strong>取番数高的那个：二杯口 3 番 &gt; 七对子 2 番，所以算二杯口。</p>

<h3>③ 平和 与 役牌雀头 —— 互斥</h3>

<p>平和要求雀头<strong>不是役牌</strong>。所以如果雀头是白、發、中、场风或自风，平和直接不成立（连风牌雀头当然也不行）。</p>

<h3>④ 荣和补成的刻子 = 明刻</h3>

<p>第 5 讲讲过，这里再强调一次它对役种的影响：<strong>双碰荣和不成四暗刻</strong>。因为荣和补上的那个刻子被算作明刻，你手里就只剩三个暗刻了。</p>

<p>解决办法是<strong>自摸</strong>——自摸补成的刻子算暗刻，四暗刻就成立了。</p>

<h3>⑤ 宝牌不计入起和番</h3>

<p>第 2 讲强调过，但在图鉴这一讲要说得更准确：<strong>宝牌会计入总番数（影响点数），但不计入「有没有役」的判定。</strong></p>

<table>
<thead><tr><th></th><th>计入总番数</th><th>能构成起和条件</th></tr></thead>
<tbody>
<tr><td>役</td><td>✅</td><td>✅</td></tr>
<tr><td>宝牌 / 赤宝牌 / 里宝牌</td><td>✅</td><td>❌</td></tr>
</tbody>
</table>

<h2>七、练习</h2>

${exercise({
  q: `「清一色」门清时是几番？`,
  options: ['2 番', '3 番', '5 番', '6 番'],
  answer: 3,
  hint: '查上面「三番与六番」那张表。',
  explain: '<p><strong>6 番</strong>，副露后降为 5 番。</p><p>6 番已经超过满贯线（5 番），所以门清清一色直接按<strong>跳满</strong>结算——子家荣和 12000 点。</p>',
})}

${exercise({
  q: `你的手牌同时成立「一杯口」和「二杯口」。总番数是多少？`,
  options: ['1 番', '3 番', '4 番', '7 番'],
  answer: 1,
  hint: '两个役会相加吗？',
  explain: '<p><strong>3 番。</strong>二杯口成立时<strong>一杯口不重复计</strong>——不是 1 + 3 = 4 番。</p><p>这类「上位役吸收下位役」的关系在日麻里很常见，二杯口/一杯口是最典型的一对。</p>',
})}

${exercise({
  q: `这手牌成立「清一色」。如果有人吃碰过，它变成几番？${handHTML([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 13], { size: 'md' })}`,
  options: ['还是 6 番', '降为 5 番', '降为 3 番', '直接不成立'],
  answer: 1,
  hint: '看清一色在表里的「副露后」那一列。',
  explain: '<p><strong>降为 5 番。</strong>清一色是「食下役」——副露后减一番，但<strong>依然成立</strong>。</p><p>对比一下：平和、一杯口、二杯口是<strong>门清限定</strong>，副露后直接不成立。这两种「副露惩罚」程度不同，别混为一谈。</p>',
})}

${exercise({
  q: `你以「双碰」的形式荣和，手里有三个暗刻，荣和补上了第四个刻子。这算<strong>四暗刻</strong>吗？`,
  options: ['算，四个刻子都是暗的', '不算，荣和补成的刻子算明刻'],
  answer: 1,
  hint: '荣和得来的那张牌，凑成的刻子算明还是算暗？',
  explain: '<p><strong>不算。</strong>荣和补成的刻子算<strong>明刻</strong>，所以你只有三个暗刻，最多算三暗刻（2 番）。</p><p>但如果你是<strong>自摸</strong>补上第四张，那就算暗刻，<strong>四暗刻成立</strong>（役满）。同一手牌，荣和和自摸差了一个役满——这就是日麻里「自摸」价值高的一个极端例子。</p>',
})}

${exercise({
  q: `一手牌同时成立「大三元」和「断幺九」。总番数怎么算？`,
  options: ['役满 + 1 番', '只算大三元役满', '役满翻倍', '断幺九会取消大三元'],
  answer: 1,
  hint: '看上面役满那一节的警告框。',
  explain: '<p><strong>只算大三元的役满。</strong>役满会<strong>吸收</strong>同一手牌里的普通役——断幺九、立直、宝牌统统不再另计。</p><p>但<strong>多个役满之间可以复合</strong>。如果同时是「大三元 + 字一色」，那是两个役满，点数翻倍。</p>',
})}

<h2>小结</h2>
<ul>
<li>役只有四个来源：<strong>状况型 / 牌型型 / 役牌型 / 稀有型</strong></li>
<li>新手先记 6 个：<strong>立直、门清自摸、平和、断幺九、役牌、一杯口</strong></li>
<li><strong>副露惩罚分两档</strong>：门清限定（直接没了） vs 食下（降番）</li>
<li><strong>上位役吸收下位役</strong>：二杯口吸收一杯口</li>
<li><strong>役满吸收普通役，但役满之间可复合</strong></li>
<li>宝牌<strong>计入总番数，但不构成起和条件</strong></li>
<li>查表比背表有用——这一讲就是给你查的</li>
</ul>

<p>到这里，「牌该怎么算」你已经全部知道了。接下来的三讲换个方向：<strong>牌该怎么打。</strong></p>
`;
}
