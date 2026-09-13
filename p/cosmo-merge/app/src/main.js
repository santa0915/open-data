// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(game.js)と I/O(Canvas 描画・入力・音・localStorage)の結線。
// ゲームのルールをここに書かないこと。ルール変更は game.js/config.js へ。
//
// ループ構造: 物理は固定タイムステップ(config.physics.fixedDt)で回し、
// 描画は requestAnimationFrame に追従する(accumulator パターン)。
// これにより端末のフレームレートに関わらず挙動が一定になる。

import { defaultConfig } from './config.js';
import { THEME } from './theme.js';
import { createRng } from './rng.js';
import { createGame, update, setAimX, drop, canDrop } from './game.js';
import { createRenderer, canvasSize } from './render.js';
import { playDrop, playMerge, playGameOver, toggleSound } from './sound.js';

const BEST_SCORE_KEY = 'cosmo-merge.best';

const config = defaultConfig();
const canvas = document.getElementById('game');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const nextCanvas = document.getElementById('next');
const overlayEl = document.getElementById('overlay');
const finalScoreEl = document.getElementById('final-score');
const restartBtn = document.getElementById('restart');
const muteBtn = document.getElementById('mute');

// --- キャンバス初期化(デバイスピクセル比対応) ---
const size = canvasSize(config);
const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
canvas.width = size.width * dpr;
canvas.height = size.height * dpr;
canvas.getContext('2d').scale(dpr, dpr);

const renderer = createRenderer(canvas, config, THEME);
let game = newGame();
let bestScore = loadBestScore();
bestEl.textContent = String(bestScore);

function newGame() {
  return createGame(config, THEME, createRng(Date.now() & 0xffffffff));
}

// --- ベストスコア(localStorage は使えない環境もあるため常に try/catch) ---
function loadBestScore() {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score) {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    /* プライベートモード等では保存されないだけ */
  }
}

// --- 入力: ポインタ(マウス/タッチ共通)とキーボード ---
function pointerToBoardX(event) {
  const rect = canvas.getBoundingClientRect();
  // CSS 拡縮後の座標を論理座標へ変換し、盤面余白(20px)を差し引く
  const x = ((event.clientX - rect.left) / rect.width) * size.width;
  return x - 20;
}

canvas.addEventListener('pointermove', (e) => {
  setAimX(game, pointerToBoardX(e));
});

canvas.addEventListener('pointerdown', (e) => {
  setAimX(game, pointerToBoardX(e));
  tryDrop();
});

document.addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
  if (e.code === 'ArrowLeft') setAimX(game, game.aimX - 14);
  else if (e.code === 'ArrowRight') setAimX(game, game.aimX + 14);
  else if (e.code === 'Space' || e.code === 'ArrowDown') tryDrop();
});

function tryDrop() {
  if (game.phase === 'gameover') return;
  if (canDrop(game)) drop(game);
}

restartBtn.addEventListener('click', () => {
  game = newGame();
  overlayEl.hidden = true;
});

muteBtn.addEventListener('click', () => {
  muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- ゲームイベントの消化(演出・音・UI 更新への変換) ---
function drainEvents() {
  for (const ev of game.events) {
    if (ev.type === 'merge') {
      renderer.addBurst(ev.x, ev.y, ev.tier);
      playMerge(ev.tier);
    } else if (ev.type === 'drop') {
      playDrop();
    } else if (ev.type === 'gameover') {
      playGameOver();
      if (ev.score > bestScore) {
        bestScore = ev.score;
        saveBestScore(bestScore);
        bestEl.textContent = String(bestScore);
      }
      finalScoreEl.textContent = String(ev.score);
      overlayEl.hidden = false;
    }
  }
  game.events.length = 0;
}

// --- 「つぎ」プレビューの描画 ---
function drawNextPreview() {
  const ctx = nextCanvas.getContext('2d');
  const def = THEME.tiers[game.nextTier - 1];
  const s = nextCanvas.width;
  ctx.clearRect(0, 0, s, s);
  const r = Math.min(def.radius, s * 0.38);
  const grad = ctx.createRadialGradient(
    s / 2 - r * 0.3, s / 2 - r * 0.3, r * 0.1, s / 2, s / 2, r
  );
  grad.addColorStop(0, def.colors[0]);
  grad.addColorStop(1, def.colors[1]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  ctx.fill();
}

// --- メインループ(固定タイムステップ + rAF 描画) ---
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  // タブ復帰などで巨大な dt が来ても物理が暴走しないよう上限を設ける
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  accumulator += dt;
  while (accumulator >= config.physics.fixedDt) {
    update(game, config.physics.fixedDt);
    accumulator -= config.physics.fixedDt;
  }

  drainEvents();
  scoreEl.textContent = String(game.score);
  drawNextPreview();
  renderer.draw(game);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
