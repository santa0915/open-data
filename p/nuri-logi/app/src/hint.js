// hint.js — 誤りの指摘 or 次に確定できる1マスの開示(architecture.md §4 / adr/0003)
//
// 優先順位: ①解答と矛盾するマスがあれば最初の1マスを指摘するだけ(直さない)。
// ②誤りが無ければ、nextDeductionで「次にライン論理だけで確定できる1マス」を
// 実際に置く(開示。architecture.md §7「既知の割り切り」)。③どちらも無ければ
// none(完成済み、または現盤面がライン論理の手詰まりで誤りも無い場合)。
//
// mistake判定: FILLEDなのに解答が空 / CROSSEDなのに解答が塗り(game-design.md §4)。
// 走査順は読み順(上から下・左から右)で最初に見つかったマスを返す。

import { CELL, beginStroke, endStroke } from './board.js';
import { nextDeduction } from './solver.js';

/**
 * @param {object} board - board.jsのcreateBoardが返す状態
 * @returns {{type:'mistake', x:number, y:number}
 *         | {type:'deduce', x:number, y:number, value:number}
 *         | {type:'none'}}
 */
export function getHint(board) {
  if (board.phase === 'cleared') return { type: 'none' };

  const mistake = findMistake(board);
  if (mistake) return { type: 'mistake', x: mistake.x, y: mistake.y };

  const deduction = nextDeduction(board.puzzle, board.cells);
  if (!deduction) return { type: 'none' };

  // deduceは実際にマスを置く(開示)。1マスのストロークとしてhistoryに積むため、
  // 通常のundoでこのヒントも取り消せる。
  const tool = deduction.value === CELL.FILLED ? 'fill' : 'cross';
  beginStroke(board, deduction.x, deduction.y, tool);
  endStroke(board);

  return { type: 'deduce', x: deduction.x, y: deduction.y, value: deduction.value };
}

function findMistake(board) {
  const { puzzle, cells } = board;
  for (let y = 0; y < puzzle.h; y++) {
    for (let x = 0; x < puzzle.w; x++) {
      const value = cells[y * puzzle.w + x];
      if (value === CELL.UNKNOWN) continue;

      const shouldBeFilled = puzzle.solution.has(`${x},${y}`);
      if (value === CELL.FILLED && !shouldBeFilled) return { x, y };
      if (value === CELL.CROSS && shouldBeFilled) return { x, y };
    }
  }
  return null;
}
