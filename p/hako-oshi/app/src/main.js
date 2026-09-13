// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(sokoban.js/solver.js/deadlock.js)と I/O(DOM・キーボード・
// スワイプ・音・localStorage)の結線。ルールをここに書かないこと。
// ターン制グリッドゲームなので rAF ループは使わず、「操作 → 状態更新 → 再描画」の
// イベント駆動で回す。

import { defaultConfig } from './config.js';
import { LEVELS } from './levels.js';
import { createGame, move, undo, restart } from './sokoban.js';
import { findDeadBoxes } from './deadlock.js';
import { solve } from './solver.js';
import {
  renderLevelSelect, createBoardView, renderBoard, renderHint, renderHud,
  renderWarning, showClearOverlay, hideClearOverlay, showScreen,
} from './render.js';
import {
  playMove, playPush, playBlocked, playUndo, playHint, playClear, playRestart,
  toggleSound,
} from './sound.js';

const PROGRESS_KEY = 'hako-oshi.progress.v1';
const config = defaultConfig();

// --- 進捗の読み書き(localStorage。プライベートモード等では黙って諦める) ---

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
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
  levelNameEl: document.getElementById('hud-level'),
  movesEl: document.getElementById('hud-moves'),
  pushesEl: document.getElementById('hud-pushes'),
  parEl: document.getElementById('hud-par'),
  warningEl: document.getElementById('warning'),
  clearOverlayEl: document.getElementById('clear-overlay'),
  clearStatsEl: document.getElementById('clear-stats'),
  clearBestEl: document.getElementById('clear-best'),
  hintMessageEl: document.getElementById('hint-message'),
  muteBtn: document.getElementById('mute'),
  levelGridEl: document.getElementById('level-grid'),
  boardEl: document.getElementById('board'),
};

// --- ゲーム状態(現在プレイ中のレベル) ---

let game = null;
let boardView = null;
let hint = null; // { box, dir } | null。表示中のヒント

function computeTileSize(level) {
  const maxDim = Math.max(level.cols, level.rows);
  return Math.max(28, Math.min(48, Math.floor(420 / maxDim)));
}

function startLevel(index) {
  game = createGame(index, LEVELS);
  hint = null;
  ui.hintMessageEl.textContent = '';
  boardView = createBoardView(ui.boardEl, game.level, computeTileSize(game.level));
  hideClearOverlay(ui);
  showScreen(screens, 'play');
  refresh();
}

function backToSelect() {
  renderLevelSelect(ui.levelGridEl, LEVELS, progress);
  showScreen(screens, 'select');
}

// --- イベントの消化(音への変換。gameの内部イベントログを読んで捨てる) ---

function drainEvents() {
  for (const ev of game.events) {
    if (ev.type === 'move') playMove();
    else if (ev.type === 'push') playPush();
    else if (ev.type === 'blocked') playBlocked();
    else if (ev.type === 'undo') playUndo();
    else if (ev.type === 'clear') playClear();
  }
  game.events.length = 0;
}

/** クリア時の記録更新。押し数→歩数の優先順で比較する(倉庫番の慣例)。 */
function recordClear() {
  const key = String(game.levelIndex);
  const prev = progress[key];
  const isBetter =
    !prev ||
    game.pushes < prev.bestPushes ||
    (game.pushes === prev.bestPushes && game.moves < prev.bestMoves);

  const entry = {
    cleared: true,
    bestPushes: isBetter ? game.pushes : prev.bestPushes,
    bestMoves: isBetter ? game.moves : prev.bestMoves,
    hintsUsed: prev ? prev.hintsUsed : 0,
  };
  progress[key] = entry;
  saveProgress();

  showClearOverlay(ui, {
    pushes: game.pushes,
    moves: game.moves,
    par: LEVELS[game.levelIndex].par,
    best: prev,
    isNewBest: isBetter,
  });
}

/** すべての操作の後に呼ぶ共通処理。 */
function refresh() {
  // phaseはmove()内で既に'cleared'へ変わっているため、直前のphaseではなく
  // 今回のevents(まだdrainしていない)に'clear'が含まれるかで判定する。
  const justCleared = game.events.some((ev) => ev.type === 'clear');
  drainEvents();

  const deadBoxes = findDeadBoxes(game.level, game.boxes);
  renderBoard(boardView, game, deadBoxes);
  renderHud(ui, LEVELS[game.levelIndex], game);
  renderWarning(ui, deadBoxes.size > 0);
  renderHint(boardView, hint);

  if (justCleared) {
    recordClear();
  }
}

function clearHint() {
  hint = null;
  ui.hintMessageEl.textContent = '';
  renderHint(boardView, null);
}

function doMove(dir) {
  if (!game || game.phase === 'cleared') return;
  clearHint();
  move(game, dir);
  refresh();
}

function doUndo() {
  if (!game) return;
  clearHint();
  undo(game);
  refresh();
}

function doRestart() {
  if (!game) return;
  clearHint();
  restart(game);
  playRestart();
  refresh();
}

function doHint() {
  if (!game || game.phase === 'cleared') return;
  const key = String(game.levelIndex);
  const prev = progress[key] || { cleared: false, bestPushes: 0, bestMoves: 0, hintsUsed: 0 };
  progress[key] = { ...prev, hintsUsed: prev.hintsUsed + 1 };
  saveProgress();

  const result = solve(game.level, game.boxes, game.player, { maxStates: config.solver.maxStates });
  if (result.status === 'solved') {
    hint = result.firstPush;
    ui.hintMessageEl.textContent = hint ? '印の箱を印の方向へ押してみよう' : 'もうクリアできる状態です';
    playHint();
  } else if (result.status === 'unsolvable') {
    hint = null;
    ui.hintMessageEl.textContent = 'この局面からは解けません。もどしてね';
  } else {
    hint = null;
    ui.hintMessageEl.textContent = 'むずかしくて調べきれません';
  }
  renderHint(boardView, hint);
}

// --- レベル選択画面 ---

ui.levelGridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.level-card');
  if (!card) return;
  startLevel(Number(card.dataset.levelIndex));
});

// --- プレイ画面のボタン ---

document.getElementById('undo-btn').addEventListener('click', doUndo);
document.getElementById('restart-btn').addEventListener('click', doRestart);
document.getElementById('hint-btn').addEventListener('click', doHint);
document.getElementById('back-to-select').addEventListener('click', backToSelect);
document.getElementById('back-to-select-clear').addEventListener('click', backToSelect);
document.getElementById('next-level').addEventListener('click', () => {
  const nextIndex = game.levelIndex + 1;
  if (nextIndex < LEVELS.length) startLevel(nextIndex);
  else backToSelect();
});

ui.muteBtn.addEventListener('click', () => {
  ui.muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- キーボード(矢印/WASD/Z/R/H/Esc、押しっぱなしは repeatMs 間隔で連続入力) ---

const DIR_KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

const heldIntervals = new Map(); // code -> intervalId

function keyAction(code) {
  if (DIR_KEYS[code]) return () => doMove(DIR_KEYS[code]);
  if (code === 'KeyZ') return doUndo;
  if (code === 'KeyR') return doRestart;
  if (code === 'KeyH') return doHint;
  return null;
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (screens.play.hidden) return; // プレイ中のみ受け付ける

  if (e.code === 'Escape') {
    e.preventDefault();
    backToSelect();
    return;
  }

  const action = keyAction(e.code);
  if (!action) return;
  e.preventDefault();

  if (e.repeat) return; // ブラウザ既定のリピートは無視し、自前のタイマーで統一する
  action();

  if (DIR_KEYS[e.code] && !heldIntervals.has(e.code)) {
    const id = setInterval(action, config.input.repeatMs);
    heldIntervals.set(e.code, id);
  }
});

document.addEventListener('keyup', (e) => {
  const id = heldIntervals.get(e.code);
  if (id !== undefined) {
    clearInterval(id);
    heldIntervals.delete(e.code);
  }
});

// --- スワイプ(タッチ開始→終了の主軸方向。しきい値 swipeThreshold px) ---

let touchStart = null;

ui.boardEl.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });

ui.boardEl.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const threshold = config.input.swipeThreshold;
  if (Math.max(absX, absY) < threshold) return; // 小さすぎるスワイプは無視

  if (absX > absY) doMove(dx > 0 ? 'right' : 'left');
  else doMove(dy > 0 ? 'down' : 'up');
}, { passive: true });

// --- E2E検証用の読み取り専用フック(ゲーム本体はこれに依存しない) ---

Object.defineProperty(globalThis, '__hakooshi', {
  get: () => ({ game, progress }),
});

// --- 起動 ---

backToSelect();
