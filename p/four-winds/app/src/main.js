// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(game.js)と I/O(Canvas 描画・キーボード・音・HUD・
// localStorage)の結線。ルールをここに書かないこと。ルール変更は
// game.js/config.js/stage.js へ。ループ構造は姉妹作と同じ
// 「固定タイムステップ + rAF 描画」(accumulator パターン)。

import { defaultConfig } from './config.js';
import { STAGE } from './stage.js';
import { createRng } from './rng.js';
import { createGame, update } from './game.js';
import { createRenderer, canvasSize } from './render.js';
import {
  playShot, playExplosion, playCapsule, playPowerup, playPlayerHit,
  playWarning, playPhaseChange, playBossSpawn, playClear, playGameOver,
  toggleSound,
} from './sound.js';

const config = defaultConfig();
const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const weaponEl = document.getElementById('weapon');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart');
const muteBtn = document.getElementById('mute');

// --- キャンバス初期化(デバイスピクセル比対応) ---
const size = canvasSize(config);
const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
canvas.width = size.width * dpr;
canvas.height = size.height * dpr;
canvas.getContext('2d').scale(dpr, dpr);

const renderer = createRenderer(canvas, config);
let game = newGame();
let bestScore = loadBestScore();
bestEl.textContent = String(bestScore);

function newGame() {
  return createGame(config, STAGE, createRng(Date.now() & 0xffffffff));
}

// 自動E2E検証用の読み取り専用フック(Playwright等が状態を観測するため。
// ゲーム本体はこれに依存しない)
Object.defineProperty(globalThis, '__fourwinds', { get: () => game });

// --- ベストスコア(localStorage は使えない環境もあるため常に try/catch) ---
function loadBestScore() {
  try {
    return Number(localStorage.getItem(config.scoring.bestScoreKey)) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score) {
  try {
    localStorage.setItem(config.scoring.bestScoreKey, String(score));
  } catch {
    /* プライベートモード等では保存されないだけ */
  }
}

// --- キーボード入力(押しっぱなし状態の集合を保持) ---
const held = new Set();
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyZ', 'Space',
]);

document.addEventListener('keydown', (e) => {
  // ゲームで使うキーのスクロール等のデフォルト動作を抑止
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  held.add(e.code);
});
document.addEventListener('keyup', (e) => held.delete(e.code));
// フォーカスを失ったら全キーを離した扱いにする(押しっぱなし事故防止)
window.addEventListener('blur', () => held.clear());

function readInput() {
  return {
    up: held.has('KeyW') || held.has('ArrowUp'),
    down: held.has('KeyS') || held.has('ArrowDown'),
    left: held.has('KeyA') || held.has('ArrowLeft'),
    right: held.has('KeyD') || held.has('ArrowRight'),
    fire: held.has('KeyZ') || held.has('Space'),
  };
}

restartBtn.addEventListener('click', () => {
  game = newGame();
  overlayEl.hidden = true;
});

muteBtn.addEventListener('click', () => {
  muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- ゲームイベントの消化(音・演出・UI 更新への変換) ---
function drainEvents() {
  for (const ev of game.events) {
    if (ev.type === 'shot') playShot();
    else if (ev.type === 'explosion') {
      renderer.addBurst(ev.x, ev.y, ev.big);
      playExplosion(ev.big);
    } else if (ev.type === 'capsule') playCapsule();
    else if (ev.type === 'powerup') playPowerup();
    else if (ev.type === 'playerHit') playPlayerHit();
    else if (ev.type === 'warning') playWarning();
    else if (ev.type === 'phaseChange') playPhaseChange();
    else if (ev.type === 'bossSpawn') playBossSpawn();
    else if (ev.type === 'clear') {
      playClear();
      showOverlay('ステージクリア!', ev.score);
    } else if (ev.type === 'gameover') {
      playGameOver();
      showOverlay('ゲームオーバー', ev.score);
    }
    // 'hit' は専用音なし(連射中に鳴りすぎるため。爆発音で十分と判断)
  }
  game.events.length = 0;
}

function showOverlay(title, score) {
  if (score > bestScore) {
    bestScore = score;
    saveBestScore(bestScore);
    bestEl.textContent = String(bestScore);
  }
  overlayTitleEl.textContent = title;
  finalScoreEl.textContent = String(score);
  overlayEl.hidden = false;
}

// --- メインループ(固定タイムステップ + rAF 描画) ---
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  // タブ復帰などで巨大な dt が来てもロジックが暴走しないよう上限を設ける
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  accumulator += dt;
  while (accumulator >= config.fixedDt) {
    update(game, config.fixedDt, readInput());
    accumulator -= config.fixedDt;
  }

  drainEvents();
  scoreEl.textContent = String(game.score);
  livesEl.textContent = String(game.lives);
  weaponEl.textContent = `Lv${game.weaponLevel}`;
  renderer.draw(game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
