// game.js — ゲーム状態管理層(純ロジック・DOM非依存)
//
// 数独ロジック(sudoku.js)の上に「遊べる状態」を載せる:
//   セル選択 → 数字入力/メモ → 重複ハイライト → 取り消し → 完成判定。
// リアルタイム性がないため物理ループは無い。時間は tick(game, dt) で加算する。
//
// イベント種別(state.events。呼び出し側が読み取って空にする):
//   { type: 'place', conflict }  … 数字を置いた(conflict=重複が発生したか)
//   { type: 'note' }             … メモを書き換えた
//   { type: 'erase' }            … 消した
//   { type: 'undo' }             … 取り消した
//   { type: 'hint', index }      … ヒントで1マス埋めた
//   { type: 'win', time, hints } … 完成
//
// メモ(notes)は9bitビットマスクの配列(候補表現は sudoku.js と同じ)。

import { generatePuzzle, findConflicts, isComplete } from './sudoku.js';

/**
 * 新しいゲームを生成する。
 * @param {object} config - defaultConfig()
 * @param {string} difficultyKey - config.difficulties のキー
 * @param {function} rng - createRng(seed)。シードが同じなら同じ問題になる
 */
export function createGame(config, difficultyKey, rng) {
  const diff = config.difficulties[difficultyKey];
  const puzzle = generatePuzzle(rng, {
    targetClues: diff.targetClues,
    requireSinglesSolvable: diff.requireSinglesSolvable,
    maxAttempts: config.generatorMaxAttempts,
  });
  return {
    config,
    difficulty: difficultyKey,
    givens: puzzle.givens.slice(),
    solution: puzzle.solution.slice(),
    clues: puzzle.clues,
    board: puzzle.givens.slice(),
    notes: new Array(81).fill(0),
    conflicts: new Set(),
    selected: -1,
    noteMode: false,
    undoStack: [],
    elapsed: 0,
    hintsUsed: 0,
    phase: 'playing', // 'playing' | 'won'
    events: [],
  };
}

/** 経過時間を進める(呼び出し側のタイマーから)。 */
export function tick(game, dt) {
  if (game.phase === 'playing') game.elapsed += dt;
}

/** セルを選択する(-1 で解除)。 */
export function select(game, idx) {
  game.selected = idx;
}

export function toggleNoteMode(game) {
  game.noteMode = !game.noteMode;
}

/** 出題マス(書き換え不可)かどうか。 */
export function isGiven(game, idx) {
  return game.givens[idx] !== 0;
}

/** 取り消し用に盤面+メモのスナップショットを積む。 */
function pushUndo(game) {
  game.undoStack.push({ board: game.board.slice(), notes: game.notes.slice() });
}

function refreshConflicts(game) {
  game.conflicts = findConflicts(game.board);
}

/**
 * 選択中のセルに数字を入力する。
 * - メモモード中は候補メモのトグル(空マスのみ)
 * - 同じ数字を再入力すると消える(トグル)
 * - 確定入力時は同一ユニットの他マスのメモから同じ数字を自動で消す
 */
export function inputDigit(game, digit) {
  const idx = game.selected;
  if (game.phase !== 'playing' || idx < 0 || isGiven(game, idx)) return false;
  if (digit < 1 || digit > 9) return false;

  if (game.noteMode) {
    if (game.board[idx] !== 0) return false; // 値のあるマスにメモは書けない
    pushUndo(game);
    game.notes[idx] ^= 1 << digit;
    game.events.push({ type: 'note' });
    return true;
  }

  pushUndo(game);
  if (game.board[idx] === digit) {
    game.board[idx] = 0; // 同じ数字はトグルで消す
  } else {
    game.board[idx] = digit;
    game.notes[idx] = 0;
    erasePeerNotes(game, idx, digit);
  }
  refreshConflicts(game);
  game.events.push({ type: 'place', conflict: game.conflicts.has(idx) });
  checkWin(game);
  return true;
}

/** idx と同じ行・列・ブロックのメモから digit を消す(確定入力の後始末)。 */
function erasePeerNotes(game, idx, digit) {
  const r = Math.floor(idx / 9);
  const c = idx % 9;
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  const bit = ~(1 << digit);
  for (let k = 0; k < 9; k++) {
    game.notes[r * 9 + k] &= bit;
    game.notes[k * 9 + c] &= bit;
    game.notes[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)] &= bit;
  }
}

/** 選択中のセルの値・メモを消す。 */
export function erase(game) {
  const idx = game.selected;
  if (game.phase !== 'playing' || idx < 0 || isGiven(game, idx)) return false;
  if (game.board[idx] === 0 && game.notes[idx] === 0) return false;
  pushUndo(game);
  game.board[idx] = 0;
  game.notes[idx] = 0;
  refreshConflicts(game);
  game.events.push({ type: 'erase' });
  return true;
}

/** 直前の操作を取り消す。 */
export function undo(game) {
  if (game.phase !== 'playing' || game.undoStack.length === 0) return false;
  const snapshot = game.undoStack.pop();
  game.board = snapshot.board;
  game.notes = snapshot.notes;
  refreshConflicts(game);
  game.events.push({ type: 'undo' });
  return true;
}

/**
 * ヒント: 選択中のセル(未選択なら最初の空マス)に正解を埋める。
 * 誤答が入っているマスにも使える(正解で上書き)。
 */
export function hint(game) {
  if (game.phase !== 'playing') return false;
  let idx = game.selected;
  const usable = (i) => i >= 0 && !isGiven(game, i) && game.board[i] !== game.solution[i];
  if (!usable(idx)) {
    idx = game.board.findIndex((v, i) => v === 0 && !isGiven(game, i));
    if (idx < 0) idx = game.board.findIndex((v, i) => usable(i));
    if (idx < 0) return false;
  }
  pushUndo(game);
  game.board[idx] = game.solution[idx];
  game.notes[idx] = 0;
  erasePeerNotes(game, idx, game.solution[idx]);
  game.hintsUsed++;
  game.selected = idx;
  refreshConflicts(game);
  game.events.push({ type: 'hint', index: idx });
  checkWin(game);
  return true;
}

function checkWin(game) {
  if (!isComplete(game.board)) return;
  // 一意解パズルなので「矛盾なく完成」=「唯一の解と一致」が保証される
  game.phase = 'won';
  game.selected = -1;
  game.events.push({ type: 'win', time: game.elapsed, hints: game.hintsUsed });
}

/** 数字ごとの残り個数(9 - 盤面上の出現数)。数字パッドの表示用。 */
export function remainingCounts(game) {
  const counts = new Array(10).fill(9);
  for (const v of game.board) if (v) counts[v]--;
  return counts;
}

// --- 中断保存(localStorage 用のプレーンなJSONに往復させる) ---

export function serialize(game) {
  return {
    version: 1,
    difficulty: game.difficulty,
    givens: game.givens,
    solution: game.solution,
    clues: game.clues,
    board: game.board,
    notes: game.notes,
    elapsed: game.elapsed,
    hintsUsed: game.hintsUsed,
  };
}

/**
 * serialize の出力からゲームを復元する。形式が不正なら null。
 * (完成済みセーブの復元は呼び出し側で弾く想定だが、復元しても害はない)
 */
export function deserialize(config, data) {
  if (!data || data.version !== 1) return null;
  const arrays = [data.givens, data.solution, data.board, data.notes];
  if (arrays.some((a) => !Array.isArray(a) || a.length !== 81)) return null;
  if (!config.difficulties[data.difficulty]) return null;
  const game = {
    config,
    difficulty: data.difficulty,
    givens: data.givens.slice(),
    solution: data.solution.slice(),
    clues: data.clues,
    board: data.board.slice(),
    notes: data.notes.slice(),
    conflicts: new Set(),
    selected: -1,
    noteMode: false,
    undoStack: [],
    elapsed: Number(data.elapsed) || 0,
    hintsUsed: Number(data.hintsUsed) || 0,
    phase: 'playing',
    events: [],
  };
  refreshConflicts(game);
  if (isComplete(game.board)) game.phase = 'won';
  return game;
}
