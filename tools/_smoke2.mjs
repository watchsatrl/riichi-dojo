import { parseHand, decomposeStandard, detectYaku, calcFu } from '../engine/index.js';

const hand = parseHand('234p11z333z');
console.log('hand', hand.map((n, i) => (n ? `${i}x${n}` : '')).filter(Boolean).join(' '));
const d = decomposeStandard(hand, 2);
console.log('decomps', JSON.stringify(d));

const ctx = {
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
try {
  const r = detectYaku(ctx);
  console.log(r.list.map((e) => `${e.name} ${e.han}`).join(' / '), 'fu', r.fu);
  console.log(r.fuDetail.items.map((i) => `${i.label}=${i.fu}`).join(' '));
} catch (e) {
  console.log('ERR', e.message);
}
for (const dec of d) {
  try {
    console.log('fu for', JSON.stringify(dec), calcFu(ctx, dec).fu);
  } catch (e) {
    console.log('fu ERR', JSON.stringify(dec), e.message);
  }
}
