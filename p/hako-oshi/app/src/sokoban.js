// sokoban.js — 盤面状態・移動・アンドゥ・クリア判定(純ロジック層)
//
// 倉庫番の定石どおり: プレイヤーは上下左右に1マスずつ移動する。進行方向に
// 箱が1個あり、その先が床(壁でも別の箱でもない)なら箱を押して進む。
// 箱が2個連続・箱の先が壁なら進めない。引く・横滑りは無い(game-design.md §2)。
//
// 状態は Set<'x,y'> を主な表現とする(座標は非負整数を想定)。
// DOM / Math.random / Date.now はこのファイルに一切持ち込まない。

import { parseLevel } from './levels.js';

const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

function key(x, y) {
  return `${x},${y}`;
}

/**
 * レベルインデックスから新規ゲーム状態を作る。
 * level(parseLevelの結果)は不変のまま保持し、restart時の初期化に使う。
 */
export function createGame(levelIndex, levels) {
  const level = parseLevel(levels[levelIndex].grid);
  return {
    levelIndex,
    level,
    boxes: new Set(level.boxes),
    player: { ...level.player },
    moves: 0,
    pushes: 0,
    history: [], // undo用スナップショット。1手=1エントリ
    phase: 'playing',
    events: [], // 'move' | 'push' | 'blocked' | 'undo' | 'clear'。 呼び出し側が都度読み捨てる想定
  };
}

/**
 * 1マス移動を試みる。dir: 'up'|'down'|'left'|'right'
 * @returns {boolean} 移動(押しを含む)が成立したか
 */
export function move(game, dir) {
  if (game.phase === 'cleared') return false; // クリア後は操作を受け付けない

  const { dx, dy } = DIRS[dir];
  const { x, y } = game.player;
  const nx = x + dx;
  const ny = y + dy;
  const nextKey = key(nx, ny);

  if (game.level.walls.has(nextKey)) {
    game.events.push({ type: 'blocked' });
    return false;
  }

  let pushed = null; // 押しが発生した場合 { from, to } (undo用)
  if (game.boxes.has(nextKey)) {
    const bx = nx + dx;
    const by = ny + dy;
    const beyondKey = key(bx, by);
    // 箱の先が壁、または別の箱(2個連続)なら押せない
    if (game.level.walls.has(beyondKey) || game.boxes.has(beyondKey)) {
      game.events.push({ type: 'blocked' });
      return false;
    }
    game.boxes.delete(nextKey);
    game.boxes.add(beyondKey);
    pushed = { from: nextKey, to: beyondKey };
  }

  const prevPlayer = { x, y };
  game.player = { x: nx, y: ny };
  game.moves += 1;
  if (pushed) game.pushes += 1;

  game.history.push({ prevPlayer, pushed });
  game.events.push({
    type: pushed ? 'push' : 'move',
    moves: game.moves,
    pushes: game.pushes,
  });

  if (isCleared(game)) {
    game.phase = 'cleared';
    game.events.push({ type: 'clear', moves: game.moves, pushes: game.pushes });
  }

  return true;
}

/**
 * 直前の1手を戻す(押し戻しを含めて完全復元)。
 * @returns {boolean} 戻す手が残っていたか
 */
export function undo(game) {
  if (game.history.length === 0) return false;

  const { prevPlayer, pushed } = game.history.pop();
  if (pushed) {
    game.boxes.delete(pushed.to);
    game.boxes.add(pushed.from);
    game.pushes -= 1;
  }
  game.player = prevPlayer;
  game.moves -= 1;
  game.phase = 'playing'; // クリア直後のアンドゥでプレイに復帰する

  game.events.push({ type: 'undo', moves: game.moves, pushes: game.pushes });
  return true;
}

/** レベルの初期配置へ戻す(historyもクリア)。 */
export function restart(game) {
  game.boxes = new Set(game.level.boxes);
  game.player = { ...game.level.player };
  game.moves = 0;
  game.pushes = 0;
  game.history = [];
  game.phase = 'playing';
}

/** 全ての箱がゴールに載っているか。 */
export function isCleared(game) {
  for (const b of game.boxes) {
    if (!game.level.goals.has(b)) return false;
  }
  return true;
}
