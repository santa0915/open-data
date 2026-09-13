// linesolver.js — 1ライン(長さn・クルーc)の決定的推論(architecture.md §4 / adr/0003)
//
// クルーに適合する全配置(ブロックの開始位置の組)を再帰で列挙し、既に確定
// している(FILLED/CROSS)マスと矛盾する配置をふるい落とす。残った配置全部で
// 共通して塗り(FILLED)になるマス・共通して空(CROSS)になるマスだけを
// 「確定した」として返す。適合配置がゼロなら contradiction。
//
// 実装: 再帰列挙(n≤15・クルー数≤8なら配置候補数は小さく、メモ化なしでも
// 十分速い。adr/0003のアルゴリズム節どおり)。
//
// クルー[0]は「塗りマスなし」を意味する(ブロック0個として扱う)。

import { CELL } from './board.js';

/**
 * ブロック開始位置の全候補(幾何的な配置のみ。既知セルは考慮しない)を列挙する。
 * @param {number} n - ラインの長さ
 * @param {number[]} blocks - ブロック長の配列(クルー[0]相当は空配列で渡す)
 * @returns {number[][]} 各要素が blocks と同じ長さの開始位置配列
 */
function enumerateStarts(n, blocks) {
  const k = blocks.length;
  const results = [];
  const starts = new Array(k);

  function recurse(blockIdx, minStart) {
    if (blockIdx === k) {
      results.push(starts.slice());
      return;
    }
    const blockLen = blocks[blockIdx];
    // このブロックより後ろに必要な最小長(残りブロック本体+間の空白1マスずつ)
    let restNeed = 0;
    for (let b = blockIdx + 1; b < k; b++) restNeed += blocks[b] + 1;
    const maxStart = n - blockLen - restNeed;

    for (let start = minStart; start <= maxStart; start++) {
      starts[blockIdx] = start;
      recurse(blockIdx + 1, start + blockLen + 1);
    }
  }

  recurse(0, 0);
  return results;
}

/** 開始位置の組からCELL値配列(FILLED/CROSSのみ)を組み立てる。 */
function buildAssignment(n, blocks, starts) {
  const assign = new Uint8Array(n).fill(CELL.CROSS);
  for (let b = 0; b < blocks.length; b++) {
    for (let i = starts[b]; i < starts[b] + blocks[b]; i++) assign[i] = CELL.FILLED;
  }
  return assign;
}

/** 配置(assign)が既知のcells(UNKNOWN以外)と矛盾していないかを調べる。 */
function isConsistent(assign, cells) {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === CELL.UNKNOWN) continue;
    if (cells[i] !== assign[i]) return false;
  }
  return true;
}

/**
 * 1ラインの決定的推論。クルーに適合する全配置の交差を取り、全配置で共通して
 * 塗り/×になる(既に確定済みでない)マスだけを changed として返す。
 * @param {Uint8Array|number[]} cells - CELL値の配列(現在の確定状態)
 * @param {number[]} clue - このラインのクルー([0]は空行)
 * @returns {{changed: {i:number, value:number}[], contradiction: boolean}}
 */
export function solveLine(cells, clue) {
  const n = cells.length;
  const blocks = clue.length === 1 && clue[0] === 0 ? [] : clue;

  const candidates = enumerateStarts(n, blocks)
    .map((starts) => buildAssignment(n, blocks, starts))
    .filter((assign) => isConsistent(assign, cells));

  if (candidates.length === 0) {
    return { changed: [], contradiction: true };
  }

  const changed = [];
  for (let i = 0; i < n; i++) {
    if (cells[i] !== CELL.UNKNOWN) continue; // 既に確定しているマスは対象外

    const allFilled = candidates.every((a) => a[i] === CELL.FILLED);
    const allCross = candidates.every((a) => a[i] === CELL.CROSS);
    if (allFilled) changed.push({ i, value: CELL.FILLED });
    else if (allCross) changed.push({ i, value: CELL.CROSS });
  }

  return { changed, contradiction: false };
}
