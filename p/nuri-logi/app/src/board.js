// board.js — 盤面状態・ストローク(塗り/×)・undo・クリア判定(純ロジック層)
//
// マスは3値(architecture.md §3 / game-design.md §2): 未定(UNKNOWN)・
// 塗り(FILLED)・×(CROSS)。×は思考補助でクリア判定には影響しない。
//
// ストロークの規約(game-design.md §3): 「最初に触れたマスに適用した変化」を
// 引きずる。beginStrokeが最初のマスの遷移(トグル: 未定→塗り→未定 / 未定→
// ×→未定。塗り⇄×は上書き)を決めて以降のcontinueStrokeに固定適用する。
// 1ドラッグ=1undo単位(historyの1エントリに複数セルをまとめる)。
//
// DOM / Math.random / Date.now はこのファイルに一切持ち込まない。

export const CELL = { UNKNOWN: 0, FILLED: 1, CROSS: 2 };

function index(puzzle, x, y) {
  return y * puzzle.w + x;
}

function coordinates(puzzle, i) {
  return { x: i % puzzle.w, y: Math.floor(i / puzzle.w) };
}

/**
 * parsePuzzleの結果から新規ゲーム状態を作る。
 * puzzle(parsePuzzleの結果)は不変のまま保持し、reset時の初期化に使う。
 */
export function createBoard(puzzle) {
  return {
    puzzle,
    cells: new Uint8Array(puzzle.w * puzzle.h), // 既定値0=CELL.UNKNOWN
    history: [], // undo用。1操作(1タップ or 1ドラッグ)=1エントリ=[{i, prev}, ...]
    phase: 'playing', // 'playing' | 'cleared'
    events: [], // 'paint' | 'undo' | 'clear' | 'lineDone'。呼び出し側が都度読み捨てる想定
    _stroke: null, // 内部専用: 進行中ストロークの一時情報(状態コントラクトの一部ではない)
  };
}

/**
 * ストロークの最初のマスに適用する遷移を決め、ストロークを開始する。
 * トグル規則: 現在のセルがtoolの対象値と同じなら未定に戻す。違うなら対象値にする
 * (塗り中の×上書き・×中の塗り上書きも同じ規則で成立する)。
 * @param {object} board
 * @param {number} x
 * @param {number} y
 * @param {'fill'|'cross'} tool
 */
export function beginStroke(board, x, y, tool) {
  if (board.phase === 'cleared') return; // クリア後は操作を受け付けない

  const target = tool === 'fill' ? CELL.FILLED : CELL.CROSS;
  const idx = index(board.puzzle, x, y);
  const prev = board.cells[idx];
  const appliedValue = prev === target ? CELL.UNKNOWN : target;

  board._stroke = { appliedValue, touched: new Map() }; // touched: index -> ストローク開始前の値
  applyStrokeCell(board, idx);
}

/**
 * ドラッグで新たに触れたマスに、ストローク開始時に決めた変化を適用する。
 * beginStroke前(strokeが無い状態)の呼び出しは無視する。
 */
export function continueStroke(board, x, y) {
  if (!board._stroke) return;
  const idx = index(board.puzzle, x, y);
  applyStrokeCell(board, idx);
}

function applyStrokeCell(board, idx) {
  const stroke = board._stroke;
  const prev = board.cells[idx];
  if (prev === stroke.appliedValue) return; // 変化なし(同マスの再通過・すでに同値)

  if (!stroke.touched.has(idx)) stroke.touched.set(idx, prev); // 最初の値だけ記録(undo用)
  board.cells[idx] = stroke.appliedValue;

  const { x, y } = coordinates(board.puzzle, idx);
  board.events.push({ type: 'paint', x, y, value: stroke.appliedValue });
}

/**
 * ストロークを確定する。変化があった全マスを1つのhistoryエントリにまとめ、
 * ライン確定(lineDone)・クリア判定(checkClear)を行う。
 */
export function endStroke(board) {
  const stroke = board._stroke;
  if (!stroke) return;
  board._stroke = null;

  const touchedArr = [...stroke.touched.entries()].map(([i, prev]) => ({ i, prev }));
  if (touchedArr.length === 0) return; // 何も変化しなかったストロークは履歴に積まない

  // lineDone判定用に、ストローク開始前のcellsをtouchedArrから復元して比較する
  const beforeCells = board.cells.slice();
  for (const { i, prev } of touchedArr) beforeCells[i] = prev;

  for (const { kind, index: lineIndex } of affectedLines(board.puzzle, touchedArr)) {
    const wasSatisfied = lineSatisfied(board.puzzle, beforeCells, kind, lineIndex);
    const isSatisfiedNow = lineSatisfied(board.puzzle, board.cells, kind, lineIndex);
    if (!wasSatisfied && isSatisfiedNow) {
      board.events.push({ type: 'lineDone', line: { kind, index: lineIndex } });
    }
  }

  board.history.push(touchedArr);
  checkClear(board);
}

/** touchedArrが触れた行・列の一覧(重複なし)を返す。 */
function affectedLines(puzzle, touchedArr) {
  const rows = new Set();
  const cols = new Set();
  for (const { i } of touchedArr) {
    const { x, y } = coordinates(puzzle, i);
    rows.add(y);
    cols.add(x);
  }
  const lines = [];
  for (const y of rows) lines.push({ kind: 'row', index: y });
  for (const x of cols) lines.push({ kind: 'col', index: x });
  return lines;
}

/** 指定ラインのCELL値配列(cellsArrayから抽出)を返す。 */
function readLineValues(puzzle, cellsArray, kind, lineIndex) {
  const len = kind === 'row' ? puzzle.w : puzzle.h;
  const values = new Array(len);
  for (let i = 0; i < len; i++) {
    const x = kind === 'row' ? i : lineIndex;
    const y = kind === 'row' ? lineIndex : i;
    values[i] = cellsArray[index(puzzle, x, y)];
  }
  return values;
}

/** CELL値配列から塗りマスの連続長クルーを導出する(puzzles.jsのlineClueと同じ規則)。 */
function runLengthsOfFilled(values) {
  const runs = [];
  let count = 0;
  for (const v of values) {
    if (v === CELL.FILLED) {
      count += 1;
    } else {
      if (count > 0) runs.push(count);
      count = 0;
    }
  }
  if (count > 0) runs.push(count);
  return runs.length > 0 ? runs : [0];
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function lineSatisfied(puzzle, cellsArray, kind, lineIndex) {
  const values = readLineValues(puzzle, cellsArray, kind, lineIndex);
  const actual = runLengthsOfFilled(values);
  const expected = kind === 'row' ? puzzle.clues.rows[lineIndex] : puzzle.clues.cols[lineIndex];
  return arraysEqual(actual, expected);
}

/**
 * 指定した行/列が、数字どおりに塗り終わっているか(クルー消し込み用)。
 * ×や未定の残りは判定に関与しない(塗りマスの並びだけを見る)。
 * @param {object} board
 * @param {'row'|'col'} kind
 * @param {number} index
 * @returns {boolean}
 */
export function isLineSatisfied(board, kind, index) {
  return lineSatisfied(board.puzzle, board.cells, kind, index);
}

/**
 * 直前の1ストロークを完全に戻す(複数セルをまとめて復元)。
 * @returns {boolean} 戻せるストロークが残っていたか
 */
export function undo(board) {
  if (board.history.length === 0) return false;

  const entry = board.history.pop();
  for (const { i, prev } of entry) board.cells[i] = prev;
  board.phase = 'playing'; // クリア直後のアンドゥでプレイに復帰する

  board.events.push({ type: 'undo' });
  return true;
}

/** 盤面を空(全マス未定)に戻す。historyも消え、アンドゥでは戻せない。 */
export function reset(board) {
  board.cells.fill(CELL.UNKNOWN);
  board.history = [];
  board.phase = 'playing';
  board._stroke = null;
}

/**
 * 塗りマスの集合が解答と完全一致したかを判定し、一致していればクリアにする。
 * ×や未定の残りは不問(game-design.md §2)。beginStroke/continueStrokeの
 * 後に内部で自動判定されるが、外部から明示的に呼んでもよい。
 */
export function checkClear(board) {
  if (board.phase === 'cleared') return;

  const filled = new Set();
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i] === CELL.FILLED) {
      const { x, y } = coordinates(board.puzzle, i);
      filled.add(`${x},${y}`);
    }
  }

  if (filled.size !== board.puzzle.solution.size) return;
  for (const k of filled) {
    if (!board.puzzle.solution.has(k)) return;
  }

  board.phase = 'cleared';
  board.events.push({ type: 'clear' });
}
