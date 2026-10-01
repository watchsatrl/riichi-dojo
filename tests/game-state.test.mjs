/**
 * 对局状态机测试 —— 直接执行（沙箱禁止 node --test 的管道 spawn）：
 *   node tests/game-state.test.mjs
 *
 * 覆盖：可复现性 / 牌山 / 配牌 / 完整对局（200 场自动对局）/ 逐步不变量 /
 * 规则边界（食替三情形、立直后暗杠、振听、九种九牌、四风连打、四家立直、四槓散了、
 * 连庄与本场、击飞、立直宣言牌放铳、海底不可鸣、一发、双响与三响）/ 视图隔离。
 */

import {
  createGame,
  startHand,
  currentSeat,
  legalActions,
  applyAction,
  isHandOver,
  isGameOver,
  viewFor,
  checkInvariants,
  countAllTiles,
  waitsFor,
  isSuukaikanPending,
  PHASES,
  makeRng,
  shuffle,
  buildWall,
  fullTileSet,
  kanDoraIndicator,
  kanUraIndicator,
  LIVE_WALL_SIZE,
  RINSHAN_SIZE,
  DEAD_WALL_SIZE,
  isKuikae,
  chiOptions,
  describeAction,
  rank1Seat,
} from '../game/index.js';
import {
  parseHand,
  handToStr,
  strToTile,
  tileToStr,
  totalTiles,
  normalizeIndex,
  emptyHand,
  cloneHand,
  shanten,
} from '../engine/index.js';

// ---------------------------------------------------------------------------
// 极简测试框架
// ---------------------------------------------------------------------------
let pass = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (err) {
    failures.push([name, err]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function assertEq(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || '值不相等'}：实际 ${sa}，期望 ${sb}`);
}
function assertThrows(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(msg || '本应抛错但没有');
}
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// 摆牌工具：把四家手牌 / 牌山顶部 / 牌河摆成指定内容
// ---------------------------------------------------------------------------
/** '234m' → [1,2,3]（升序牌索引数组） */
function tilesOf(str) {
  const h = parseHand(str);
  const out = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < h[t]; k++) out.push(t);
  return out;
}

const junkRng = makeRng(20260930);

/**
 * 从剩余牌池里随机抽一副「明显不听牌」的废牌手（shanten ≥ 2），用于填充测试不关心的座位。
 *
 * 为什么不用固定字符串：四个座位共用的牌种上限是 4 张，写死废牌手极易与测试主角的手牌撞牌；
 * 从剩余池里现抽可以从根上避免冲突。
 *
 * @param {number[]} pool 剩余物理牌池（会被就地取走）
 * @param {number} size 需要的张数
 * @returns {number[]} 计数数组
 */
function autoJunkHand(pool, size) {
  const cnt = new Array(34).fill(0);
  for (const t of pool) cnt[normalizeIndex(t)] += 1;
  for (let attempt = 0; attempt < 5000; attempt++) {
    const c = cnt.slice();
    const hand = emptyHand();
    let n = 0;
    while (n < size) {
      const cands = [];
      for (let t = 0; t < 34; t++) if (c[t] > 0) cands.push(t);
      if (cands.length === 0) break;
      const t = cands[Math.floor(junkRng() * cands.length)];
      c[t] -= 1;
      hand[t] += 1;
      n += 1;
    }
    if (n === size && shanten(hand, 0) >= 2) {
      for (let t = 0; t < 34; t++) {
        for (let k = 0; k < hand[t]; k++) {
          const idx = pool.findIndex((x) => normalizeIndex(x) === t);
          pool.splice(idx, 1);
        }
      }
      return hand;
    }
  }
  throw new Error('autoJunkHand: 无法从剩余牌池构造不听牌的废牌手');
}

/**
 * 把 state 重置成「指定手牌 + 指定接下来摸到的牌」的摸牌阶段。
 *
 * @param {object} state 对局状态（先调用过 startHand）
 * @param {object} opts
 *   - `hands`: 四个字符串或 null（null = 自动填一副不听牌的废牌手）；
 *     张数 = 13 − 3 × 该家副露数
 *   - `melds`: 每家副露规格 `[{type, tiles:'234m', called:'4m'}]`
 *   - `wall`: 接下来依次摸到的牌（省略时用剩余池的头部）
 *   - `ponds`: 每家牌河（从池中取牌，保证牌张守恒）
 *   - `turn`: 现在轮到谁摸打（默认庄家）
 *   - `dora`: 宝牌指示牌
 *   - `emptyWall`: 把剩余可摸牌全部移出牌墙（构造「摸完即荒牌流局」）
 */
function stack(state, opts) {
  const turn = opts.turn === undefined ? state.dealer : opts.turn;
  const meldSpecs = opts.melds || [[], [], [], []];
  const meldsPer = meldSpecs.map((list) =>
    list.map((spec) => {
      const tiles = tilesOf(spec.tiles);
      if (spec.type === 'chi') {
        assert(tiles.length === 3 && tiles[1] === tiles[0] + 1 && tiles[2] === tiles[1] + 1, `chi 副露不合法：${spec.tiles}`);
        assert(tiles[0] % 9 <= 6 && Math.floor(tiles[0] / 9) === Math.floor(tiles[2] / 9), `chi 不能跨花色：${spec.tiles}`);
      } else {
        assert(tiles.every((t) => t === tiles[0]), `${spec.type} 必须是同一种牌`);
      }
      return { type: spec.type, tiles, calledTile: spec.called ? strToTile(spec.called) : tiles[tiles.length - 1] };
    }),
  );

  // 复位
  for (const p of state.players) {
    p.hand = emptyHand();
    p.melds = meldsPer[p.seat].map((m) => ({ ...m, tiles: m.tiles.slice() }));
    p.menzen = p.melds.every((m) => m.type === 'ankan');
    p.pond = [];
    p.pondCalled = [];
    p.riichi = false;
    p.riichiTurn = null;
    p.doubleRiichi = false;
    p.ippatsu = false;
    p.furiten = false;
    p.tempFuriten = false;
    p.riichiFuriten = false;
    p.drawnTile = null;
    p.handRed = [0, 0, 0];
    p.meldRed = [0, 0, 0];
    p.riichiWaits = null;
    p.paoBy = null;
    p.drawCount = 0;
    p.discardCount = 0;
    p.rinshanDraw = false;
    p.haiteiDraw = false;
    p.pendingKanDora = 0;
    p.tenpai = false;
  }
  state.callCount = 0;
  state.kanCount = 0;
  state.kanOwners = [];
  state.discardLog = [];
  state.suukaikanPending = false;
  state.kuikaeLock = null;
  state.lastDiscard = null;
  state.pendingClaims = [];
  state.claimResults = [];
  state.claimContext = null;
  state.result = null;
  state.kanDoraCount = 0;
  state.uraIndicators = [];

  // 从完整 136 张（不含赤，便于测试可读）里取走摆好的牌，剩下就是牌山
  const pool = fullTileSet({ m: 0, p: 0, s: 0 });
  const take = (tile) => {
    let idx = pool.indexOf(tile);
    if (idx < 0) idx = pool.findIndex((x) => normalizeIndex(x) === normalizeIndex(tile));
    if (idx < 0) throw new Error(`stack: 牌 ${tileToStr(tile)} 已被用光（摆牌冲突）`);
    return pool.splice(idx, 1)[0];
  };

  const hands = [null, null, null, null];
  for (let i = 0; i < 4; i++) {
    const spec = (opts.hands || [])[i];
    if (spec === null || spec === undefined) continue;
    const h = parseHand(spec);
    const expect = 13 - 3 * meldsPer[i].length;
    assert(totalTiles(h) === expect, `stack: 座位 ${i} 暗牌 ${totalTiles(h)} 张，应为 ${expect} 张`);
    hands[i] = h;
    for (let t = 0; t < 34; t++) for (let k = 0; k < h[t]; k++) take(t);
  }
  for (let i = 0; i < 4; i++) for (const m of meldsPer[i]) for (const t of m.tiles) take(t);

  const top = [];
  for (const s of opts.wall || []) top.push(...tilesOf(s));
  let topPhysical = top.map((t) => take(t));
  if (topPhysical.length === 0) topPhysical = [pool.shift()]; // 至少给当前玩家一张可摸的牌

  // 牌河（从池中取牌，保证牌张守恒）
  const ponds = [[], [], [], []];
  const pondsCalled = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    const list = (opts.ponds || [])[i] || [];
    for (const s of list) {
      const t = take(strToTile(s));
      ponds[i].push(normalizeIndex(t));
      pondsCalled[i].push(false);
    }
  }

  // 王牌 / 岭上牌 / 宝牌指示牌必须在「自动废牌」之前取走，
  // 否则随机废牌手可能把指定的宝牌指示牌摸走。
  let doraTile = null;
  if (opts.dora !== undefined) doraTile = take(strToTile(opts.dora));
  const rinshan = [];
  for (let i = 0; i < RINSHAN_SIZE; i++) rinshan.push(pool.pop());
  const dead = [];
  for (let i = 0; i < DEAD_WALL_SIZE; i++) dead.push(pool.pop());
  if (doraTile !== null) {
    pool.push(dead[0]); // 原指示牌放回牌山（保证 136 张守恒）
    dead[0] = doraTile;
  }

  for (let i = 0; i < 4; i++) {
    if (hands[i] === null) hands[i] = autoJunkHand(pool, 13 - 3 * meldsPer[i].length);
  }

  if (opts.emptyWall) dead.push(...pool.splice(0, pool.length));
  state.wall = { live: [...topPhysical, ...pool], dead, rinshan, rinshanIndex: 0 };
  state.doraIndicators = [dead[0]];

  for (const p of state.players) {
    p.hand = hands[p.seat].slice();
    p.pond = ponds[p.seat].slice();
    p.pondCalled = pondsCalled[p.seat].slice();
  }
  const active = state.players[turn];
  if (topPhysical.length > 0) {
    const drawn = topPhysical[0];
    active.hand[normalizeIndex(drawn)] += 1;
    active.drawnTile = drawn;
    active.drawCount = 1;
    // 顶端那张已由摸牌者拿走
    state.wall.live = state.wall.live.slice(topPhysical.length);
    state.wall.live.unshift(...topPhysical.slice(1));
    // 摸到最后一张可摸牌 → 海底（海底摸月 / 河底捞鱼判定用）
    active.haiteiDraw = state.wall.live.length === 0;
  }
  state.turn = turn;
  state.phase = PHASES.DRAW;
  const bad = checkInvariants(state);
  assert(bad.length === 0, `stack 后不变量失败：${bad.join('；')}`);
  return state;
}

/** 放弃所有待响应的鸣牌窗口，返回期间产生的事件 */
function passAllClaims(state) {
  const events = [];
  let guard = 0;
  while (state.phase === PHASES.CLAIM) {
    if (++guard > 8) throw new Error('passAllClaims: 循环异常');
    const s = currentSeat(state);
    const pass = legalActions(state, s).find((a) => a.type === 'pass');
    assert(pass !== undefined, `座位 ${s} 应能放弃鸣牌`);
    events.push(...applyAction(state, s, pass));
  }
  return events;
}

/** 让 keepSeats 之外的待响应座位全部放弃（自动废牌手可能碰巧能鸣牌） */
function passOthers(state, keepSeats) {
  const keep = Array.isArray(keepSeats) ? keepSeats : [keepSeats];
  let guard = 0;
  while (state.phase === PHASES.CLAIM && state.pendingClaims.some((p) => !keep.includes(p.seat))) {
    if (++guard > 8) throw new Error('passOthers: 循环异常');
    const s = state.pendingClaims.find((p) => !keep.includes(p.seat)).seat;
    const pass = legalActions(state, s).find((a) => a.type === 'pass');
    assert(pass !== undefined, `座位 ${s} 应能放弃鸣牌`);
    applyAction(state, s, pass);
  }
}

/** 让当前玩家打一张牌（先放弃所有鸣牌窗口） */
function stepDiscard(state) {
  passAllClaims(state);
  const s = currentSeat(state);
  const a = legalActions(state, s).find((x) => x.type === 'discard');
  assert(a !== undefined, `座位 ${s} 应有牌可打（阶段 ${state.phase}）`);
  return applyAction(state, s, a);
}

// ---------------------------------------------------------------------------
// 自动对局驱动器（随机合法动作 + 简单策略）
// ---------------------------------------------------------------------------
const AUTO_GAMES = Number(process.env.MJ_AUTO_GAMES || 200);

function chooseDiscard(actions, hand, meldCount, rnd) {
  const tiles = actions.filter((a) => a.type === 'discard');
  if (tiles.length === 0) return null;
  let best = null;
  let bestScore = Infinity;
  for (const a of tiles) {
    const h = cloneHand(hand);
    h[normalizeIndex(a.tile)] -= 1;
    const score = shanten(h, meldCount) + rnd() * 0.05;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * 把一个完整对局跑到结束。
 *
 * @param {number} seed 对局种子
 * @param {{checkEvery?: boolean, events?: boolean, length?: string, decisionSeed?: number}} opts
 */
function autoPlay(seed, opts = {}) {
  const state = createGame({ seed, length: opts.length || 'tonpuu' });
  const rnd = makeRng(opts.decisionSeed === undefined ? seed * 7919 + 13 : opts.decisionSeed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const stats = { hands: 0, wins: 0, tsumo: 0, ron: 0, draws: {}, turns: 0, events: 0, firstEvents: [] };
  let guard = 0;
  while (!isGameOver(state)) {
    if (++guard > 200) throw new Error('对局局数异常（>200 局）');
    const startEv = startHand(state);
    stats.events += startEv.length;
    if (opts.events && stats.hands === 0) stats.firstEvents.push(...startEv);
    stats.hands += 1;
    let steps = 0;
    while (!isHandOver(state)) {
      if (++steps > 4000) throw new Error('本局步数异常（>4000）');
      const seat = currentSeat(state);
      const acts = legalActions(state, seat);
      assert(acts.length > 0, `座位 ${seat} 无合法动作（阶段 ${state.phase}）`);
      const win = acts.find((a) => a.type === 'tsumo' || a.type === 'ron');
      let act = null;
      if (win) act = win;
      else {
        const riichi = acts.find((a) => a.type === 'riichi');
        const kans = acts.filter((a) => a.type === 'kan');
        const calls = acts.filter((a) => a.type === 'pon' || a.type === 'chi');
        const ky = acts.find((a) => a.type === 'kyuushu');
        if (riichi && rnd() < 0.95) act = riichi;
        else if (ky && rnd() < 0.7) act = ky;
        else if (kans.length > 0 && rnd() < 0.5) act = pick(kans);
        else if (calls.length > 0 && rnd() < 0.3) act = pick(calls);
        if (act === null) act = chooseDiscard(acts, state.players[seat].hand, state.players[seat].melds.length, rnd);
        if (act === null) act = pick(acts);
      }
      const ev = applyAction(state, seat, act);
      stats.events += ev.length;
      if (opts.events && stats.hands === 1) stats.firstEvents.push(...ev);
      if (opts.checkEvery !== false) {
        const bad = checkInvariants(state);
        assert(bad.length === 0, `不变量失败（动作 ${describeAction(act)}）：${bad.join('；')}`);
      }
    }
    const r = state.result;
    assert(r !== null, '本局结束后 result 为空');
    assert(r.type === 'win' || r.type === 'draw', `未知结果类型 ${r.type}`);
    stats.turns += sum(state.players.map((p) => p.discardCount)) / 4;
    if (r.type === 'win') {
      stats.wins += 1;
      for (const w of r.winners) (w.isTsumo ? (stats.tsumo += 1) : (stats.ron += 1));
    } else {
      stats.draws[r.kind] = (stats.draws[r.kind] || 0) + 1;
    }
    const after = checkInvariants(state);
    assert(after.length === 0, `终局不变量失败：${after.join('；')}`);
  }
  assert(state.ranking !== null, '终局应给出顺位');
  assert(sum(state.players.map((p) => p.score)) === 100000, '终局点数总和应为 100000');
  return { state, stats };
}

// ===========================================================================
// 1. 可复现性
// ===========================================================================
test('可复现性：同一 seed 的两个对局逐事件完全一致', () => {
  for (const seed of [1, 42, 987654]) {
    const a = autoPlay(seed, { checkEvery: false, events: true });
    const b = autoPlay(seed, { checkEvery: false, events: true });
    assertEq(b.stats.firstEvents, a.stats.firstEvents, `seed ${seed} 的事件流应完全一致`);
    assertEq(b.state.players.map((p) => p.score), a.state.players.map((p) => p.score), `seed ${seed} 终局点数应一致`);
    assertEq(b.state.ranking, a.state.ranking, `seed ${seed} 顺位应一致`);
    assertEq(b.stats, a.stats, `seed ${seed} 统计应一致`);
  }
});

test('可复现性：不同 seed 给出不同牌局；rngState 可快照', () => {
  const a = autoPlay(1, { checkEvery: false, events: true });
  const b = autoPlay(2, { checkEvery: false, events: true });
  assert(JSON.stringify(a.stats) !== JSON.stringify(b.stats), '不同 seed 结果不应完全相同');
  const s1 = createGame({ seed: 7 });
  const s2 = createGame({ seed: 7 });
  startHand(s1);
  startHand(s2);
  assertEq(s1.rngState, s2.rngState, '同 seed 开局后 rngState 应一致');
  assertEq(handToStr(s1.players[0].hand), handToStr(s2.players[0].hand), '同 seed 配牌应一致');
  assert(Number.isInteger(s1.rngState) && s1.rngState >= 0, 'rngState 应为非负整数');
  assertEq(s1.seed, 7, 'seed 应记录在 state 上');
});

// ===========================================================================
// 2. 牌山
// ===========================================================================
test('牌山：122 + 4 + 10 = 136，每种牌 4 张，含 3 张赤 5', () => {
  const wall = buildWall(makeRng(2024), undefined);
  assertEq(wall.live.length, LIVE_WALL_SIZE, '可摸牌应为 122 张');
  assertEq(wall.rinshan.length, RINSHAN_SIZE, '岭上牌应为 4 张');
  assertEq(wall.dead.length, DEAD_WALL_SIZE, '王牌应为 10 张');
  const all = [...wall.live, ...wall.rinshan, ...wall.dead];
  assertEq(all.length, 136, '牌山总张数应为 136');
  const counts = new Array(34).fill(0);
  for (const t of all) counts[normalizeIndex(t)] += 1;
  assert(counts.every((c) => c === 4), '每种牌都应有 4 张');
  assertEq(all.filter((t) => t >= 34).sort((a, b) => a - b), [34, 35, 36], '默认应有赤 5m/5p/5s 各 1 张');
  assertEq(kanDoraIndicator(wall.dead, 0), wall.dead[2], '第 1 张杠宝牌指示牌位置');
  assertEq(kanUraIndicator(wall.dead, 3), wall.dead[9], '第 4 张杠里宝牌指示牌位置');
});

test('牌山：同 seed 一致、可注入 rng、shuffle 不改入参', () => {
  const a = buildWall(makeRng(99), undefined);
  const b = buildWall(makeRng(99), undefined);
  assertEq(a.live, b.live, '同 seed 牌山应一致');
  assert(JSON.stringify(a.live) !== JSON.stringify(buildWall(makeRng(100), undefined).live), '不同 seed 应不同');
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(src, makeRng(3));
  assertEq(src, [1, 2, 3, 4, 5, 6, 7, 8], 'shuffle 不应修改入参');
  assertEq([...out].sort((x, y) => x - y), src, 'shuffle 应保持元素集合');
  const rng = makeRng(5);
  const seq = [rng(), rng(), rng()];
  const rng2 = makeRng(5);
  assertEq([rng2(), rng2(), rng2()], seq, 'makeRng 应可复现');
  assert(seq.every((x) => x >= 0 && x < 1), 'rng 应返回 [0,1)');
  assertEq(fullTileSet().length, 136, 'fullTileSet 应为 136 张');
  assertThrows(() => buildWall('nope'), 'buildWall 应拒绝非函数 rng');
});

// ===========================================================================
// 3. 配牌与非法动作
// ===========================================================================
test('开局：庄家 14 张、闲家 13 张、翻 1 张宝牌指示牌', () => {
  const state = createGame({ seed: 11 });
  assertEq(state.phase, PHASES.IDLE, '未开局应为 idle');
  assertThrows(() => applyAction(state, 0, { type: 'discard', tile: 0 }), '未开局应拒绝动作');
  const events = startHand(state);
  assert(events.some((e) => e.type === 'hand_start'), '应有 hand_start 事件');
  const draw = events.find((e) => e.type === 'draw');
  assert(draw !== undefined && draw.seat === state.dealer, '庄家应先摸第 14 张');
  assertEq(totalTiles(state.players[state.dealer].hand), 14, '庄家应有 14 张');
  for (let s = 0; s < 4; s++) {
    if (s === state.dealer) continue;
    assertEq(totalTiles(state.players[s].hand), 13, `闲家 ${s} 应有 13 张`);
  }
  assertEq(state.doraIndicators.length, 1, '开局翻 1 张宝牌指示牌');
  assertEq(checkInvariants(state), [], '开局后不变量应通过');
  assertEq(currentSeat(state), state.dealer, '当前应是庄家行动');
  assertEq(countAllTiles(state).reduce((a, b) => a + b, 0), 136, '全场牌数应为 136');
});

test('非法动作一律抛错（打不存在的牌 / 不该自己动 / 未知类型）', () => {
  const state = createGame({ seed: 12 });
  startHand(state);
  const dealer = state.dealer;
  const other = (dealer + 1) % 4;
  assertThrows(() => applyAction(state, other, { type: 'discard', tile: 0 }), '不该该座位行动时应抛错');
  const notInHand = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((t) => state.players[dealer].hand[t] === 0);
  assertThrows(() => applyAction(state, dealer, { type: 'discard', tile: notInHand }), '打手里没有的牌应抛错');
  assertThrows(() => applyAction(state, dealer, { type: 'chi', tiles: [0, 1] }), '非响应阶段不能吃');
  assertThrows(() => applyAction(state, dealer, { type: 'bogus' }), '未知动作类型应抛错');
  assertThrows(() => applyAction(state, 9, { type: 'discard', tile: 0 }), '座位越界应抛错');
  assertThrows(() => {
    const v = viewFor(state, 9);
    void v;
  }, 'viewFor 座位越界应抛错');
});

// ===========================================================================
// 4. 食替禁止（rules.md §4.3）
// ===========================================================================
test('食替：吃 345s+6s 后立即打 3s（筋替）非法，过一巡后允许', () => {
  const state = createGame({ seed: 22 });
  startHand(state);
  // 庄家（座位 0）手中有 6s 可打；座位 1（下家）手中有 345s
  stack(state, {
    hands: ['6s123m456p789p11z9s', '345s19m19p112233z', null, null],
    dora: '5z',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('6s') });
  const chi = legalActions(state, 1).find((a) => a.type === 'chi');
  assert(chi !== undefined, '座位 1 应该可以吃 6s');
  assertEq(chi.tiles, [strToTile('4s'), strToTile('5s')], '应当用 4s5s 吃 6s');
  applyAction(state, 1, chi);
  const discards = legalActions(state, 1).filter((a) => a.type === 'discard').map((a) => a.tile);
  assert(!discards.includes(strToTile('3s')), '吃 45s 叫 6s 后立即打 3s 应被禁止（筋替 start-1）');
  assert(!discards.includes(strToTile('6s')), '打刚吃进的 6s 应被禁止（现物替）');
  assert(!discards.includes(strToTile('7s')), '打 start+3 的 7s 应被禁止（筋替）');
  assert(discards.length > 0, '仍应有别的牌可打');
  assertThrows(() => applyAction(state, 1, { type: 'discard', tile: strToTile('3s') }), '非法食替应抛错');
  applyAction(state, 1, { type: 'discard', tile: strToTile('1z') });
  for (let i = 0; i < 3; i++) stepDiscard(state);
  assertEq(currentSeat(state), 1, '应轮回座位 1');
  const after = legalActions(state, 1).filter((a) => a.type === 'discard').map((a) => a.tile);
  assert(after.includes(strToTile('3s')), '经过一巡后打 3s 应被允许（§4.3）');
});

test('食替：234567s 吃 8s 打 2s 允许（与吃进牌组不成同一顺子）', () => {
  const state = createGame({ seed: 23 });
  startHand(state);
  assertEq(chiOptions(parseHand('234567s19m19p11z3z'), strToTile('8s')).length, 1, '234567s 只有一种吃 8s 的取法');
  assertEq(chiOptions(parseHand('234567s19m19p11z3z'), strToTile('8s'))[0], [strToTile('6s'), strToTile('7s')], '应用 6s7s 吃 8s');
  stack(state, {
    hands: ['8s123m456p789p11z9s', '234567s19m19p11z3z', null, null],
    dora: '5z',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  const chi = legalActions(state, 1).find((a) => a.type === 'chi');
  assert(chi !== undefined, '应能吃 8s');
  applyAction(state, 1, chi);
  const discards = legalActions(state, 1).filter((a) => a.type === 'discard').map((a) => a.tile);
  assert(discards.includes(strToTile('2s')), '吃 8s 后打 2s 应被允许（§4.3）');
  assert(!discards.includes(strToTile('5s')), '打 start-1 的 5s 应被禁止');
  assert(!discards.includes(strToTile('9s')), '打 start+3 的 9s 应被禁止');
  assertEq(isKuikae({ type: 'chi', tiles: [23, 24, 25], calledTile: 25 }, strToTile('9s')), true, '9s 是 start+3（678s 叫 8s 后打 9s）');
  assertEq(isKuikae({ type: 'chi', tiles: [23, 24, 25], calledTile: 25 }, strToTile('5s')), true, '5s 是 start-1');
  assertEq(isKuikae({ type: 'chi', tiles: [23, 24, 25], calledTile: 25 }, strToTile('4s')), false, '4s 与 678s 组不成同一顺子，不受限');
  assertEq(isKuikae({ type: 'pon', tiles: [4, 4, 4], calledTile: 4 }, 4), true, '碰后打同一张是现物替');
});

// ===========================================================================
// 5. 立直后暗杠（rules.md §5.4）
// ===========================================================================
test('立直后暗杠改变听牌型 → 非法（听牌集合必须完全一致）', () => {
  const state = createGame({ seed: 31 });
  startHand(state);
  // 13 张形 1111m2345678m99m 听 3m/6m/9m；摸 5p 后暗杠 1m 会变成完全不听
  stack(state, {
    turn: 1,
    hands: [null, '1111m2345678m99m', null, null],
    wall: ['5p'],
    dora: '5z',
  });
  const p = state.players[1];
  p.riichi = true;
  p.riichiWaits = [2, 5, 8]; // 3m/6m/9m
  p.ippatsu = true;
  assertEq(waitsFor(state, 1).map(tileToStr), ['3m', '6m', '9m'], '该手牌应听 3m/6m/9m');
  assertEq(legalActions(state, 1).filter((a) => a.type === 'kan'), [], '改变听牌型的暗杠不应出现在合法动作里');
  assertThrows(() => applyAction(state, 1, { type: 'kan', kind: 'ankan', tile: 0 }), '非法暗杠应抛错');
});

test('立直后暗杠不改变听牌型 → 允许（正向对照）', () => {
  const state = createGame({ seed: 32 });
  startHand(state);
  // 13 张形 789999m2234p567s 听 2p/5p；摸 6m 后暗杠 9m 听牌集合不变
  stack(state, {
    turn: 1,
    hands: [null, '789999m2234p567s', null, null],
    wall: ['6m'],
    dora: '5z',
  });
  const p = state.players[1];
  p.riichi = true;
  p.riichiWaits = [10, 13]; // 2p/5p
  p.ippatsu = true;
  assertEq(waitsFor(state, 1).map(tileToStr), ['2p', '5p'], '该手牌应听 2p/5p');
  const kans = legalActions(state, 1).filter((a) => a.type === 'kan' && a.kind === 'ankan');
  assertEq(kans.map((a) => a.tile), [strToTile('9m')], '不改变听牌型的暗杠应被允许');
  const events = applyAction(state, 1, kans[0]);
  assert(events.some((e) => e.type === 'kan' && e.kind === 'ankan'), '应有 kan 事件');
  assert(events.some((e) => e.type === 'dora_reveal'), '暗杠应立即翻杠宝牌（§3.5）');
  assertEq(state.players[1].melds.length, 1, '应有 1 组副露');
  assertEq(state.players[1].melds[0].type, 'ankan', '应为暗杠');
  assertEq(state.players[1].menzen, true, '暗杠不破坏门清');
  assertEq(state.players[1].hand[strToTile('9m')], 0, '4 张 9m 应全部离手');
  assertEq(totalTiles(state.players[1].hand), 11, '暗杠后摸岭上牌应为 11 张');
  assertEq(waitsFor(state, 1).map(tileToStr), ['2p', '5p'], '暗杠后听牌集合应不变');
});

// ===========================================================================
// 6. 振听（rules.md §6.3）
// ===========================================================================
test('振听时 legalActions 里没有 ron（自摸不受限）', () => {
  const state = createGame({ seed: 41 });
  startHand(state);
  // 座位 0 手中有 5s/8s；座位 1 听 5s/8s 且有断幺九；座位 1 自己牌河里已有 5s → 舍牌振听
  stack(state, {
    hands: ['5s8s123m456p11z789p', '234m567m234p55s67s', null, null],
    ponds: [null, ['5s'], null, null],
    dora: '9s',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('5s') });
  const acts = legalActions(state, 1);
  assert(!acts.some((a) => a.type === 'ron'), '舍牌振听时不应有 ron');
  assert(acts.some((a) => a.type === 'pass'), '仍应有 pass');
  assertThrows(() => applyAction(state, 1, { type: 'ron' }), '振听荣和应抛错');
  assertEq(state.players[1].furiten, true, '玩家 furiten 字段应为 true');
});

test('未振听时可以荣和（对照组）', () => {
  const state = createGame({ seed: 42 });
  startHand(state);
  stack(state, {
    hands: ['5s8s123m456p11z789p', '234m567m234p55s67s', null, null],
    dora: '9s',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  assert(legalActions(state, 1).some((a) => a.type === 'ron'), '未振听时应能荣和 8s');
  const ev = applyAction(state, 1, { type: 'ron' });
  const win = ev.find((e) => e.type === 'win');
  assert(win !== undefined, '应有 win 事件');
  assert(win.result.han >= 1, '应至少有 1 番');
  assert(isHandOver(state), '本局应结束');
});

test('同巡振听：见逃后不能荣和（§6.3）', () => {
  const state = createGame({ seed: 43 });
  startHand(state);
  stack(state, {
    hands: ['5s8s123m456p11z789p', '234m567m234p55s67s', null, null],
    dora: '9s',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  applyAction(state, 1, { type: 'pass' }); // 见逃
  assertEq(state.players[1].tempFuriten, true, '见逃后应处于同巡振听');
  assertEq(state.players[1].furiten, true, 'furiten 字段应同步');
  stepDiscard(state); // 座位 2 打牌
  const s3 = currentSeat(state);
  if (state.players[s3].hand[strToTile('8s')] > 0) {
    applyAction(state, s3, { type: 'discard', tile: strToTile('8s') });
    assert(!legalActions(state, 1).some((a) => a.type === 'ron'), '同巡振听中不应有 ron');
  }
});

// ===========================================================================
// 7. 九种九牌（rules.md §10.5.1）
// ===========================================================================
test('九种九牌：首次摸牌 + 未鸣牌 + 幺九 9 种以上才出现；宣告后连庄', () => {
  const state = createGame({ seed: 51 });
  startHand(state);
  stack(state, { hands: ['19m19p19s1234567z', null, null, null], dora: '5z' });
  const acts = legalActions(state, state.dealer);
  assert(acts.some((a) => a.type === 'kyuushu'), '13 种幺九应可宣告九种九牌');
  const events = applyAction(state, state.dealer, { type: 'kyuushu' });
  const de = events.find((e) => e.type === 'draw_end');
  assertEq(de.kind, 'kyuushu', '应为九种九牌流局');
  assertEq(de.payments, [], '途中流局不产生收付');
  const he = events.find((e) => e.type === 'hand_end');
  assertEq(he.deltas, [0, 0, 0, 0], '途中流局不产生收付');
  assertEq(he.nextDealer, state.dealer, '途中流局应连庄');
  assertEq(he.nextHonba, 1, '途中流局本场 +1');
});

test('九种九牌：只有 8 种幺九 / 已鸣牌 / 第二次摸牌 均不出现', () => {
  const s8 = createGame({ seed: 52 });
  startHand(s8);
  stack(s8, { hands: ['19m19p19s12z23456m', null, null, null], dora: '5z' });
  assert(!legalActions(s8, s8.dealer).some((a) => a.type === 'kyuushu'), '8 种幺九不应出现九种九牌');

  const s2 = createGame({ seed: 53 });
  startHand(s2);
  stack(s2, {
    hands: ['19m19p19s1234z', null, null, null],
    melds: [[{ type: 'pon', tiles: '555z', called: '5z' }], [], [], []],
    dora: '6z',
  });
  assertEq(totalTiles(s2.players[s2.dealer].hand), 11, '副露 1 组时暗牌 10 张 + 刚摸的第 11 张');
  assert(!legalActions(s2, s2.dealer).some((a) => a.type === 'kyuushu'), '已鸣牌不应出现九种九牌');

  const s3 = createGame({ seed: 54 });
  startHand(s3);
  stack(s3, { hands: ['19m19p19s1234567z', null, null, null], dora: '5z' });
  s3.players[s3.dealer].drawCount = 2;
  assert(!legalActions(s3, s3.dealer).some((a) => a.type === 'kyuushu'), '第二次摸牌不应出现九种九牌');
});

// ===========================================================================
// 8. 四风连打 / 四家立直 / 四槓散了
// ===========================================================================
test('四风连打：第一巡四家连续打出同一种风牌 → 途中流局', () => {
  const state = createGame({ seed: 61 });
  startHand(state);
  const hand = '1z234m567m234p5s8s9s'; // 每家同一形 → 每种牌恰好 4 张
  stack(state, { hands: [hand, hand, hand, hand], dora: '6z' });
  for (let i = 0; i < 4; i++) {
    const seat = currentSeat(state);
    const dz = legalActions(state, seat).find((a) => a.type === 'discard' && normalizeIndex(a.tile) === 27);
    assert(dz !== undefined, `座位 ${seat} 应能打出東`);
    const ev = applyAction(state, seat, dz);
    if (i < 3) {
      assert(!ev.some((e) => e.type === 'draw_end'), `第 ${i + 1} 家打東不应流局`);
      passAllClaims(state);
      assertEq(currentSeat(state), (seat + 1) % 4, '应轮到下一家');
    } else {
      const de = ev.find((e) => e.type === 'draw_end');
      assert(de !== undefined, '第 4 家打東应触发四风连打');
      assertEq(de.kind, 'suufonrenda', 'kind 应为 suufonrenda');
      const he = ev.find((e) => e.type === 'hand_end');
      assertEq(he.nextDealer, state.dealer, '途中流局应连庄');
      assertEq(he.nextHonba, 1, '途中流局本场 +1');
    }
  }
  assertEq(state.players.every((p) => p.pond.length === 1), true, '四家各打出一张');
  assertEq(state.players.map((p) => p.pond[0]), [27, 27, 27, 27], '四家都打的是東');
});

test('四家立直：四家全部立直 → 途中流局，立直棒留场', () => {
  const state = createGame({ seed: 62 });
  startHand(state);
  const hand = '234m567m234p567s9p'; // 听 9p（单骑），每家同一形 → 每种牌恰好 4 张
  stack(state, { hands: [hand, hand, hand, hand], wall: ['1z', '2z', '3z', '4z'], dora: '5z' });
  for (let i = 0; i < 4; i++) {
    const seat = currentSeat(state);
    const riichi = legalActions(state, seat).find((a) => a.type === 'riichi');
    assert(riichi !== undefined, `座位 ${seat} 应能立直（第 ${i + 1} 家）`);
    const ev = applyAction(state, seat, riichi);
    if (i < 3) {
      assert(!ev.some((e) => e.type === 'draw_end'), `第 ${i + 1} 家立直不应流局`);
      passAllClaims(state);
      assertEq(currentSeat(state), (seat + 1) % 4, '应轮到下一家');
    } else {
      const de = ev.find((e) => e.type === 'draw_end');
      assert(de !== undefined, '第四家立直成立应触发四家立直流局');
      assertEq(de.kind, 'suuchariichi', 'kind 应为 suuchariichi');
    }
  }
  assertEq(state.riichiSticks, 4, '四根立直棒应留场');
  assertEq(state.players.filter((p) => p.riichi).length, 4, '四家都应处于立直状态');
  assertEq(checkInvariants(state), [], '四家立直后不变量应通过');
  assertEq(sum(state.players.map((p) => p.score)) + 4000, 100000, '点数总和含供托应为 100000');
});

test('四槓散了：复数人开出第 4 槓且打牌未放铳 → 途中流局', () => {
  const state = createGame({ seed: 63 });
  startHand(state);
  stack(state, {
    hands: ['1111m234567p89s5z', '2222m234567p89s5z', '3333m234567p89s5z', '4444m234567p89s5z'],
    dora: '6z',
  });
  for (let i = 0; i < 4; i++) {
    const seat = currentSeat(state);
    const kan = legalActions(state, seat).find((a) => a.type === 'kan' && a.kind === 'ankan');
    assert(kan !== undefined, `座位 ${seat} 应有暗杠可选（第 ${i + 1} 槓）`);
    applyAction(state, seat, kan);
    assertEq(state.kanCount, i + 1, `开杠次数应为 ${i + 1}`);
    assertEq(state.kanOwners.length, i + 1, '开杠者列表应同步');
    const dz = legalActions(state, seat).find((a) => a.type === 'discard');
    assert(dz !== undefined, `座位 ${seat} 杠后应能打牌`);
    const ev = applyAction(state, seat, dz);
    if (i < 3) {
      assert(!ev.some((e) => e.type === 'draw_end'), `第 ${i + 1} 槓后不应流局`);
      passAllClaims(state);
    } else {
      const de = ev.find((e) => e.type === 'draw_end');
      assert(de !== undefined, '第 4 槓后打牌未放铳应四槓散了');
      assertEq(de.kind, 'sukanagare', 'kind 应为 sukanagare');
      const he = ev.find((e) => e.type === 'hand_end');
      assertEq(he.nextDealer, state.dealer, '途中流局应连庄');
      assertEq(he.nextHonba, 1, '途中流局本场 +1');
    }
  }
  assertEq(state.players.filter((p) => p.melds.length > 0).length, 4, '四家各有一组暗杠');
  assertEq(state.kanOwners, [0, 1, 2, 3], '四次开杠分属四家');
});

test('四槓散了判定：同一人 4 槓不流局，复数人才流局（§10.5.4）', () => {
  assertEq(isSuukaikanPending(3, [0, 0, 0]), false, '不足 4 槓不流局');
  assertEq(isSuukaikanPending(4, [0, 0, 0, 0]), false, '同一人开 4 槓不流局（保留四槓子机会）');
  assertEq(isSuukaikanPending(4, [0, 0, 0, 1]), true, '复数人开出第 4 槓 → 流局判定');
  assertEq(isSuukaikanPending(4, [0, 1, 2, 3]), true, '四家各一槓 → 流局判定');
  assertEq(isSuukaikanPending(4, [0, 1, 0, 0]), true, '第 4 槓由另一人开出 → 流局判定');
});

test('同一人连开 3 槓不流局', () => {
  const state = createGame({ seed: 64 });
  startHand(state);
  stack(state, { hands: ['1111m2222m3333m5p', null, null, null], dora: '6z' });
  for (let i = 0; i < 3; i++) {
    passAllClaims(state); // 先清掉上一步留下的鸣牌窗口
    const seat = currentSeat(state);
    assertEq(seat, 0, '应轮回庄家');
    const kan = legalActions(state, seat).find((a) => a.type === 'kan' && a.kind === 'ankan');
    assert(kan !== undefined, `庄家应能开第 ${i + 1} 槓`);
    applyAction(state, seat, kan);
    // 摸切（打刚摸到的那张），避免把下一个暗杠的四张拆掉
    const drawn = state.players[seat].drawnTile;
    const dz = legalActions(state, seat).find((a) => a.type === 'discard' && normalizeIndex(a.tile) === normalizeIndex(drawn));
    assert(dz !== undefined, '杠后应能摸切');
    const ev = applyAction(state, seat, dz);
    assert(!ev.some((e) => e.type === 'draw_end'), `同一人开第 ${i + 1} 槓不应流局（§10.5.4）`);
    assertEq(state.players[seat].melds.length, i + 1, `应有 ${i + 1} 组暗杠`);
    for (let k = 0; k < 3; k++) stepDiscard(state);
  }
  assertEq(state.kanCount, 3, '应开出 3 槓');
  assertEq(state.suukaikanPending, false, '同一人 3 槓不应进入四槓散了');
  assert(!isHandOver(state), '不应流局');
});

// ===========================================================================
// 9. 连庄 / 轮庄 / 本场（rules.md §2.6）
// ===========================================================================
test('亲家和牌 → 连庄且本场 +1；子家和牌 → 轮庄且本场归零', () => {
  const state = createGame({ seed: 71 });
  startHand(state);
  const dealer = state.dealer;
  stack(state, { hands: ['234m567m234p55s67s', null, null, null], wall: ['8s'], dora: '9s' });
  state.honba = 3;
  const events = applyAction(state, dealer, { type: 'tsumo' });
  const he = events.find((e) => e.type === 'hand_end');
  assert(he !== undefined, '应有 hand_end');
  assertEq(he.nextDealer, dealer, '亲家和牌应连庄');
  assertEq(he.nextHonba, 4, '亲家和牌本场应 +1');
  assert(he.gameOver === false, '不应终局');
  assertEq(sum(he.deltas), 0, '无人立直时 deltas 之和应为 0');
  assertEq(state.handNumber, 0, '连庄不应推进局数');

  const s2 = createGame({ seed: 73, handNumber: 1 });
  startHand(s2);
  stack(s2, { turn: 2, hands: [null, null, '234m567m234p55s67s', null], wall: ['8s'], dora: '9s' });
  s2.honba = 2;
  assertEq(s2.dealer, 1, '南一局（handNumber=1）庄家应是座位 1');
  const he3 = applyAction(s2, 2, { type: 'tsumo' }).find((e) => e.type === 'hand_end');
  assertEq(he3.nextDealer, 2, '子家和牌应轮庄');
  assertEq(he3.nextHonba, 0, '子家和牌本场应归零');
  assertEq(s2.honba, 0, 'state.honba 应已更新');
  assertEq(s2.handNumber, 2, '应推进到下一局');
});

test('荒牌流局：亲家听牌连庄，亲家不听轮庄（形式听牌也算）', () => {
  const state = createGame({ seed: 81 });
  startHand(state);
  stack(state, {
    hands: ['123m456m789m123p1s', null, null, null],
    wall: ['2s'],
    emptyWall: true,
    dora: '5z',
  });
  const dealerWaits = waitsFor(state, 0);
  assertEq(dealerWaits.map(tileToStr), ['1s'], '庄家应单骑听 1s');
  const ev = applyAction(state, 0, { type: 'discard', tile: strToTile('2s') });
  const de = ev.find((e) => e.type === 'draw_end');
  assert(de !== undefined, '牌山摸完应荒牌流局');
  assertEq(de.kind, 'exhaustive', '应为荒牌流局');
  assertEq(de.tenpai[0], true, '庄家听牌');
  assertEq(de.tenpai.slice(1), [false, false, false], '其余三家不听（自动废牌手）');
  const he = ev.find((e) => e.type === 'hand_end');
  assertEq(he.nextDealer, 0, '亲家听牌则连庄');
  assertEq(he.nextHonba, 1, '连庄则本场 +1');
});

test('听牌罚符：荒牌流局的收付与十种分布一致（§10.3）', () => {
  const state = createGame({ seed: 82 });
  startHand(state);
  stack(state, {
    hands: ['123m456m789m123p1s', null, null, null],
    wall: ['2s'],
    emptyWall: true,
    dora: '5z',
  });
  const ev = applyAction(state, 0, { type: 'discard', tile: strToTile('2s') });
  const de = ev.find((e) => e.type === 'draw_end');
  assert(de !== undefined, '应荒牌流局');
  const tp = de.tenpai;
  const winners = tp.filter(Boolean).length;
  const losers = 4 - winners;
  const expected = tp.map((t) => (winners === 0 || losers === 0 ? 0 : t ? 3000 / winners : -3000 / losers));
  const deltas = ev.find((e) => e.type === 'hand_end').deltas;
  assertEq(deltas, expected, `听牌分布 ${JSON.stringify(tp)} 的罚符应为 ${JSON.stringify(expected)}`);
  assertEq(sum(deltas), 0, '罚符总和应为 0');
  assertEq(winners, 1, '本局面应恰有 1 家听牌');
  assertEq(deltas, [3000, -1000, -1000, -1000], '1 人听：不听者各付 1000');
});

test('本场加点：荣和放铳者全额支付 300 × 本场（§2.4）', () => {
  const run = (honba) => {
    const state = createGame({ seed: 91 });
    startHand(state);
    stack(state, {
      hands: ['5s8s123m456p11z789p', '234m567m234p55s67s', null, null],
      dora: '9s',
    });
    state.honba = honba;
    applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
    passOthers(state, 1);
    const ev = applyAction(state, 1, { type: 'ron' });
    const win = ev.find((e) => e.type === 'win');
    assert(win !== undefined, '应产生和牌');
    return win.result;
  };
  const base = run(0);
  const honba2 = run(2);
  assertEq(base.payments.breakdown[0].seat, 0, '放铳者应是座位 0');
  assertEq(base.deltas[0], -base.payments.breakdown[0].amount, '放铳者全额支付');
  assertEq(
    honba2.payments.breakdown[0].amount - base.payments.breakdown[0].amount,
    600,
    '2 本场应比 0 本场多付 600（300 × 2，荣和由放铳者全付）',
  );
});

test('立直棒归和牌者（多家和牌时归头跳家）', () => {
  const state = createGame({ seed: 92 });
  startHand(state);
  stack(state, {
    hands: ['5s8s123m456p11z789p', '234m567m234p55s67s', null, null],
    dora: '9s',
  });
  state.players[2].score -= 2000;
  state.riichiSticks = 2;
  assertEq(checkInvariants(state), [], '供托计入后点数总和仍应为 100000');
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  const ev = applyAction(state, 1, { type: 'ron' });
  const win = ev.find((e) => e.type === 'win');
  assertEq(win.result.riichiSticksTaken, 2, '和牌者应取得 2 根立直棒');
  assertEq(state.riichiSticks, 0, '供托应清零');
  assertEq(sum(win.result.deltas), 2000, 'deltas 之和应等于供托总额');
});

// ===========================================================================
// 10. 立直宣言牌放铳（燕返，rules.md §5.2）
// ===========================================================================
test('立直宣言牌放铳（燕返）：立直不成立、供托退还', () => {
  const state = createGame({ seed: 101 });
  startHand(state);
  // 庄家 13 张听 5s/8s，摸到 9p 后宣言立直并打出 9p；座位 1 单骑听 9p（役牌白）
  stack(state, {
    hands: ['234m567m234p55s67s', '234m567m234p555z9p', null, null],
    wall: ['9p'],
    dora: '9s',
  });
  assertEq(waitsFor(state, 1).map(tileToStr), ['9p'], '座位 1 应单骑听 9p');
  const riichi = legalActions(state, 0).find((a) => a.type === 'riichi' && a.tile === strToTile('9p'));
  assert(riichi !== undefined, '庄家应能立直并打出 9p');
  const events = applyAction(state, 0, riichi);
  assert(events.some((e) => e.type === 'riichi'), '应有 riichi 事件');
  assertEq(state.riichiSticks, 1, '宣言后应有 1 根立直棒');
  assertEq(state.players[0].score, 24000, '宣言后点数应扣 1000');
  assert(legalActions(state, 1).some((a) => a.type === 'ron'), '座位 1 应能荣和宣言牌');
  passOthers(state, 1);
  const win = applyAction(state, 1, { type: 'ron' }).find((e) => e.type === 'win');
  assert(win !== undefined, '应有 win 事件');
  assertEq(win.result.yaku.map((y) => y.id), ['yakuhaiHaku'], '和牌役应是役牌白（与座位 0 的立直无关）');
  assertEq(state.players[0].riichi, false, '立直应不成立（燕返）');
  assertEq(state.players[0].doubleRiichi, false, '两立直同样不成立');
  assertEq(state.players[0].ippatsu, false, '一发作废');
  assertEq(state.riichiSticks, 0, '宣言供托应退还');
  assertEq(state.players[0].score, 24000 + 1000 - win.result.payments.breakdown[0].amount, '点数应退还 1000 并支付放铳');
  assertEq(win.result.riichiSticksTaken, 0, '退还的立直棒不应被和牌者取走');
});

// ===========================================================================
// 11. 击飞（rules.md §12.2）
// ===========================================================================
function hakofuriCase(startScore) {
  const scores = [startScore, 100000 - startScore - 25000 - 25000, 25000, 25000];
  if (scores[1] < 0) throw new Error('测试分数设置有误');
  const state = createGame({ seed: 111, scores });
  startHand(state);
  // 座位 1 副露断幺九，听 8s；座位 0 放铳 → 1 番 30 符 = 1000 点
  stack(state, {
    hands: ['5s8s123m456p11z789p', '567m234p55s67s', null, null],
    melds: [[], [{ type: 'chi', tiles: '234m', called: '4m' }], [], []],
    dora: '9s',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  passOthers(state, 1);
  const ev = applyAction(state, 1, { type: 'ron' });
  return { state, win: ev.find((e) => e.type === 'win'), ev };
}

test('击飞：点数变负立即结束对局', () => {
  const { state, win, ev } = hakofuriCase(900);
  assert(win !== undefined, '应产生和牌');
  assertEq(win.result.payments.breakdown[0].amount, 1000, '应为 1 番 30 符 = 1000 点');
  assertEq(state.players[0].score, -100, '点数应为 -100（负数部分一并计算，不清零）');
  assertEq(isGameOver(state), true, '负数应立刻终局');
  assert(ev.some((e) => e.type === 'game_over'), '应有 game_over 事件');
  assert(state.ranking !== null, '应有顺位');
});

test('击飞：恰好 0 点继续游戏', () => {
  const { state, win, ev } = hakofuriCase(1000);
  assert(win !== undefined, '应产生和牌');
  assertEq(state.players[0].score, 0, '点数应恰好为 0');
  assertEq(isGameOver(state), false, '0 点不应终局');
  assert(!ev.some((e) => e.type === 'game_over'), '不应有 game_over 事件');
  assertEq(state.phase, PHASES.HAND_OVER, '应进入下一局准备状态');
  const ev2 = startHand(state);
  assert(ev2.some((e) => e.type === 'hand_start'), '0 点应能继续开新局');
});

// ===========================================================================
// 12. 多家和牌（rules.md §6.5）
// ===========================================================================
function multiRonSetup(seats) {
  const state = createGame({ seed: 121 });
  startHand(state);
  const hands = ['5s8s123m456p11z789p', '567m234p55s67s', '234m678p55m67s', null];
  const melds = [[], [{ type: 'chi', tiles: '234m', called: '4m' }], [{ type: 'chi', tiles: '234s', called: '4s' }], []];
  if (seats >= 3) {
    hands[3] = '234s567p55p67s';
    melds[3] = [{ type: 'chi', tiles: '678p', called: '8p' }];
  }
  stack(state, { hands, melds, dora: '9s' });
  state.players[2].score -= 2000;
  state.riichiSticks = 2; // 桌上 2 根立直棒
  return state;
}

test('双响：两家同时荣和全部结算，场供与立直棒归头跳家', () => {
  const state = multiRonSetup(2);
  for (const s of [1, 2]) assertEq(waitsFor(state, s).includes(strToTile('8s')), true, `座位 ${s} 应听 8s`);
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  assert(state.pendingClaims.some((x) => x.seat === 1), '座位 1 应进入响应');
  assert(state.pendingClaims.some((x) => x.seat === 2), '座位 2 应进入响应');
  passOthers(state, [1, 2]);
  applyAction(state, 1, { type: 'ron' });
  assertEq(isHandOver(state), false, '还有一家未响应，本局不应结束');
  const ev = applyAction(state, 2, { type: 'ron' });
  assertEq(ev.filter((e) => e.type === 'win').length, 2, '应有两家和牌（雀魂无头跳）');
  const r = state.result;
  assertEq(r.winners.length, 2, '结果里应有两家');
  const w1 = r.winners.find((w) => w.seat === 1);
  const w2 = r.winners.find((w) => w.seat === 2);
  assertEq(w1.riichiSticksTaken, 2, '立直棒应归头跳家（座位 1）');
  assertEq(w2.riichiSticksTaken, 0, '座位 2 不应取得立直棒');
  assertEq(r.deltas[0], -(w1.payments.breakdown[0].amount + w2.payments.breakdown[0].amount), '放铳者向两家各付全额');
  assertEq(sum(r.deltas), 2000, 'deltas 之和应等于供托总额');
  assertEq(state.riichiSticks, 0, '供托应清零');
  assertEq(state.dealer, 1, '子家和牌应轮庄');
  assertEq(state.ranking, null, '尚未终局');
});

test('三响：三家同时荣和全部结算（雀魂口径，无三家和流局）', () => {
  const state = multiRonSetup(3);
  for (const s of [1, 2, 3]) assertEq(waitsFor(state, s).includes(strToTile('8s')), true, `座位 ${s} 应听 8s`);
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  assertEq(state.pendingClaims.map((x) => x.seat).sort(), [1, 2, 3], '三家都应进入响应');
  applyAction(state, 3, { type: 'ron' });
  applyAction(state, 2, { type: 'ron' });
  const ev = applyAction(state, 1, { type: 'ron' });
  assertEq(ev.filter((e) => e.type === 'win').length, 3, '应有三家和牌');
  const r = state.result;
  assertEq(r.winners.length, 3, '结果里应有三家');
  assertEq(r.winners.find((w) => w.seat === 1).riichiSticksTaken, 2, '头跳家（座位 1）取得立直棒');
  assertEq(
    r.deltas[0],
    -r.winners.reduce((a, w) => a + w.payments.breakdown[0].amount, 0),
    '放铳者向三家各付全额',
  );
  assert(!ev.some((e) => e.type === 'draw_end'), '三家和不应流局（雀魂无三家和了流局）');
});

// ===========================================================================
// 13. 视图隔离（viewFor）
// ===========================================================================
test('viewFor：隐藏他人暗牌、深拷贝、冻结、终局后公开', () => {
  const state = createGame({ seed: 131 });
  startHand(state);
  const v = viewFor(state, 0);
  assert(v.players[0].hand !== null, '自己的暗牌应可见');
  assertEq(v.players[1].hand, null, '他人的暗牌应隐藏');
  assertEq(v.players[1].drawnTile, null, '他人的摸牌应隐藏');
  assertEq(v.players[1].pond.length, 0, '牌河应公开');
  assertEq(v.remainingTiles, 122 - 53, '剩余可摸牌数应正确');
  assertEq(Object.isFrozen(v), true, '快照应被冻结');
  assertThrows(() => {
    v.phase = 'hacked';
  }, '冻结对象赋值应抛错');
  const before = handToStr(state.players[0].hand);
  v.players[0].hand[0] = 99;
  v.players[1].melds.push({ type: 'pon', tiles: [0, 0, 0] });
  assertEq(handToStr(state.players[0].hand), before, '改快照不应影响内部状态');
  assertEq(state.players[1].melds.length, 0, '改快照不应影响内部 melds');
  assertEq(v.legalActions.length > 0, true, '应给出当前座位的合法动作');

  stack(state, { turn: 1, hands: [null, '234m567m234p55s67s', null, null], wall: ['8s'], dora: '9s' });
  applyAction(state, 1, { type: 'tsumo' });
  const v2 = viewFor(state, 0);
  assertEq(v2.phase, PHASES.HAND_OVER, '应已进入本局结束');
  assert(v2.players[1].hand !== null, '本局结束后应公开暗牌');
  assert(v2.result !== null && v2.result.type === 'win', '结果应可见');
  const v3 = viewFor(state, 1);
  assertEq(v3.self.seat, 1, 'self 应是观察者本人');
  assertEq(v3.legalActions, [], '本局结束后没有合法动作');
});

// ===========================================================================
// 14. 海底牌不可鸣 / 河底捞鱼（rules.md §3.4）
// ===========================================================================
test('不可以鸣海底牌（吃/碰/大明杠），但可以被荣和', () => {
  const state = createGame({ seed: 141 });
  startHand(state);
  stack(state, {
    hands: ['456s789s123m4p11z9s', '123m456s789s44p13z', null, null],
    wall: ['7z'],
    emptyWall: true,
    dora: '6z',
  });
  assertEq(state.wall.live.length, 0, '海底牌已被摸走，牌山为空');
  assertEq(state.players[0].haiteiDraw, true, '当前摸到的应是海底牌');
  const ev = applyAction(state, 0, { type: 'discard', tile: strToTile('4p') });
  assertEq(state.wall.live.length, 0, '海底牌已打出');
  for (const x of state.pendingClaims) {
    assert(!x.actions.some((a) => a.type === 'pon'), '海底牌不可碰');
    assert(!x.actions.some((a) => a.type === 'chi'), '海底牌不可吃');
    assert(!x.actions.some((a) => a.type === 'kan'), '海底牌不可大明杠');
  }
  assert(state.players[1].hand[strToTile('4p')] >= 2, '座位 1 手里有对子 4p，若不是海底本可碰');
  const de = [...ev, ...passAllClaims(state)].find((e) => e.type === 'draw_end');
  assert(de !== undefined && de.kind === 'exhaustive', '无人荣和时应荒牌流局');
});

test('河底捞鱼：海底牌可以被荣和', () => {
  const state = createGame({ seed: 142 });
  startHand(state);
  stack(state, {
    hands: ['8s123m456s789s55p1z', '234m567m234p55s67s', null, null],
    wall: ['1z'],
    emptyWall: true,
    dora: '6z',
  });
  assertEq(state.players[0].haiteiDraw, true, '当前摸到的应是海底牌');
  applyAction(state, 0, { type: 'discard', tile: strToTile('8s') });
  assert(legalActions(state, 1).some((a) => a.type === 'ron'), '河底牌应可荣和');
  const win = applyAction(state, 1, { type: 'ron' }).find((e) => e.type === 'win');
  assert(win !== undefined, '应和牌');
  assertEq(win.result.yaku.some((y) => y.id === 'houtei'), true, '应含河底捞鱼');
});

// ===========================================================================
// 15. 一发与副露破坏（rules.md §5.5 / §4.2）
// ===========================================================================
test('一发：立直后有效，任何鸣牌（含暗杠）即被破坏', () => {
  const state = createGame({ seed: 151 });
  startHand(state);
  stack(state, {
    hands: ['234m567m234p55s67s', '1111m234567p89s5z', null, null],
    wall: ['9p'],
    dora: '6z',
  });
  const riichi = legalActions(state, 0).find((a) => a.type === 'riichi' && a.tile === strToTile('9p'));
  assert(riichi !== undefined, '庄家应能立直并打出 9p');
  applyAction(state, 0, riichi);
  assertEq(state.players[0].ippatsu, true, '立直后应有一发');
  passAllClaims(state);
  assertEq(currentSeat(state), 1, '应轮到座位 1');
  const kan = legalActions(state, 1).find((a) => a.type === 'kan' && a.kind === 'ankan');
  assert(kan !== undefined, '座位 1 应有暗杠可选');
  applyAction(state, 1, kan);
  assertEq(state.players[0].ippatsu, false, '暗杠应破坏一发（§4.2 / §5.5）');
  assertEq(state.players[1].ippatsu, false, '全场一发都应被破坏');
});

// ===========================================================================
// 15.5 加杠 / 抢槓 / 大明杠 / 包牌登记（rules.md §4.2 §6.6 §3.5 §11.1）
// ===========================================================================
test('加杠可被抢槓：槓不成立、不产生杠宝牌，按荣和清算（§6.6）', () => {
  const state = createGame({ seed: 161 });
  startHand(state);
  // 座位 0（庄家）碰过 5m 且手里还有第 4 张；座位 1 两面听 2m/5m（断幺九）
  stack(state, {
    hands: ['5m123m456p789p', '34m234p567p234s88s', null, null],
    melds: [[{ type: 'pon', tiles: '555m', called: '5m' }], [], [], []],
    wall: ['9p'],
    dora: '6z',
  });
  const kans = legalActions(state, 0).filter((a) => a.type === 'kan' && a.kind === 'kakan');
  assertEq(kans.map((a) => a.tile), [strToTile('5m')], '应能加杠 5m');
  applyAction(state, 0, kans[0]);
  assertEq(state.phase, PHASES.CLAIM, '加杠应开抢槓窗口');
  assert(state.pendingClaims.some((x) => x.seat === 1), '座位 1 应进入响应');
  assert(legalActions(state, 1).some((a) => a.type === 'ron'), '座位 1 应能抢槓荣和');
  passOthers(state, 1);
  const win = applyAction(state, 1, { type: 'ron' }).find((e) => e.type === 'win');
  assert(win !== undefined, '应产生抢槓和牌');
  assertEq(win.result.yaku.some((y) => y.id === 'chankan'), true, '应含抢槓 1 番');
  assertEq(state.kanCount, 0, '被抢的槓不成立');
  assertEq(state.players[0].melds[0].type, 'pon', '副露应仍是碰');
  assertEq(state.doraIndicators.length, 1, '不应翻出杠宝牌');
});

test('大明杠：成立后摸岭上牌；杠宝牌在打出 1 张后才翻（§3.5 / A18）', () => {
  const state = createGame({ seed: 162 });
  startHand(state);
  stack(state, {
    hands: ['5p123m456m789m11z9s', '555p123m456s789s1z', null, null],
    dora: '6z',
  });
  applyAction(state, 0, { type: 'discard', tile: strToTile('5p') });
  const kan = legalActions(state, 1).find((a) => a.type === 'kan' && a.kind === 'minkan');
  assert(kan !== undefined, '座位 1 应能大明杠 5p');
  const ev = applyAction(state, 1, kan);
  assert(ev.some((e) => e.type === 'meld' && e.meld.type === 'minkan'), '应生成大明杠副露');
  assert(ev.some((e) => e.type === 'kan' && e.kind === 'minkan'), '应有 kan 事件');
  assert(ev.some((e) => e.type === 'draw'), '应摸岭上牌');
  assertEq(state.players[1].melds.length, 1, '副露数应为 1');
  assertEq(state.players[1].hand[strToTile('5p')], 0, '3 张 5p 应离手');
  assertEq(state.kanCount, 1, '开杠次数应为 1');
  assertEq(state.doraIndicators.length, 1, '打出 1 张之前不翻杠宝牌');
  assertEq(state.players[1].menzen, false, '大明杠破坏门清');
  // 打出一张后翻杠宝牌
  const dz = legalActions(state, 1).find((a) => a.type === 'discard');
  const ev2 = applyAction(state, 1, dz);
  assert(ev2.some((e) => e.type === 'dora_reveal'), '打出 1 张后应翻杠宝牌');
  assertEq(state.doraIndicators.length, 2, '宝牌指示牌应为 2 张');
});

test('包牌登记：碰出第三组三元牌时记下责任者（§11.1）', () => {
  const state = createGame({ seed: 163 });
  startHand(state);
  stack(state, {
    hands: ['7z123m456p789p22z9s', '77z111z33z', null, null],
    melds: [
      [],
      [
        { type: 'pon', tiles: '555z', called: '5z' },
        { type: 'pon', tiles: '666z', called: '6z' },
      ],
      [],
      [],
    ],
    dora: '9p',
  });
  assertEq(state.players[1].paoBy, null, '尚未成立包牌');
  applyAction(state, 0, { type: 'discard', tile: strToTile('7z') });
  const pon = legalActions(state, 1).find((a) => a.type === 'pon');
  assert(pon !== undefined, '座位 1 应能碰中');
  applyAction(state, 1, pon);
  assertEq(state.players[1].paoBy, 0, '打出「中」的座位 0 成为包牌者');
  assertEq(state.players[1].melds.length, 3, '应有 3 组副露（大三元听牌）');
});

// ===========================================================================
// 15.6 立直宣言的「剩余可摸牌 ≥ 4」条件（§5.1）
// ===========================================================================
test('立直条件：剩余可摸牌 ≥ 4 才可宣言（§5.1 ④）', () => {
  const state = createGame({ seed: 171 });
  startHand(state);
  stack(state, {
    hands: ['234m567m234p55s67s', null, null, null],
    wall: ['9p'],
    emptyWall: true,
    dora: '5z',
  });
  const setLive = (n) => {
    const movable = [...state.wall.live, ...state.wall.dead.slice(DEAD_WALL_SIZE)];
    state.wall.dead.length = DEAD_WALL_SIZE; // 只保留真正的 10 张王牌
    state.wall.live = movable.slice(0, n);
    state.wall.dead.push(...movable.slice(n)); // 其余放回王牌，保证 136 张守恒
  };
  setLive(3);
  assertEq(checkInvariants(state), [], '挪牌后不变量应仍成立');
  assertEq(state.wall.live.length, 3, '剩余可摸牌 3 张');
  assert(!legalActions(state, 0).some((a) => a.type === 'riichi'), '剩余 3 张时不能立直');
  setLive(4);
  assertEq(state.wall.live.length, 4, '剩余可摸牌 4 张');
  assert(legalActions(state, 0).some((a) => a.type === 'riichi'), '剩余恰好 4 张时可以立直（边界）');
});

test('立直条件：点数不足 1000 / 已副露 时不能立直（§5.1）', () => {
  const poor = createGame({ seed: 172, scores: [900, 33100, 33000, 33000] });
  startHand(poor);
  stack(poor, { hands: ['234m567m234p55s67s', null, null, null], wall: ['9p'], dora: '5z' });
  assertEq(poor.players[0].score, 900, '庄家只有 900 点');
  assert(!legalActions(poor, 0).some((a) => a.type === 'riichi'), '点数 < 1000 不能立直');

  const called = createGame({ seed: 173 });
  startHand(called);
  stack(called, {
    hands: ['567m234p55s67s', null, null, null],
    melds: [[{ type: 'chi', tiles: '234m', called: '4m' }], [], [], []],
    wall: ['9p'],
    dora: '5z',
  });
  assertEq(called.players[0].menzen, false, '吃过牌不是门清');
  assert(!legalActions(called, 0).some((a) => a.type === 'riichi'), '副露后不能立直');
});

// ===========================================================================
// 15.7 不支持的规则显式抛错（不静默错算）
// ===========================================================================
test('不支持的规则变体一律显式抛错', () => {
  assertThrows(() => createGame({ length: 'sanma' }), '三麻未实现，应显式抛错');
  assertThrows(() => createGame({ options: { honbaValue: 200 } }), '本场值固定 300');
  assertThrows(() => createGame({ options: { notenPenalty: 2000 } }), '不听罚符固定 3000（四麻）');
  assertThrows(() => createGame({ options: { tieBreakBySeat: false } }), 'WRC 同点均分未实现');
  assertThrows(() => createGame({ options: { riichiStickOnFinal: 'void' } }), 'JPML 终局供托作废未实现');
  assertThrows(() => createGame({ scores: [25000, 25000, 25000, 24000] }), '起始点数之和必须是 100000');
  assertThrows(() => createGame({ handNumber: 12 }), 'handNumber 越界');
  assertThrows(() => createGame({ rules: { kuitan: 'yes' } }), '规则开关取值非法');
});

// ===========================================================================
// 15.8 赤 5 的记账与打牌
// ===========================================================================
test('赤 5：计账、可作为独立选择打出、牌河按普通 5 记录', () => {
  const ALL = [...Array(34).keys()];

  /** 把「某张牌（可为赤 5 别名）」搬到牌山头部，返回它在 live 中的下标 */
  function moveToWall(state, want) {
    let idx = state.wall.live.findIndex((t) => (want.red ? t === want.tile : t < 34 && t === want.tile));
    if (idx >= 0) return idx;
    // 不在牌山里 → 从别家手里换出来
    for (const p of state.players) {
      if (want.red) {
        const suit = want.tile - 34;
        if (p.handRed[suit] > 0 && p.hand[normalizeIndex(want.tile)] > 0) {
          const normal = normalizeIndex(want.tile);
          const idx2 = state.wall.live.findIndex((t) => normalizeIndex(t) !== normal);
          assert(idx2 >= 0, '牌山应有无用的普通牌');
          const give = state.wall.live[idx2];
          state.wall.live[idx2] = want.tile;
          p.hand[normal] -= 1;
          p.handRed[suit] -= 1;
          p.hand[normalizeIndex(give)] += 1;
          return idx2;
        }
      } else if (p.hand[want.tile] > (want.tile % 9 === 4 && want.tile < 27 ? p.handRed[Math.floor(want.tile / 9)] : 0)) {
        const idx2 = state.wall.live.findIndex((t) => t < 34 && normalizeIndex(t) !== want.tile && t !== want.tile);
        assert(idx2 >= 0, '牌山应有无用的普通牌');
        const give = state.wall.live[idx2];
        state.wall.live[idx2] = want.tile;
        p.hand[want.tile] -= 1;
        p.hand[normalizeIndex(give)] += 1;
        return idx2;
      }
    }
    throw new Error('找不到可用的牌');
  }

  /** 把牌山里的某张牌换到庄家手里 */
  function wallToDealer(state, liveIdx, asRed) {
    const dp = state.players[state.dealer];
    const tile = state.wall.live[liveIdx];
    const type = normalizeIndex(tile);
    const spare = ALL.find((t) => dp.hand[t] > 0 && t !== type);
    assert(spare !== undefined, '庄家手里应有可交换的牌');
    dp.hand[spare] -= 1;
    dp.hand[type] += 1;
    if (asRed) dp.handRed[tile - 34] += 1;
    state.wall.live[liveIdx] = spare;
  }

  const state = createGame({ seed: 181 });
  startHand(state);
  const dealer = state.dealer;
  const redTile = state.wall.live.find((t) => t >= 34) ?? 34 + [0, 1, 2].find((s) => state.players.some((p) => p.handRed[s] > 0));
  const suit = redTile - 34;
  const normal = normalizeIndex(redTile);
  const redIdx = moveToWall(state, { red: true, tile: redTile });
  wallToDealer(state, redIdx, true);
  const normalIdx = moveToWall(state, { red: false, tile: normal });
  wallToDealer(state, normalIdx, false);
  assertEq(checkInvariants(state), [], '搬牌后不变量应仍成立');
  assertEq(state.players[dealer].handRed[suit], 1, '庄家手上有 1 张赤 5');
  assertEq(state.players[dealer].hand[normal], 2, '庄家手里同时有 1 张普通 5');
  const discards = legalActions(state, dealer).filter((a) => a.type === 'discard').map((a) => a.tile);
  assertEq(discards.includes(34 + suit), true, '应能显式打出赤 5');
  assertEq(discards.includes(normal), true, '也能打出普通 5');
  applyAction(state, dealer, { type: 'discard', tile: 34 + suit });
  assertEq(state.players[dealer].handRed[suit], 0, '赤 5 记账应递减');
  assertEq(state.players[dealer].pond[0], normal, '牌河按普通 5 记录（赤的区分只在记账里）');
  assertEq(state.players[dealer].hand[normal], 1, '剩下的应是普通 5');
  assertEq(checkInvariants(state), [], '打赤 5 后不变量应仍成立');

  // 手里该牌种的 5 全是赤的 → 只给一个选项，打出的必然是赤的
  const state2 = createGame({ seed: 182 });
  startHand(state2);
  const dp2 = state2.players[state2.dealer];
  const redTile2 = state2.wall.live.find((t) => t >= 34) ?? 34 + [0, 1, 2].find((s) => state2.players.some((p) => p.handRed[s] > 0));
  const suit2 = redTile2 - 34;
  const normal2 = normalizeIndex(redTile2);
  const redIdx2 = moveToWall(state2, { red: true, tile: redTile2 });
  wallToDealer(state2, redIdx2, true);
  dp2.handRed[suit2] = 1;
  while (dp2.hand[normal2] > 1) {
    dp2.hand[normal2] -= 1;
    const idx = state2.wall.live.findIndex((t) => t < 34 && normalizeIndex(t) !== normal2);
    assert(idx >= 0, '牌山应有可交换的普通牌');
    const other = state2.wall.live[idx];
    state2.wall.live[idx] = normal2;
    dp2.hand[normalizeIndex(other)] += 1;
  }
  assertEq(checkInvariants(state2), [], '只剩赤 5 时的不变量');
  const only = legalActions(state2, state2.dealer).filter((a) => a.type === 'discard');
  assertEq(only.some((a) => a.tile === normal2), true, '应能打出 5');
  assertEq(only.some((a) => a.tile === 34 + suit2), false, '手里只有赤 5 时不再区分两种写法');
  applyAction(state2, state2.dealer, { type: 'discard', tile: normal2 });
  assertEq(dp2.handRed[suit2], 0, '打出的应是那张赤 5');
});

// ===========================================================================
// 16. 完整对局压测（≥200 场）
// ===========================================================================
test(`完整对局：${AUTO_GAMES} 场自动对局全部正常结束且不变量恒成立`, () => {
  const t0 = Date.now();
  const agg = { games: 0, hands: 0, wins: 0, tsumo: 0, ron: 0, turns: 0, draws: {} };
  for (let g = 0; g < AUTO_GAMES; g++) {
    const seed = 90000 + g * 137;
    const { stats } = autoPlay(seed, { length: 'tonpuu' });
    agg.games += 1;
    agg.hands += stats.hands;
    agg.wins += stats.wins;
    agg.tsumo += stats.tsumo;
    agg.ron += stats.ron;
    agg.turns += stats.turns;
    for (const [k, v] of Object.entries(stats.draws)) agg.draws[k] = (agg.draws[k] || 0) + v;
  }
  const ms = Date.now() - t0;
  const winRate = (agg.wins / agg.hands) * 100;
  const perHand = ms / agg.hands;
  console.log(
    `  [压测] ${agg.games} 场 / ${agg.hands} 局，耗时 ${(ms / 1000).toFixed(1)}s（${perHand.toFixed(1)}ms/局）\n` +
      `  [压测] 和牌 ${agg.wins} 局（自摸 ${agg.tsumo} / 荣和 ${agg.ron}）＝ ${winRate.toFixed(1)}%；` +
      `流局 ${agg.hands - agg.wins} 局 ＝ ${(100 - winRate).toFixed(1)}%\n` +
      `  [压测] 流局种类 ${JSON.stringify(agg.draws)}；平均每局四家打牌数均值 ${(agg.turns / agg.hands).toFixed(2)}`,
  );
  assert(agg.hands >= AUTO_GAMES, '总局数应不少于场数');
  assert(agg.wins > 0, '应有和牌产生');
  assert(agg.hands - agg.wins > 0, '应有流局产生');
  assert(agg.tsumo > 0 && agg.ron > 0, '自摸与荣和都应出现');
  assert(winRate > 30 && winRate < 95, `和牌率 ${winRate.toFixed(1)}% 应在合理区间`);
});

test('完整对局：半庄（东南战）能正常终局并给出顺位与马点', () => {
  const { state, stats } = autoPlay(555, { length: 'hanchan' });
  assert(stats.hands >= 4, '半庄至少 4 局');
  assertEq(state.gameOver, true, '应已终局');
  assertEq(state.ranking.length, 4, '顺位应有 4 家');
  assertEq(state.ranking.map((r) => r.rank), [1, 2, 3, 4], '顺位应为 1-4');
  assertEq(state.ranking.map((r) => r.uma), [15, 5, -5, -15], '马点应为 [15,5,-5,-15]');
  for (const r of state.ranking) {
    assertEq(r.points, (r.score - 25000) / 1000 + r.uma, '精算点应为 (点数-25000)/1000 + 马点');
  }
  assertEq(rank1Seat(state), state.ranking[0].seat, '一位应与 rank1Seat 一致');
  assertEq(state.riichiSticks, 0, '终局剩余立直棒应判给一位');
});

// ---------------------------------------------------------------------------
console.log(`\n通过 ${pass} / 失败 ${failures.length}`);
for (const [name, err] of failures) {
  console.error(`\nFAIL: ${name}\n  ${err.message}`);
  if (process.env.MJ_VERBOSE) console.error(err.stack);
}
if (failures.length > 0) process.exit(1);
