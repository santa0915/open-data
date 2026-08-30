// main.js — エントリポイント(結線層)
//
// 責務: 純ロジック(session/select/stats)と I/O(DOM・音・localStorage)の結線。
// ルールをここに書かないこと(SRSは srs.js、出題は select.js、進行は session.js)。
// rng は Date.now シードで「ここで」生成して注入する(ロジック層に直書き
// しない — architecture.md §4)。now も常に Date.now() をここから渡す。

import { CONFIG } from './config.js';
import { mulberry32 } from './rng.js';
import { validatePack } from './schema.js';
import { PACK as PACK_SHAKAI } from '../data/pack-shakai.js';
import { PACK as PACK_RIKA } from '../data/pack-rika.js';
import {
  createSession, createSessionFrom, current, reveal, grade, summary, submitAuto, next,
} from './session.js';
import { dueCount } from './select.js';
import { overallStats } from './stats.js';
import {
  showScreen, renderHome, renderQuiz, renderResult, renderStats, showToast,
} from './render.js';
import { playCorrect, playWrong, playDone, toggleSound } from './sound.js';

// パック登録は配列(複数パック対応の骨格 — architecture.md §7)。社会+理科
const packs = [PACK_SHAKAI, PACK_RIKA];

// --- 個人利用パックの動的読み込み(adr/0005) --------------------------------
//
// data/private/index.js(gitignore済み・コミット禁止)が存在すれば読み込み、
// packs へ追加する。配布状態のアプリにはこのファイルが無いので何も起きない。
// 形式は data/private/index.sample.js を参照。

async function loadPrivatePacks() {
  let mod;
  try {
    mod = await import('../data/private/index.js');
  } catch {
    return; // ファイルが無い(=個人利用パック未使用)。正常系
  }
  const list = Array.isArray(mod.PRIVATE_PACKS) ? mod.PRIVATE_PACKS : [];
  for (const p of list) {
    const { ok, errors } = validatePack(p);
    if (!ok) {
      // 不正なパックはスキップして続行(アプリ全体は止めない)
      console.warn(`[ichimon] 個人利用パック「${p && p.id}」をスキップしました:`, errors);
      continue;
    }
    if (packs.some((existing) => existing.id === p.id)) {
      console.warn(`[ichimon] 個人利用パック「${p.id}」はIDが既存パックと重複するためスキップしました`);
      continue;
    }
    // 個人利用パックは必ず distribution:'private' 扱い(UIの「個人」バッジ)
    packs.push({ ...p, distribution: 'private' });
  }
}

// 起動前に読み込みを済ませる(top-level await。ES Modules 前提 — adr/0001)
await loadPrivatePacks();

// localStorage のキー(product-design.md §5)
const PROGRESS_KEY = 'ichimon.progress.v1';
const SETTINGS_KEY = 'ichimon.settings.v1';

// 出題抽選用の乱数(シードは起動時刻。デイリー固定はしない — architecture.md §4)
const rng = mulberry32(Date.now() >>> 0);

// --- 保存・復元(try/catch: プライベートモード等では保存されないだけ) -----

// 保存形式は { ...settings(状態コントラクトの5フィールド), packId }。
// packId は選択中の教科(UIの状態)であってロジック層の settings には含めない
// (createSession 等へ渡すオブジェクトはコントラクトどおりの形を保つ)

/** 保存済みJSONを読む(壊れていれば null)。 */
function readSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

// 出題形式の正準名(settings.types の検証用 — adr/0006)
const VALID_TYPES = ['recall', 'choice', 'written', 'ordering'];

function defaultSettings(forPack) {
  return {
    areas: forPack.areas.map((a) => a.id),
    target: 50,
    size: CONFIG.sessionSize,
    mode: 'normal',
    adaptive: true,
    types: null, // null = すべての形式(形式フィルタ未指定)
  };
}

/** 保存値から選択中パックを決める(不明なIDなら先頭=社会)。 */
function loadPack(saved) {
  return packs.find((p) => p.id === (saved && saved.packId)) || packs[0];
}

/** 保存値から settings を組み立てる(areas は選択中パックの分野で検証)。 */
function loadSettings(saved, forPack) {
  const base = defaultSettings(forPack);
  if (!saved) return base;
  const knownAreas = new Set(forPack.areas.map((a) => a.id));
  const areas = Array.isArray(saved.areas)
    ? saved.areas.filter((id) => knownAreas.has(id))
    : base.areas;
  return {
    ...base,
    // 保存された分野が選択中パックに1つも合致しない場合は全分野に戻す
    areas: areas.length > 0 ? areas : base.areas,
    target: typeof saved.target === 'number'
      ? Math.min(CONFIG.hensachiMax, Math.max(CONFIG.hensachiMin, Math.round(saved.target)))
      : base.target,
    mode: saved.mode === 'review' ? 'review' : 'normal',
    adaptive: saved.adaptive !== false,
    types: (() => {
      // 形式フィルタ: 妥当な形式名の配列のみ復元(それ以外は「すべて」)
      if (!Array.isArray(saved.types)) return null;
      const valid = saved.types.filter((t) => VALID_TYPES.includes(t));
      return valid.length > 0 ? valid : null;
    })(),
  };
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, packId: pack.id }));
  } catch {
    /* 保存できなくても続行 */
  }
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    if (saved && saved.version === 1 && saved.records && typeof saved.records === 'object') {
      return saved;
    }
  } catch {
    /* 壊れた保存は初期値で作り直す */
  }
  return { version: 1, records: {} };
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* 保存できなくても続行 */
  }
}

const savedSettings = readSavedSettings();
let pack = loadPack(savedSettings); // 選択中の教科(パック)
let settings = loadSettings(savedSettings, pack);
let progress = loadProgress();
let session = null;

// 自動E2E検証用の読み取り専用フック(アプリ本体はこれに依存しない)
Object.defineProperty(globalThis, '__ichimon', {
  get: () => ({ session, progress, settings }),
});

// --- DOM要素の束 -----------------------------------------------------------

const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  quiz: $('screen-quiz'),
  result: $('screen-result'),
  stats: $('screen-stats'),
};

const ui = {
  toast: $('toast'),
  // home
  subjectCards: $('subject-cards'),
  areaChips: $('area-chips'),
  typeChips: $('type-chips'),
  targetSlider: $('target-slider'),
  targetValue: $('target-value'),
  modeNormal: $('mode-normal'),
  modeReview: $('mode-review'),
  adaptiveToggle: $('adaptive-toggle'),
  // quiz
  quizProgressText: $('quiz-progress-text'),
  quizProgressBar: $('quiz-progress-bar'),
  quizTypeChip: $('quiz-type-chip'),
  quizMeta: $('quiz-meta'),
  quizQuestion: $('quiz-question'),
  answerBlock: $('answer-block'),
  quizAnswer: $('quiz-answer'),
  quizExplanation: $('quiz-explanation'),
  revealBtn: $('reveal-btn'),
  gradeBtns: $('grade-btns'),
  gradeHint: $('grade-hint'),
  nextBtn: $('next-btn'),
  choiceOptions: $('choice-options'),
  orderingBlock: $('ordering-block'),
  orderingItems: $('ordering-items'),
  orderingReset: $('ordering-reset'),
  orderingSubmit: $('ordering-submit'),
  orderingResult: $('ordering-result'),
  writtenPoints: $('written-points'),
  writtenPointsList: $('written-points-list'),
  // result
  resultScore: $('result-score'),
  resultMessage: $('result-message'),
  resultByArea: $('result-by-area'),
  resultWrongSection: $('result-wrong-section'),
  resultWrongList: $('result-wrong-list'),
  retryWrongBtn: $('retry-wrong'),
  // stats
  statsTotals: $('stats-totals'),
  statsPacks: $('stats-packs'),
  statsByTypeSection: $('stats-by-type-section'),
  statsByType: $('stats-by-type'),
  statsByAreaSection: $('stats-by-area-section'),
  statsByArea: $('stats-by-area'),
  statsByBandSection: $('stats-by-band-section'),
  statsByBand: $('stats-by-band'),
  statsWeakSection: $('stats-weak-section'),
  statsWeak: $('stats-weak'),
};

// --- 画面遷移 ---------------------------------------------------------------

/** パックIDごとの復習待ち件数(教科カードのバッジは全分野で数える)。 */
function dueByPack(now) {
  const result = {};
  for (const p of packs) {
    result[p.id] = dueCount(p, progress, { areas: p.areas.map((a) => a.id) }, now);
  }
  return result;
}

function goHome() {
  renderHome(ui, { packs, pack, settings, dueByPack: dueByPack(Date.now()) });
  showScreen(screens, 'home');
}

function goStats() {
  // 統計は全パック横断(overallStats)。復習待ちも全パック合計で見せる
  const dueTotal = Object.values(dueByPack(Date.now())).reduce((a, b) => a + b, 0);
  renderStats(ui, overallStats(packs, progress), dueTotal, packs);
  showScreen(screens, 'stats');
}

// 回答中のUI状態(choiceの選択・orderingのタップ順)。1問ごとにリセットする。
// ロジック状態(session)とは別物 — 確定前の入力だけを持つ
let quizView = { picked: null, arranged: null, picks: [] };

function resetQuizView() {
  quizView = { picked: null, arranged: null, picks: [] };
}

/** セッションを開始して出題画面へ(空なら遷移せずトースト)。 */
function startSession(newSession) {
  if (newSession.list.length === 0) {
    showToast(
      ui.toast,
      settings.mode === 'review' ? '復習待ちの問題はありません' : '出題できる問題がありません'
    );
    return;
  }
  session = newSession;
  resetQuizView();
  renderQuiz(ui, session, quizView);
  showScreen(screens, 'quiz');
}

function finishSession() {
  playDone();
  renderResult(ui, pack, summary(session));
  showScreen(screens, 'result');
}

// --- home の操作 -------------------------------------------------------------

// 教科カード(タップで教科を切り替え)。renderHomeが毎回作り直すため委任で拾う
ui.subjectCards.addEventListener('click', (e) => {
  const card = e.target.closest('.subject-card');
  if (!card || card.dataset.pack === pack.id) return;
  pack = packs.find((p) => p.id === card.dataset.pack) || pack;
  // 分野は教科ごとに異なるため、切り替え時は新しい教科の全分野に戻す
  settings.areas = pack.areas.map((a) => a.id);
  saveSettings();
  goHome();
});

// 分野チップ(複数選択トグル)。renderHomeが毎回作り直すため委任で拾う
ui.areaChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const id = chip.dataset.area;
  settings.areas = settings.areas.includes(id)
    ? settings.areas.filter((a) => a !== id)
    : [...settings.areas, id];
  saveSettings();
  goHome();
});

// 出題形式フィルタ(すべて/一問一答/4たく/きじゅつ/ならべかえ — 単一選択)
ui.typeChips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  settings.types = chip.dataset.type === 'all' ? null : [chip.dataset.type];
  saveSettings();
  goHome();
});

ui.targetSlider.addEventListener('input', () => {
  settings.target = Number(ui.targetSlider.value);
  ui.targetValue.textContent = ui.targetSlider.value;
});
ui.targetSlider.addEventListener('change', saveSettings);

ui.modeNormal.addEventListener('click', () => {
  settings.mode = 'normal';
  saveSettings();
  goHome();
});
ui.modeReview.addEventListener('click', () => {
  settings.mode = 'review';
  saveSettings();
  goHome();
});

ui.adaptiveToggle.addEventListener('click', () => {
  settings.adaptive = !settings.adaptive;
  saveSettings();
  goHome();
});

$('start-btn').addEventListener('click', () => {
  if (settings.areas.length === 0) {
    showToast(ui.toast, '分野を1つ以上えらんでね');
    return;
  }
  startSession(createSession(pack, settings, progress, rng, Date.now()));
});

$('to-stats').addEventListener('click', goStats);

// --- quiz の操作 -------------------------------------------------------------

ui.revealBtn.addEventListener('click', () => {
  if (!session) return;
  reveal(session);
  renderQuiz(ui, session, quizView);
});

/** 自己採点(○/×)を1問ぶん処理する(recall/written)。 */
function handleGrade(isCorrect) {
  if (!session) return;
  if (!grade(session, isCorrect, progress, Date.now())) return; // reveal前・記録済みは無視
  saveProgress();
  (isCorrect ? playCorrect : playWrong)();
  if (session.phase === 'done') {
    finishSession();
  } else {
    resetQuizView();
    renderQuiz(ui, session, quizView);
  }
}

$('grade-correct').addEventListener('click', () => handleGrade(true));
$('grade-wrong').addEventListener('click', () => handleGrade(false));

/** 自動採点(choice/ordering)の入力を確定する。 */
function handleSubmitAuto(input) {
  const result = submitAuto(session, input, progress, Date.now());
  if (!result) return; // 受け付けない状態・形式なら何もしない
  saveProgress();
  (result.correct ? playCorrect : playWrong)();
  renderQuiz(ui, session, quizView);
}

// choice: 選択肢タップで即採点(renderが毎回作り直すため委任で拾う)
ui.choiceOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.option');
  if (!btn || !session || session.phase !== 'question') return;
  quizView.picked = btn.dataset.option;
  handleSubmitAuto(quizView.picked);
});

// ordering: タップした順に番号を振る(adr/0006 §5)
ui.orderingItems.addEventListener('click', (e) => {
  const btn = e.target.closest('.order-item');
  if (!btn || !session || session.phase !== 'question') return;
  if (quizView.picks.includes(btn.dataset.item)) return; // 二重タップは無視
  quizView.picks.push(btn.dataset.item);
  renderQuiz(ui, session, quizView);
});

ui.orderingReset.addEventListener('click', () => {
  if (!session || session.phase !== 'question') return;
  quizView.picks = [];
  renderQuiz(ui, session, quizView);
});

ui.orderingSubmit.addEventListener('click', () => {
  if (!session || session.phase !== 'question') return;
  const q = current(session);
  if (!q || quizView.picks.length !== q.items.length) return; // 全項目を選ぶまで確定不可
  quizView.arranged = quizView.picks.slice();
  handleSubmitAuto(quizView.arranged);
});

// つぎへ(choice/ordering の結果表示から次の問題へ)
ui.nextBtn.addEventListener('click', () => {
  if (!session || !next(session)) return;
  if (session.phase === 'done') {
    finishSession();
  } else {
    resetQuizView();
    renderQuiz(ui, session, quizView);
  }
});

$('quiz-quit').addEventListener('click', () => {
  // 途中でやめても、採点済みの問題の進捗は保存済み(1問ごとにsaveProgress)
  session = null;
  goHome();
});

// --- result の操作 -----------------------------------------------------------

// 「×だけもう一度」: 今回×だった問題列で即席セッション(architecture.md §6)。
// rng を渡して choice/ordering の表示順を再シャッフルする(渡さないと
// choice の先頭が常に正解になる — session.js の互換フォールバック)
ui.retryWrongBtn.addEventListener('click', () => {
  if (!session) return;
  startSession(createSessionFrom(pack, session.settings, summary(session).wrong, rng));
});

$('result-home').addEventListener('click', () => {
  session = null;
  goHome();
});

// --- stats の操作 ------------------------------------------------------------

$('stats-home').addEventListener('click', goHome);

// リセット(統計画面の最下部、確認つき — product-design.md §5)
$('reset-btn').addEventListener('click', () => {
  if (!confirm('学習の記録をすべて消します。よろしいですか?')) return;
  progress = { version: 1, records: {} };
  saveProgress();
  showToast(ui.toast, '記録をリセットしました');
  goStats();
});

// --- ヘッダー -----------------------------------------------------------------

$('mute').addEventListener('click', () => {
  $('mute').textContent = toggleSound() ? '🔊' : '🔇';
});

// --- 起動 ---------------------------------------------------------------------

goHome();
