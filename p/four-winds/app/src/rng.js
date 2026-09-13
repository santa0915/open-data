// rng.js — シード可能な決定的乱数生成器 (mulberry32)
//
// Math.random を直接使わない理由: シードを固定すれば出現順(側方オフセットの
// 'random' 抽選など)が再現できるため、ユニットテストとリプレイ/バグ再現が
// 決定的に行える(docs/architecture.md 参照)。cosmo-merge/game/src/rng.js と
// 同一実装(姉妹作間で乱数の質・挙動を揃えるため)。

/**
 * mulberry32。seed(32bit整数)から [0, 1) の乱数を返す関数を生成する。
 * 品質はゲーム用途に十分で、実装が短く依存ゼロなことを優先した。
 */
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
