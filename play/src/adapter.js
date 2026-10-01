/**
 * adapter.js —— GameState → view 对象的唯一转换点
 *
 * 界面只认 view 的扁平结构，不认状态机的内部字段。
 * 好处是状态机怎么演化，都只需要改这一个文件。
 */

const WINDS = ['東', '南', '西', '北'];

/** 自风：庄家是東，然后按座次（逆时针）依次南西北 */
export const windOf = (seat, dealer) => (seat - dealer + 4) % 4;

/**
 * 状态机里的场风用的是牌索引（27–30），界面用 0–3。
 * 在这个边界上一次性换算掉，别让它漏到渲染层。
 */
const windIdx = (w) => (w >= 27 ? w - 27 : w);

/**
 * @param {object} state  状态机
 * @param {number} mySeat 以谁的视角看（决定谁的手牌可见）
 * @param {Array}  [legal] 该座位当前可做的动作
 */
export function toView(state, mySeat, legal = []) {
  const dealer = state.dealer;

  const players = state.players.map((p) => {
    const pond = p.pond || [];
    // 状态机的手牌是「当前实际持有」，摸牌后即为 14 张，直接数即可
    const tileCount = p.hand.reduce((a, b) => a + b, 0);
    // 最后一张打出的牌高亮。被鸣走的牌在牌河里显示为淡色
    const lastPondIdx = (state.lastDiscard && state.lastDiscard.seat === p.seat && !state.lastDiscard.called)
      ? pond.length - 1 : -1;

    return {
      seat: p.seat,
      wind: windOf(p.seat, dealer),
      score: p.score,
      // 自己的手牌给计数数组；别家只给「几张牌背」——张数是公开信息，牌面不是
      hand: p.seat === mySeat
        ? p.hand
        : Array.from({ length: tileCount }, () => 0),
      melds: p.melds || [],
      pond,
      pondCalled: p.pondCalled || [],
      lastPondIdx,
      riichi: !!p.riichi,
      ippatsu: !!p.ippatsu,
      furiten: !!p.furiten,
      drawnTile: p.seat === mySeat ? p.drawnTile : null,
      menzen: !!p.menzen,
    };
  });

  return {
    mySeat,
    players,
    dealer,
    handNumber: state.handNumber,
    roundWind: windIdx(state.roundWind),
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    wallRemaining: state.wall && state.wall.live ? state.wall.live.length : 0,
    doraIndicators: state.doraIndicators || [],
    uraIndicators: state.uraIndicators || [],
    turn: state.turn,
    phase: state.phase,
    lastDiscard: state.lastDiscard || null,
    legal,
    result: state.result || null,
  };
}

export { WINDS };
