// sudoku.js — ナンバープレースの中核ロジック(依存ゼロ・決定的・DOM非依存)
//
// 盤面表現: 長さ81の配列。値は 0(空)または 1〜9。index = row * 9 + col。
// 候補表現: 9bitのビットマスク。bit d (1<<d) が「数字 d を置ける」を意味する。
//
// 提供する機能:
//   - candidatesMask / findConflicts     … 候補計算・重複検出
//   - solve / countSolutions             … バックトラッキングソルバ(MRVヒューリスティック)
//   - solveWithSinglesOnly               … シングル技法のみの論理ソルバ(難易度保証用)
//   - generateSolvedGrid / generatePuzzle … 完成盤と問題の生成(一意解保証・対称掘り)
//
// アルゴリズムの選定理由は docs/adr/0003-generation-algorithm.md を参照。

const FULL_MASK = 0x3fe; // bit1〜bit9 が立った状態(全候補)

/** 27ユニット(行9・列9・ブロック9)それぞれのセルindex配列。 */
export const UNITS = (() => {
  const units = [];
  for (let r = 0; r < 9; r++) units.push([...Array(9).keys()].map((c) => r * 9 + c));
  for (let c = 0; c < 9; c++) units.push([...Array(9).keys()].map((r) => r * 9 + c));
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const unit = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) unit.push((br * 3 + dr) * 9 + bc * 3 + dc);
      }
      units.push(unit);
    }
  }
  return units;
})();

/** セルidxに置ける数字のビットマスク(既に値があるセルにも仮想的に計算する)。 */
export function candidatesMask(board, idx) {
  let mask = FULL_MASK;
  const r = Math.floor(idx / 9);
  const c = idx % 9;
  for (let k = 0; k < 9; k++) {
    const rv = board[r * 9 + k];
    if (rv && r * 9 + k !== idx) mask &= ~(1 << rv);
    const cv = board[k * 9 + c];
    if (cv && k * 9 + c !== idx) mask &= ~(1 << cv);
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const i = (br + dr) * 9 + bc + dc;
      if (board[i] && i !== idx) mask &= ~(1 << board[i]);
    }
  }
  return mask;
}

function popcount(mask) {
  let n = 0;
  while (mask) {
    mask &= mask - 1;
    n++;
  }
  return n;
}

/**
 * 同一ユニット内で重複している値を持つセルのindex集合を返す。
 * ゲーム側の「赤くする」表示に使う。
 */
export function findConflicts(board) {
  const conflicts = new Set();
  for (const unit of UNITS) {
    const seen = new Map(); // 値 → 最初に見たindex
    for (const idx of unit) {
      const v = board[idx];
      if (!v) continue;
      if (seen.has(v)) {
        conflicts.add(idx);
        conflicts.add(seen.get(v));
      } else {
        seen.set(v, idx);
      }
    }
  }
  return conflicts;
}

/** 盤面が完成しているか(全マス埋まり・重複なし)。 */
export function isComplete(board) {
  return board.every((v) => v >= 1 && v <= 9) && findConflicts(board).size === 0;
}

/**
 * バックトラッキングの共通実装。
 * MRV(候補が最少のセルから埋める)で枝刈りする。9x9では十分高速。
 * @param {function|null} digitOrder - 数字の試行順を返す関数(生成時のシャッフル用)
 */
function search(board, limit, digitOrder, firstSolution) {
  let count = 0;
  function rec() {
    // 候補最少の空セルを選ぶ
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0) continue;
      const mask = candidatesMask(board, i);
      const n = popcount(mask);
      if (n === 0) return; // 行き止まり
      if (n < bestN) {
        bestN = n;
        best = i;
        bestMask = mask;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      // 全マス埋まった = 解が1つ見つかった
      count++;
      if (firstSolution && !firstSolution.length) firstSolution.push(...board);
      return;
    }
    const digits = digitOrder ? digitOrder() : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const d of digits) {
      if (!(bestMask & (1 << d))) continue;
      board[best] = d;
      rec();
      board[best] = 0;
      if (count >= limit) return;
    }
  }
  rec();
  return count;
}

/**
 * 解の個数を limit まで数える(一意性検証は limit=2 で足りる)。
 * 注意: 置かれた数字同士が既に矛盾している盤面は探索前に弾く。
 * search() の枝刈りは「空マスの候補ゼロ」しか見ないため、既存の矛盾を
 * 見逃したまま探索すると指数的に遅くなる(v1.0開発時に実測)。
 */
export function countSolutions(board, limit = 2) {
  if (findConflicts(board).size > 0) return 0;
  return search(board.slice(), limit, null, null);
}

/** 最初に見つかった解を返す(解なしなら null)。 */
export function solve(board) {
  if (findConflicts(board).size > 0) return null;
  const found = [];
  const n = search(board.slice(), 1, null, found);
  return n > 0 ? found : null;
}

/**
 * ネイキッドシングル(候補が1つ)とヒドゥンシングル(ユニット内でその数字を
 * 置けるセルが1つ)だけで解けるところまで解く。
 * 完成すれば解を、途中で手詰まりなら null を返す。
 * = 「仮置きなしの論理だけで解ける」ことの機械的な定義(難易度保証に使う)。
 */
export function solveWithSinglesOnly(board) {
  const b = board.slice();
  let progress = true;
  while (progress) {
    progress = false;

    // ネイキッドシングル
    for (let i = 0; i < 81; i++) {
      if (b[i] !== 0) continue;
      const mask = candidatesMask(b, i);
      const n = popcount(mask);
      if (n === 0) return null; // 矛盾
      if (n === 1) {
        b[i] = 31 - Math.clz32(mask); // 最上位ビットの位置 = その数字
        progress = true;
      }
    }

    // ヒドゥンシングル
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        if (unit.some((idx) => b[idx] === d)) continue;
        let spot = -1;
        let places = 0;
        for (const idx of unit) {
          if (b[idx] === 0 && candidatesMask(b, idx) & (1 << d)) {
            spot = idx;
            places++;
            if (places > 1) break;
          }
        }
        if (places === 1) {
          b[spot] = d;
          progress = true;
        }
      }
    }
  }
  return b.every((v) => v > 0) ? b : null;
}

/** ランダムな完成盤を生成する(バックトラッキング+数字順シャッフル)。 */
export function generateSolvedGrid(rng) {
  const board = new Array(81).fill(0);
  const found = [];
  const baseDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  search(board, 1, () => shuffleInPlace(rng, baseDigits.slice()), found);
  return found;
}

function shuffleInPlace(rng, array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * 問題を生成する。
 * 手順: 完成盤 → 180°回転対称のペアで掘る(見た目の美しさの定石)。
 * 掘るたびに countSolutions で一意性を検証し、崩れたら埋め戻す。
 *
 * @param {function} rng - createRng(seed)
 * @param {object} opts - { targetClues, requireSinglesSolvable, maxAttempts }
 * @returns {{ givens, solution, clues, singlesSolvable }}
 *   givens: 問題(長さ81、0=空)。solution: 唯一の解。
 *   条件を満たせない場合も、一意解のパズルを必ず返す(ベストエフォート)。
 */
export function generatePuzzle(rng, opts) {
  const { targetClues, requireSinglesSolvable = false, maxAttempts = 20 } = opts;
  let best = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = generateSolvedGrid(rng);
    const board = solution.slice();
    let clues = 81;

    // 前半のセル(0..40)を回し、対称の相方(80-i)と同時に掘る
    const order = shuffleInPlace(rng, [...Array(41).keys()]);
    for (const i of order) {
      if (clues <= targetClues) break;
      const j = 80 - i;
      if (board[i] === 0) continue;
      const backupI = board[i];
      const backupJ = board[j];
      board[i] = 0;
      if (j !== i) board[j] = 0;
      if (countSolutions(board, 2) !== 1) {
        board[i] = backupI;
        board[j] = backupJ;
        continue;
      }
      clues -= j === i ? 1 : 2;
    }

    const singlesSolvable = solveWithSinglesOnly(board) !== null;
    const candidate = { givens: board, solution, clues, singlesSolvable };

    // 条件を完全に満たしたら即返す
    if (clues <= targetClues + 2 && (!requireSinglesSolvable || singlesSolvable)) {
      return candidate;
    }
    // 満たせない場合に備え、条件に最も近い候補を保持する
    const better =
      !best ||
      (requireSinglesSolvable && singlesSolvable && !best.singlesSolvable) ||
      (singlesSolvable === best.singlesSolvable && candidate.clues < best.clues);
    if (better) best = candidate;
  }
  return best;
}
