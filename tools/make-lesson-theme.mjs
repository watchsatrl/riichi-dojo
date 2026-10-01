#!/usr/bin/env node
/**
 * make-lesson-theme.mjs —— 把教程的样式表自动改写成「只作用于 .lesson-body」的版本
 *
 * 为什么要有这一步：
 *   关卡里的「讲解」段落直接复用教程的课文 HTML。如果把教程的 style.css 原样
 *   塞进游戏，两边会打架 —— 教程是浅色纸面（--ink 是深色字），游戏是深绿呢面
 *   （--ink 是浅色字），变量同名不同义，后加载的把前面整个覆盖掉。
 *
 *   手抄一份深色版也不行：两套样式会各自演化，迟早长得不一样。
 *
 *   所以机械改写：`:root` 的变量搬进 `.lesson-body` 作用域，全局选择器丢掉，
 *   其余选择器统一加 `.lesson-body ` 前缀。改完讲解段落是一个自带浅色主题的
 *   独立区块，放进深色界面里反而像是刻意的「手册页」。
 *
 * 用法：node mahjong/tools/make-lesson-theme.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = resolve(ROOT, 'tutorial/src/style.css');
const OUT = resolve(ROOT, 'play/src/lesson-theme.css');

/** 这些选择器是「页面级」的，作用域化之后没有意义，直接丢 */
const DROP = [/^\*$/, /^html\b/, /^body$/, /^html,\s*body$/];

/** 把一组逗号分隔的选择器加上作用域前缀 */
function scope(selectorText, prefix) {
  return selectorText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === ':root' ? prefix : `${prefix} ${s}`))
    .join(', ');
}

/**
 * 极简 CSS 分块器。只处理本仓库手写的样式表：
 * 顶层规则 + @media 两种形态，够用且不会误伤。
 */
function transform(css, prefix, depth = 0) {
  const out = [];
  let i = 0;

  while (i < css.length) {
    // 跳过空白与注释
    const rest = css.slice(i);
    const ws = rest.match(/^(\s+|\/\*[\s\S]*?\*\/)+/);
    if (ws) { i += ws[0].length; continue; }

    const brace = css.indexOf('{', i);
    if (brace === -1) break;
    const head = css.slice(i, brace).trim();

    // 找到配对的右花括号
    let depthCount = 1;
    let j = brace + 1;
    while (j < css.length && depthCount > 0) {
      if (css[j] === '{') depthCount++;
      else if (css[j] === '}') depthCount--;
      j++;
    }
    const bodyText = css.slice(brace + 1, j - 1);

    if (head.startsWith('@media') || head.startsWith('@supports')) {
      const inner = transform(bodyText, prefix, depth + 1);
      if (inner.trim()) out.push(`${head} {\n${inner}\n}`);
    } else if (head.startsWith('@')) {
      out.push(`${head} {${bodyText}}`);        // @keyframes 之类原样保留
    } else {
      const dropped = DROP.some((re) => re.test(head));
      if (!dropped) {
        out.push(`${scope(head, prefix)} {${bodyText}}`);
      } else if (/^body$|^html,\s*body$/.test(head)) {
        // body 上的排版属性（字号、行高、字体）挪到作用域容器上
        const keep = bodyText
          .split(';')
          .map((d) => d.trim())
          .filter((d) => d && !/^(margin|padding|background|overflow|height)\b/.test(d))
          .join('; ');
        if (keep) out.push(`${prefix} {${keep}}`);
      }
    }
    i = j;
  }
  return out.join('\n');
}

const src = readFileSync(SRC, 'utf8');
const body = transform(src, '.lesson-body');

const header = `/* ═══════════════════════════════════════════════════════════════
   自动生成，请勿手改 —— 改 tutorial/src/style.css 后重新运行：
     node mahjong/tools/make-lesson-theme.mjs
   作用：把教程样式整体限定在 .lesson-body 作用域内，
        避免和游戏的深色主题互相覆盖。
   ═══════════════════════════════════════════════════════════════ */

`;

writeFileSync(OUT, header + body + '\n', 'utf8');

console.log(`✓ ${relative(ROOT, SRC)} → ${relative(ROOT, OUT)}`);
console.log(`  ${src.split('\n').length} 行 → ${(header + body).split('\n').length} 行，作用域 .lesson-body`);
