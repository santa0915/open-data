// rng.js — シード可能な決定的乱数生成器 (mulberry32)
//
// 実装は姉妹作(ichimon 等)と同一方針。シードが同じなら配役・行動選択が
// 完全に再現できるため、balance.test の決定性と game.test の
// 「同シード同入力で同一ログ」検証が成立する。
// ロジック層は Math.random を直接使わず、必ずこの rng を注入で受け取る
// (architecture.md §1・§2: rng消費順序の固定)。

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates シャッフル。配列を破壊せず新しい配列を返す。 */
export function shuffle(rng, array) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
