// 临时冒烟测试（跑通后删除）
import {
  parseHand,
  detectYaku,
  calcFu,
  calcScore,
  makeRules,
  TENHOU_4P,
  isDiscardFuriten,
  isFuriten,
  canRon,
} from '../engine/index.js';
import { decomposeStandard } from '../engine/agari.js';

const ctx = (hand, winTile, extra = {}) => ({
  hand: parseHand(hand),
  melds: [],
  winTile,
  isTsumo: false,
  roundWind: 27,
  seatWind: 28,
  ...extra,
});

// 1. 平和荣和
const c1 = ctx('123m456m789m234p55s', 10); // 和 2p? 用 waits 检查
console.log('--- 平和案 ---');
const r1 = detectYaku(c1);
console.log(r1.list.map((e) => `${e.name} ${e.han}`).join(' / '), 'han', r1.han, 'fu', r1.fu, 'total', r1.totalHan);
console.log(r1.fuDetail.items.map((i) => `${i.label}=${i.fu}`).join(' '));

console.log('--- 111222333m44m567p 高点 ---');
const c2 = ctx('111222333m44m567p', 3); // 和 4m（单骑）
const r2 = detectYaku(c2);
console.log(r2.list.map((e) => `${e.name} ${e.han}`).join(' / '), 'han', r2.han, 'fu', r2.fu);

console.log('--- 七对子 ---');
const c3 = ctx('11m99m11p99p112233z', 33, { isTsumo: true });
const r3 = detectYaku(c3);
console.log(r3.list.map((e) => `${e.name} ${e.han}`).join(' / '), 'form', r3.form, 'fu', r3.fu, 'total', r3.totalHan);

console.log('--- 110 符牌例 ---');
{
  const hand = parseHand('234p11z777z'); // 234p + 東東 + 中中中（7z = 中）
  const cc = {
    hand,
    melds: [
      { type: 'ankan', tiles: [0, 0, 0, 0] },
      { type: 'ankan', tiles: [28, 28, 28, 28] },
    ],
    winTile: 33,
    isTsumo: false,
    roundWind: 27,
    seatWind: 27,
  };
  const rr = detectYaku(cc);
  console.log(rr.list.map((e) => `${e.name} ${e.han}`).join(' / '), 'fu', rr.fu, 'detail', rr.fuDetail.items.map((i) => `${i.label}=${i.fu}`).join(' '));
  console.log(rr.fuDetail.items.filter((i) => i.note).map((i) => `  ${i.label}: ${i.note}`).join('\n'));
}

console.log('--- score ---');
console.log(JSON.stringify(calcScore({ han: 3, fu: 30, isDealer: false, isTsumo: false })));
console.log(calcScore({ han: 3, fu: 30, isDealer: false, isTsumo: false }).detail);
console.log(calcScore({ han: 4, fu: 30, isDealer: false }, makeRules()).payments);
console.log(calcScore({ han: 2, fu: 20, isDealer: false, isTsumo: true }).payments);

console.log('--- furiten ---');
const h13 = parseHand('12m456p789s11222z');
console.log('discard furiten(6m in pond):', isDiscardFuriten(h13, 0, [], [5]));
console.log('discard furiten(1m in pond):', isDiscardFuriten(h13, 0, [], [0]));
console.log('isFuriten:', isFuriten({ hand13: h13, melds: [], pond: [5] }));

console.log('--- canRon ---');
const c5 = { ...ctx('123m456m789m234p55s', 10, { isRiichi: true }), pond: [] };
console.log(canRon(c5));
console.log(JSON.stringify(decomposeStandard(parseHand('111222333m44m567p')).length));
