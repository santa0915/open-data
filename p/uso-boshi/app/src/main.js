// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(game.js/bots.js/text.js)と I/O(DOM・音・localStorage)の結線。
// ゲームのルールをここに書かないこと(ルール変更は game.js/config.js へ)。
//
// 進行の考え方(architecture.md §6):
//   advance() は1ステップずつしか進まない半自動ステップ方式なので、ここで
//   「pendingInputが立つか終局するまでadvanceを回すループ」を持つ
//   (stepUntilPause)。ロジック自体は一瞬で最後まで進められるので、
//   「発言を1件ずつ間を置いて見せる」演出はロジックに触れずUI側のタイマー
//   (setTimeout)だけで実現する(drainRevealQueue)。
//
// rng は Date.now() シードで生成してここで注入する(URL ?seed= があれば
// そちらを優先し、シードを固定した決定的な検証ができるようにする —
// game-design.md/architecture.md では明示されていないが、開発・検証の便宜のため
// ここでのみ追加した割り切り)。

import { defaultConfig } from './config.js';
import { mulberry32 } from './rng.js';
import { createGame, advance, submitNightAction, submitStatement, submitVote } from './game.js';
import { toSpeech } from './text.js';
import {
  showScreen,
  renderReveal,
  renderSurvivorRow,
  appendLogLine,
  renderNight,
  renderMorning,
  renderStatementMenu,
  renderVoteHeading,
  renderVotePicker,
  renderResult,
} from './render.js';
import { playStatement, playDeath, playExile, playWin, playLose, toggleSound } from './sound.js';

const STATS_KEY = 'uso-boshi.stats.v1';
const REVEAL_DELAY = 500; // ログ1件あたりの表示間隔(architecture.md §6)
const HUMAN_INDEX = 0; // プレイヤーは常に先頭の席(キャラ選択UIは無い七人固定)

const $ = (id) => document.getElementById(id);

// タイトル/役職配布/ゲーム本体(夜〜結果)の3グループをまず切り替え、
// ゲーム本体の中で夜/朝/昼/投票/結果のどれを見せるかをさらに切り替える。
const screens = {
  title: $('screen-title'),
  reveal: $('screen-reveal'),
  game: $('game-area'),
};

const phaseScreens = {
  night: $('screen-night'),
  morning: $('screen-morning'),
  day: $('screen-day'),
  vote: $('screen-vote'),
  result: $('screen-result'),
};

const ui = {
  revealAvatar: $('reveal-avatar'),
  revealName: $('reveal-name'),
  revealRoleBadge: $('reveal-role-badge'),
  revealDesc: $('reveal-desc'),
  revealPartner: $('reveal-partner'),
  survivorRow: $('survivor-row'),
  shipLog: $('ship-log'),
  nightWaiting: $('night-waiting'),
  nightWaitingText: $('night-waiting-text'),
  nightPicker: $('night-picker'),
  nightPrompt: $('night-prompt'),
  nightOptions: $('night-options'),
  morningSummary: $('morning-summary'),
  morningSeerResult: $('morning-seer-result'),
  dayWaiting: $('day-waiting'),
  statementMenu: $('statement-menu'),
  statementKinds: $('statement-kinds'),
  statementTargets: $('statement-targets'),
  statementTruth: $('statement-truth'),
  statementBack: $('statement-back'),
  voteHeading: $('vote-heading'),
  voteWaiting: $('vote-waiting'),
  votePicker: $('vote-picker'),
  voteOptions: $('vote-options'),
  resultBanner: $('result-banner'),
  resultRoster: $('result-roster'),
  resultStats: $('result-stats'),
};

// --- 戦績(localStorage。プライベートモード等では保存されないだけで続行する) ---

function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY));
    if (saved && saved.version === 1) return saved;
  } catch {
    /* 壊れていれば初期値で作り直す */
  }
  return { version: 1, plays: 0, crewWins: 0, wolfWins: 0 };
}

function saveStats() {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* 保存できなくても続行 */
  }
}

let stats = loadStats();

// --- シード解決: URL ?seed= があれば優先(決定的な検証用)、無ければ起動時刻 ---

function resolveSeed() {
  const param = new URLSearchParams(location.search).get('seed');
  if (param !== null && param !== '' && !Number.isNaN(Number(param))) {
    return Number(param) >>> 0;
  }
  return Date.now() >>> 0;
}

// --- ゲーム状態 ---------------------------------------------------------------

let game = null;
let revealedCount = 0; // 船内ログに反映済みの game.log の件数(表示カーソル)
let statementStage = { kind: null, target: null, isWolf: null };

// 自動E2E検証用の読み取り専用フック(アプリ本体はこれに依存しない)
Object.defineProperty(globalThis, '__usoboshi', {
  get: () => ({ game }),
});

function newGame() {
  const rng = mulberry32(resolveSeed());
  game = createGame(defaultConfig(), rng, { humanIndex: HUMAN_INDEX });
  revealedCount = 0;
  statementStage = { kind: null, target: null, isWolf: null };
  ui.shipLog.textContent = '';
  ui.survivorRow.hidden = false;
  renderReveal(ui, game);
  showScreen(screens, 'reveal');
}

// --- ロジックの前進: 1停止点まで進める ----------------------------------------
//
// 停止点は3種類だけ: (1) 人間の入力が必要(pendingInput) (2) 終局(winner)
// (3) 生存中の人間にとっての「朝」に到達した瞬間(犠牲発表を読ませるため)。
// 人間が既に死亡している場合は(3)を無視して結果まで自動で進む
// (game-design.md「プレイヤー死亡後は自動解決しダイジェストを表示」)。
function stepUntilPause() {
  for (;;) {
    if (game.winner) return 'result';
    if (game.pendingInput) return 'input';
    const before = game.phase;
    advance(game);
    if (game.winner) return 'result';
    if (game.pendingInput) return 'input';
    const humanAlive = game.players[game.humanIndex].alive;
    if (humanAlive && game.phase === 'morning' && before !== 'morning') return 'morning-pause';
  }
}

// --- ログの逐次表示演出 ---------------------------------------------------------
//
// ロジックは既に確定済み(game.log)なので、ここではその再生ペースだけを
// setTimeoutで作る。voteResultは「誰が誰に入れたか」を1票ずつ見せるため
// 複数行に展開する(architecture.md §6「投票画面は開票を1票ずつ表示」)。

function flattenLogEntry(logEntry) {
  if (logEntry.entry.kind === 'voteResult') {
    const lines = [{ text: toSpeech(logEntry, game.players), actorId: null }];
    for (const [voterId, targetId] of Object.entries(logEntry.entry.votes)) {
      const voter = game.players[Number(voterId)];
      const target = game.players[targetId];
      lines.push({ text: `${voter.name} → ${target.name}`, actorId: Number(voterId) });
    }
    return lines;
  }
  return [{ text: toSpeech(logEntry, game.players), actorId: logEntry.actorId }];
}

function playSoundFor(kind) {
  if (kind === 'death') playDeath();
  else if (kind === 'exile') playExile();
  else if (kind === 'gameEnd') (game.winner === 'crew' ? playWin : playLose)();
  else if (kind === 'co-seer' || kind === 'report' || kind === 'suspect' || kind === 'trust' || kind === 'pass') {
    playStatement();
  }
}

const DIGEST_KINDS = new Set(['death', 'noDeath', 'exile', 'gameEnd']);

/** revealedCountからgame.logの末尾まで、演出つきで(または人間死亡後はダイジェストで)出し切る。 */
function drainRevealQueue(onDone) {
  if (revealedCount >= game.log.length) {
    onDone();
    return;
  }

  const humanAlive = game.players[game.humanIndex].alive;
  const digest = !humanAlive; // 死亡後は要点だけ・待ち時間なしでまとめて見せる

  const entry = game.log[revealedCount];
  revealedCount += 1;

  if (digest && !DIGEST_KINDS.has(entry.entry.kind)) {
    drainRevealQueue(onDone); // ダイジェストでは発言は飛ばす
    return;
  }

  playSoundFor(entry.entry.kind);
  for (const line of flattenLogEntry(entry)) {
    appendLogLine(ui, line.text, { actorId: line.actorId, players: game.players });
  }

  setTimeout(() => drainRevealQueue(onDone), digest ? 0 : REVEAL_DELAY);
}

// --- 画面の提示 -----------------------------------------------------------------

function presentPause(outcome) {
  if (outcome === 'result') {
    finishGame();
    return;
  }
  renderSurvivorRow(ui, game);
  if (outcome === 'morning-pause') {
    renderMorning(ui, game);
    showScreen(phaseScreens, 'morning');
    return;
  }
  // outcome === 'input'
  if (game.pendingInput.type === 'night') {
    renderNight(ui, game);
    showScreen(phaseScreens, 'night');
  } else if (game.pendingInput.type === 'statement') {
    statementStage = { kind: null, target: null, isWolf: null };
    renderStatementMenu(ui, game, statementStage);
    showScreen(phaseScreens, 'day');
  } else if (game.pendingInput.type === 'vote') {
    renderVoteHeading(ui, game);
    renderVotePicker(ui, game);
    showScreen(phaseScreens, 'vote');
  }
}

// busy: ログ演出の再生中(setTimeoutチェーンの途中)に連打・二重発火しても
// 二重にロジックを進めないための再入防止フラグ(見た目だけの後始末)。
let busy = false;

function advanceAndPresent() {
  if (busy) return;
  busy = true;
  const outcome = stepUntilPause();
  drainRevealQueue(() => {
    busy = false;
    presentPause(outcome);
  });
}

function finishGame() {
  stats.plays += 1;
  if (game.winner === 'crew') stats.crewWins += 1;
  else stats.wolfWins += 1;
  saveStats();

  ui.survivorRow.hidden = true; // result-rosterの方に役職つきで出すので二重表示を避ける
  renderResult(ui, game, stats);
  showScreen(phaseScreens, 'result');
}

function submitStatementAndAdvance(entry) {
  if (!submitStatement(game, entry)) return;
  statementStage = { kind: null, target: null, isWolf: null };
  advanceAndPresent();
}

// --- 操作の結線 -----------------------------------------------------------------

$('start-btn').addEventListener('click', newGame);
$('retry-btn').addEventListener('click', newGame);

$('reveal-ok').addEventListener('click', () => {
  showScreen(screens, 'game');
  advanceAndPresent();
});

$('morning-ok').addEventListener('click', () => {
  advanceAndPresent();
});

$('mute').addEventListener('click', () => {
  $('mute').textContent = toggleSound() ? '🔊' : '🔇';
});

// 決定後、ログ逐次表示の演出(setTimeoutチェーン)が終わるまでは次のpendingInputの
// 画面へまだ切り替わらない。その間に古い選択肢ボタンが押せる状態のまま残ると
// 二重送信やテストでの誤クリックの原因になるため、送信直後に即座に隠す
// (ロジックの結果は既に確定済みで、ここは見た目だけの後始末)。
function lockNightPicker() {
  ui.nightPicker.hidden = true;
  ui.nightWaiting.hidden = false;
  ui.nightWaitingText.textContent = '夜がふけていく…';
}
function lockStatementMenu() {
  ui.statementMenu.hidden = true;
  ui.dayWaiting.hidden = false;
}
function lockVotePicker() {
  ui.votePicker.hidden = true;
  ui.voteWaiting.hidden = false;
}

// 夜: 対象選択(役職に応じた1段選択)
ui.nightOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.target-btn');
  if (!btn) return;
  const targetId = Number(btn.dataset.target);
  if (!submitNightAction(game, targetId)) return;
  lockNightPicker();
  advanceAndPresent();
});

// 昼: 発言メニュー(kind選択→対象選択の2段。reportのみ3段目で真偽選択)
ui.statementKinds.addEventListener('click', (e) => {
  const btn = e.target.closest('.menu-btn');
  if (!btn) return;
  const kind = btn.dataset.kind;
  if (kind === 'co-seer' || kind === 'pass') {
    lockStatementMenu();
    submitStatementAndAdvance({ kind });
    return;
  }
  statementStage = { kind, target: null, isWolf: null };
  renderStatementMenu(ui, game, statementStage);
});

ui.statementTargets.addEventListener('click', (e) => {
  const btn = e.target.closest('.target-btn');
  if (!btn) return;
  const targetId = Number(btn.dataset.target);
  if (statementStage.kind === 'report') {
    statementStage = { ...statementStage, target: targetId };
    renderStatementMenu(ui, game, statementStage);
    return;
  }
  lockStatementMenu();
  submitStatementAndAdvance({ kind: statementStage.kind, target: targetId });
});

ui.statementTruth.addEventListener('click', (e) => {
  const btn = e.target.closest('.menu-btn');
  if (!btn) return;
  lockStatementMenu();
  submitStatementAndAdvance({
    kind: 'report',
    target: statementStage.target,
    isWolf: btn.dataset.truth === 'true',
  });
});

ui.statementBack.addEventListener('click', () => {
  if (statementStage.kind === 'report' && statementStage.target !== null) {
    statementStage = { ...statementStage, target: null };
  } else {
    statementStage = { kind: null, target: null, isWolf: null };
  }
  renderStatementMenu(ui, game, statementStage);
});

// 投票(決選投票も同じ画面・同じ配線)
ui.voteOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.target-btn');
  if (!btn) return;
  const targetId = Number(btn.dataset.target);
  if (!submitVote(game, targetId)) return;
  lockVotePicker();
  advanceAndPresent();
});

// --- 起動 ---------------------------------------------------------------------

showScreen(screens, 'title');
