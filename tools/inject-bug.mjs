/**
 * inject-bug.mjs —— 反向验证：往源码里注入一个已知的 bug，确认对应的测试真的会报警。
 *
 * 为什么需要它：
 *   写完一个校验，最容易犯的错是**以为测过了**。这件事已经栽过两次 ——
 *   一次在 PowerShell 里拼正则转义失败，补丁根本没生效，两次跑都是「通过」，
 *   看起来像验证过了，其实什么都没验证。
 *
 * 所以注入必须走脚本文件（避开 shell 转义），而且脚本必须**确认替换真的发生了**：
 * 找不到锚点就报错退出，绝不静默地什么都不做。
 *
 * 用法：
 *   node mahjong/tools/inject-bug.mjs --list
 *   node mahjong/tools/inject-bug.mjs <名字>
 *   node mahjong/tools/inject-bug.mjs --restore
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, '..');
const BACKUP_DIR = resolve(ROOT, '.recover');

/**
 * 重建产物。
 *
 * **这一步不能省。** `play-dom.test.mjs` 读的是构建好的 `play/index.html`，
 * 不是源码 —— 只改 `play/src/*.js` 而不重建，测试跑的仍然是旧代码，
 * 注入「成功」了但测不出任何东西，看起来像测试没用。
 * 这件事真的发生过一次：leaktimer 注入后两次跑都是绿的。
 */
function rebuild(target) {
  if (!target) return;
  const r = spawnSync(process.execPath, [resolve(ROOT, 'tools/build-tutorial.mjs'), target], {
    cwd: ROOT, stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.error(`重建 ${target} 失败 —— 测试跑的是旧产物，这次验证无效`);
    process.exit(1);
  }
}

/**
 * 每个注入项：找到 file 里的 find，换成 replace，然后用 test 验证会被抓住。
 */
const MUTATIONS = {
  figure: {
    file: 'tutorial/src/lessons/l01.js',
    test: 'tests/levels.test.mjs',
    // 整段替换，保证注入后的文件仍然是合法 JS ——
    // 第一版只换了 `handWithMelds(` 这个开头，剩下的参数把括号配平搞坏了，
    // 结果是测试根本跑不起来，「失败数」为空而不是报错，看起来像通过。
    find: '${handWithMelds(\n'
        + '    [[27, 27, 27], [12, 13, 14], [26, 26, 26]],\n'
        + '    [0, 1, 2, 22, 22],\n'
        + "    { size: 'lg' },\n"
        + '  )}`',
    replace: "${handHTML([27, 27, 27, 12, 13, 14, 26, 26, 26, 0, 1, 2, 22, 22], { size: 'lg' })}`",
    note: '把副露题的图改回「一排平铺 14 张」',
    expect: '图文不符',
  },
  loud: {
    file: 'ui/audio.js',
    test: 'tests/audio-ui.test.mjs',
    find: 'gain: 0.5 * j.g * w',
    replace: 'gain: 2.4 * j.g * w',
    note: '把打牌声的包络放大到 2.4（原 0.5）',
    expect: '削波',
  },
  nag: {
    file: 'play/src/hint.js',
    test: 'tests/hint.test.mjs',
    find: 'best.shanten <= 2 && meldCount && !settled.length',
    replace: 'best.shanten <= 2 && meldCount',
    note: '提示的「没役」警告去掉「手里已有确定的役」这个检查',
    expect: '手里明明有役牌白',
  },
  orphan: {
    file: 'play/src/hint.js',
    test: 'tests/hint.test.mjs',
    find: 'if (![-2, -1, 1, 2].some((d) => has(r + d)))',
    replace: 'if (![-2, -1, 1, 2].some(has))',
    note: 'describeTile 的邻居判断：把偏移量当成点数传进去',
    expect: '应当算搭子',
  },
  pondback: {
    file: 'play/src/table.js',
    test: 'tests/play-ui.test.mjs',
    find: "  ${zone(0, 'bottom')}\n",
    replace: '',
    note: '把自己那家的牌河从桌子中央拿掉（退回各扫门前雪的老版面）',
    expect: '缺少 .pz-bottom',
  },
  leaktimer: {
    file: 'play/src/app.js',
    test: 'tests/play-dom.test.mjs',
    // ★ 这个测试读的是构建产物，不是源码 —— 必须重建，否则注入无效
    build: 'game',
    find: 'function quitGame() {\n  clearTimeout(timer);\n  timer = null;',
    replace: 'function quitGame() {',
    note: '退出对局时不清计时器',
    expect: '待触发的计时器没清掉',
  },
  offbeat: {
    file: 'ui/chiptune.js',
    test: 'tests/chiptune.test.mjs',
    find: "melody: [[1, 'a4', 3]] },",
    replace: "melody: [[2, 'a4', 3]] },",
    note: '把一个小节的旋律往后挪一拍，让它溢出小节',
    expect: '会盖到下一小节',
  },
};

const argv = process.argv.slice(2);

if (argv.includes('--list') || argv.length === 0) {
  console.log('可注入的 bug：\n');
  for (const [name, m] of Object.entries(MUTATIONS)) {
    console.log(`  ${name.padEnd(9)} ${m.note}`);
    console.log(`  ${' '.repeat(9)} 跑 ${m.test}，预期报出「${m.expect}」\n`);
  }
  console.log('还原：node mahjong/tools/inject-bug.mjs --restore');
  process.exit(0);
}

const backupPath = (name) => resolve(BACKUP_DIR, `inject-${name}.orig`);

if (argv.includes('--restore')) {
  let n = 0;
  let needsBuild = new Set();
  for (const name of Object.keys(MUTATIONS)) {
    const b = backupPath(name);
    if (!existsSync(b)) continue;
    writeFileSync(resolve(ROOT, MUTATIONS[name].file), readFileSync(b, 'utf8'), 'utf8');
    unlinkSync(b);
    if (MUTATIONS[name].build) needsBuild.add(MUTATIONS[name].build);
    n++;
    console.log(`已还原 ${MUTATIONS[name].file}`);
  }
  if (!n) console.log('没有待还原的注入');
  for (const t of needsBuild) rebuild(t);          // 产物也要还原，否则下次跑的是坏代码
  process.exit(0);
}

const name = argv[0];
const m = MUTATIONS[name];
if (!m) {
  console.error(`未知的注入项「${name}」，用 --list 看可选项`);
  process.exit(1);
}

const target = resolve(ROOT, m.file);
const src = readFileSync(target, 'utf8');

// 关键：找不到锚点必须报错退出，绝不静默地什么都不做
if (!src.includes(m.find)) {
  console.error(`在 ${m.file} 里找不到锚点：\n  ${m.find}\n`);
  console.error('源码可能改过 —— 请同步更新本脚本，否则「验证」是假的。');
  process.exit(1);
}

mkdirSync(BACKUP_DIR, { recursive: true });
writeFileSync(backupPath(name), src, 'utf8');

const after = src.replace(m.find, m.replace);
if (after === src) {
  console.error('替换没有产生任何变化，注入失败');
  process.exit(1);
}

// 注入后的文件必须仍然是合法 JS。
// 少了这一步，一个把括号搞坏的注入会让测试**根本跑不起来** ——
// 输出是空的而不是报错，看起来很像「通过」。
try {
  new (await import('node:vm')).SourceTextModule(after);   // 需要 --experimental-vm-modules
} catch (err) {
  if (err instanceof SyntaxError) {
    console.error(`注入后语法错误：${err.message}`);
    console.error('这次注入是无效的 —— 测试根本没机会报警。');
    process.exit(1);
  }
  // SourceTextModule 不可用（没开 flag）时退化成纯括号配平检查
  const bal = (str, open, close) =>
    [...str].reduce((n, c) => n + (c === open ? 1 : c === close ? -1 : 0), 0);
  for (const [o, c] of [['(', ')'], ['{', '}'], ['[', ']']]) {
    if (bal(after, o, c) !== 0) {
      console.error(`注入后 ${o}${c} 配平被破坏（差 ${bal(after, o, c)}）—— 测试将无法运行`);
      process.exit(1);
    }
  }
}

writeFileSync(target, after, 'utf8');

console.log(`已注入 ${name}：${m.note}`);
if (m.build) {
  console.log(`这个测试读的是构建产物，正在重建 ${m.build} …`);
  rebuild(m.build);
}
console.log(`验证：D:\\srt\\NMP\\node.exe ${m.test.replace(/\//g, '\\')}`);
console.log(`预期报出：「${m.expect}」`);
console.log('还原：node mahjong/tools/inject-bug.mjs --restore');
