// solver.js — 盤面全体の伝播(本作の品質の核。architecture.md §4 / adr/0003)
//
// 空盤面から全行・全列に solveLine を適用し、変化があったラインの直交ライン
// (行が変わったら影響を受けた列、列が変わったら影響を受けた行)をキューに
// 戻して不動点まで伝播する worklist 方式(標準的なノノグラム解法)。
//
// 全マス確定 = 'solved'(このとき解は必然的に一意。adr/0003)。
// 不動点で未定が残れば 'stuck'(=ライン論理だけでは解けない絵。出荷不可)。
// 途中でcontradictionが出れば 'contradiction'(クルー同士が矛盾。通常は
// deriveClues由来のクルーでは起こらないが、手組みのpuzzle(テスト用)では
// 起こり得る)。

import { CELL } from './board.js';
import { solveLine } from './linesolver.js';

function cellIndex(w, x, y) {
  return y * w + x;
}

/** 指定ラインのCELL値配列をcellsから抽出する。 */
function readLine(puzzle, cells, kind, lineIndex) {
  const len = kind === 'row' ? puzzle.w : puzzle.h;
  const line = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const x = kind === 'row' ? i : lineIndex;
    const y = kind === 'row' ? lineIndex : i;
    line[i] = cells[cellIndex(puzzle.w, x, y)];
  }
  return line;
}

function clueOf(puzzle, kind, lineIndex) {
  return kind === 'row' ? puzzle.clues.rows[lineIndex] : puzzle.clues.cols[lineIndex];
}

/** 多重登録を避けるworklistキュー(行/列を'row:0'のようなキーで管理)。 */
function createLineQueue() {
  const queue = [];
  const queued = new Set();
  return {
    enqueue(kind, index) {
      const key = `${kind}:${index}`;
      if (queued.has(key)) return;
      queued.add(key);
      queue.push({ kind, index });
    },
    dequeue() {
      const item = queue.shift();
      queued.delete(`${item.kind}:${item.index}`);
      return item;
    },
    get size() {
      return queue.length;
    },
  };
}

/**
 * 空盤面から行・列のライン論理を不動点まで伝播する。
 * @param {object} puzzle - parsePuzzleの結果({w, h, clues})
 * @returns {{status: 'solved'|'stuck'|'contradiction', cells: Uint8Array, steps: number}}
 */
export function solveByLines(puzzle) {
  const { w, h } = puzzle;
  const cells = new Uint8Array(w * h); // 既定値0 = CELL.UNKNOWN
  let steps = 0;

  const queue = createLineQueue();
  for (let y = 0; y < h; y++) queue.enqueue('row', y);
  for (let x = 0; x < w; x++) queue.enqueue('col', x);

  while (queue.size > 0) {
    const { kind, index } = queue.dequeue();
    const lineCells = readLine(puzzle, cells, kind, index);
    const result = solveLine(lineCells, clueOf(puzzle, kind, index));

    if (result.contradiction) {
      return { status: 'contradiction', cells, steps };
    }
    if (result.changed.length === 0) continue;

    steps += 1;
    for (const { i, value } of result.changed) {
      const x = kind === 'row' ? i : index;
      const y = kind === 'row' ? index : i;
      cells[cellIndex(w, x, y)] = value;
      // 変化したマスの直交ラインを再キューする(worklist伝播)
      queue.enqueue(kind === 'row' ? 'col' : 'row', kind === 'row' ? x : y);
    }
  }

  const solved = cells.every((v) => v !== CELL.UNKNOWN);
  return { status: solved ? 'solved' : 'stuck', cells, steps };
}

/**
 * 現在の(誤りのない)盤面から、ライン論理で次に1マス確定できる手を1つ返す
 * (ヒント用)。入力cellsは変更しない。行→列の順に走査し、最初に変化が
 * 見つかったラインの最初の1マスだけを返す(solveByLinesの伝播の一部と一致する)。
 * @param {object} puzzle - parsePuzzleの結果({w, h, clues})
 * @param {Uint8Array|number[]} cells - 現在のCELL値配列
 * @returns {{x:number, y:number, value:number} | null}
 */
export function nextDeduction(puzzle, cells) {
  const { w, h } = puzzle;
  const working = Uint8Array.from(cells);

  const queue = createLineQueue();
  for (let y = 0; y < h; y++) queue.enqueue('row', y);
  for (let x = 0; x < w; x++) queue.enqueue('col', x);

  while (queue.size > 0) {
    const { kind, index } = queue.dequeue();
    const lineCells = readLine(puzzle, working, kind, index);
    const result = solveLine(lineCells, clueOf(puzzle, kind, index));

    if (result.contradiction || result.changed.length === 0) continue;

    const { i, value } = result.changed[0];
    const x = kind === 'row' ? i : index;
    const y = kind === 'row' ? index : i;
    return { x, y, value };
  }

  return null; // これ以上ライン論理では確定できない(全確定 or 手詰まり)
}
