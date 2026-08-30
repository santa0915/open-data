// rng.js — シード可能な決定的乱数生成器 (mulberry32)
//
// 実装は姉妹作(nine-grid / yomoji)と同一方針。シードが同じなら出題選択が
// 完全に再現できるため、テストの決定性と不具合再現が成立する。
// ロジック層は Math.random を直接使わず、必ずこの rng を引数で受け取る。

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
