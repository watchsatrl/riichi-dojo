/**
 * 教程内容校验
 * =====================================================================
 * 为什么需要这个测试：
 *   教程里的每一手牌都是手写的牌索引。`[7,8,9]` 想表达「八萬九萬一萬」，
 *   实际却是「八萬九萬一筒」—— 这种错误肉眼极难发现，但会直接把规则教错。
 *   所以这里不测代码，测**内容**：把每一讲渲染成 HTML，再从 HTML 里
 *   把牌反解回来，验证它是否真的符合自己声称的标签。
 *
 * 检查项：
 *   1. 标「顺子 / 吃」的三张，必须同花色且数字连续
 *   2. 标「刻子 / 碰」的三张，必须完全相同
 *   3. 标「雀头 / 对子」的两张，必须完全相同
 *   4. 一个 hand 容器里，同一种牌不得超过 4 张
 *   5. 正文里不得出现孤立的花括号（模板字面量多写一个 `}` 会原样渲染出来）
 *
 * 每一条都做过反向验证：故意注入错误，确认它真的会报警。
 * 空测试比没有测试更危险。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tileName, suitOf, rankOf, baseIdx } from '../ui/tiles.js';
import { LESSONS } from '../tutorial/src/lessons/index.js';

// aria-label（中文牌名）→ 牌索引
const NAME_TO_INDEX = new Map();
for (let i = 0; i < 37; i++) NAME_TO_INDEX.set(tileName(i), i);

const FIG_RE = /<figure>([\s\S]*?)<figcaption>([\s\S]*?)<\/figcaption><\/figure>/g;
const HAND_RE = /<span class="hand[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
const TILE_RE = /aria-label="([^"]+)"/g;

function tilesIn(fragment) {
  const out = [];
  for (const m of fragment.matchAll(TILE_RE)) {
    const idx = NAME_TO_INDEX.get(m[1]);
    assert.notEqual(idx, undefined, `出现了无法识别的牌名「${m[1]}」，说明 aria-label 与 tileName 不同步`);
    out.push(baseIdx(idx));
  }
  return out;
}

function isRun(ts) {
  if (ts.length !== 3) return false;
  const [a, b, c] = ts;
  if (suitOf(a) !== suitOf(b) || suitOf(b) !== suitOf(c)) return false;
  if (suitOf(a) === 3) return false;                       // 字牌不能组顺子
  return rankOf(b) === rankOf(a) + 1 && rankOf(c) === rankOf(a) + 2;
}

const isTriplet = (ts) => ts.length === 3 && ts[0] === ts[1] && ts[1] === ts[2];
const isPair = (ts) => ts.length === 2 && ts[0] === ts[1];

const PROBLEMS = [];

for (const les of LESSONS) {
  if (les.todo || typeof les.render !== 'function') continue;
  const html = les.render();

  // ── 1–3：拆解图里的标签必须与牌相符 ──────────────────────────
  for (const m of html.matchAll(FIG_RE)) {
    const tiles = tilesIn(m[1]);
    const label = m[2].replace(/<[^>]*>/g, '').trim();

    if (/顺子|吃/.test(label)) {
      if (!isRun(tiles)) {
        PROBLEMS.push(`[${les.id}] 标签「${label}」声称是顺子，但牌是 ${tiles.map(tileName).join(' ')}`);
      }
    } else if (/刻子|碰/.test(label)) {
      if (!isTriplet(tiles)) {
        PROBLEMS.push(`[${les.id}] 标签「${label}」声称是刻子，但牌是 ${tiles.map(tileName).join(' ')}`);
      }
    } else if (/雀头|对子/.test(label)) {
      if (!isPair(tiles)) {
        PROBLEMS.push(`[${les.id}] 标签「${label}」声称是雀头，但牌是 ${tiles.map(tileName).join(' ')}`);
      }
    }
  }

  // ── 4：单个 hand 容器内，同一种牌不得超过 4 张 ────────────────
  for (const m of html.matchAll(HAND_RE)) {
    const tiles = tilesIn(m[1]);
    const count = new Map();
    for (const t of tiles) count.set(t, (count.get(t) || 0) + 1);
    for (const [t, n] of count) {
      if (n > 4) {
        PROBLEMS.push(`[${les.id}] 一手牌里出现了 ${n} 张 ${tileName(t)}（一副牌只有 4 张）`);
      }
    }
  }

  // ── 5：模板字面量多写一个花括号，会原样渲染成可见的「}」 ──────
  // 源码里 `})}` 和 `})}}` 只差一个字符，肉眼几乎看不出来，
  // 但页面上会明晃晃挂着一个孤立的右花括号。这一条就是抓它。
  for (const frag of html.replace(/<[^>]*>/g, '\u0000').split('\u0000')) {
    const t = frag.trim();
    if (t === '}' || t === '}}' || t === ')}' || t === ')') {
      PROBLEMS.push(`[${les.id}] 正文里出现孤立的「${t}」，多半是模板字面量多写了大括号`);
    }
  }
}

test('教程内容：所有牌的标签与牌面一致', () => {
  assert.deepEqual(PROBLEMS, [], `发现 ${PROBLEMS.length} 处内容错误：\n  - ` + PROBLEMS.join('\n  - '));
});
