// srs.js — Leitner方式の間隔反復(docs/adr/0004-srs.md)
//
// 箱0〜4。正解で箱+1(上限4)・不正解で箱0へ戻す。due はその問題を次に
// 出題してよい時刻(msエポック)。now は常に呼び出し側から注入する
// (ロジック層で Date.now を直書きしない — architecture.md §1)。

import { CONFIG } from './config.js';

export const BOX_INTERVALS_DAYS = CONFIG.boxIntervalsDays;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

/** 未回答の問題の初期レコード。box0・due=0(=即時出題可)。 */
export function initialRecord() {
  return { box: 0, due: 0, attempts: 0, correct: 0, last: 0 };
}

/**
 * 回答結果を反映した新しいレコードを返す(引数の record は変更しない)。
 * 正解: box=min(box+1,4)。不正解: box=0。
 * due = now + BOX_INTERVALS_DAYS[box] 日 (ms換算)。
 */
export function applyAnswer(record, isCorrect, now) {
  const box = isCorrect ? Math.min(record.box + 1, MAX_BOX) : 0;
  return {
    box,
    due: now + BOX_INTERVALS_DAYS[box] * DAY_MS,
    attempts: record.attempts + 1,
    correct: record.correct + (isCorrect ? 1 : 0),
    last: now,
  };
}

/** 出題期日(due)が到来しているか(due <= now)。 */
export function isDue(record, now) {
  return record.due <= now;
}
