// physics.js — 円専用の軽量2D物理エンジン(依存ゼロ・決定的)
//
// このゲームに必要な範囲(円同士・円と壁)だけを実装した最小エンジン。
// 汎用物理エンジンを使わない判断の理由は docs/adr/0003-custom-physics.md 参照。
//
// 設計方針:
//   - 固定タイムステップ前提(呼び出し側が cfg.fixedDt で step を回す)。
//     同じ初期状態と同じ dt 列に対して常に同じ結果を返す(決定的)。
//   - 速度の衝突応答は1回、位置のめり込み補正は solverIterations 回反復。
//     カジュアルな積み上げ表現にはこれで十分安定する。
//   - 質量は半径の2乗に比例(面積比)。大きい天体ほど押されにくい。
//   - DOM/Canvas に一切依存しない(Node.js でそのままテスト可能)。

/**
 * 物理ワールドを生成する。
 * @param {object} cfg - defaultConfig().physics 相当
 * @param {object} board - defaultConfig().board 相当(width/height を使用)
 */
export function createWorld(cfg, board) {
  return {
    cfg,
    width: board.width,
    height: board.height,
    bodies: [],
    nextId: 1,
    // 直近の step で接触したペア [bodyA, bodyB] の配列。
    // 合体判定(game.js)がこれを読む。step のたびにクリアされる。
    contacts: [],
  };
}

/**
 * 剛体(円)を追加して返す。tier はゲーム側の意味づけで物理は関知しない。
 */
export function addBody(world, { x, y, r, tier, vx = 0, vy = 0 }) {
  const body = { id: world.nextId++, x, y, r, tier, vx, vy, dead: false };
  world.bodies.push(body);
  return body;
}

/**
 * 物理を dt 秒だけ進める。呼び出し側は必ず固定 dt で呼ぶこと。
 */
export function step(world, dt) {
  const cfg = world.cfg;
  const bodies = world.bodies;
  world.contacts.length = 0;

  // 1. 積分(semi-implicit Euler): 速度→位置の順で更新
  const drag = Math.max(0, 1 - cfg.airDrag * dt);
  for (const b of bodies) {
    b.vy += cfg.gravity * dt;
    b.vx *= drag;
    b.vy *= drag;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // 2. 衝突解決: 速度応答は初回のみ、位置補正は全反復で行う
  for (let iter = 0; iter < cfg.solverIterations; iter++) {
    const applyImpulse = iter === 0;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        resolvePair(bodies[i], bodies[j], cfg, applyImpulse, world.contacts);
      }
    }
    for (const b of bodies) {
      resolveWalls(b, world, applyImpulse);
    }
  }
}

/**
 * 円同士の衝突解決。重なっていれば位置を押し戻し、初回のみ速度も反射する。
 */
function resolvePair(a, b, cfg, applyImpulse, contacts) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rsum = a.r + b.r;
  const distSq = dx * dx + dy * dy;
  if (distSq >= rsum * rsum) return;

  let dist = Math.sqrt(distSq);
  let nx, ny;
  if (dist < 1e-6) {
    // 完全に同一座標(同位置スポーン等)。上下方向に分離する。
    nx = 0;
    ny = -1;
    dist = 0;
  } else {
    nx = dx / dist;
    ny = dy / dist;
  }

  // 逆質量(質量は面積 = r^2 に比例)。大きい方が動きにくい。
  const invMassA = 1 / (a.r * a.r);
  const invMassB = 1 / (b.r * b.r);
  const invMassSum = invMassA + invMassB;

  // 位置補正: めり込み量の一定割合を反復で解消する
  const overlap = rsum - dist;
  const correction = (overlap * cfg.positionCorrection) / invMassSum;
  a.x -= nx * correction * invMassA;
  a.y -= ny * correction * invMassA;
  b.x += nx * correction * invMassB;
  b.y += ny * correction * invMassB;

  if (applyImpulse) {
    contacts.push([a, b]);

    // 法線方向の相対速度が近づく向きのときだけ反発インパルスを与える
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velAlongNormal = rvx * nx + rvy * ny;
    if (velAlongNormal < 0) {
      const impulse = (-(1 + cfg.restitution) * velAlongNormal) / invMassSum;
      a.vx -= impulse * nx * invMassA;
      a.vy -= impulse * ny * invMassA;
      b.vx += impulse * nx * invMassB;
      b.vy += impulse * ny * invMassB;

      // 接線方向の相対速度を減衰(簡易摩擦: 滑り・転がりすぎ防止)
      const tvx = rvx - velAlongNormal * nx;
      const tvy = rvy - velAlongNormal * ny;
      const friction = cfg.contactFriction / invMassSum;
      a.vx += tvx * friction * invMassA;
      a.vy += tvy * friction * invMassA;
      b.vx -= tvx * friction * invMassB;
      b.vy -= tvy * friction * invMassB;
    }
  }
}

/**
 * 壁(左右・床)との衝突解決。天井は開放(投下口)なので判定しない。
 */
function resolveWalls(b, world, applyImpulse) {
  const rest = world.cfg.restitution;

  if (b.x - b.r < 0) {
    b.x = b.r;
    if (applyImpulse && b.vx < 0) b.vx = -b.vx * rest;
  } else if (b.x + b.r > world.width) {
    b.x = world.width - b.r;
    if (applyImpulse && b.vx > 0) b.vx = -b.vx * rest;
  }

  if (b.y + b.r > world.height) {
    b.y = world.height - b.r;
    if (applyImpulse) {
      if (b.vy > 0) b.vy = -b.vy * rest;
      // 床摩擦: 接地中の水平速度を減衰させ、静止しやすくする
      b.vx *= 1 - world.cfg.groundFriction;
    }
  }
}
