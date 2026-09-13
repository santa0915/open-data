// enemies.js — 敵・ボスのスポーンと挙動更新
//
// 「-fに直進、sに正弦波」のように軌道パターンを一度書けば4方向で動く
// (docs/adr/0003-direction-frame.md §2)。方向による分岐(if dirIndex===...)
// は書かない。敵はスポーン時のframe(DIRSの要素)を保持し、切替後もその
// frameで動き続ける(残存物の慣性)。ボスだけは「現在の」dirIndexを毎フレーム
// 参照する(アンカーが新しい前縁へ引っ越すため)。
//
// 座標はスポーン時に一度だけ決める分(zako/tank/carrier)は経過時間age から
// 解析的に(=毎フレーム蓄積せず)再計算する。誤差が蓄積せず決定性が保ちやすい。
// 自機を追尾するarc・ボスは経過時間だけでは決まらないため速度を積分する。

import { DIRS, toWorld } from './directions.js';
import { ENEMY_TYPES, STAGE } from './stage.js';

/** 角度をラジアン[-π, π]へ正規化する。 */
function normalizeAngle(a) {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

/** 盤面中心。 */
function boardCenter(config) {
  return { x: config.board.width / 2, y: config.board.height / 2 };
}

/**
 * 敵を1体スポーンして game.enemies に追加する。現在の dirIndex の frame を
 * 保持させ、前縁の外側(中心 + f*(edgeDistance+aheadMargin) + s*side)に置く。
 */
export function spawnEnemy(game, type, side) {
  const { config } = game;
  const def = ENEMY_TYPES[type];
  const frame = DIRS[game.dirIndex];
  const center = boardCenter(config);
  const forwardDist = config.spawn.edgeDistance + config.spawn.aheadMargin;
  const offset = toWorld(frame, forwardDist, side);

  const enemy = {
    x: center.x + offset.x,
    y: center.y + offset.y,
    r: def.radius,
    hp: def.hp,
    type,
    frame,
    age: 0,
    score: def.score,
    spawnX: center.x + offset.x,
    spawnY: center.y + offset.y,
  };

  if (type === 'arc') {
    // 初速はスポーン時のframeの-f方向(以後、自機方向へ緩く旋回する)
    const v = toWorld(frame, -def.speed, 0);
    enemy.vx = v.x;
    enemy.vy = v.y;
  }
  if (type === 'tank') {
    enemy.fireTimer = def.fireInterval;
  }

  game.enemies.push(enemy);
  return enemy;
}

/** ボスをスポーンし、game.boss にセットする。 */
export function spawnBoss(game) {
  const bossCfg = STAGE.boss;
  const frame = DIRS[game.dirIndex];
  const center = boardCenter(game.config);
  const anchor = toWorld(frame, bossCfg.anchorDistance, 0);

  game.boss = {
    x: center.x + anchor.x,
    y: center.y + anchor.y,
    r: bossCfg.radius,
    hp: bossCfg.hp,
    maxHp: bossCfg.hp,
    fireTimer: bossCfg.attackInterval,
    age: 0,
    attackToggle: 0, // 0: 5-way, 1: 2連。攻撃のたびに反転する
    pendingPair: null, // 2連攻撃の2発目待ち { timer, angle }
  };
  return game.boss;
}

/** 撃破された敵の位置から、そのフレームの-f方向へ漂うカプセルを作る。 */
export function spawnCapsule(game, enemy) {
  const cfg = game.config.capsule;
  const v = toWorld(enemy.frame, -cfg.driftSpeed, 0);
  const capsule = { x: enemy.x, y: enemy.y, vx: v.x, vy: v.y, r: cfg.radius };
  game.capsules.push(capsule);
  return capsule;
}

/** 敵1体ぶんの位置・状態を更新する(zako/tank/carrierは解析的、arcは積分)。 */
function updateOne(game, enemy, dt) {
  const def = ENEMY_TYPES[enemy.type];
  enemy.age += dt;

  if (enemy.type === 'arc') {
    if (enemy.age <= def.turnDuration) {
      const target = Math.atan2(game.player.y - enemy.y, game.player.x - enemy.x);
      const current = Math.atan2(enemy.vy, enemy.vx);
      const diff = normalizeAngle(target - current);
      const maxStep = def.turnRate * dt;
      const step = Math.max(-maxStep, Math.min(maxStep, diff));
      const next = current + step;
      enemy.vx = Math.cos(next) * def.speed;
      enemy.vy = Math.sin(next) * def.speed;
    }
    enemy.x += enemy.vx * dt;
    enemy.y += enemy.vy * dt;
    return;
  }

  // zako/tank/carrier: age から解析的に位置を求める(誤差が蓄積しない)
  const forwardDist = -def.speed * enemy.age;
  const sideAmp = def.swayAmplitude || 0;
  const sidePeriod = def.swayPeriod || 1;
  const sideDist = sideAmp * Math.sin((2 * Math.PI * enemy.age) / sidePeriod);
  const offset = toWorld(enemy.frame, forwardDist, sideDist);
  enemy.x = enemy.spawnX + offset.x;
  enemy.y = enemy.spawnY + offset.y;

  if (enemy.type === 'tank') {
    enemy.fireTimer -= dt;
    if (enemy.fireTimer <= 0) {
      enemy.fireTimer += def.fireInterval;
      const angle = Math.atan2(game.player.y - enemy.y, game.player.x - enemy.x);
      game.enemyBullets.push({
        x: enemy.x,
        y: enemy.y,
        vx: Math.cos(angle) * def.bulletSpeed,
        vy: Math.sin(angle) * def.bulletSpeed,
        r: def.bulletRadius,
      });
    }
  }
}

/** game.enemies の全敵を更新する。 */
export function updateEnemies(game, dt) {
  for (const enemy of game.enemies) updateOne(game, enemy, dt);
}

/**
 * ボスの移動(アンカー追従+スウェイ)と攻撃を更新する。
 * アンカーは常に「現在のdirIndex」の前方に置かれ、方向が切り替わると
 * ボスは新しいアンカーへ等速で寄っていく(経路の演出は不要 → 既知の割り切り)。
 */
export function updateBoss(game, dt) {
  const boss = game.boss;
  if (!boss) return;
  const bossCfg = STAGE.boss;
  boss.age += dt;

  const frame = DIRS[game.dirIndex];
  const center = boardCenter(game.config);
  const anchorOffset = toWorld(frame, bossCfg.anchorDistance, 0);
  const sway = bossCfg.swayAmplitude * Math.sin((2 * Math.PI * boss.age) / bossCfg.swayPeriod);
  const swayOffset = toWorld(frame, 0, sway);
  const targetX = center.x + anchorOffset.x + swayOffset.x;
  const targetY = center.y + anchorOffset.y + swayOffset.y;

  const dx = targetX - boss.x;
  const dy = targetY - boss.y;
  const dist = Math.hypot(dx, dy);
  const step = bossCfg.anchorSpeed * dt;
  if (dist <= step || dist === 0) {
    boss.x = targetX;
    boss.y = targetY;
  } else {
    boss.x += (dx / dist) * step;
    boss.y += (dy / dist) * step;
  }

  // 2連攻撃の2発目待ち(先に予約したタイマーが尽きたら発射)
  if (boss.pendingPair) {
    boss.pendingPair.timer -= dt;
    if (boss.pendingPair.timer <= 0) {
      const angle = boss.pendingPair.angle;
      game.enemyBullets.push({
        x: boss.x,
        y: boss.y,
        vx: Math.cos(angle) * bossCfg.pairBulletSpeed,
        vy: Math.sin(angle) * bossCfg.pairBulletSpeed,
        r: 5,
      });
      boss.pendingPair = null;
    }
  }

  boss.fireTimer -= dt;
  if (boss.fireTimer <= 0) {
    boss.fireTimer += bossCfg.attackInterval;
    const aim = Math.atan2(game.player.y - boss.y, game.player.x - boss.x);
    if (boss.attackToggle === 0) {
      // ①自機狙いのNウェイ
      const stepAngle = (bossCfg.fanAngleStepDeg * Math.PI) / 180;
      const half = (bossCfg.fanCount - 1) / 2;
      for (let i = 0; i < bossCfg.fanCount; i++) {
        const angle = aim + (i - half) * stepAngle;
        game.enemyBullets.push({
          x: boss.x,
          y: boss.y,
          vx: Math.cos(angle) * bossCfg.fanBulletSpeed,
          vy: Math.sin(angle) * bossCfg.fanBulletSpeed,
          r: 5,
        });
      }
    } else {
      // ②自機狙い2連(1発目は即、2発目はpairInterval秒後)
      game.enemyBullets.push({
        x: boss.x,
        y: boss.y,
        vx: Math.cos(aim) * bossCfg.pairBulletSpeed,
        vy: Math.sin(aim) * bossCfg.pairBulletSpeed,
        r: 5,
      });
      boss.pendingPair = { timer: bossCfg.pairInterval, angle: aim };
    }
    boss.attackToggle = 1 - boss.attackToggle;
  }
}
