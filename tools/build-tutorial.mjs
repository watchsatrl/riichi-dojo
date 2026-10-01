#!/usr/bin/env node
/**
 * build-tutorial.mjs —— 把教程的 ES module 源码图内联成单个自包含 HTML。
 *
 * 为什么需要它：
 *   教程要交付为「双击就能打开的单文件 HTML」（无服务器、无构建依赖、无网络）。
 *   但源码必须拆成多个模块才好维护和测试。
 *   所以开发时写标准 ESM，构建时做一次迷你打包：拓扑排序 → 每个模块包一层 IIFE
 *   → import 变成从模块导出表解构 → 拼成一段脚本塞进 <style>/<script> 占位符。
 *
 * 为什么是「包一层 IIFE」而不是「扁平拼接」：
 *   引擎和 UI 会自然地出现同名函数（suitOf / rankOf / isHonor…）。
 *   扁平拼接会让后者静默覆盖前者，是最难查的一类 bug。
 *   作用域隔离后重名无害，同时换来一项有用的能力：构建期校验导入名是否存在。
 *
 * 约束（违反会直接构建失败，不会静默出错）：
 *   - 只支持相对路径导入；不支持裸模块名 / node: 内置模块
 *   - 不支持 export default
 *   - import / export 语句必须写成单行
 *   - export const/let/var 一行只声明一个变量
 *
 * 用法： node mahjong/tools/build-tutorial.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/**
 * 构建目标。教程和对局界面共用这一套管线 —— 它们都是「多个 ES module
 * 内联成一个自包含 HTML」，差别只在入口、样式和输出位置。
 */
const TARGETS = {
  tutorial: { src: 'tutorial/src', out: 'tutorial/index.html' },
  game: {
    src: 'play/src', out: 'play/index.html',
    // 课文样式是自动作用域化的（见 make-lesson-theme.mjs），必须排在游戏样式之前
    styles: ['play/src/lesson-theme.css', 'play/src/style.css'],
  },
};

const targetName = (process.argv[2] || 'tutorial').replace(/^--/, '');
const target = TARGETS[targetName];
if (!target) {
  throw new Error(`未知构建目标「${targetName}」，可选：${Object.keys(TARGETS).join(' / ')}`);
}

const ENTRY      = resolve(ROOT, target.src, 'app.js');
const SHELL      = resolve(ROOT, target.shell || `${target.src}/shell.html`);
const STYLE      = (target.styles || [target.style || `${target.src}/style.css`]).map((p) => resolve(ROOT, p));
const OUT_HTML   = resolve(ROOT, target.out);
const OUT_BUNDLE = resolve(ROOT, target.src, '../.build/bundle.js');

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

// ── 单行语法识别 ────────────────────────────────────────────────
const RE_IMPORT_NS   = /^\s*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const RE_IMPORT_FROM = /^\s*import\s+(.+?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const RE_IMPORT_BARE = /^\s*import\s+['"]([^'"]+)['"]\s*;?\s*$/;
const RE_REEXPORT    = /^\s*export\s*\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]\s*;?\s*$/;
const RE_EXPORT_LIST = /^\s*export\s*\{([^}]*)\}\s*;?\s*$/;
const RE_EXPORT_DECL = /^\s*export\s+(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/;
const RE_DECL_KIND   = /^\s*export\s+(const|let|var)\s/;

function parseNameList(inner) {
  return inner.split(',').map((s) => s.trim()).filter(Boolean).map((spec) => {
    const m = spec.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    return m ? { imported: m[1], exported: m[2] } : { imported: spec, exported: spec };
  });
}

const SINGLE_LINE_STMT = [RE_IMPORT_NS, RE_IMPORT_FROM, RE_IMPORT_BARE, RE_REEXPORT, RE_EXPORT_LIST, RE_EXPORT_DECL];

/**
 * 把跨行的 import / export 语句合并成单行，其余行原样保留。
 * 这样源码里可以自由地写：
 *     import {
 *       a, b,
 *     } from './x.js';
 * 而不必为了配合构建工具把导入挤成一行。
 */
function logicalLines(source) {
  const out = [];
  let buf = null;

  for (const line of source.split(/\r?\n/)) {
    if (buf !== null) {
      buf += ' ' + line.trim();
      if (/;\s*$/.test(line)) { out.push(buf); buf = null; }
      continue;
    }
    if (SINGLE_LINE_STMT.some((re) => re.test(line))) { out.push(line); continue; }
    if (/^\s*(?:import|export)\b/.test(line)) { buf = line.trim(); continue; }
    out.push(line);
  }

  if (buf !== null) throw new Error(`有 import/export 语句没有以分号结尾：${buf}`);
  return out;
}

// ── 解析单个模块 ────────────────────────────────────────────────
function parseModule(abs) {
  const source = readFileSync(abs, 'utf8');
  const imports = [];    // { spec, ns, bindings:[{imported,local}] }
  const exports = [];    // { local, exported }
  const reExports = [];  // { spec, names:[{imported,exported}] }
  const deps = [];
  const body = [];

  const resolveSpec = (spec) => {
    if (!spec.startsWith('.')) {
      throw new Error(`${rel(abs)}: 不支持非相对导入 "${spec}"（教程必须自包含）`);
    }
    return resolve(dirname(abs), spec);
  };

  for (const line of logicalLines(source)) {
    let m;

    if ((m = line.match(RE_IMPORT_NS))) {
      deps.push(resolveSpec(m[2]));
      imports.push({ spec: m[2], ns: m[1], bindings: [] });
      continue;
    }

    if ((m = line.match(RE_IMPORT_FROM))) {
      const clause = m[1].trim();
      const braceIdx = clause.indexOf('{');
      if (braceIdx === -1) {
        throw new Error(`${rel(abs)}: 不支持 default 导入 —— "${line.trim()}"`);
      }
      const prefix = clause.slice(0, braceIdx).replace(/,\s*$/, '').trim();
      const inner = clause.slice(braceIdx + 1, clause.lastIndexOf('}'));
      deps.push(resolveSpec(m[2]));
      // parseNameList 给的是 { 原名, 别名 }；导入这边「别名」就是模块内的本地名
      const bindings = parseNameList(inner).map((n) => ({ imported: n.imported, local: n.exported }));
      if (bindings.some((b) => !b.imported || !b.local)) {
        throw new Error(`${rel(abs)}: 解析导入名失败 —— "${line.trim()}"`);
      }
      imports.push({ spec: m[2], ns: prefix || null, bindings });
      continue;
    }

    if ((m = line.match(RE_IMPORT_BARE))) { deps.push(resolveSpec(m[1])); continue; }

    if ((m = line.match(RE_REEXPORT))) {
      deps.push(resolveSpec(m[2]));
      reExports.push({ spec: m[2], names: parseNameList(m[1]) });
      continue;
    }

    if ((m = line.match(RE_EXPORT_LIST))) {
      for (const n of parseNameList(m[1])) exports.push({ local: n.imported, exported: n.exported });
      continue;
    }

    if (/^\s*export\s+default\b/.test(line)) {
      throw new Error(`${rel(abs)}: 不支持 export default`);
    }

    if ((m = line.match(RE_EXPORT_DECL))) {
      if (RE_DECL_KIND.test(line)) {
        const eq = line.indexOf('=');
        if (eq !== -1 && line.slice(0, eq).includes(',')) {
          throw new Error(`${rel(abs)}: export const/let/var 请一行只声明一个变量 —— "${line.trim()}"`);
        }
      }
      exports.push({ local: m[1], exported: m[1] });
      body.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }

    if (/^\s*export\s+/.test(line)) throw new Error(`${rel(abs)}: 无法识别的 export —— "${line.trim()}"`);
    if (/^\s*import\s+/.test(line)) throw new Error(`${rel(abs)}: 无法识别的 import —— "${line.trim()}"（是否写成了多行？）`);

    body.push(line);
  }

  return { abs, imports, exports, reExports, deps, body };
}

// ── DFS 拓扑排序（依赖在前） ─────────────────────────────────────
const visited = new Set();
const modules = [];

function walk(abs) {
  if (visited.has(abs)) return;
  visited.add(abs);
  const mod = parseModule(abs);
  for (const d of mod.deps) walk(d);
  modules.push(mod);
}

walk(ENTRY);

const modId = new Map(modules.map((m, i) => [m.abs, `__mod_${i}`]));
const exportsOf = new Map(
  modules.map((m) => [m.abs, new Set([...m.exports.map((e) => e.exported), ...m.reExports.flatMap((r) => r.names.map((n) => n.exported))])]),
);

// ── 构建期校验：导入的名字必须真的被导出（抓拼写错误） ───────────
const problems = [];
for (const mod of modules) {
  for (const imp of mod.imports) {
    const target = resolve(dirname(mod.abs), imp.spec);
    const avail = exportsOf.get(target);
    if (!avail) { problems.push(`${rel(mod.abs)} → ${rel(target)} 未被纳入构建`); continue; }
    for (const b of imp.bindings) {
      if (!avail.has(b.imported)) {
        problems.push(`${rel(mod.abs)}: 从 ${rel(target)} 导入的 "${b.imported}" 并不存在`);
      }
    }
  }
  for (const re of mod.reExports) {
    const target = resolve(dirname(mod.abs), re.spec);
    const avail = exportsOf.get(target);
    if (!avail) { problems.push(`${rel(mod.abs)} → ${rel(re.spec)} 未被纳入构建`); continue; }
    for (const n of re.names) {
      if (!avail.has(n.imported)) {
        problems.push(`${rel(mod.abs)}: 从 ${rel(target)} 转出的 "${n.imported}" 并不存在`);
      }
    }
  }
}
if (problems.length) {
  throw new Error('导入校验失败：\n  - ' + problems.join('\n  - '));
}

// ── 逐模块生成作用域隔离的代码 ──────────────────────────────────
const chunks = [];
for (const mod of modules) {
  const id = modId.get(mod.abs);
  const lines = [`const ${id} = (function () {`];

  for (const imp of mod.imports) {
    const targetId = modId.get(resolve(dirname(mod.abs), imp.spec));
    if (imp.ns) lines.push(`  const ${imp.ns} = ${targetId};`);
    if (imp.bindings.length) {
      const pattern = imp.bindings
        .map((b) => (b.imported === b.local ? b.imported : `${b.imported}: ${b.local}`))
        .join(', ');
      lines.push(`  const { ${pattern} } = ${targetId};`);
    }
  }

  lines.push(...mod.body.map((l) => (l.length ? '  ' + l : l)));

  const ret = [];
  for (const e of mod.exports) ret.push(e.local === e.exported ? e.local : `${e.exported}: ${e.local}`);
  for (const re of mod.reExports) {
    const targetId = modId.get(resolve(dirname(mod.abs), re.spec));
    for (const n of re.names) ret.push(`${n.exported}: ${targetId}.${n.imported}`);
  }
  if (ret.length) lines.push(`  return { ${ret.join(', ')} };`);

  lines.push('})();', '');
  chunks.push(`/* ═══ ${rel(mod.abs)} ═══ */`, ...lines);
}

const bundle = ['(function () {', '  "use strict";', ...chunks.map((l) => (l.length ? '  ' + l : l)), '})();'].join('\n');

// ── 语法自检（构建失败要早、要响） ──────────────────────────────
// 先落盘再自检：万一失败，产物还在，能直接看是哪一行拼坏了。
mkdirSync(dirname(OUT_BUNDLE), { recursive: true });
writeFileSync(OUT_BUNDLE, bundle, 'utf8');

try {
  new vm.Script(bundle, { filename: 'bundle.js' });
} catch (e) {
  throw new Error(`拼接结果语法错误：${e.message}\n（失败的产物已写入 ${rel(OUT_BUNDLE)}，可直接查看）`);
}

// ── 组装 HTML ───────────────────────────────────────────────────
const shell = readFileSync(SHELL, 'utf8');
const css = STYLE.map((f) => readFileSync(f, 'utf8')).join('\n');

for (const token of ['/*__STYLE__*/', '//__SCRIPT__']) {
  if (!shell.includes(token)) throw new Error(`shell.html 缺少占位符 ${token}`);
}
if (css.includes('</style')) throw new Error('CSS 中出现了 </style，会截断样式块');
if (bundle.includes('</script')) throw new Error('JS 中出现了 </script，会截断脚本块');

const html = shell.replace('/*__STYLE__*/', () => css).replace('//__SCRIPT__', () => bundle);

mkdirSync(dirname(OUT_BUNDLE), { recursive: true });
writeFileSync(OUT_BUNDLE, bundle, 'utf8');
writeFileSync(OUT_HTML, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`✓ ${modules.length} 个模块，按依赖序内联，导入校验通过`);
for (const m of modules) console.log(`    ${rel(m.abs)}`);
console.log(`✓ JS  bundle ${kb(Buffer.byteLength(bundle))}（语法自检通过）`);
console.log(`✓ CSS        ${kb(Buffer.byteLength(css))}`);
console.log(`✓ 单文件     ${rel(OUT_HTML)}  ${kb(Buffer.byteLength(html))}`);
