// game.js — ゲームルール層(純ロジック・DOM非依存)
//
// 物理(physics.js)の上に「協力プラットフォーマー」のルールを載せる:
//   2人同時操作 → 頭乗り(積み重ね) → カギ・ドア・スイッチ/ゲート・トゲ →
//   全員がドアに入ってクリア → 全レベル踏破。
// 乱数は使わない(完全に決定的)。同じ入力列は常に同じ結果になる。
//
// イベント種別(state.events。呼び出し側が読み取って空にする):
//   { type: 'level', index, name }  … レベル開始
//   { type: 'jump', player }        … ジャンプした(効果音用)
//   { type: 'key', player }         … カギを取った
//   { type: 'unlock' }              … ドアが開いた
//   { type: 'gate', open }          … ゲートの開閉が切り替わった
//   { type: 'death' }               … トゲに触れた(位置リセット)
//   { type: 'clear', index }        … レベルクリア
//   { type: 'allclear', time, deaths } … 全レベルクリア

import { moveBody, aabbOverlap } from './physics.js';
import { parseLevel } from './levels.js';

export function createGame(config, levels) {
  const game = {
    config,
    levels,
    levelIndex: 0,
    phase: 'playing', // 'playing' | 'clear' | 'allclear'
    totalTime: 0, // 全レベル通算のプレイ時間 [s]
    levelTime: 0, // 現在レベルの経過時間(演出用)
    deaths: 0,
    clearTimer: 0,
    players: [],
    events: [],
  };
  loadLevel(game, 0);
  return game;
}

/** 指定インデックスのレベルを読み込み、プレイ状態を初期化する。 */
export function loadLevel(game, index) {
  const T = game.config.tile;
  const level = parseLevel(game.levels[index].grid);
  game.levelIndex = index;
  game.level = level;
  game.phase = 'playing';
  game.levelTime = 0;
  game.gateOpen = false;

  game.players = level.spawns.map((s, i) => makePlayer(game.config, s, i, T));

  game.key = level.key
    ? {
        homeX: level.key.tx * T + (T - 24) / 2,
        homeY: level.key.ty * T + (T - 24) / 2,
        x: 0, y: 0, // 下で home に揃える
        heldBy: -1, // 持っているプレイヤーの index。-1 = 誰も持っていない
        delivered: false,
      }
    : null;
  if (game.key) {
    game.key.x = game.key.homeX;
    game.key.y = game.key.homeY;
  }

  // ドアは見た目・判定とも縦2タイル('D' はその下端)
  game.door = {
    x: level.door.tx * T + 2,
    y: (level.door.ty - 1) * T + 4,
    w: T - 4,
    h: T * 2 - 4,
    unlocked: !level.key, // カギの無いレベルは最初から開いている
  };

  game.events.push({ type: 'level', index, name: game.levels[index].name });
}

function makePlayer(config, spawn, index, T) {
  const { width, height } = config.player;
  return {
    index,
    x: spawn.tx * T + (T - width) / 2,
    y: spawn.ty * T + (T - height),
    w: width,
    h: height,
    vx: 0,
    vy: 0,
    grounded: false,
    facing: index === 0 ? 1 : -1,
    coyote: 0,
    buffer: 0,
    prevJump: false,
    prevY: 0,
  };
}

/** プレイヤーを含む全動体をスポーン状態に戻す(トゲ死・リトライ共用)。 */
export function resetPositions(game) {
  const T = game.config.tile;
  game.level.spawns.forEach((s, i) => {
    game.players[i] = makePlayer(game.config, s, i, T);
  });
  if (game.key && !game.key.delivered) {
    game.key.heldBy = -1;
    game.key.x = game.key.homeX;
    game.key.y = game.key.homeY;
  }
  game.gateOpen = false;
}

/** タイルのソリッド判定(閉じたゲートを含む)。物理へ渡すコールバック。 */
function isSolidAt(game, tx, ty) {
  const level = game.level;
  if (tx < 0 || ty < 0 || tx >= level.cols || ty >= level.rows) return true;
  if (level.solid[ty][tx]) return true;
  if (!game.gateOpen && level.gateSet.has(ty * level.cols + tx)) return true;
  return false;
}

/**
 * ゲームを dt 秒進める。
 * @param {Array} inputs - プレイヤーごとの { left, right, jump }(押しっぱなし状態)
 */
export function update(game, dt, inputs) {
  if (game.phase === 'clear') {
    game.clearTimer -= dt;
    if (game.clearTimer <= 0) {
      if (game.levelIndex + 1 < game.levels.length) {
        loadLevel(game, game.levelIndex + 1);
      } else {
        game.phase = 'allclear';
        game.events.push({ type: 'allclear', time: game.totalTime, deaths: game.deaths });
      }
    }
    return;
  }
  if (game.phase !== 'playing') return;

  game.totalTime += dt;
  game.levelTime += dt;

  const isSolid = (tx, ty) => isSolidAt(game, tx, ty);
  game.players.forEach((p, i) => stepPlayer(game, p, inputs[i] || {}, dt, isSolid));
  resolveStacking(game);
  updateKey(game);
  updateGates(game);
  checkSpikes(game);
  checkClear(game);
}

/** 1プレイヤーぶんの入力処理・ジャンプ制御・物理移動。 */
function stepPlayer(game, p, input, dt, isSolid) {
  const c = game.config.player;
  const phys = game.config.physics;

  // 横移動: 入力方向へ加速、入力なしなら減速(空中は慣性を残す)
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    const accel = p.grounded ? c.groundAccel : c.airAccel;
    p.vx += dir * accel * dt;
    p.vx = Math.max(-c.moveMax, Math.min(c.moveMax, p.vx));
    p.facing = dir;
  } else {
    const decel = (p.grounded ? c.groundDecel : c.airDecel) * dt;
    if (Math.abs(p.vx) <= decel) p.vx = 0;
    else p.vx -= Math.sign(p.vx) * decel;
  }

  // ジャンプ: コヨーテタイム(離床猶予)+先行入力バッファの2つのQoLを併用
  p.coyote = p.grounded ? c.coyoteTime : p.coyote - dt;
  if (input.jump && !p.prevJump) p.buffer = c.jumpBuffer;
  else p.buffer -= dt;
  if (p.buffer > 0 && p.coyote > 0) {
    p.vy = -c.jumpVelocity;
    p.coyote = 0;
    p.buffer = 0;
    game.events.push({ type: 'jump', player: p.index });
  }
  // 可変ジャンプ: ボタンを離したら上昇速度を削る(短押し=低いジャンプ)
  if (!input.jump && p.vy < -c.jumpCutVelocity) p.vy = -c.jumpCutVelocity;
  p.prevJump = !!input.jump;

  // 重力(終端速度あり)→ 移動・衝突解決
  p.vy = Math.min(p.vy + phys.gravity * dt, phys.maxFallSpeed);
  p.prevY = p.y;
  moveBody(p, dt, isSolid, game.config.tile);
}

/**
 * プレイヤー同士の「頭乗り」解決。
 * 上から降ってきた場合のみ相手の頭の上に着地できる(横方向は互いに
 * すり抜ける)。この割り切りの理由は docs/adr/0004 を参照。
 */
function resolveStacking(game) {
  const [a, b] = game.players;
  tryStandOn(a, b, game);
  tryStandOn(b, a, game);
}

function tryStandOn(top, bottom, game) {
  if (!aabbOverlap(top, bottom)) return;
  // 「前フレームで相手より上に居て、落下中」のときだけ頭に乗る
  const wasAbove = top.prevY + top.h <= bottom.prevY + 6;
  if (top.vy >= 0 && wasAbove) {
    top.y = bottom.y - top.h;
    top.vy = 0;
    top.grounded = true;
    top.coyote = game.config.player.coyoteTime;
  }
}

/** カギの取得・追従・ドアへの受け渡し。 */
function updateKey(game) {
  const key = game.key;
  if (!key || key.delivered) return;

  if (key.heldBy < 0) {
    const rect = { x: key.x, y: key.y, w: 24, h: 24 };
    for (const p of game.players) {
      if (aabbOverlap(p, rect)) {
        key.heldBy = p.index;
        game.events.push({ type: 'key', player: p.index });
        break;
      }
    }
  }

  if (key.heldBy >= 0) {
    const carrier = game.players[key.heldBy];
    key.x = carrier.x; // 頭上に浮かせて追従(描画も同じ座標を使う)
    key.y = carrier.y - 28;
    if (aabbOverlap(carrier, game.door)) {
      key.delivered = true;
      key.heldBy = -1;
      game.door.unlocked = true;
      game.events.push({ type: 'unlock' });
    }
  }
}

/** 感圧スイッチ: 誰かが乗っている間だけ全ゲートが開く。 */
function updateGates(game) {
  const T = game.config.tile;
  let pressed = false;
  for (const plate of game.level.plates) {
    const rect = { x: plate.tx * T + 4, y: plate.ty * T + 20, w: T - 8, h: 12 };
    if (game.players.some((p) => aabbOverlap(p, rect))) {
      pressed = true;
      break;
    }
  }
  if (pressed !== game.gateOpen) {
    game.gateOpen = pressed;
    game.events.push({ type: 'gate', open: pressed });
  }
}

/** トゲ接触: どちらか1人でも触れたら全員スタートに戻る(協力の連帯責任)。 */
function checkSpikes(game) {
  const T = game.config.tile;
  for (const spike of game.level.spikes) {
    // 当たり判定はトゲの先端付近のみ(高さ12px)。見た目(16px)より少し甘くして
    // 「かすった感」の理不尽さを避ける。飛び越え難度にも直結する値
    const rect = { x: spike.tx * T + 3, y: spike.ty * T + 20, w: T - 6, h: T - 20 };
    if (game.players.some((p) => aabbOverlap(p, rect))) {
      game.deaths++;
      game.events.push({ type: 'death' });
      resetPositions(game);
      return;
    }
  }
}

/** クリア判定: ドアが開いていて、全員の中心がドア内にあること。 */
function checkClear(game) {
  if (!game.door.unlocked) return;
  const d = game.door;
  const allIn = game.players.every((p) => {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    return cx >= d.x && cx <= d.x + d.w && cy >= d.y && cy <= d.y + d.h;
  });
  if (allIn) {
    game.phase = 'clear';
    game.clearTimer = game.config.rules.clearDelay;
    game.events.push({ type: 'clear', index: game.levelIndex });
  }
}
