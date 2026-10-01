/**
 * tests/run-all.mjs —— 顺序跑完所有测试文件
 *
 * 为什么不用 `node --test tests/`：
 *   标准做法就是那个，`npm test` 用的也是它，**普通机器上完全没问题**。
 *   但在受限环境里（子进程管道被禁用），`node --test` 拿不到子进程的输出会直接失败。
 *   这个脚本改成逐个文件执行、输出直接继承 —— 同样的用例，绕开管道。
 *
 * 用法：
 *   node tests/run-all.mjs
 *   或  npm run test:files
 */

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = import.meta.dirname;
const ROOT = resolve(DIR, '..');

const files = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs')).sort();
if (!files.length) {
  console.error('tests/ 里没有找到 *.test.mjs');
  process.exit(1);
}

const failed = [];
const t0 = Date.now();

for (const f of files) {
  const line = `── ${f} `;
  console.log(`\n${line}${'─'.repeat(Math.max(0, 58 - line.length))}`);
  const r = spawnSync(process.execPath, [resolve(DIR, f)], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) failed.push(f);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${'═'.repeat(60)}`);
if (failed.length) {
  console.log(`✗ ${files.length - failed.length} / ${files.length} 个文件通过，${secs}s`);
  console.log('失败的文件：');
  for (const f of failed) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 全部 ${files.length} 个测试文件通过，${secs}s`);
