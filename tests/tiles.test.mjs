/**
 * tiles.js 单元测试
 * =====================================================================
 * 覆盖：索引约定、花色/番号、幺九判定、字符串互转、parseHand 的多种写法、
 * 赤牌归一、ドラ指示牌、计数数组工具、副露展开。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HAND_SIZE,
  HAND_SIZE_WITH_RED,
  HONOR_START,
  MAX_COPIES,
  NUM_TILE_TYPES,
  RED_5M,
  RED_5P,
  RED_5S,
  SUIT_M,
  SUIT_P,
  SUIT_S,
  SUIT_Z,
  addTile,
  cloneHand,
  doraFromIndicator,
  emptyHand,
  handToStr,
  handWithMelds,
  isHonor,
  isSimple,
  isTerminal,
  isYaochu,
  meldTileCounts,
  normalizeHand,
  normalizeIndex,
  parseHand,
  rankOf,
  removeTile,
  strToTile,
  suitOf,
  tileToStr,
  totalTiles,
  validateMelds,
} from '../engine/tiles.js';

test('常量符合约定', () => {
  assert.equal(NUM_TILE_TYPES, 34);
  assert.equal(HAND_SIZE, 34);
  assert.equal(HAND_SIZE_WITH_RED, 37);
  assert.equal(HONOR_START, 27);
  assert.equal(MAX_COPIES, 4);
  assert.deepEqual([SUIT_M, SUIT_P, SUIT_S, SUIT_Z], [0, 1, 2, 3]);
  assert.deepEqual([RED_5M, RED_5P, RED_5S], [34, 35, 36]);
});

test('suitOf / rankOf 覆盖全部 0–36', () => {
  for (let i = 0; i <= 8; i++) {
    assert.equal(suitOf(i), SUIT_M);
    assert.equal(rankOf(i), i + 1);
  }
  for (let i = 9; i <= 17; i++) {
    assert.equal(suitOf(i), SUIT_P);
    assert.equal(rankOf(i), i - 9 + 1);
  }
  for (let i = 18; i <= 26; i++) {
    assert.equal(suitOf(i), SUIT_S);
    assert.equal(rankOf(i), i - 18 + 1);
  }
  for (let i = 27; i <= 33; i++) {
    assert.equal(suitOf(i), SUIT_Z);
    assert.equal(rankOf(i), i - 27 + 1);
  }
  // 赤 5 视作普通 5
  assert.equal(suitOf(RED_5M), SUIT_M);
  assert.equal(rankOf(RED_5M), 5);
  assert.equal(suitOf(RED_5P), SUIT_P);
  assert.equal(rankOf(RED_5P), 5);
  assert.equal(suitOf(RED_5S), SUIT_S);
  assert.equal(rankOf(RED_5S), 5);
  // 赤牌字牌顺序
  assert.equal(rankOf(27), 1); // 東
  assert.equal(rankOf(33), 7); // 中
});

test('normalizeIndex 把 34/35/36 归一到 4/13/22，并做越界检查', () => {
  assert.equal(normalizeIndex(0), 0);
  assert.equal(normalizeIndex(33), 33);
  assert.equal(normalizeIndex(34), 4);
  assert.equal(normalizeIndex(35), 13);
  assert.equal(normalizeIndex(36), 22);
  assert.throws(() => normalizeIndex(37), RangeError);
  assert.throws(() => normalizeIndex(-1), RangeError);
  assert.throws(() => normalizeIndex(1.5), RangeError);
});

test('isHonor / isTerminal / isYaochu / isSimple', () => {
  const honorIdx = [27, 28, 29, 30, 31, 32, 33];
  const terminalIdx = [0, 8, 9, 17, 18, 26];
  const simpleIdx = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25];
  for (let i = 0; i < 34; i++) {
    const honor = honorIdx.includes(i);
    const terminal = terminalIdx.includes(i);
    assert.equal(isHonor(i), honor, `isHonor(${i})`);
    assert.equal(isTerminal(i), terminal, `isTerminal(${i})`);
    assert.equal(isYaochu(i), honor || terminal, `isYaochu(${i})`);
    assert.equal(isSimple(i), !(honor || terminal), `isSimple(${i})`);
  }
  // 赤 5 不是幺九
  assert.equal(isYaochu(RED_5M), false);
  assert.equal(isSimple(RED_5P), true);
});

test('tileToStr / strToTile 互转（含赤牌）', () => {
  const expected = [
    [0, '1m'], [4, '5m'], [8, '9m'],
    [9, '1p'], [13, '5p'], [17, '9p'],
    [18, '1s'], [22, '5s'], [26, '9s'],
    [27, '1z'], [30, '4z'], [31, '5z'], [32, '6z'], [33, '7z'],
    [34, '0m'], [35, '0p'], [36, '0s'],
  ];
  for (const [idx, str] of expected) {
    assert.equal(tileToStr(idx), str);
    assert.equal(strToTile(str), idx);
  }
  for (let i = 0; i < 34; i++) assert.equal(strToTile(tileToStr(i)), i);
  // 大小写与空白容错
  assert.equal(strToTile(' 5M '), 4);
  assert.equal(strToTile('1Z'), 27);
  // 非法输入
  assert.throws(() => strToTile('0z'), RangeError);
  assert.throws(() => strToTile('8z'), RangeError);
  assert.throws(() => strToTile('5x'), RangeError);
  assert.throws(() => strToTile('55m'), RangeError);
  assert.throws(() => tileToStr(37), RangeError);
});

test('parseHand：后缀记法 / 单张记法 / 乱序 / 赤牌 / 空白', () => {
  const a = parseHand('123m456p789s11222z');
  assert.equal(totalTiles(a), 14);
  assert.equal(handToStr(a), '123m456p789s11222z');
  // 单张重复写法等价
  assert.deepEqual(parseHand('1m2m3m'), parseHand('123m'));
  assert.deepEqual(parseHand('111z22z'), parseHand('1z1z1z2z2z'));
  // 花色顺序无所谓
  assert.deepEqual(parseHand('456p123m'), parseHand('123m456p'));
  // 空白与逗号被忽略
  assert.deepEqual(parseHand(' 123m, 456p 、789s '), parseHand('123m456p789s'));
  // 空串 = 空手牌
  assert.deepEqual(parseHand(''), emptyHand());
  // 赤牌归一到普通 5
  assert.deepEqual(parseHand('0m'), parseHand('5m'));
  const redHand = parseHand('05m');
  assert.equal(redHand[4], 2);
  assert.equal(totalTiles(redHand), 2);
  // 非法
  assert.throws(() => parseHand('123'), RangeError); // 结尾缺花色
  assert.throws(() => parseHand('5x'), RangeError);
  assert.throws(() => parseHand('8z'), RangeError);
  assert.throws(() => parseHand('0z'), RangeError);
  assert.throws(() => parseHand('11111m'), RangeError); // 超过 4 张
});

test('handToStr 与 parseHand 互相往返', () => {
  const samples = [
    '',
    '1m',
    '19m19p19s1234567z',
    '1112345678999m',
    '11223344556677m',
    '11122233344455z',
    '123456789m123456789p1s',
  ];
  for (const s of samples) {
    assert.equal(handToStr(parseHand(s)), s);
  }
  // 计数数组里的 4 张会输出 4 个数字
  const h = emptyHand();
  h[0] = 4;
  assert.equal(handToStr(h), '1111m');
});

test('doraFromIndicator：数牌循环 + 字牌（风牌/三元牌各自循环）', () => {
  // 数牌 9 → 1
  assert.equal(doraFromIndicator(8), 0); // 9m → 1m
  assert.equal(doraFromIndicator(17), 9); // 9p → 1p
  assert.equal(doraFromIndicator(26), 18); // 9s → 1s
  assert.equal(doraFromIndicator(0), 1); // 1m → 2m
  // 风牌 東南西北：北 → 東
  assert.equal(doraFromIndicator(27), 28); // 東→南
  assert.equal(doraFromIndicator(28), 29); // 南→西
  assert.equal(doraFromIndicator(29), 30); // 西→北
  assert.equal(doraFromIndicator(30), 27); // 北→東
  // 三元牌 白發中：中 → 白
  assert.equal(doraFromIndicator(31), 32); // 白→發
  assert.equal(doraFromIndicator(32), 33); // 發→中
  assert.equal(doraFromIndicator(33), 31); // 中→白
  // 赤 5 指示牌按普通 5 处理
  assert.equal(doraFromIndicator(RED_5M), 5); // 赤5m → 6m
  // 任意指示牌的结果都在 0–33 且与花色的对应关系正确
  for (let i = 0; i < 34; i++) {
    const d = doraFromIndicator(i);
    assert.ok(d >= 0 && d < 34);
    assert.equal(suitOf(d), suitOf(i), `指示牌 ${tileToStr(i)} 的宝牌花色`);
  }
});

test('计数数组工具：emptyHand / totalTiles / addTile / removeTile / cloneHand', () => {
  const h = emptyHand();
  assert.equal(h.length, 34);
  assert.ok(h.every((v) => v === 0));
  assert.equal(totalTiles(h), 0);

  addTile(h, 0);
  addTile(h, 0, 2);
  assert.equal(h[0], 3);
  assert.equal(totalTiles(h), 3);
  assert.throws(() => addTile(h, 0, 2), RangeError); // 会超过 4 张
  assert.throws(() => addTile(h, 0, -1), RangeError);

  removeTile(h, 0, 2);
  assert.equal(h[0], 1);
  assert.throws(() => removeTile(h, 0, 2), RangeError);

  const c = cloneHand(h);
  assert.deepEqual(c, h);
  c[1] = 4;
  assert.equal(h[1], 0); // 深拷贝

  // 赤牌索引会被归一
  addTile(h, RED_5M);
  assert.equal(h[4], 1);
  removeTile(h, RED_5M);
  assert.equal(h[4], 0);
});

test('normalizeHand：长度 37 的赤牌槽位被并入普通 5', () => {
  const withRed = new Array(37).fill(0);
  withRed[4] = 1; // 普通 5m
  withRed[RED_5M] = 1; // 赤 5m
  withRed[RED_5S] = 2; // 两张赤 5s
  const h = normalizeHand(withRed);
  assert.equal(h.length, 34);
  assert.equal(h[4], 2);
  assert.equal(h[22], 2);
  assert.equal(totalTiles(h), 4);

  // 长度 34 的数组原样复制
  const plain = parseHand('123m');
  const norm = normalizeHand(plain);
  assert.deepEqual(norm, plain);
  assert.notEqual(norm, plain);

  assert.throws(() => normalizeHand(new Array(10).fill(0)), TypeError);
  assert.throws(() => normalizeHand([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), RangeError);
});

test('副露工具：validateMelds / meldTileCounts / handWithMelds', () => {
  const melds = [
    { type: 'chi', tiles: [0, 1, 2] },
    { type: 'pon', tiles: [31, 31, 31] },
    { type: 'ankan', tiles: [13, 13, 13, 13] },
  ];
  assert.equal(validateMelds(melds), melds);
  const counts = meldTileCounts(melds);
  assert.equal(counts[0], 1);
  assert.equal(counts[1], 1);
  assert.equal(counts[2], 1);
  assert.equal(counts[31], 3);
  assert.equal(counts[13], 4);
  assert.equal(totalTiles(counts), 10);

  const concealed = parseHand('456m789m11p');
  const whole = handWithMelds(concealed, melds);
  assert.equal(totalTiles(whole), 18);
  assert.equal(whole[0], 1);
  assert.equal(whole[13], 4);
  // 原手牌不被修改
  assert.equal(totalTiles(concealed), 8);

  // 非法副露
  assert.throws(() => validateMelds([{ type: 'chi', tiles: [0, 1] }]), RangeError);
  assert.throws(() => validateMelds([{ type: 'pon', tiles: [0, 1, 2] }]), RangeError);
  assert.throws(() => validateMelds([{ type: 'nope', tiles: [0, 1, 2] }]), RangeError);
  assert.throws(() => validateMelds('x'), TypeError);
  // 展开后超过 4 张
  assert.throws(() => handWithMelds(parseHand('111m'), [{ type: 'pon', tiles: [0, 0, 0] }, { type: 'pon', tiles: [0, 0, 0] }]), RangeError);
});
