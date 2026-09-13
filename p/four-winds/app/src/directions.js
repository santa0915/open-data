// directions.js — 方向フレーム抽象(本作の中心抽象)
//
// 「右のとき/上のとき…」という分岐をコードのどこにも書かないための規約。
// 方向を「前方ベクトルf・側方ベクトルs」の直交フレームとして定義し、
// すべての位置・速度計算は (forward, side) 局所座標 → toWorld() による
// ワールド射影で書く(docs/adr/0003-direction-frame.md)。
//
// 敵・カプセルはスポーン時の frame(DIRSの要素への参照)を自分で保持し、
// 切替後も保持した frame で動き続ける(残存物の慣性)。現在の
// game.dirIndex を使うのは新規スポーン・自機の弾・ボスのアンカーのみ。

// dirIndex: 0=右, 1=上, 2=左, 3=下(サイクル順は右→上→左→下→右…)
export const DIRS = [
  { name: 'right', f: { x: 1, y: 0 }, s: { x: 0, y: -1 } },
  { name: 'up', f: { x: 0, y: -1 }, s: { x: -1, y: 0 } },
  { name: 'left', f: { x: -1, y: 0 }, s: { x: 0, y: 1 } },
  { name: 'down', f: { x: 0, y: 1 }, s: { x: 1, y: 0 } },
];

/** サイクル順で次の dirIndex を返す(右→上→左→下→右…)。 */
export function nextDir(dirIndex) {
  return (dirIndex + 1) % 4;
}

/** 機体の見た目角度 [rad]。右=0, 上=-π/2, 左=π, 下=+π/2。 */
export function angleOf(dirIndex) {
  const f = DIRS[dirIndex].f;
  return Math.atan2(f.y, f.x);
}

/**
 * frame の局所座標 (forward, side) をワールドのベクトルへ射影する。
 * 位置に使う場合は呼び出し側で盤面中心に加算すること
 * (例: `center + toWorld(frame, edgeDistance, sideOffset)`)。
 */
export function toWorld(frame, forward, side) {
  return {
    x: frame.f.x * forward + frame.s.x * side,
    y: frame.f.y * forward + frame.s.y * side,
  };
}
