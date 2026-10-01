/**
 * 点数表自检脚本（验证要求 #1）
 * =====================================================================
 * 用 engine/score.js 的 calcScore 遍历
 *   番 1–13 × 符 20/25/30/40/50/60/70/80/90/100/110 × 子/亲 × 荣和/自摸
 * 输出完整点数表，并与 research/yaku-fu-score.md 的「完整点数速查表」**逐格比对**。
 *
 * 额外做三组自洽性检查（与本文件里的表无关，纯公式层面）：
 *   1. 子家自摸三家合计 ≥ 子家荣和（零头进位导致，差值 < 300）；
 *   2. 亲家自摸三家合计 ≥ 亲家荣和；
 *   3. 满贯界限：基本点 > 2000 一律封顶 2000；切上满贯只影响 (30符,4番) 与 (60符,3番)。
 *
 * 运行：node tools/check-score-table.mjs
 * 退出码 0 = 全部一致。
 */

import { readFileSync } from 'node:fs';
import { calcScore, resolveLimit } from '../engine/score.js';
import { makeRules, KIRIAGE_MANGAN } from '../engine/rules.js';

const MD = new URL('../research/yaku-fu-score.md', import.meta.url);
const FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];
const HAN_LIST = Array.from({ length: 13 }, (_, i) => i + 1);

/** 文档「5 番及以上」表里的满贯自摸值（子 2000/4000、亲 4000 all） */
const MANGAN_TSUMO_KO = [2000, 4000];
const MANGAN_TSUMO_OYA = 4000;

/**
 * 该 (符, 番) 组合是否可能以荣和出现。
 * 依据文档 §3.6 的「—」说明：20 符荣和不存在（平和荣和 = 30 符）；25 符至少 2 番。
 *
 * @param {number} fu 符数
 * @param {number} han 番数
 * @returns {boolean} 可能存在返回 true
 */
function legalRon(fu, han) {
  if (han < 1) return false;
  if (fu === 20) return false;
  if (fu === 25) return han >= 2;
  return true;
}

/**
 * 该 (符, 番) 组合是否可能以自摸出现。
 * 依据文档 §3.6：20 符自摸至少 2 番（平和 + 门清自摸）；25 符自摸至少 3 番；
 * 110 符 1 番自摸不存在（该形态必含门清荣和 10 符）。
 *
 * @param {number} fu 符数
 * @param {number} han 番数
 * @returns {boolean} 可能存在返回 true
 */
function legalTsumo(fu, han) {
  if (han < 1) return false;
  if (fu === 20) return han >= 2;
  if (fu === 25) return han >= 3;
  if (fu === 110 && han === 1) return false;
  return true;
}

/**
 * 解析 yaku-fu-score.md 的点数速查表。
 *
 * @param {string} text 文档全文
 * @returns {Map<string, {ron: number|null, tsumo: number[]|null}>} key = `${seat}|${fu}|${han}`
 */
function parseDocTables(text) {
  /** @type {Map<string, {ron: number|null, tsumo: number[]|null}>} */
  const out = new Map();
  let seat = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('#### 子家')) {
      seat = 'ko';
      continue;
    }
    if (line.startsWith('#### 亲家')) {
      seat = 'oya';
      continue;
    }
    if (line.startsWith('#### 5 番')) {
      seat = null;
      continue;
    }
    if (!seat || !line.startsWith('| **')) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length !== 5) continue;
    const m = /^\*\*(\d+) 符\*\*/.exec(cells[0]);
    if (!m) continue;
    const fu = Number(m[1]);
    for (let han = 1; han <= 4; han++) {
      const cell = cells[han];
      /** @type {{ron: number|null, tsumo: number[]|null}} */
      const rec = { ron: null, tsumo: null };
      const parts = cell.split('<br>').map((s) => s.trim());
      for (const part of parts) {
        const mr = /荣和 \*\*(\d+)\*\*/.exec(part);
        if (mr) {
          rec.ron = Number(mr[1]);
          continue;
        }
        if (/荣和 —/.test(part)) {
          rec.ron = null;
          continue;
        }
        const mt = /自摸 (\d+)\/(\d+)/.exec(part);
        if (mt) {
          rec.tsumo = [Number(mt[1]), Number(mt[2])];
          continue;
        }
        const ma = /自摸 (\d+) all/.exec(part);
        if (ma) {
          rec.tsumo = [Number(ma[1])];
          continue;
        }
        if (/自摸 —/.test(part)) {
          rec.tsumo = null;
          continue;
        }
        const mm = /满贯 (\d+)/.exec(part);
        if (mm) {
          rec.ron = Number(mm[1]);
          // 只写「满贯」不写自摸细节时，按文档 5 番以上表补齐满贯自摸值
          if (!cell.includes('自摸')) {
            rec.tsumo = seat === 'ko' ? MANGAN_TSUMO_KO.slice() : [MANGAN_TSUMO_OYA];
          }
        }
      }
      out.set(`${seat}|${fu}|${han}`, rec);
    }
  }
  return out;
}

/**
 * 把期望支付额格式化成可读串。
 *
 * @param {{ron?: number, all?: number, dealer?: number, child?: number}} payments 支付
 * @param {boolean} isTsumo 是否自摸
 * @returns {string} 形如 "3900" 或 "400/700" 或 "700 all"
 */
function fmt(payments, isTsumo) {
  if (!isTsumo) return String(payments.ron);
  if (payments.all !== undefined) return `${payments.all} all`;
  return `${payments.child}/${payments.dealer}`;
}

// ---------------------------------------------------------------------------
// 1) 输出完整点数表
// ---------------------------------------------------------------------------
const rules = makeRules();
let tableOk = 0;
let tableBad = 0;
/** @type {string[]} */
const problems = [];

console.log('=== 完整点数表（不采用切上满贯，雀魂四人段位场默认规则集）===');
console.log('符数 | 番数 | 子家荣和 | 子家自摸(子/亲) | 亲家荣和 | 亲家自摸(all)');
console.log('-----|------|----------|----------------|----------|---------------');
for (const fu of FU_LIST) {
  for (const han of HAN_LIST) {
    const koRon = calcScore({ han, fu, isDealer: false, isTsumo: false }, rules);
    const koTsu = calcScore({ han, fu, isDealer: false, isTsumo: true }, rules);
    const oyaRon = calcScore({ han, fu, isDealer: true, isTsumo: false }, rules);
    const oyaTsu = calcScore({ han, fu, isDealer: true, isTsumo: true }, rules);
    console.log(
      `${String(fu).padStart(4)} | ${String(han).padStart(4)} | ${String(koRon.payments.ron).padStart(8)} | ` +
        `${fmt(koTsu.payments, true).padStart(14)} | ${String(oyaRon.payments.ron).padStart(8)} | ` +
        `${fmt(oyaTsu.payments, true).padStart(13)}`,
    );
    // 自洽性：子家自摸三家合计 ≥ 荣和；亲家自摸三家合计 ≥ 荣和
    const koTotal = koTsu.payments.dealer + koTsu.payments.child * 2;
    if (koTotal < koRon.payments.ron) {
      problems.push(`子家 ${fu}符${han}番：自摸合计 ${koTotal} < 荣和 ${koRon.payments.ron}`);
    }
    const oyaTotal = oyaTsu.payments.all * 3;
    if (oyaTotal < oyaRon.payments.ron) {
      problems.push(`亲家 ${fu}符${han}番：自摸合计 ${oyaTotal} < 荣和 ${oyaRon.payments.ron}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2) 与文档逐格比对
// ---------------------------------------------------------------------------
const doc = parseDocTables(readFileSync(MD, 'utf8'));
let valueCells = 0;
let valueOk = 0;
let blankCells = 0;
let blankOk = 0;
/** @type {string[]} */
const gridErrors = [];

for (const [key, rec] of [...doc.entries()].sort()) {
  const [seat, fuStr, hanStr] = key.split('|');
  const fu = Number(fuStr);
  const han = Number(hanStr);
  const isDealer = seat === 'oya';

  const ronRes = calcScore({ han, fu, isDealer, isTsumo: false }, rules);
  const tsuRes = calcScore({ han, fu, isDealer, isTsumo: true }, rules);

  // 荣和
  if (rec.ron !== null) {
    valueCells++;
    if (!legalRon(fu, han)) {
      gridErrors.push(`非法荣和：${seat} ${fu}符${han}番（文档给了 ${rec.ron}，但该组合不存在）`);
    } else if (ronRes.payments.ron !== rec.ron) {
      gridErrors.push(`荣和 ${seat} ${fu}符${han}番：文档 ${rec.ron} ≠ 引擎 ${ronRes.payments.ron}`);
    } else {
      valueOk++;
      tableOk++;
    }
  } else {
    blankCells++;
    if (legalRon(fu, han)) {
      gridErrors.push(`应有值却为空：${seat} ${fu}符${han}番（引擎算出荣和 ${ronRes.payments.ron}）`);
    } else {
      blankOk++;
      tableOk++;
    }
  }

  // 自摸
  if (rec.tsumo !== null) {
    valueCells++;
    const expect = isDealer ? [tsuRes.payments.all] : [tsuRes.payments.child, tsuRes.payments.dealer];
    if (!legalTsumo(fu, han)) {
      gridErrors.push(`非法自摸：${seat} ${fu}符${han}番（文档给了 ${rec.tsumo.join('/')}）`);
    } else if (expect.join('/') !== rec.tsumo.join('/')) {
      gridErrors.push(`自摸 ${seat} ${fu}符${han}番：文档 ${rec.tsumo.join('/')} ≠ 引擎 ${expect.join('/')}`);
    } else {
      valueOk++;
      tableOk++;
    }
  } else {
    blankCells++;
    if (legalTsumo(fu, han)) {
      gridErrors.push(
        `应有值却为空：${seat} ${fu}符${han}番（引擎算出 ${fmt(tsuRes.payments, true)}）`,
      );
    } else {
      blankOk++;
      tableOk++;
    }
  }
}

console.log('');
console.log(`[比对] 文档提取 ${doc.size} 格（符 20/25/30–110 × 番 1–4 × 子/亲）`);
console.log(`[比对] 有值格 ${valueCells} 项：一致 ${valueOk}，不一致 ${valueCells - valueOk}`);
console.log(`[比对] 空格   ${blankCells} 项：引擎判定「不存在」${blankOk}，判定不符 ${blankCells - blankOk}`);
console.log(`[比对] 合计一致 ${tableOk} 项，不一致 ${gridErrors.length} 项`);
for (const e of gridErrors) console.log('   ✗', e);

// ---------------------------------------------------------------------------
// 3) 5 番以上定值表
// ---------------------------------------------------------------------------
console.log('');
console.log('=== 5 番及以上（不分符数）===');
const DAN = [
  [5, '满贯', 8000, [2000, 4000], 12000, 4000],
  [6, '跳满', 12000, [3000, 6000], 18000, 6000],
  [7, '跳满', 12000, [3000, 6000], 18000, 6000],
  [8, '倍满', 16000, [4000, 8000], 24000, 8000],
  [10, '倍满', 16000, [4000, 8000], 24000, 8000],
  [11, '三倍满', 24000, [6000, 12000], 36000, 12000],
  [12, '三倍满', 24000, [6000, 12000], 36000, 12000],
  [13, '累计役满', 32000, [8000, 16000], 48000, 16000],
];
let danOk = 0;
for (const [han, name, koRon, koTsu, oyaRon, oyaTsu] of DAN) {
  const r1 = calcScore({ han, fu: 30, isDealer: false, isTsumo: false }, rules);
  const r2 = calcScore({ han, fu: 30, isDealer: false, isTsumo: true }, rules);
  const r3 = calcScore({ han, fu: 30, isDealer: true, isTsumo: false }, rules);
  const r4 = calcScore({ han, fu: 30, isDealer: true, isTsumo: true }, rules);
  const ok =
    r1.payments.ron === koRon &&
    r2.payments.child === koTsu[0] &&
    r2.payments.dealer === koTsu[1] &&
    r3.payments.ron === oyaRon &&
    r4.payments.all === oyaTsu;
  if (ok) danOk++;
  console.log(
    `${String(han).padStart(2)} 番 ${name.padEnd(4)} 子荣和 ${String(r1.payments.ron).padStart(6)}  子自摸 ${fmt(r2.payments, true)}  ` +
      `亲荣和 ${String(r3.payments.ron).padStart(6)}  亲自摸 ${fmt(r4.payments, true)}  ${ok ? '✓' : '✗'}`,
  );
}

// 役满 / 双倍役满
const yakuman = calcScore({ han: 0, fu: 0, isDealer: false, isTsumo: false, yakumanCount: 1 }, rules);
const doubleYakuman = calcScore({ han: 0, fu: 0, isDealer: true, isTsumo: false, yakumanCount: 2 }, rules);

// ---------------------------------------------------------------------------
// 4) 切上满贯口径
// ---------------------------------------------------------------------------
console.log('');
console.log('=== 切上满贯（rules.kiriageMangan）===');
const noKiri = calcScore({ han: 4, fu: 30, isDealer: false, isTsumo: false }, rules);
const yesKiri = calcScore({ han: 4, fu: 30, isDealer: false, isTsumo: false }, makeRules({ [KIRIAGE_MANGAN]: true }));
const noKiri3 = calcScore({ han: 3, fu: 60, isDealer: false, isTsumo: false }, rules);
const yesKiri3 = calcScore({ han: 3, fu: 60, isDealer: false, isTsumo: false }, makeRules({ [KIRIAGE_MANGAN]: true }));
console.log(`不切上：4番30符 子荣和 ${noKiri.payments.ron}（文档 7700）/ 3番60符 子荣和 ${noKiri3.payments.ron}（文档 7700）`);
console.log(`切上开：4番30符 子荣和 ${yesKiri.payments.ron}（期望 8000）/ 3番60符 子荣和 ${yesKiri3.payments.ron}（期望 8000）`);
console.log(`公式自然满贯：4番40符 basic=${resolveLimit(4, 40, rules, 0).basic}、3番70符 basic=${resolveLimit(3, 70, rules, 0).basic}`);
console.log(`役满 子荣和 ${yakuman.payments.ron}（期望 32000）；双倍役满 亲荣和 ${doubleYakuman.payments.ron}（期望 96000）`);

const kiriOk =
  noKiri.payments.ron === 7700 &&
  noKiri3.payments.ron === 7700 &&
  yesKiri.payments.ron === 8000 &&
  yesKiri3.payments.ron === 8000 &&
  resolveLimit(4, 40, rules, 0).basic === 2000 &&
  resolveLimit(3, 70, rules, 0).basic === 2000 &&
  yakuman.payments.ron === 32000 &&
  doubleYakuman.payments.ron === 96000;

console.log('');
const bad = gridErrors.length + problems.length + (danOk === DAN.length ? 0 : 1) + (kiriOk ? 0 : 1);
console.log('=== 结论 ===');
console.log(`文档逐格比对：一致 ${tableOk} 格，不一致 ${gridErrors.length} 格`);
console.log(`表格自洽性：不一致 ${problems.length} 项`);
console.log(`5 番以上定值：${danOk}/${DAN.length} 行一致`);
console.log(`切上满贯 / 满贯界限 / 役满：${kiriOk ? '一致' : '不一致'}`);
console.log(bad === 0 ? '✅ 全部一致' : `❌ 共 ${bad} 项不一致`);
for (const p of problems) console.log('   ✗', p);
process.exitCode = bad === 0 ? 0 : 1;
