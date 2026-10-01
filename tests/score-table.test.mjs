/**
 * 点数速查表校验
 * =====================================================================
 * 为什么单独测这个：
 *   教程第 6 讲里那张速查表是手敲的，一共 100 个数字。只要有一个敲错，
 *   读者就会照着错数去实战——而点数恰恰是最容易被当真、也最容易被记住的东西。
 *
 * 做法：从公式独立算一遍全部格子，再把第 6 讲渲染出的 HTML 里的数字抓回来，
 *       逐个比对。两边不一致就报错。
 *
 * 公式：基本点 = 符 × 2^(2+番)
 *   子家荣和 = 基本点 × 4，亲家荣和 = 基本点 × 6
 *   子家自摸 = 子 基本点×1 / 亲 基本点×2（各自进位到 100）
 *   亲家自摸 = 三家各 基本点×2（进位到 100）
 *   基本点超过 2000 封顶为满贯（2000）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { lesson06 } from '../tutorial/src/lessons/l06.js';

const ceil100 = (n) => Math.ceil(n / 100) * 100;

function expected(fu, han) {
  const raw = fu * 2 ** (2 + han);
  const basic = raw > 2000 ? 2000 : raw;          // 满贯封顶
  const capped = raw > 2000;
  return {
    ronChild: ceil100(basic * 4),
    tsumoChild: ceil100(basic),
    tsumoDealer: ceil100(basic * 2),
    ronDealer: ceil100(basic * 6),
    tsumoDealerAll: ceil100(basic * 2),
    capped,
  };
}

const fmt = (n) => String(n);

test('第 6 讲点数速查表：每一格都与公式一致', () => {
  const html = lesson06();
  const rows = [...html.matchAll(
    /<tr><td><strong>(\d+)符 (\d+)番<\/strong><\/td><td class="num">([^<]*)<\/td><td class="num">([^<]*)<\/td><td class="num">([^<]*)<\/td><td class="num">([^<]*)<\/td><\/tr>/g,
  )];

  assert.ok(rows.length >= 20, `只匹配到 ${rows.length} 行，正则或表格结构变了`);

  const problems = [];
  const seen = new Set();

  for (const m of rows) {
    const fu = Number(m[1]);
    const han = Number(m[2]);
    const [, , , ron, tsumo, dRon, dTsumo] = m;
    seen.add(`${fu}/${han}`);

    const e = expected(fu, han);

    // 子家荣和
    const wantRon = e.capped ? '8000' : fmt(e.ronChild);
    if (ron.trim() !== wantRon) {
      problems.push(`${fu}符${han}番 子家荣和：文档写「${ron.trim()}」，公式算出「${wantRon}」`);
    }

    // 子家自摸：两个数各自判断是否满贯
    if (e.capped) {
      if (tsumo.trim() !== '2000 / 4000') {
        problems.push(`${fu}符${han}番 子家自摸（满贯）：文档写「${tsumo.trim()}」，应为「2000 / 4000」`);
      }
    } else {
      const wantTsumo = `${e.tsumoChild} / ${e.tsumoDealer}`;
      if (tsumo.trim() !== wantTsumo) {
        problems.push(`${fu}符${han}番 子家自摸：文档写「${tsumo.trim()}」，公式算出「${wantTsumo}」`);
      }
    }

    // 亲家荣和
    const wantDRon = e.capped ? '12000' : fmt(e.ronDealer);
    if (dRon.trim() !== wantDRon) {
      problems.push(`${fu}符${han}番 亲家荣和：文档写「${dRon.trim()}」，公式算出「${wantDRon}」`);
    }

    // 亲家自摸
    const wantDTsumo = `${e.capped ? 4000 : e.tsumoDealerAll} 全`;
    if (dTsumo.trim() !== wantDTsumo) {
      problems.push(`${fu}符${han}番 亲家自摸：文档写「${dTsumo.trim()}」，公式算出「${wantDTsumo}」`);
    }
  }

  assert.deepEqual(problems, [], `速查表有 ${problems.length} 处数字错误：\n  - ` + problems.join('\n  - '));
});
