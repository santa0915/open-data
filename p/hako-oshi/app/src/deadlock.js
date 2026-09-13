// deadlock.js — 角デッドロックの静的検出(即時警告用・v1は角のみ)
//
// ゴールに載っていない箱について、直交2方向(上下いずれか×左右いずれか)が
// 両方とも壁なら、その箱はもう動かせない(角にはまった)と判定する。
// 例: 箱の上と左が壁 → 上へも左へも押せず、下・右へ押しても壁沿いに
//     戻ってこられないため、事実上のデッドロック。
//
// v1はこのパターンのみを検出する(誤検出ゼロを優先。凍結・壁ラインの検出は
// game-design.md §7 / development-guide.md の拡張候補)。
// solver.js は同じ判定関数を探索の枝刈りに再利用する(architecture.md §5)。

export function findDeadBoxes(level, boxes) {
  const dead = new Set();

  for (const b of boxes) {
    if (level.goals.has(b)) continue; // ゴール上の箱はデッドロック扱いしない

    const [x, y] = b.split(',').map(Number);
    const wallUp = level.walls.has(`${x},${y - 1}`);
    const wallDown = level.walls.has(`${x},${y + 1}`);
    const wallLeft = level.walls.has(`${x - 1},${y}`);
    const wallRight = level.walls.has(`${x + 1},${y}`);

    const cornered =
      (wallUp && wallLeft) ||
      (wallUp && wallRight) ||
      (wallDown && wallLeft) ||
      (wallDown && wallRight);

    if (cornered) dead.add(b);
  }

  return dead;
}
