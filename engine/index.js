/**
 * 日本麻将牌理引擎 —— 统一出口
 * =====================================================================
 *
 * 牌的表示（全引擎统一，勿改）：
 *   0–8 一萬～九萬(m) / 9–17 一筒～九筒(p) / 18–26 一索～九索(s) /
 *   27–33 東南西北白發中(z)；34/35/36 为赤 5m/5p/5s 的输入别名，
 *   入口一律归一到 4/13/22（本引擎不区分赤牌）。
 *
 * 手牌 = 长度 34 的计数数组，且**只包含暗牌部分**；
 * 副露单独用 melds 数组传入，meldCount = melds.length 表示已固定的面子数。
 *
 * 用法：
 *   import { parseHand, shanten, waitingTiles, ukeire } from './engine/index.js';
 *   const h = parseHand('123m456p789s11222z'); // 14 张和牌形
 *   shanten(h, 0);  // -1
 */

export * from './tiles.js';
export * from './agari.js';
export * from './shanten.js';
export * from './waits.js';
export * from './rules.js';
export * from './fu.js';
export * from './yaku.js';
export * from './score.js';
export * from './furiten.js';
