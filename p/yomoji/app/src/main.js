// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(game.js)と I/O(DOM・キーボード・音・localStorage)の結線。
// ルールをここに書かないこと(判定は judge.js、進行は game.js)。
// リアルタイム性がないので rAF ループは使わず、
// 「操作 → 状態更新 → drainEvents → render」のイベント駆動で回す。

import { defaultConfig } from './config.js';
import { ANSWERS } from './words.js';
import { cycleKana, romajiToKana } from './kana.js';
import {
  createGame, inputKana, backspace, submit, serialize, deserialize,
} from './game.js';
import {
  buildBoard, buildKeyboard, render, revealDuration, showToast, shake,
} from './render.js';
import {
  playType, playReveal, playReject, playWin, playLose, toggleSound,
} from './sound.js';

// localStorage のキー(architecture.md §5)
const DAILY_KEY = 'yomoji.daily'; // daily の進行(dateKey が今日のときだけ復元)
const STATS_KEY = 'yomoji.stats'; // 統計(daily の勝敗のみ更新)
const SEEN_KEY = 'yomoji.seen';   // 初回フラグ(あそびかたの自動表示)

const config = defaultConfig();

const ui = {
  boardEl: document.getElementById('board'),
  kbEl: document.getElementById('keyboard'),
  toastEl: document.getElementById('toast'),
  overlayEl: document.getElementById('overlay'),
  resultTitleEl: document.getElementById('result-title'),
  resultAnswerEl: document.getElementById('result-answer'),
  resultStatsEl: document.getElementById('result-stats'),
  shareBtn: document.getElementById('share'),
  shareTextEl: document.getElementById('share-text'),
  helpEl: document.getElementById('help'),
  muteBtn: document.getElementById('mute'),
  modeLabelEl: document.getElementById('mode-label'),
};
ui.rows = buildBoard(ui.boardEl, config);
ui.keys = buildKeyboard(ui.kbEl);

// --- ゲームの生成・復元 ---

/** 「きょうのもんだい」の日付シード(ローカル日付 YYYYMMDD の数値)。 */
function dailySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function newDailyGame() {
  return createGame(config, ANSWERS, { mode: 'daily', seed: dailySeed() });
}

function newFreeGame() {
  return createGame(config, ANSWERS, { mode: 'free', seed: Date.now() & 0xffffffff });
}

/** 保存済みの daily を復元する(dateKey が今日と一致する場合のみ)。 */
function loadSavedDaily() {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (!raw) return null;
    const saved = deserialize(config, ANSWERS, JSON.parse(raw));
    return saved && saved.dateKey === String(dailySeed()) ? saved : null;
  } catch {
    return null;
  }
}

/** daily の進行を保存する(終局後も同日中の再表示のため保存し続ける)。 */
function persist() {
  if (game.mode !== 'daily') return;
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(serialize(game)));
  } catch {
    /* プライベートモード等では保存されないだけ */
  }
}

let game = loadSavedDaily() || newDailyGame();

// 自動E2E検証用の読み取り専用フック(ゲーム本体はこれに依存しない)
Object.defineProperty(globalThis, '__yomoji', { get: () => game });

// --- 統計(daily のみ。architecture.md §5) ---

function loadStats() {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY));
    if (s && typeof s === 'object' && Array.isArray(s.dist)) return s;
  } catch {
    /* 壊れた保存は初期値で作り直す */
  }
  return { plays: 0, wins: 0, streak: 0, maxStreak: 0, dist: new Array(config.tries).fill(0) };
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* 保存できなくても続行 */
  }
}

/** daily の勝敗で統計を更新する(win なら tries、lose なら null)。 */
function recordResult(winTries) {
  const stats = loadStats();
  stats.plays++;
  if (winTries) {
    stats.wins++;
    stats.streak++;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    stats.dist[winTries - 1]++;
  } else {
    stats.streak = 0;
  }
  saveStats(stats);
}

// --- 結果画面と共有 ---

/** '20260711' → '2026-07-11'(共有テキストの日付表記)。 */
function formatDateKey(dateKey) {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

const STATE_EMOJI = { hit: '🟩', blow: '🟨', miss: '⬜' };

/** 共有テキスト(game-design.md §7 の形式。close は含めない)。 */
function shareText() {
  const result = game.phase === 'won' ? `${game.guesses.length}/${config.tries}` : `X/${config.tries}`;
  const grid = game.guesses
    .map((g) => g.marks.map((m) => STATE_EMOJI[m.state]).join(''))
    .join('\n');
  return `ヨモジ ${formatDateKey(game.dateKey)} ${result}\n${grid}`;
}

function showResult() {
  const won = game.phase === 'won';
  ui.resultTitleEl.textContent = won ? 'せいかい!' : 'ざんねん…';
  ui.resultAnswerEl.textContent = `こたえ: ${game.answer.join('')}`;

  if (game.mode === 'daily') {
    const s = loadStats();
    const dist = s.dist.map((n, i) => `${i + 1}:${n}`).join(' ');
    ui.resultStatsEl.textContent =
      `プレイ ${s.plays} ・ かち ${s.wins} ・ れんぞく ${s.streak} ・ さいちょう ${s.maxStreak}\n` +
      `かいすう分布 ${dist}`;
    ui.shareBtn.hidden = false;
  } else {
    ui.resultStatsEl.textContent = '(れんしゅうは きろくに のこりません)';
    ui.shareBtn.hidden = true;
  }
  ui.shareTextEl.hidden = true;
  ui.overlayEl.hidden = false;
}

ui.shareBtn.addEventListener('click', async () => {
  const text = shareText();
  try {
    await navigator.clipboard.writeText(text);
    showToast(ui.toastEl, 'コピーしました');
  } catch {
    // 権限なし等でコピーできない場合はテキストを画面に出して手動コピー
    ui.shareTextEl.textContent = text;
    ui.shareTextEl.hidden = false;
  }
});

// --- イベントの消化(音・演出・統計への変換) ---

function drainEvents() {
  let animateRow = -1;
  for (const ev of game.events) {
    if (ev.type === 'input' || ev.type === 'delete') playType();
    else if (ev.type === 'reject') {
      playReject();
      showToast(ui.toastEl, '4もじ いれてね');
      shake(ui.boardEl);
    } else if (ev.type === 'reveal') {
      playReveal();
      animateRow = ev.row; // この行だけ1マスずつめくる
    } else if (ev.type === 'win') {
      if (game.mode === 'daily') recordResult(ev.tries);
      setTimeout(() => {
        playWin();
        showResult();
      }, revealDuration(config));
    } else if (ev.type === 'lose') {
      if (game.mode === 'daily') recordResult(null);
      setTimeout(() => {
        playLose();
        showResult();
      }, revealDuration(config));
    }
  }
  game.events.length = 0;
  return animateRow;
}

/** すべての操作の後に呼ぶ共通処理。 */
function refresh() {
  const animateRow = drainEvents();
  render(game, ui, animateRow);
  persist();
}

// --- 入力: 画面キーボード ---

ui.kbEl.addEventListener('click', (e) => {
  const key = e.target.closest('.key');
  if (!key) return;
  inputKana(game, key.dataset.kana);
  refresh();
});

// 「゛゜小」: 直前に入力した文字を変換サイクルする。ロジック層のAPIだけで
// 実現する(最後の1文字を消して、サイクル後の文字を入れ直す)
document.getElementById('cycle').addEventListener('click', () => {
  const last = game.current[game.current.length - 1];
  if (!last) return;
  const next = cycleKana(last);
  if (next === last) return; // 対象外の文字(あ・ん等)では何もしない
  backspace(game);
  inputKana(game, next);
  refresh();
});

document.getElementById('delete').addEventListener('click', () => {
  romajiBuffer = ''; // 画面操作したらローマ字の打ちかけは破棄する
  backspace(game);
  refresh();
});

document.getElementById('enter').addEventListener('click', () => {
  romajiBuffer = '';
  submit(game);
  refresh();
});

// --- 入力: 物理キーボード(ローマ字) ---

let romajiBuffer = '';

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Enter') {
    romajiBuffer = '';
    submit(game);
  } else if (e.key === 'Backspace') {
    // 打ちかけのローマ字があればそれを先に消す(IMEの感覚に合わせる)
    if (romajiBuffer) romajiBuffer = romajiBuffer.slice(0, -1);
    else backspace(game);
  } else if (/^[a-z]$/i.test(e.key)) {
    romajiBuffer += e.key.toLowerCase();
    const { kanas, rest } = romajiToKana(romajiBuffer);
    for (const ch of kanas) inputKana(game, ch); // KANA_SET外は game 側が無視する
    romajiBuffer = rest;
  } else {
    return; // 関係ないキーは奪わない
  }
  e.preventDefault();
  refresh();
});

// --- モード切替・ヘッダー ---

function startGame(next) {
  game = next;
  romajiBuffer = '';
  ui.overlayEl.hidden = true;
  ui.modeLabelEl.textContent = game.mode === 'daily' ? 'きょうのもんだい' : 'れんしゅう';
  refresh();
  // 復元した daily が終局済みなら結果をそのまま見せる(同日中の再訪)
  if (game.phase !== 'playing') showResult();
}

document.getElementById('mode-daily').addEventListener('click', () => {
  startGame(loadSavedDaily() || newDailyGame());
});
document.getElementById('mode-free').addEventListener('click', () => {
  startGame(newFreeGame());
});
document.getElementById('to-free').addEventListener('click', () => {
  startGame(newFreeGame());
});
document.getElementById('close-overlay').addEventListener('click', () => {
  ui.overlayEl.hidden = true;
});

ui.muteBtn.addEventListener('click', () => {
  ui.muteBtn.textContent = toggleSound() ? '🔊' : '🔇';
});

// --- あそびかたパネル(初回は自動表示) ---

document.getElementById('help-btn').addEventListener('click', () => {
  ui.helpEl.hidden = false;
});
document.getElementById('help-close').addEventListener('click', () => {
  ui.helpEl.hidden = true;
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 保存できなければ次回も出るだけ */
  }
});

let seen = false;
try {
  seen = localStorage.getItem(SEEN_KEY) === '1';
} catch {
  /* 読めない環境では毎回表示 */
}
if (!seen) ui.helpEl.hidden = false;

// --- 起動 ---

startGame(game);
