// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(board.js/solver.js/hint.js)と I/O(DOM・マウス・タッチ・
// キーボード・音・localStorage・タイマー)の結線。ルールをここに書かないこと。
// グリッドゲームなので rAF ループは使わず、「操作 → 状態更新 → 再描画」の
// イベント駆動で回す(hako-oshiと同方式)。

import { defaultConfig } from './config.js';
import { PUZZLES, parsePuzzle } from './puzzles.js';
import {
  CELL, createBoard, beginStroke, continueStroke, endStroke, undo, reset,
  isLineSatisfied, checkClear,
} from './board.js';
import { getHint } from './hint.js';
import {
  renderPuzzleSelect, createBoardView, renderCells, renderClueDim, renderHintHighlight,
  playClearSequence, resetClearSequence, showClearOverlay, hideClearOverlay, showScreen,
  renderToolButtons, renderTimer,
} from './render.js';
import {
  playFill, playCross, playUndo, playLineDone, playHintMistake, playHintDeduce, playClear,
  toggleSound,
} from './sound.js';

const config = defaultConfig();

// --- 進捗・途中盤面の読み書き(localStorage。プライベートモード等では黙って諦める) ---

function loadProgress() {
  try {
    const raw = localStorage.getItem(config.storage.progressKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(config.storage.progressKey, JSON.stringify(progress));
  } catch {
    /* 保存できなくてもプレイは続行する */
  }
}

function boardStorageKey(index) {
  return `${config.storage.boardKeyPrefix}${index}`;
}

// 途中盤面はcellsのみ保存する(historyは保存しない。architecture.md §7)
function loadSavedCells(index) {
  try {
    const raw = localStorage.getItem(boardStorageKey(index));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCells(index, cells) {
  try {
    localStorage.setItem(boardStorageKey(index), JSON.stringify(Array.from(cells)));
  } catch {
    /* 保存できなくてもプレイは続行する */
  }
}

const progress = loadProgress();

// --- DOM参照 ---

const screens = {
  select: document.getElementById('screen-select'),
  play: document.getElementById('screen-play'),
};

const ui = {
  puzzleGridEl: document.getElementById('puzzle-grid'),
  boardEl: document.getElementById('board'),
  hudNameEl: document.getElementById('hud-name'),
  hudTimerEl: document.getElementById('hud-timer'),
  hudHintsEl: document.getElementById('hud-hints'),
  muteBtn: document.getElementById('mute'),
  toolFillBtn: document.getElementById('tool-fill'),
  toolCrossBtn: document.getElementById('tool-cross'),
  clearOverlayEl: document.getElementById('clear-overlay'),
  clearNameEl: document.getElementById('clear-name'),
  clearStatsEl: document.getElementById('clear-stats'),
  clearBestEl: document.getElementById('clear-best'),
};

// --- ゲーム状態(現在プレイ中のパズル) ---

let puzzleIndex = null;
let board = null;
let boardView = null;
let tool = 'fill'; // 'fill' | 'cross'(左クリック/タップ時に使う。右クリックは常に×)
let hintHighlight = null; // { x, y, type } | null
let elapsedSec = 0;
let timerId = null;
let pointerDown = false;

/** セルサイズをconfigの目安から計算し、画面幅に収まらなければ下限まで縮める。 */
function computeCellSize(puzzle) {
  const base = config.render.cellSizePx[puzzle.w] || config.render.cellSizeMinPx;
  const clueAllowancePx = base * 2; // クルー欄(コーナー+クルー数字)のおおよその幅
  const available = Math.min(window.innerWidth - 24, 520) - clueAllowancePx;
  const fit = Math.floor(available / puzzle.w);
  return Math.max(config.render.cellSizeMinPx, Math.min(base, fit || base));
}

function startPuzzle(index) {
  puzzleIndex = index;
  const puzzle = parsePuzzle(PUZZLES[index]);
  board = createBoard(puzzle);

  const saved = loadSavedCells(index);
  if (saved && saved.length === board.cells.length) {
    board.cells.set(saved);
    checkClear(board); // 保存時点で既に完成していた場合、phaseを復元する
  }

  tool = 'fill';
  hintHighlight = null;
  elapsedSec = 0;

  clearInterval(timerId);
  timerId = setInterval(tick, config.timer.tickMs);

  const cellSize = computeCellSize(puzzle);
  boardView = createBoardView(ui.boardEl, puzzle, cellSize, config.render.thickLineEvery);
  resetClearSequence(boardView);
  hideClearOverlay(ui);
  renderToolButtons(ui, tool);

  ui.hudNameEl.textContent = puzzle.name;
  updateHintsHud();

  showScreen(screens, 'play');
  refresh();
}

function backToSelect() {
  clearInterval(timerId);
  timerId = null;
  board = null;
  renderPuzzleSelect(ui.puzzleGridEl, PUZZLES, progress);
  showScreen(screens, 'select');
}

// --- イベントの消化(board.eventsを読んで音に変換し、読み捨てる) ---

function drainEvents() {
  for (const ev of board.events) {
    if (ev.type === 'paint') {
      if (ev.value === CELL.FILLED) playFill();
      else if (ev.value === CELL.CROSS) playCross();
    } else if (ev.type === 'undo') {
      playUndo();
    } else if (ev.type === 'lineDone') {
      playLineDone();
    }
    // 'clear' はonCleared側でアニメーションと同期させて鳴らす
  }
  board.events.length = 0;
}

function updateClueDim() {
  const satisfiedRows = [];
  for (let y = 0; y < board.puzzle.h; y++) satisfiedRows.push(isLineSatisfied(board, 'row', y));
  const satisfiedCols = [];
  for (let x = 0; x < board.puzzle.w; x++) satisfiedCols.push(isLineSatisfied(board, 'col', x));
  renderClueDim(boardView, satisfiedRows, satisfiedCols);
}

function updateHintsHud() {
  const prog = progress[String(puzzleIndex)];
  ui.hudHintsEl.textContent = String(prog ? prog.hintsUsed : 0);
}

/** すべての操作の後に呼ぶ共通処理。 */
function refresh() {
  const justCleared = board.events.some((ev) => ev.type === 'clear');
  drainEvents();

  renderCells(boardView, board);
  updateClueDim();
  renderHintHighlight(boardView, hintHighlight);
  saveCells(puzzleIndex, board.cells);

  if (justCleared) onCleared();
}

function onCleared() {
  playClear();
  clearInterval(timerId);

  const key = String(puzzleIndex);
  const prev = progress[key];
  const wasCleared = Boolean(prev && prev.cleared);
  const isNewBest = !wasCleared || elapsedSec < prev.bestTimeSec;
  const hintsUsed = prev ? prev.hintsUsed : 0;

  progress[key] = {
    cleared: true,
    bestTimeSec: isNewBest ? elapsedSec : prev.bestTimeSec,
    hintsUsed,
  };
  saveProgress();

  playClearSequence(boardView, 400, 500, () => {
    showClearOverlay(ui, {
      name: board.puzzle.name,
      timeSec: elapsedSec,
      hintsUsed,
      best: wasCleared ? prev : null,
      isNewBest,
    });
  });
}

function tick() {
  if (!board || board.phase !== 'playing') return;
  if (document.hidden) return; // タブ非表示中は加算しない
  elapsedSec += 1;
  renderTimer(ui, elapsedSec);
}

// --- 操作 ---

function doUndo() {
  if (!board) return;
  hintHighlight = null;
  undo(board);
  refresh();
}

function doHint() {
  if (!board || board.phase === 'cleared') return;
  hintHighlight = null;
  const hint = getHint(board);
  if (hint.type === 'none') return;

  const key = String(puzzleIndex);
  const prevProg = progress[key] || { cleared: false, bestTimeSec: 0, hintsUsed: 0 };
  progress[key] = { ...prevProg, hintsUsed: prevProg.hintsUsed + 1 };
  saveProgress();
  updateHintsHud();

  if (hint.type === 'mistake') {
    playHintMistake();
    hintHighlight = { x: hint.x, y: hint.y, type: 'mistake' };
    refresh();
  } else if (hint.type === 'deduce') {
    playHintDeduce();
    hintHighlight = { x: hint.x, y: hint.y, type: 'deduce' };
    refresh(); // getHintが盤面を変化させているため、paint等のイベントもここでdrainされる
  }
}

function doReset() {
  if (!board) return;
  if (!window.confirm('盤面を空にします。よろしいですか?')) return;
  reset(board);
  hintHighlight = null;
  elapsedSec = 0;
  resetClearSequence(boardView);
  hideClearOverlay(ui);
  refresh();
}

// --- パズル選択画面 ---

ui.puzzleGridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.puzzle-card');
  if (!card) return;
  startPuzzle(Number(card.dataset.puzzleIndex));
});

// --- プレイ画面のボタン ---

document.getElementById('undo-btn').addEventListener('click', doUndo);
document.getElementById('hint-btn').addEventListener('click', doHint);
document.getElementById('reset-btn').addEventListener('click', doReset);
document.getElementById('back-to-select').addEventListener('click', backToSelect);
document.getElementById('back-to-select-clear').addEventListener('click', backToSelect);
document.getElementById('next-puzzle').addEventListener('click', () => {
  const next = puzzleIndex + 1;
  if (next < PUZZLES.length) startPuzzle(next);
  else backToSelect();
});

ui.toolFillBtn.addEventListener('click', () => {
  tool = 'fill';
  renderToolButtons(ui, tool);
});
ui.toolCrossBtn.addEventListener('click', () => {
  tool = 'cross';
  renderToolButtons(ui, tool);
});

ui.muteBtn.addEventListener('click', () => {
  ui.muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- マウス(左=現在のツール、右クリック=×固定。ドラッグは最初のマスの遷移を継続適用) ---

function cellFromTarget(target) {
  const el = target && target.closest ? target.closest('.cell') : null;
  if (!el) return null;
  return { x: Number(el.dataset.x), y: Number(el.dataset.y) };
}

ui.boardEl.addEventListener('mousedown', (e) => {
  if (!board || board.phase === 'cleared') return;
  const cell = cellFromTarget(e.target);
  if (!cell) return;
  e.preventDefault();
  hintHighlight = null;
  const usedTool = e.button === 2 ? 'cross' : tool;
  pointerDown = true;
  beginStroke(board, cell.x, cell.y, usedTool);
  refresh();
});

ui.boardEl.addEventListener('mouseover', (e) => {
  if (!pointerDown || !board) return;
  const cell = cellFromTarget(e.target);
  if (!cell) return;
  continueStroke(board, cell.x, cell.y);
  refresh();
});

document.addEventListener('mouseup', () => {
  if (!pointerDown || !board) return;
  pointerDown = false;
  endStroke(board);
  refresh();
});

ui.boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

// --- タッチ(タップ+ドラッグ。ツール切替ボタンでぬる/×を選ぶ) ---

function cellFromPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return cellFromTarget(el);
}

ui.boardEl.addEventListener('touchstart', (e) => {
  if (!board || board.phase === 'cleared') return;
  const t = e.changedTouches[0];
  const cell = cellFromPoint(t.clientX, t.clientY);
  if (!cell) return;
  e.preventDefault();
  hintHighlight = null;
  pointerDown = true;
  beginStroke(board, cell.x, cell.y, tool);
  refresh();
}, { passive: false });

ui.boardEl.addEventListener('touchmove', (e) => {
  if (!pointerDown || !board) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  const cell = cellFromPoint(t.clientX, t.clientY);
  if (!cell) return;
  continueStroke(board, cell.x, cell.y);
  refresh();
}, { passive: false });

ui.boardEl.addEventListener('touchend', () => {
  if (!pointerDown || !board) return;
  pointerDown = false;
  endStroke(board);
  refresh();
});

// --- キーボード(Z/H/Esc。プレイ中のみ受け付ける) ---

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (screens.play.hidden) return;

  if (e.code === 'Escape') {
    e.preventDefault();
    backToSelect();
  } else if (e.code === 'KeyZ') {
    e.preventDefault();
    doUndo();
  } else if (e.code === 'KeyH') {
    e.preventDefault();
    doHint();
  }
});

// --- E2E検証用の読み取り専用フック(ゲーム本体はこれに依存しない) ---

Object.defineProperty(globalThis, '__nurilogi', {
  get: () => ({ board, progress }),
});

// --- 起動 ---

backToSelect();
