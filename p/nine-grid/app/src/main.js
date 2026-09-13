// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(game.js)と I/O(DOM・キーボード・音・localStorage)の結線。
// ルールをここに書かないこと。リアルタイムゲームではないので rAF ループは
// 使わず、「操作 → 状態更新 → render」のイベント駆動+タイマー(1秒間隔)で回す。

import { defaultConfig } from './config.js';
import { createRng } from './rng.js';
import {
  createGame, tick, select, toggleNoteMode, inputDigit, erase, undo, hint,
  serialize, deserialize,
} from './game.js';
import { buildBoard, render, formatTime } from './render.js';
import {
  playPlace, playConflict, playSoft, playHint, playWin, toggleSound,
} from './sound.js';

const SAVE_KEY = 'nine-grid.save';
const BEST_KEY = (diff) => `nine-grid.best.${diff}`;

const config = defaultConfig();

const ui = {
  boardEl: document.getElementById('board'),
  padEl: document.getElementById('pad'),
  noteBtn: document.getElementById('note'),
  timeEl: document.getElementById('time'),
  diffEl: document.getElementById('difficulty'),
  hintsEl: document.getElementById('hints'),
  overlayEl: document.getElementById('overlay'),
  resultEl: document.getElementById('result'),
  muteBtn: document.getElementById('mute'),
};
const { cells, padButtons } = buildBoard(ui.boardEl, ui.padEl);
ui.cells = cells;
ui.padButtons = padButtons;

// --- ゲームの生成・復元 ---

/** 「きょうの1問」用の日付シード(同じ日は世界中で同じ問題)。 */
function dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function newGame(difficultyKey, seed) {
  const s = seed ?? (Date.now() & 0xffffffff);
  return createGame(config, difficultyKey, createRng(s));
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const game = deserialize(config, JSON.parse(raw));
    return game && game.phase === 'playing' ? game : null;
  } catch {
    return null;
  }
}

function persist() {
  try {
    if (game.phase === 'playing') {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(game)));
    } else {
      localStorage.removeItem(SAVE_KEY); // 完成したら中断セーブは不要
    }
  } catch {
    /* プライベートモード等では保存されないだけ */
  }
}

let game = loadSavedGame() || newGame('normal');

// 自動E2E検証用の読み取り専用フック(ゲーム本体はこれに依存しない)
Object.defineProperty(globalThis, '__ninegrid', { get: () => game });

// --- イベントの消化(音・完成画面への変換) ---

function drainEvents() {
  for (const ev of game.events) {
    if (ev.type === 'place') (ev.conflict ? playConflict : playPlace)();
    else if (ev.type === 'hint') playHint();
    else if (ev.type === 'note' || ev.type === 'erase' || ev.type === 'undo') playSoft();
    else if (ev.type === 'win') {
      playWin();
      showResult(ev);
    }
  }
  game.events.length = 0;
}

function showResult(ev) {
  const diffName = config.difficulties[game.difficulty].name;
  let message = `${diffName} ・ タイム ${formatTime(ev.time)} ・ ヒント ${ev.hints} 回`;
  try {
    const key = BEST_KEY(game.difficulty);
    const best = Number(localStorage.getItem(key)) || Infinity;
    if (ev.hints === 0 && ev.time < best) {
      localStorage.setItem(key, String(Math.floor(ev.time)));
      message += ' ・ 自己ベスト!';
    }
  } catch {
    /* 保存できなくても表示は続ける */
  }
  ui.resultEl.textContent = message;
  ui.overlayEl.hidden = false;
}

/** すべての操作の後に呼ぶ共通処理。 */
function refresh() {
  drainEvents();
  render(game, ui);
  persist();
}

// --- 入力: クリック/タップ ---

ui.boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell) return;
  select(game, Number(cell.dataset.index));
  refresh();
});

ui.padEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.pad');
  if (!btn) return;
  inputDigit(game, Number(btn.dataset.digit));
  refresh();
});

ui.noteBtn.addEventListener('click', () => {
  toggleNoteMode(game);
  refresh();
});
document.getElementById('erase').addEventListener('click', () => {
  erase(game);
  refresh();
});
document.getElementById('undo').addEventListener('click', () => {
  undo(game);
  refresh();
});
document.getElementById('hint-btn').addEventListener('click', () => {
  hint(game);
  refresh();
});

for (const btn of document.querySelectorAll('[data-new]')) {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.new;
    game =
      kind === 'daily'
        ? newGame(config.dailyDifficulty, dailySeed())
        : newGame(kind);
    ui.overlayEl.hidden = true;
    refresh();
  });
}

ui.muteBtn.addEventListener('click', () => {
  ui.muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- 入力: キーボード ---

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const code = e.code;
  let handled = true;

  if (code.startsWith('Digit') || code.startsWith('Numpad')) {
    const d = Number(code.replace('Digit', '').replace('Numpad', ''));
    if (d >= 1 && d <= 9) inputDigit(game, d);
    else if (d === 0) erase(game);
    else handled = false;
  } else if (code === 'Backspace' || code === 'Delete') erase(game);
  else if (code === 'KeyN') toggleNoteMode(game);
  else if (code === 'KeyZ' || code === 'KeyU') undo(game);
  else if (code === 'KeyH') hint(game);
  else if (code.startsWith('Arrow')) {
    const cur = game.selected < 0 ? 40 : game.selected; // 未選択なら中央から
    const r = Math.floor(cur / 9);
    const c = cur % 9;
    if (code === 'ArrowLeft') select(game, r * 9 + Math.max(0, c - 1));
    else if (code === 'ArrowRight') select(game, r * 9 + Math.min(8, c + 1));
    else if (code === 'ArrowUp') select(game, Math.max(0, r - 1) * 9 + c);
    else select(game, Math.min(8, r + 1) * 9 + c);
  } else handled = false;

  if (handled) {
    e.preventDefault();
    refresh();
  }
});

// --- タイマー(1秒間隔。タブが隠れている間は進めない) ---

setInterval(() => {
  if (document.hidden || game.phase !== 'playing') return;
  tick(game, 1);
  ui.timeEl.textContent = formatTime(game.elapsed);
  if (Math.floor(game.elapsed) % config.autosaveInterval === 0) persist();
}, 1000);

refresh();
