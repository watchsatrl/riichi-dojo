import { lesson00 } from './l00.js';
import { lesson01 } from './l01.js';
import { lesson02 } from './l02.js';
import { lesson03 } from './l03.js';
import { lesson04 } from './l04.js';
import { lesson05 } from './l05.js';
import { lesson06 } from './l06.js';
import { lesson07 } from './l07.js';
import { lesson08 } from './l08.js';
import { lesson09 } from './l09.js';
import { lesson10 } from './l10.js';
/**
 * lessons/index.js —— 讲次注册表
 *
 * 单独抽出来的原因：app.js 负责渲染外壳，测试需要拿到讲次列表做内容校验。
 * 如果注册表写在 app.js 里，测试就得连外壳一起 import（而外壳会碰 document）。
 */


/**
 * 每一讲：{ id, num, group, title, render?, todo? }
 * 没有 render 的讲次是「已规划未撰写」，渲染成占位页。
 */
export const LESSONS = [
  { id: 'l00', num: '0', group: '入门', title: '认识一副麻将牌', render: lesson00 },
  { id: 'l01', num: '1', group: '入门', title: '和牌的形态', render: lesson01 },
  { id: 'l02', num: '2', group: '入门', title: '役：为什么我不能和牌', render: lesson02 },
  { id: 'l03', num: '3', group: '入门', title: '一局牌怎么走', render: lesson03 },
  { id: 'l04', num: '4', group: '进阶', title: '振听', render: lesson04 },
  { id: 'l05', num: '5', group: '进阶', title: '番与符', render: lesson05 },
  { id: 'l06', num: '6', group: '进阶', title: '点数计算', render: lesson06 },
  { id: 'l07', num: '7', group: '进阶', title: '役种图鉴', render: lesson07 },
  { id: 'l08', num: '8', group: '实战', title: '牌效率：该打哪张', render: lesson08 },
  { id: 'l09', num: '9', group: '实战', title: '防守：什么时候该弃和', render: lesson09 },
  { id: 'l10', num: '10', group: '实战', title: '复盘：常见错误', render: lesson10 },
];

export const GROUPS = ['入门', '进阶', '实战'];
