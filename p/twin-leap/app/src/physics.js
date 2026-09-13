// physics.js — タイルマップ用AABBプラットフォーマー物理(依存ゼロ・決定的)
//
// 軸分離スイープ方式: X移動→X解決→Y移動→Y解決 の順で処理する。
// プラットフォーマーの定番手法で、角での引っかかりが起きにくい。
// 固定タイムステップ前提(1/120s)。最大速度 900px/s × 1/120s = 7.5px/step は
// プレイヤーの最小辺(24px)より十分小さく、トンネリングは起きない。
//
// このモジュールは「ソリッドかどうか」を isSolid(tx, ty) コールバックで
// 問い合わせるだけで、レベル・ゲート・プレイヤーの事情は一切知らない。

/**
 * AABB剛体を dt 秒ぶん移動し、タイルと衝突解決する。
 * @param {object} body - { x, y, w, h, vx, vy, grounded } を持つオブジェクト(破壊的更新)
 * @param {number} dt - 固定タイムステップ [s]
 * @param {function} isSolid - (tx, ty) => boolean。範囲外は true を返すこと
 * @param {number} tile - タイル1辺のピクセル数
 */
export function moveBody(body, dt, isSolid, tile) {
  // --- X軸 ---
  body.x += body.vx * dt;
  if (body.vx > 0) {
    const tx = Math.floor((body.x + body.w) / tile);
    if (touchesColumn(body, tx, isSolid, tile)) {
      body.x = tx * tile - body.w;
      body.vx = 0;
    }
  } else if (body.vx < 0) {
    const tx = Math.floor(body.x / tile);
    if (touchesColumn(body, tx, isSolid, tile)) {
      body.x = (tx + 1) * tile;
      body.vx = 0;
    }
  }

  // --- Y軸 ---
  body.grounded = false;
  body.y += body.vy * dt;
  if (body.vy > 0) {
    const ty = Math.floor((body.y + body.h) / tile);
    if (touchesRow(body, ty, isSolid, tile)) {
      body.y = ty * tile - body.h;
      body.vy = 0;
      body.grounded = true;
    }
  } else if (body.vy < 0) {
    const ty = Math.floor(body.y / tile);
    if (touchesRow(body, ty, isSolid, tile)) {
      body.y = (ty + 1) * tile;
      body.vy = 0;
    }
  }
}

/** body が縦に跨いでいる行のうち、列 tx にソリッドがあるか。 */
function touchesColumn(body, tx, isSolid, tile) {
  const tyFrom = Math.floor(body.y / tile);
  const tyTo = Math.floor((body.y + body.h - 0.001) / tile);
  for (let ty = tyFrom; ty <= tyTo; ty++) {
    if (isSolid(tx, ty)) return true;
  }
  return false;
}

/** body が横に跨いでいる列のうち、行 ty にソリッドがあるか。 */
function touchesRow(body, ty, isSolid, tile) {
  const txFrom = Math.floor(body.x / tile);
  const txTo = Math.floor((body.x + body.w - 0.001) / tile);
  for (let tx = txFrom; tx <= txTo; tx++) {
    if (isSolid(tx, ty)) return true;
  }
  return false;
}

/** AABB同士の重なり判定(ゲーム層のアイテム取得等でも使う汎用ヘルパ)。 */
export function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
