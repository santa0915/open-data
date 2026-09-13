// game.js — ゲーム状態管理層(純ロジック・DOM非依存)
//
// judge.js(1推測の判定)の上に「遊べる状態」を載せる:
//   かな入力 → 確定(submit) → 判定・keyboard色更新 → 勝敗判定 → 保存/復元。
//
// イベント種別(game.events。呼び出し側が読み取って空にする想定):
//   { type: 'input' }             … かなを1文字入力した
//   { type: 'delete' }            … 1文字消した
//   { type: 'reject', reason }    … submit を拒否した(reason: 'length')
//   { type: 'reveal', row }       … 確定して1行めくれた(row: guesses の index)
//   { type: 'win', tries }        … 正解して勝利(tries: 使った回数)
//   { type: 'lose', answer }      … 全滅して敗北(answer: 答えのかな配列)
//
// dateKey について: main.js は「きょうのもんだい」のシードにローカル日付の
// 数値 YYYYMMDD をそのまま使う(architecture.md §5)。よって daily モードでは
// その seed 自体が日付そのものなので、dateKey は String(seed) から導出する
// (createGame の引数を { mode, seed } のみに保つための割り切り)。

import { KANA_SET } from './kana.js';
import { judgeGuess } from './judge.js';
import { createRng } from './rng.js';

const STATE_PRIORITY = { miss: 1, blow: 2, hit: 3 };

/**
 * 新しいゲームを生成する。
 * @param {object} config - defaultConfig()
 * @param {string[]} words - ANSWERS(words.js)。答えの抽選元
 * @param {{ mode: 'daily'|'free', seed: number }} opts
 *   答えは createRng(seed) で words から決定的に選ぶ(シードが同じなら同じ答え)
 */
export function createGame(config, words, { mode, seed }) {
  const rng = createRng(seed);
  const answerWord = words[Math.floor(rng() * words.length)];

  return {
    config,
    words,
    rng,
    mode,
    dateKey: mode === 'daily' ? String(seed) : null,
    answer: Array.from(answerWord),
    guesses: [],
    current: [],
    phase: 'playing',
    keyboard: {},
    events: [],
  };
}

/**
 * 入力中の推測(current)にかなを1文字追加する。
 * KANA_SET 外の文字・4文字を超える入力・終局後は無視して false を返す。
 */
export function inputKana(game, ch) {
  if (game.phase !== 'playing') return false;
  if (!KANA_SET.has(ch)) return false;
  if (game.current.length >= game.config.length) return false;
  game.current.push(ch);
  game.events.push({ type: 'input' });
  return true;
}

/** 入力中の推測を1文字消す。空のとき・終局後は無視。 */
export function backspace(game) {
  if (game.phase !== 'playing') return false;
  if (game.current.length === 0) return false;
  game.current.pop();
  game.events.push({ type: 'delete' });
  return true;
}

/**
 * 入力中の推測を確定する。
 * - 文字数が length 未満なら reject イベントを出し、盤面は変化しない
 * - 受理されれば judgeGuess で判定し、guesses に積み、keyboard を更新する
 * - 全マス hit なら win、tries 回使い切って未勝利なら lose
 */
export function submit(game) {
  if (game.phase !== 'playing') return false;
  if (game.current.length < game.config.length) {
    game.events.push({ type: 'reject', reason: 'length' });
    return false;
  }

  const kanas = game.current.slice();
  const marks = judgeGuess(kanas, game.answer);
  game.guesses.push({ kanas, marks });
  game.current = [];
  updateKeyboard(game, kanas, marks);

  const row = game.guesses.length - 1;
  game.events.push({ type: 'reveal', row });

  const won = marks.every((m) => m.state === 'hit');
  if (won) {
    game.phase = 'won';
    game.events.push({ type: 'win', tries: game.guesses.length });
  } else if (game.guesses.length >= game.config.tries) {
    game.phase = 'lost';
    game.events.push({ type: 'lose', answer: game.answer.slice() });
  }

  return true;
}

/**
 * キーボードの色を更新する(reveal のたびに呼ぶ)。
 * 優先度 hit > blow > miss。既により強い情報があれば弱い情報で上書きしない。
 * close はキーボードには反映しない(game-design.md §6)。
 */
function updateKeyboard(game, kanas, marks) {
  for (let i = 0; i < kanas.length; i++) {
    const ch = kanas[i];
    const state = marks[i].state;
    const current = game.keyboard[ch];
    if (!current || STATE_PRIORITY[state] > STATE_PRIORITY[current]) {
      game.keyboard[ch] = state;
    }
  }
}

// --- 中断保存(localStorage 用のプレーンなJSONに往復させる) ---
// config・words・rng は呼び出し側が別途持っている前提で保存しない
// (rng は答え抽選が済んだ後は不要。復元後は null にする)。

export function serialize(game) {
  return {
    version: 1,
    mode: game.mode,
    dateKey: game.dateKey,
    answer: game.answer.slice(),
    guesses: game.guesses.map((g) => ({
      kanas: g.kanas.slice(),
      marks: g.marks.map((m) => ({ state: m.state, close: m.close })),
    })),
    current: game.current.slice(),
    phase: game.phase,
    keyboard: { ...game.keyboard },
  };
}

const VALID_STATES = new Set(['hit', 'blow', 'miss']);
const VALID_PHASES = new Set(['playing', 'won', 'lost']);

/**
 * serialize の出力からゲームを復元する。形式が不正なら null。
 * @param {object} config - defaultConfig()
 * @param {string[]} words - ANSWERS(words.js)。answer の長さ検証等には使わないが
 *   createGame と対称の引数にしておく(呼び出し側の取り回しを揃えるため)
 */
export function deserialize(config, words, data) {
  if (!data || data.version !== 1) return null;
  if (data.mode !== 'daily' && data.mode !== 'free') return null;
  if (!Array.isArray(data.answer) || data.answer.length !== config.length) return null;
  if (!data.answer.every((ch) => typeof ch === 'string' && KANA_SET.has(ch))) return null;
  if (!Array.isArray(data.current) || data.current.length > config.length) return null;
  if (!data.current.every((ch) => typeof ch === 'string' && KANA_SET.has(ch))) return null;
  if (!VALID_PHASES.has(data.phase)) return null;
  if (!Array.isArray(data.guesses)) return null;
  for (const g of data.guesses) {
    if (!g || !Array.isArray(g.kanas) || g.kanas.length !== config.length) return null;
    if (!Array.isArray(g.marks) || g.marks.length !== config.length) return null;
    for (const m of g.marks) {
      if (!m || !VALID_STATES.has(m.state) || typeof m.close !== 'boolean') return null;
    }
  }
  if (!data.keyboard || typeof data.keyboard !== 'object') return null;
  for (const state of Object.values(data.keyboard)) {
    if (!VALID_STATES.has(state)) return null;
  }

  return {
    config,
    words,
    rng: null, // 答え抽選は済んでいるため復元後は不要
    mode: data.mode,
    dateKey: data.mode === 'daily' ? String(data.dateKey) : null,
    answer: data.answer.slice(),
    guesses: data.guesses.map((g) => ({
      kanas: g.kanas.slice(),
      marks: g.marks.map((m) => ({ state: m.state, close: m.close })),
    })),
    current: data.current.slice(),
    phase: data.phase,
    keyboard: { ...data.keyboard },
    events: [],
  };
}
