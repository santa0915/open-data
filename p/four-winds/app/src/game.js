// game.js — ゲームルール層(純ロジック・DOM非依存)
//
// 方向フレーム(directions.js)+敵・ボス(enemies.js)の上に「フォーウィンズ」
// のルールを載せる: 15秒ごとの方向切替(警告→切替→スポーン休止→回頭) →
// 自機の移動・射撃 → 敵/ボス/弾/カプセルの移動 → 衝突 → カリング →
// クリア/ゲームオーバー判定(docs/architecture.md §3, §4)。
// 描画・入力・音は一切持たない。外部への通知は game.events キューで行い、
// 呼び出し側(main.js やテスト)が読み取って drain する。
//
// イベント種別:
//   shot / hit / explosion {x,y,big} / capsule(取得) / powerup /
//   playerHit / warning / phaseChange {dirIndex} / bossSpawn /
//   clear {score} / gameover {score}
//
// 状態コントラクトのフィールド名は変更しないこと(I/O層がこの形に依存する)。

import { DIRS, nextDir, angleOf, toWorld } from './directions.js';
import { STAGE } from './stage.js';
import { spawnEnemy, spawnBoss, spawnCapsule, updateEnemies, updateBoss } from './enemies.js';

/** 角度をラジアン[-π, π]へ正規化する。 */
function normalizeAngle(a) {
  return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}

/** 2円の当たり判定。 */
function circlesHit(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

function randomSide(config, rng) {
  return rng() * 2 * config.spawn.sideRange - config.spawn.sideRange;
}

/**
 * stage.phases のウェーブを「絶対stageTime付きのスポーン予約」の平坦なリストへ
 * 展開する。編隊(count>1)はinterval秒間隔で同じsideから連続出現する
 * (docs/architecture.md §5)。side:'random' はここで一度だけ抽選し、
 * 編隊全体で共有する。
 */
function buildSpawnQueue(stage, rng, config) {
  const queue = [];
  stage.phases.forEach((phase, phaseIndex) => {
    for (const wave of phase.waves) {
      const side = wave.side === 'random' ? randomSide(config, rng) : wave.side;
      const count = wave.count || 1;
      const interval = wave.interval || 0;
      for (let i = 0; i < count; i++) {
        queue.push({
          time: phaseIndex * config.direction.cycleDuration + wave.at + i * interval,
          type: wave.type,
          side,
        });
      }
    }
  });
  queue.sort((a, b) => a.time - b.time);
  return queue;
}

/**
 * 新しいゲーム状態を生成する。
 * @param {object} config - defaultConfig() 相当
 * @param {object} stage  - STAGE 相当(phases + boss)
 * @param {function} rng  - createRng(seed) が返す乱数関数
 */
export function createGame(config, stage, rng) {
  const center = { x: config.board.width / 2, y: config.board.height / 2 };

  const game = {
    config,
    stage,
    rng,
    phase: 'playing', // 'playing' | 'clear' | 'gameover'
    score: 0,
    lives: config.player.lives,
    weaponLevel: 1,
    stageTime: 0,
    dirIndex: 0,
    phaseTimer: 0,
    phaseCount: 0,
    warning: false,
    spawnHold: 0,
    shipAngle: angleOf(0),
    player: {
      x: center.x,
      y: center.y,
      r: config.player.radius,
      fireCooldown: 0,
      invincible: 0,
      alive: true,
    },
    playerBullets: [],
    enemyBullets: [],
    enemies: [],
    capsules: [],
    boss: null,
    events: [],

    // 以下は内部状態(状態コントラクトの一部ではない。I/O層は参照しない)
    _spawnQueue: buildSpawnQueue(stage, rng, config),
    _spawnCursor: 0,
    _bossZakoTimer: 0,
  };

  return game;
}

/**
 * ゲームを dt 秒進める。dt には config.fixedDt を渡すこと(固定タイムステップ前提)。
 * @param {object} input - { up, down, left, right, fire }(押しっぱなし状態)
 */
export function update(game, dt, input) {
  if (game.phase !== 'playing') return;

  advancePhase(game, dt);
  tweenShipAngle(game, dt);
  spawnWaves(game, dt);
  updatePlayer(game, dt, input || {});
  moveEntities(game, dt);
  resolveCollisions(game);
  cullEntities(game);
}

/** フェーズ進行: 警告→方向切替→フェーズ生存ボーナス(docs/architecture.md §4-1)。 */
function advancePhase(game, dt) {
  const cfg = game.config.direction;
  game.stageTime += dt;
  game.phaseTimer += dt;

  if (!game.warning && game.phaseTimer >= cfg.cycleDuration - cfg.warningLead) {
    game.warning = true;
    game.events.push({ type: 'warning' });
  }

  if (game.phaseTimer >= cfg.cycleDuration) {
    game.phaseTimer -= cfg.cycleDuration;
    game.dirIndex = nextDir(game.dirIndex);
    game.phaseCount += 1;
    game.spawnHold = cfg.spawnHoldDuration;
    game.warning = false;
    game.score += game.config.scoring.phaseSurviveBonus;
    game.events.push({ type: 'phaseChange', dirIndex: game.dirIndex });
  }
}

/** 機体の見た目角度を目標角へ最短弧でトゥイーンする(ロジックの切替は瞬間)。 */
function tweenShipAngle(game, dt) {
  const cfg = game.config.direction;
  const angularSpeed = (Math.PI / 2) / cfg.turnDuration; // 90°を turnDuration 秒で回りきる速さ
  const target = angleOf(game.dirIndex);
  const diff = normalizeAngle(target - game.shipAngle);
  const maxStep = angularSpeed * dt;
  const step = Math.max(-maxStep, Math.min(maxStep, diff));
  game.shipAngle = normalizeAngle(game.shipAngle + step);
}

/**
 * スポーン: spawnHold中は停止。phaseCount 0..3 はstage.jsのタイムライン、
 * 4以降はボス(初回)+6秒ごとのzako編隊(docs/architecture.md §4-3)。
 */
function spawnWaves(game, dt) {
  game.spawnHold = Math.max(0, game.spawnHold - dt);
  if (game.spawnHold > 0) return;

  if (game.phaseCount >= 4) {
    if (!game.boss) {
      spawnBoss(game);
      game.boss.score = STAGE.boss.score;
      game.events.push({ type: 'bossSpawn' });
    } else {
      const zw = STAGE.boss.zakoWave;
      game._bossZakoTimer += dt;
      if (game._bossZakoTimer >= zw.interval) {
        game._bossZakoTimer -= zw.interval;
        const side = randomSide(game.config, game.rng);
        for (let i = 0; i < zw.count; i++) {
          game._spawnQueue.push({
            time: game.stageTime + i * zw.spawnInterval,
            type: 'zako',
            side,
          });
        }
      }
    }
  }

  while (
    game._spawnCursor < game._spawnQueue.length &&
    game._spawnQueue[game._spawnCursor].time <= game.stageTime
  ) {
    const ev = game._spawnQueue[game._spawnCursor];
    spawnEnemy(game, ev.type, ev.side);
    game._spawnCursor += 1;
  }
}

/** 自機の移動・射撃・無敵時間を更新する。 */
function updatePlayer(game, dt, input) {
  const player = game.player;
  const cfg = game.config;

  if (player.alive) {
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2;
      dx *= inv;
      dy *= inv;
    }
    player.x += dx * cfg.player.speed * dt;
    player.y += dy * cfg.player.speed * dt;
    player.x = Math.max(player.r, Math.min(cfg.board.width - player.r, player.x));
    player.y = Math.max(player.r, Math.min(cfg.board.height - player.r, player.y));

    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    if (input.fire && player.fireCooldown <= 0) {
      fireWeapon(game);
      player.fireCooldown = cfg.player.fireCooldown;
      game.events.push({ type: 'shot' });
    }
  }

  player.invincible = Math.max(0, player.invincible - dt);
}

/** 現在のf方向へ武器レベル別の自弾を発射する(回頭中も新方向)。 */
function fireWeapon(game) {
  const frame = DIRS[game.dirIndex];
  const cfg = game.config.bullet;
  const player = game.player;
  const vf = { x: frame.f.x * cfg.speed, y: frame.f.y * cfg.speed };

  const spawnBullet = (offsetForward, offsetSide, vx, vy) => {
    const p = toWorld(frame, offsetForward, offsetSide);
    game.playerBullets.push({ x: player.x + p.x, y: player.y + p.y, vx, vy, r: cfg.radius });
  };

  if (game.weaponLevel === 1) {
    spawnBullet(0, 0, vf.x, vf.y);
    return;
  }

  // Lv2以上: 側方±twinSideOffsetの平行ツイン
  spawnBullet(0, cfg.twinSideOffset, vf.x, vf.y);
  spawnBullet(0, -cfg.twinSideOffset, vf.x, vf.y);

  if (game.weaponLevel >= 3) {
    // ツインに加え、前方±obliqueAngleDegの斜め2発(計4発)
    const baseAngle = Math.atan2(frame.f.y, frame.f.x);
    const rad = (cfg.obliqueAngleDeg * Math.PI) / 180;
    for (const sign of [1, -1]) {
      const angle = baseAngle + sign * rad;
      spawnBullet(0, 0, Math.cos(angle) * cfg.speed, Math.sin(angle) * cfg.speed);
    }
  }
}

/** 敵・ボス・弾・カプセルを各自の速度/フレームで移動させる。 */
function moveEntities(game, dt) {
  updateEnemies(game, dt);
  if (game.boss) updateBoss(game, dt);

  for (const b of game.playerBullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (const b of game.enemyBullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
  for (const c of game.capsules) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  }
}

/** 衝突判定一式(docs/architecture.md §4-6)。 */
function resolveCollisions(game) {
  resolvePlayerBulletsVsEnemies(game);
  resolvePlayerBulletsVsBoss(game);
  resolvePlayerVsThreats(game);
  resolvePlayerVsCapsules(game);
}

function resolvePlayerBulletsVsEnemies(game) {
  for (const bullet of game.playerBullets) {
    if (bullet.dead) continue;
    for (const enemy of game.enemies) {
      if (enemy.dead || bullet.dead) continue;
      if (!circlesHit(bullet, enemy)) continue;

      bullet.dead = true;
      enemy.hp -= game.config.bullet.damage;
      game.events.push({ type: 'hit' });
      if (enemy.hp <= 0) {
        enemy.dead = true;
        game.score += enemy.score;
        game.events.push({ type: 'explosion', x: enemy.x, y: enemy.y, big: false });
        if (enemy.type === 'carrier') spawnCapsule(game, enemy);
      }
    }
  }
  game.playerBullets = game.playerBullets.filter((b) => !b.dead);
  game.enemies = game.enemies.filter((e) => !e.dead);
}

function resolvePlayerBulletsVsBoss(game) {
  const boss = game.boss;
  if (!boss || boss.hp <= 0) return;
  for (const bullet of game.playerBullets) {
    if (bullet.dead || boss.hp <= 0) continue;
    if (!circlesHit(bullet, boss)) continue;

    bullet.dead = true;
    boss.hp -= game.config.bullet.damage;
    game.events.push({ type: 'hit' });
    if (boss.hp <= 0) {
      game.score += boss.score;
      game.events.push({ type: 'explosion', x: boss.x, y: boss.y, big: true });
      game.phase = 'clear';
      game.events.push({ type: 'clear', score: game.score });
    }
  }
  game.playerBullets = game.playerBullets.filter((b) => !b.dead);
}

/** 敵本体・敵弾・ボスとの被弾判定。無敵中は無視し、1フレームに1回だけ食らう。 */
function resolvePlayerVsThreats(game) {
  const player = game.player;
  const wasVulnerable = player.alive && player.invincible <= 0;
  let hitThisFrame = false;

  for (const bullet of game.enemyBullets) {
    if (bullet.dead) continue;
    if (!circlesHit(player, bullet)) continue;
    bullet.dead = true;
    if (wasVulnerable && !hitThisFrame) {
      applyPlayerHit(game);
      hitThisFrame = true;
    }
  }
  game.enemyBullets = game.enemyBullets.filter((b) => !b.dead);

  if (wasVulnerable && !hitThisFrame) {
    for (const enemy of game.enemies) {
      if (circlesHit(player, enemy)) {
        applyPlayerHit(game);
        hitThisFrame = true;
        break;
      }
    }
  }

  if (wasVulnerable && !hitThisFrame && game.boss && circlesHit(player, game.boss)) {
    applyPlayerHit(game);
  }
}

function applyPlayerHit(game) {
  game.lives -= 1;
  game.player.invincible = game.config.player.invincibleDuration;
  game.events.push({ type: 'playerHit' });
  if (game.lives <= 0) {
    game.player.alive = false;
    game.phase = 'gameover';
    game.events.push({ type: 'gameover', score: game.score });
  }
}

function resolvePlayerVsCapsules(game) {
  const player = game.player;
  for (const capsule of game.capsules) {
    if (capsule.dead) continue;
    if (!circlesHit(player, capsule)) continue;
    capsule.dead = true;
    game.events.push({ type: 'capsule' });
    if (game.weaponLevel < 3) {
      game.weaponLevel += 1;
      game.events.push({ type: 'powerup' });
    } else {
      game.score += game.config.scoring.capsuleMaxLevelBonus;
    }
  }
  game.capsules = game.capsules.filter((c) => !c.dead);
}

/**
 * カリング。frameを保持する敵は後縁/側縁の外側マージンで判定
 * (docs/game-design.md §3)。frameを持たない弾・カプセルは単純なAABBで判定する
 * (設計書に個別の数値が無いための簡略化。config.spawn.genericCullMargin)。
 */
function cullEntities(game) {
  const cfg = game.config;
  const center = { x: cfg.board.width / 2, y: cfg.board.height / 2 };
  const backLimit = -(cfg.spawn.edgeDistance + cfg.spawn.cullBackMargin);
  const sideLimit = cfg.spawn.edgeDistance + cfg.spawn.cullSideMargin;

  game.enemies = game.enemies.filter((enemy) => {
    const dx = enemy.x - center.x;
    const dy = enemy.y - center.y;
    const forward = dx * enemy.frame.f.x + dy * enemy.frame.f.y;
    const side = dx * enemy.frame.s.x + dy * enemy.frame.s.y;
    return forward >= backLimit && Math.abs(side) <= sideLimit;
  });

  const margin = cfg.spawn.genericCullMargin;
  const inBoardBounds = (e) =>
    e.x >= -margin &&
    e.x <= cfg.board.width + margin &&
    e.y >= -margin &&
    e.y <= cfg.board.height + margin;

  game.playerBullets = game.playerBullets.filter(inBoardBounds);
  game.enemyBullets = game.enemyBullets.filter(inBoardBounds);
  game.capsules = game.capsules.filter(inBoardBounds);
}
