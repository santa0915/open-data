// rng.js — シード可能な決定的乱数生成器 (mulberry32)
//
// 実装は姉妹作(nine-grid 等)と同一方針。シード固定で答えの選択が完全に
// 再現できるため、「きょうのもんだい」(日付シード)・テストの再現性が成立する。

export function createRng(seed) {
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
