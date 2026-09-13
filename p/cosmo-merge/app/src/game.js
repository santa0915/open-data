// game.js — ゲームルール層(純ロジック・DOM非依存)
//
// 物理(physics.js)の上に「スイカゲーム型」のルールを載せる:
//   投下 → 同ティア接触で合体(次ティアに進化) → スコア加算 →
//   デッドライン超過でゲームオーバー。
// 描画・入力・音は一切持たない。外部への通知は state.events キューで行い、
// 呼び出し側(main.js やテスト)が読み取って drain する。
//
// イベント種別:
//   { type: 'merge', x, y, tier, score }  … tier のペアが合体した(演出・効果音用)
//   { type: 'drop', x, y, tier }          … プレイヤーが投下した
//   { type: 'gameover', score }           … ゲームオーバー確定

import { createWorld, addBody, step } from './physics.js';
import { weightedPick } from './rng.js';

/**
 * 新しいゲーム状態を生成する。
 * @param {object} config - defaultConfig() 相当(テストでは縮小盤面などに差し替え可)
 * @param {object} theme  - THEME 相当(tiers 配列を持つこと)
 * @param {function} rng  - createRng(seed) が返す乱数関数
 */
export function createGame(config, theme, rng) {
  const game = {
    config,
    theme,
    rng,
    world: createWorld(config.physics, config.board),
    phase: 'playing', // 'playing' | 'gameover'
    score: 0,
    time: 0, // ゲーム内経過時間 [s]
    aimX: config.board.width / 2, // 投下位置(プレイヤー操作で移動)
    currentTier: 0, // 下で初期化
    nextTier: 0,
    dropCooldown: 0, // 残り秒数。0以下で投下可能
    dangerTime: 0, // デッドライン超過が継続している秒数
    danger: false, // 描画用: 今フレームに超過体が存在するか
    events: [],
  };
  game.currentTier = rollSpawnTier(game);
  game.nextTier = rollSpawnTier(game);
  return game;
}

/** 投下候補ティアを重み付き抽選する(1始まり)。 */
function rollSpawnTier(game) {
  const weights = game.config.rules.spawnWeights.slice(0, game.config.rules.spawnMaxTier);
  return weightedPick(game.rng, weights) + 1;
}

/** 現在の投下ティアの半径(投下位置のクランプと描画に使う)。 */
export function currentRadius(game) {
  return game.theme.tiers[game.currentTier - 1].radius;
}

/** 照準x座標を設定する。半径ぶん壁の内側にクランプされる。 */
export function setAimX(game, x) {
  const r = currentRadius(game);
  game.aimX = Math.min(Math.max(x, r), game.config.board.width - r);
}

/** 投下可能なら true(UI の表示分岐にも使う)。 */
export function canDrop(game) {
  return game.phase === 'playing' && game.dropCooldown <= 0;
}

/**
 * 現在の天体を照準位置から投下する。成功したら true。
 * クールダウン中・ゲームオーバー中は何もしない。
 */
export function drop(game) {
  if (!canDrop(game)) return false;
  setAimX(game, game.aimX); // ティアが変わった直後のクランプずれ対策
  const tier = game.currentTier;
  const body = addBody(game.world, {
    x: game.aimX,
    y: game.config.board.dropY,
    r: game.theme.tiers[tier - 1].radius,
    tier,
  });
  body.bornAt = game.time;
  game.events.push({ type: 'drop', x: body.x, y: body.y, tier });

  game.currentTier = game.nextTier;
  game.nextTier = rollSpawnTier(game);
  game.dropCooldown = game.config.rules.dropCooldown;
  return true;
}

/**
 * ゲームを dt 秒進める。物理 → 合体 → ゲームオーバー判定の順。
 * dt には config.physics.fixedDt を渡すこと(固定タイムステップ前提)。
 */
export function update(game, dt) {
  if (game.phase !== 'playing') return;
  game.time += dt;
  game.dropCooldown -= dt;

  step(game.world, dt);
  resolveMerges(game);
  checkGameOver(game, dt);
}

/**
 * 物理 step が記録した接触ペアから、同ティア同士を合体させる。
 * 1つの天体は1フレームに1回しか合体しない(dead フラグで排他)。
 * 合体で生まれた天体は次フレーム以降の接触で連鎖合体する。
 */
function resolveMerges(game) {
  const world = game.world;
  let merged = false;

  for (const [a, b] of world.contacts) {
    if (a.dead || b.dead || a.tier !== b.tier) continue;
    a.dead = true;
    b.dead = true;

    const tier = a.tier;
    const tierDef = game.theme.tiers[tier - 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    game.score += tierDef.score;
    game.events.push({ type: 'merge', x: mx, y: my, tier, score: tierDef.score });
    merged = true;

    // 最大ティア同士は消滅(スコアのみ)。それ以外は次ティアが誕生する。
    if (tier < game.theme.tiers.length) {
      const child = addBody(world, {
        x: mx,
        y: my,
        r: game.theme.tiers[tier].radius,
        tier: tier + 1,
        vx: (a.vx + b.vx) / 2,
        vy: (a.vy + b.vy) / 2,
      });
      child.bornAt = game.time;
    }
  }

  if (merged) {
    world.bodies = world.bodies.filter((b) => !b.dead);
  }
}

/**
 * ゲームオーバー判定。
 * 「生まれてから gameOverGrace 秒を超えた天体の上端がデッドラインより上」
 * の状態が gameOverDelay 秒連続したら確定する。猶予と連続時間の2段構えに
 * しているのは、投下直後の通過や合体の跳ねで即死しないようにするため。
 */
function checkGameOver(game, dt) {
  const { deadlineY } = game.config.board;
  const { gameOverGrace, gameOverDelay } = game.config.rules;

  let danger = false;
  for (const b of game.world.bodies) {
    if (game.time - b.bornAt < gameOverGrace) continue;
    if (b.y - b.r < deadlineY) {
      danger = true;
      break;
    }
  }
  game.danger = danger;
  game.dangerTime = danger ? game.dangerTime + dt : 0;

  if (game.dangerTime >= gameOverDelay) {
    game.phase = 'gameover';
    game.events.push({ type: 'gameover', score: game.score });
  }
}
