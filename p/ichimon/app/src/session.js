// session.js — 1セットの進行(状態コントラクトは architecture.md §3 厳守)
//
// フロー(形式ごと — adr/0006):
//   recall/written: question → reveal → revealed → grade(記録+次へ)
//   choice/ordering: question → submitAuto(判定+記録、revealedで停止)→ next(次へ)
// 自己採点(grade)は「解説を読んだ後の一手」、自動採点(submitAuto)は
// 「答えた瞬間に判定し、結果を見せてから進む」— どちらも記録処理は共通。
// choice/ordering の表示順はセッション生成時に rng で確定する(session.shuffles。
// 決定性の維持と、描画のたびに順序が変わる事故の防止 — adr/0006 §4)。

import { selectQuestions } from './select.js';
import { initialRecord, applyAnswer } from './srs.js';
import { shuffle } from './rng.js';
import { CONFIG } from './config.js';

/** 問題の出題形式(type省略=recall。v1パック互換)。 */
function typeOf(question) {
  return question.type === undefined ? 'recall' : question.type;
}

/**
 * choice/ordering の表示順を事前計算する。
 *   choice:   [answer, ...choices](正解+誤答3つ)のシャッフル
 *   ordering: items(正しい順序)のシャッフル
 * rng が無い場合(旧API互換の呼び出し)は元の並びのまま返す。
 */
function buildShuffles(list, rng) {
  const shuffles = {};
  for (const q of list) {
    const type = typeOf(q);
    if (type === 'choice') {
      const options = [q.answer, ...q.choices];
      shuffles[q.id] = rng ? shuffle(rng, options) : options;
    } else if (type === 'ordering') {
      shuffles[q.id] = rng ? shuffle(rng, q.items) : q.items.slice();
    }
  }
  return shuffles;
}

/**
 * 新しいセッションを生成する。
 * settings は呼び出し側のオブジェクトをそのまま保持せずコピーする
 * (adaptiveでの target 書き換えが呼び出し側の設定に波及しないようにするため)。
 */
export function createSession(pack, settings, progress, rng, now) {
  const list = selectQuestions(pack, progress, settings, rng, now);
  return {
    pack,
    settings: { ...settings },
    list,
    index: 0,
    phase: 'question',
    results: [],
    shuffles: buildShuffles(list, rng),
  };
}

/**
 * 指定した問題列から即席セッションを作る(結果画面の「×だけもう一度」用)。
 * 出題選択(selectQuestions)を通さず、渡された順のまま出題する。
 * 状態コントラクトは createSession と同一。空列なら最初から done。
 * rng は choice/ordering の表示順シャッフル用(省略時は元の並びのまま)。
 */
export function createSessionFrom(pack, settings, questions, rng) {
  return {
    pack,
    settings: { ...settings },
    list: questions.slice(),
    index: 0,
    phase: questions.length > 0 ? 'question' : 'done',
    results: [],
    shuffles: buildShuffles(questions, rng),
  };
}

/** 現在の設問。セット終了後は null。 */
export function current(session) {
  return session.list[session.index] || null;
}

/** 答え・解説を表示する(question→revealed)。phaseが違えば何もせず false。 */
export function reveal(session) {
  if (session.phase !== 'question') return false;
  session.phase = 'revealed';
  return true;
}

/** パックのスケールに応じた target の許容範囲(adaptiveのクランプ用)。 */
function targetRange(pack) {
  return pack.difficultyScale === 'stars'
    ? [CONFIG.starsMin, CONFIG.starsMax]
    : [CONFIG.hensachiMin, CONFIG.hensachiMax];
}

/** 現在の設問がもう記録済みか(submitAuto後のnext待ち状態の判別)。 */
function currentRecorded(session) {
  return session.results.length > session.index;
}

/**
 * 回答結果の記録(grade / submitAuto 共通の内部処理)。
 * progress の該当レコードを srs.applyAnswer で更新し、results に積み、
 * adaptive なら target を ±adaptiveStep 動かす(スケール範囲でクランプ)。
 */
function recordAnswer(session, isCorrect, progress, now) {
  const q = session.list[session.index];
  if (!progress.records) progress.records = {};
  const record = progress.records[q.id] || initialRecord();
  progress.records[q.id] = applyAnswer(record, isCorrect, now);

  session.results.push({ id: q.id, correct: isCorrect });

  if (session.settings.adaptive) {
    const [min, max] = targetRange(session.pack);
    const delta = isCorrect ? CONFIG.adaptiveStep : -CONFIG.adaptiveStep;
    session.settings.target = Math.min(max, Math.max(min, session.settings.target + delta));
  }
}

/** 次の問題へ進める(内部)。全問終了で phase='done'。 */
function advance(session) {
  session.index += 1;
  session.phase = session.index >= session.list.length ? 'done' : 'question';
}

/**
 * 自己採点を反映する(recall/written 用。revealed→記録→次の問題 or done)。
 * - phaseが'revealed'でなければ何も変えず false(reveal前のgrade拒否)
 * - submitAuto で記録済みの設問にも false(二重記録の防止)
 */
export function grade(session, isCorrect, progress, now) {
  if (session.phase !== 'revealed' || currentRecorded(session)) return false;
  recordAnswer(session, isCorrect, progress, now);
  advance(session);
  return true;
}

/** 4択の判定: 選んだ文字列が answer と一致すれば正解。 */
export function judgeChoice(question, selected) {
  return selected === question.answer;
}

/** 整序の判定: 並べた配列が items(正しい順序)と完全一致すれば正解。 */
export function judgeOrdering(question, arranged) {
  return (
    Array.isArray(arranged) &&
    arranged.length === question.items.length &&
    arranged.every((item, i) => item === question.items[i])
  );
}

/**
 * 自動採点(choice/ordering 用)。入力を判定して記録し、結果表示のため
 * phase='revealed' で停止する(前進は next で行う)。
 * @param {string|string[]} input - choice: 選択した文字列 / ordering: 並べた文字列配列
 * @returns {{ correct: boolean } | null} 判定結果。受け付けない状態・形式なら null
 */
export function submitAuto(session, input, progress, now) {
  if (session.phase !== 'question') return null;
  const q = session.list[session.index];
  const type = typeOf(q);

  let correct;
  if (type === 'choice') correct = judgeChoice(q, input);
  else if (type === 'ordering') correct = judgeOrdering(q, input);
  else return null; // recall/written は自己採点(reveal→grade)の経路のみ

  recordAnswer(session, correct, progress, now);
  session.phase = 'revealed';
  return { correct };
}

/**
 * 次の問題へ進む(submitAuto で記録済みの revealed からのみ)。
 * recall/written の revealed(未記録)では false — 記録を飛ばして
 * 前進できないようにする(採点漏れの防止)。
 */
export function next(session) {
  if (session.phase !== 'revealed' || !currentRecorded(session)) return false;
  advance(session);
  return true;
}

/** 正答数・分野別内訳・×だった問題一覧(答えつき)を返す。 */
export function summary(session) {
  const byArea = {};
  const wrong = [];

  for (const result of session.results) {
    const q = session.list.find((item) => item.id === result.id);
    if (!byArea[q.area]) byArea[q.area] = { attempts: 0, correct: 0 };
    byArea[q.area].attempts += 1;
    if (result.correct) {
      byArea[q.area].correct += 1;
    } else {
      wrong.push(q);
    }
  }

  return {
    total: session.list.length,
    correct: session.results.filter((r) => r.correct).length,
    byArea,
    wrong,
  };
}
