// judge.js — 判定の純関数(本作の核。game-design.md §4 に厳密に従う)
//
// 状態を持たない。呼び出し側(game.js)が結果を保存する。

import { toBaseKana } from './kana.js';

/**
 * 推測を答えと突き合わせ、1マスごとの判定を返す。
 * @param {string[]} guessKanas  - 推測(かな配列。長さは answerKanas と同じ想定)
 * @param {string[]} answerKanas - 答え(かな配列)
 * @returns {{ state: 'hit'|'blow'|'miss', close: boolean }[]}
 *
 * state(Wordle標準の2パス判定):
 *   1パス目: guess[i] === answer[i] のマスを hit にし、答えの残り文字の個数表を作る
 *            (hit したマスの文字は個数表から除く=二重に消費されない)
 *   2パス目: hit以外のマスを左から順に、個数表に残っていれば blow にして
 *            個数を1減らす。残っていなければ miss
 *
 * close(「おしい」— 本作独自): state !== 'hit' のマスについて、
 *   基準文字(濁点半濁点除去+小書き→大書き)が一致するなら true。
 *   state とは独立の追加情報(blow かつ close もあり得る)。hit には付かない。
 */
export function judgeGuess(guessKanas, answerKanas) {
  const len = answerKanas.length;
  const states = new Array(len).fill('miss');

  // 1パス目: hit確定 + 残り文字の個数表(hitで消費した分は数えない)
  const remaining = new Map();
  for (let i = 0; i < len; i++) {
    if (guessKanas[i] === answerKanas[i]) {
      states[i] = 'hit';
    } else {
      const ch = answerKanas[i];
      remaining.set(ch, (remaining.get(ch) || 0) + 1);
    }
  }

  // 2パス目: hit以外を左から見て、残り個数表を消費しながら blow/miss を決める
  for (let i = 0; i < len; i++) {
    if (states[i] === 'hit') continue;
    const ch = guessKanas[i];
    const left = remaining.get(ch) || 0;
    if (left > 0) {
      states[i] = 'blow';
      remaining.set(ch, left - 1);
    }
    // else miss のまま
  }

  // close: hit以外のマスに基準文字一致を追加情報として付与
  return states.map((state, i) => ({
    state,
    close: state !== 'hit' && toBaseKana(guessKanas[i]) === toBaseKana(answerKanas[i]),
  }));
}
