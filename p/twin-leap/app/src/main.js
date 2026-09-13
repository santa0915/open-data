// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(game.js)と I/O(Canvas・キーボード・音・HUD)の結線。
// ルールをここに書かないこと。ループ構造は cosmo-merge と同じ
// 「固定タイムステップ + rAF 描画」(accumulator パターン)。

import { defaultConfig } from './config.js';
import { LEVELS } from './levels.js';
import { createGame, update, resetPositions } from './game.js';
import { createRenderer, canvasSize } from './render.js';
import {
  playJump, playKey, playUnlock, playGate, playDeath,
  playClear, playAllClear, toggleSound,
} from './sound.js';

const config = defaultConfig();
const canvas = document.getElementById('game');
const levelEl = document.getElementById('level');
const timeEl = document.getElementById('time');
const deathsEl = document.getElementById('deaths');
const overlayEl = document.getElementById('overlay');
const statsEl = document.getElementById('final-stats');
const restartBtn = document.getElementById('restart');
const muteBtn = document.getElementById('mute');

// --- キャンバス初期化(デバイスピクセル比対応) ---
const size = canvasSize(config);
const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
canvas.width = size.width * dpr;
canvas.height = size.height * dpr;
canvas.getContext('2d').scale(dpr, dpr);

const renderer = createRenderer(canvas, config);
let game = createGame(config, LEVELS);

// 自動E2E検証用の読み取り専用フック(Playwright等が状態を観測するため。
// ゲーム本体はこれに依存しない)
Object.defineProperty(globalThis, '__twinleap', { get: () => game });

// --- キーボード入力(押しっぱなし状態の集合を保持) ---
const held = new Set();
document.addEventListener('keydown', (e) => {
  // ゲームで使うキーのスクロール等のデフォルト動作を抑止
  if (isGameKey(e.code)) e.preventDefault();
  held.add(e.code);
  if (e.code === config.keys.retry && !e.repeat && game.phase === 'playing') {
    resetPositions(game); // リトライ(deaths は増えない)
  }
});
document.addEventListener('keyup', (e) => held.delete(e.code));
// フォーカスを失ったら全キーを離した扱いにする(押しっぱなし事故防止)
window.addEventListener('blur', () => held.clear());

function isGameKey(code) {
  const k = config.keys;
  return [
    k.p1.left, k.p1.right, k.p1.jump,
    k.p2.left, k.p2.right, k.p2.jump,
    k.retry, 'Space',
  ].includes(code);
}

function readInputs() {
  const k = config.keys;
  return [
    { left: held.has(k.p1.left), right: held.has(k.p1.right), jump: held.has(k.p1.jump) },
    { left: held.has(k.p2.left), right: held.has(k.p2.right), jump: held.has(k.p2.jump) },
  ];
}

restartBtn.addEventListener('click', () => {
  game = createGame(config, LEVELS);
  overlayEl.hidden = true;
});

muteBtn.addEventListener('click', () => {
  muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- ゲームイベントの消化(音・UI 更新への変換) ---
function drainEvents() {
  for (const ev of game.events) {
    if (ev.type === 'jump') playJump();
    else if (ev.type === 'key') playKey();
    else if (ev.type === 'unlock') playUnlock();
    else if (ev.type === 'gate') playGate();
    else if (ev.type === 'death') playDeath();
    else if (ev.type === 'clear') playClear();
    else if (ev.type === 'allclear') {
      playAllClear();
      statsEl.textContent =
        `タイム ${formatTime(ev.time)} ・ ミス ${ev.deaths} 回`;
      overlayEl.hidden = false;
    }
  }
  game.events.length = 0;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

// --- メインループ(固定タイムステップ + rAF 描画) ---
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  accumulator += dt;
  while (accumulator >= config.physics.fixedDt) {
    update(game, config.physics.fixedDt, readInputs());
    accumulator -= config.physics.fixedDt;
  }

  drainEvents();
  levelEl.textContent = `${game.levelIndex + 1} / ${LEVELS.length}`;
  timeEl.textContent = formatTime(game.totalTime);
  deathsEl.textContent = String(game.deaths);
  renderer.draw(game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
