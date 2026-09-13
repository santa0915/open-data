// game.js — 状態機械(配役・夜解決・議論・投票・勝敗)。DOM非依存の純ロジック層。
//
// architecture.md §2 の状態コントラクトとAPIを厳守する。半自動ステップ方式:
// advance(game) は現在フェーズを1ステップ進める。人間(humanIndex)の入力が
// 必要な地点に来たら pendingInput を立てて即returnし、そうでなければボットの
// 判断(bots.js)で自動的に1ステップぶんだけ処理する。呼び出し側(UI/テスト)は
// `while (!game.pendingInput && !game.winner) advance(game);` のように
// pendingInputが立つか終局するまで advance を回し続ける想定
// (humanIndex=-1なら pendingInput は一度も立たず、全自動対戦になる)。
//
// rng消費順序(architecture.md §2、本実装での具体化): 配役(createGame) →
// 各日サイクルごとに [夜: 護衛→襲撃→調査の順でボット決定(tie-break/確率判定
// のみrng消費)] → [朝: 全疑心度ペアへノイズ(b昇順→t昇順)] →
// [昼: 発言順シャッフル→turnOrder順にボット発言(tie-break/確率判定のみ)] →
// [投票: 生存者id昇順にボット投票(tie-break)] → [同数なら決選投票・同上] の順。
// この順序を変えると決定性テスト(同シード同入力で同一ログ)が壊れるため、
// 新たにrngを呼ぶ処理を足すときは必ずこの並びのどこに位置するか明記すること。

import { CHARACTERS } from './characters.js';
import { shuffle } from './rng.js';
import { createBotState, observe, botStatement, botVote, botNight } from './bots.js';

export const ROLES = { WOLF: 'wolf', SEER: 'seer', GUARD: 'guard', CREW: 'crew' };

function buildRoleDeck(config) {
  const deck = [];
  for (let i = 0; i < config.roles.wolf; i++) deck.push(ROLES.WOLF);
  for (let i = 0; i < config.roles.seer; i++) deck.push(ROLES.SEER);
  for (let i = 0; i < config.roles.guard; i++) deck.push(ROLES.GUARD);
  for (let i = 0; i < config.roles.crew; i++) deck.push(ROLES.CREW);
  return deck;
}

function emptyNight() {
  return { cursor: 'guard', guardTarget: null, killTarget: null, seerTarget: null };
}

/**
 * 新しいゲームを生成する。配役はrngで決定される(rng消費の最初)。
 * humanIndex=-1 なら人間の席が存在せず、全自動対戦になる(balance.test用)。
 */
export function createGame(config, rng, { humanIndex = 0 } = {}) {
  const deck = shuffle(rng, buildRoleDeck(config)); // 配役(rng消費①)

  const players = CHARACTERS.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    role: deck[i],
    alive: true,
    coSeer: false,
  }));

  const game = {
    config,
    rng,
    day: 1,
    phase: 'reveal',
    players,
    humanIndex,
    round: 1,
    turnOrder: [],
    turnCursor: 0,
    log: [],
    night: emptyNight(),
    votes: {},
    winner: null,
    pendingInput: null,
    events: [],

    // 状態コントラクトの `...` 拡張分(architecture.md §2 の night/results等)
    lastGuardTarget: null, // 連続同一護衛の禁止判定用
    investigations: [], // 調査員の私的な調査履歴 { day, seerId, target, isWolf }
    runoffCandidates: null, // 決選投票の対象(タイの時のみ非null)
  };

  game.botState = createBotState(game);
  return game;
}

// --- 共通ヘルパー -----------------------------------------------------------

function aliveIds(game) {
  return game.players.filter((p) => p.alive).map((p) => p.id);
}

function aliveOthers(game, actorId) {
  return game.players.filter((p) => p.alive && p.id !== actorId).map((p) => p.id);
}

function findRoleId(game, role) {
  const p = game.players.find((pl) => pl.role === role);
  return p ? p.id : null;
}

function findWolfActor(game) {
  return game.players
    .filter((p) => p.alive && p.role === ROLES.WOLF)
    .sort((a, b) => a.id - b.id)[0];
}

function pushLog(game, actorId, entry) {
  const logEntry = { day: game.day, phase: game.phase, actorId, entry };
  if (entry.kind === 'co-seer') game.players[actorId].coSeer = true; // 副作用をここに集約
  game.log.push(logEntry);
  game.events.push(logEntry);
  observe(game, game.botState, logEntry);
  return logEntry;
}

function checkWinner(game) {
  const alive = game.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === ROLES.WOLF).length;
  const others = alive.length - wolves;
  if (wolves === 0) return 'crew';
  if (wolves >= others) return 'wolf';
  return null;
}

function finishIfWon(game) {
  const winner = checkWinner(game);
  if (!winner) return false;
  game.winner = winner;
  pushLog(game, null, { kind: 'gameEnd', winner });
  game.phase = 'result';
  return true;
}

// --- 進行API ----------------------------------------------------------------

export function advance(game) {
  if (game.winner) return game;
  switch (game.phase) {
    case 'reveal':
      return stepReveal(game);
    case 'night':
      return stepNight(game);
    case 'morning':
      return stepMorning(game);
    case 'day':
      return stepDay(game);
    case 'vote':
      return stepVote(game);
    case 'runoff':
      return stepRunoff(game);
    default:
      return game;
  }
}

function stepReveal(game) {
  game.phase = 'night';
  game.night = emptyNight();
  return game;
}

// --- 夜 -----------------------------------------------------------------

function guardOptions(game, guardId) {
  return game.players
    .filter((p) => p.alive && p.id !== guardId && p.id !== game.lastGuardTarget)
    .map((p) => p.id);
}

function wolfOptions(game) {
  return game.players.filter((p) => p.alive && p.role !== ROLES.WOLF).map((p) => p.id);
}

function seerOptions(game, seerId) {
  return game.players.filter((p) => p.alive && p.id !== seerId).map((p) => p.id);
}

function stepNight(game) {
  const n = game.night;

  if (n.cursor === 'guard') {
    const guardId = findRoleId(game, ROLES.GUARD);
    const guard = game.players[guardId];
    if (!guard.alive) {
      n.cursor = 'wolf';
      return advance(game);
    }
    if (guard.id === game.humanIndex) {
      game.pendingInput = { type: 'night', options: guardOptions(game, guardId) };
      return game;
    }
    n.guardTarget = botNight(game, game.botState, guardId);
    n.cursor = 'wolf';
    return game;
  }

  if (n.cursor === 'wolf') {
    const wolf = findWolfActor(game);
    if (wolf.id === game.humanIndex) {
      game.pendingInput = { type: 'night', options: wolfOptions(game) };
      return game;
    }
    n.killTarget = botNight(game, game.botState, wolf.id);
    n.cursor = 'seer';
    return game;
  }

  if (n.cursor === 'seer') {
    const seerId = findRoleId(game, ROLES.SEER);
    const seer = game.players[seerId];
    if (!seer.alive) {
      n.cursor = 'resolve';
      return advance(game);
    }
    if (seer.id === game.humanIndex) {
      game.pendingInput = { type: 'night', options: seerOptions(game, seerId) };
      return game;
    }
    n.seerTarget = botNight(game, game.botState, seerId);
    n.cursor = 'resolve';
    return game;
  }

  return resolveNight(game);
}

function resolveNight(game) {
  const n = game.night;

  let deathId = null;
  if (n.killTarget !== null && n.killTarget !== n.guardTarget) {
    deathId = n.killTarget;
    game.players[deathId].alive = false;
  }
  if (n.guardTarget !== null) game.lastGuardTarget = n.guardTarget;

  if (n.seerTarget !== null) {
    const seerId = findRoleId(game, ROLES.SEER);
    const target = game.players[n.seerTarget];
    const isWolf = target.role === ROLES.WOLF;
    game.investigations.push({ day: game.day, seerId, target: n.seerTarget, isWolf });
    observe(game, game.botState, {
      day: game.day,
      phase: game.phase,
      actorId: seerId,
      entry: { kind: 'seerResult', target: n.seerTarget, isWolf },
    });
  }

  if (deathId !== null) {
    pushLog(game, null, { kind: 'death', target: deathId, role: game.players[deathId].role });
  } else {
    pushLog(game, null, { kind: 'noDeath' });
  }

  if (finishIfWon(game)) return game;

  game.phase = 'morning';
  return game;
}

// --- 朝 -----------------------------------------------------------------

function stepMorning(game) {
  observe(game, game.botState, {
    day: game.day,
    phase: game.phase,
    actorId: null,
    entry: { kind: 'noise' },
  });
  game.turnOrder = shuffle(game.rng, aliveIds(game));
  game.round = 1;
  game.turnCursor = 0;
  game.phase = 'day';
  return game;
}

// --- 昼(議論) --------------------------------------------------------------

function statementOptions(game, actorId) {
  const player = game.players[actorId];
  const kinds = ['co-seer', 'suspect', 'trust', 'pass'];
  if (player.coSeer) kinds.push('report');
  return { kinds, targets: aliveOthers(game, actorId) };
}

function isValidTarget(game, target, actorId) {
  if (typeof target !== 'number') return false;
  if (target === actorId) return false;
  const p = game.players[target];
  return !!p && p.alive;
}

function isValidStatement(game, actorId, entry) {
  const actor = game.players[actorId];
  if (!entry || typeof entry.kind !== 'string') return false;
  switch (entry.kind) {
    case 'co-seer':
    case 'pass':
      return true;
    case 'report':
      if (!actor.coSeer) return false;
      return isValidTarget(game, entry.target, actorId) && typeof entry.isWolf === 'boolean';
    case 'suspect':
    case 'trust':
      return isValidTarget(game, entry.target, actorId);
    default:
      return false;
  }
}

function stepDay(game) {
  if (game.turnCursor >= game.turnOrder.length) {
    if (game.round < game.config.discussionRounds) {
      game.round += 1;
      game.turnCursor = 0;
    } else {
      game.phase = 'vote';
      game.votes = {};
      return game;
    }
  }

  const actorId = game.turnOrder[game.turnCursor];
  if (actorId === game.humanIndex) {
    game.pendingInput = { type: 'statement', options: statementOptions(game, actorId) };
    return game;
  }

  const entry = botStatement(game, game.botState, actorId);
  pushLog(game, actorId, entry);
  game.turnCursor += 1;
  return game;
}

// --- 投票 -----------------------------------------------------------------

function nextPendingVoter(game, aliveVoterIds) {
  return aliveVoterIds.find((id) => !(id in game.votes));
}

function tallyVotes(game, aliveVoterIds, candidateIds) {
  const counts = {};
  for (const id of candidateIds) counts[id] = 0;
  for (const voter of aliveVoterIds) {
    const target = game.votes[voter];
    if (target !== undefined && counts[target] !== undefined) counts[target] += 1;
  }
  pushLog(game, null, { kind: 'voteResult', votes: { ...game.votes } });

  const maxCount = Math.max(...candidateIds.map((id) => counts[id]));
  const top = candidateIds.filter((id) => counts[id] === maxCount);

  if (top.length === 1) {
    return exilePlayer(game, top[0]);
  }
  if (game.runoffCandidates) {
    // 決選投票でも同数 → 乱数で1人に決める(引き分け防止・決選は1回のみ)
    const idx = Math.floor(game.rng() * top.length);
    return exilePlayer(game, top[idx]);
  }
  game.runoffCandidates = top;
  game.votes = {};
  game.phase = 'runoff';
  return game;
}

function exilePlayer(game, targetId) {
  const player = game.players[targetId];
  player.alive = false;
  pushLog(game, null, { kind: 'exile', target: targetId, role: player.role });
  game.runoffCandidates = null;

  if (finishIfWon(game)) return game;

  if (game.day >= game.config.maxDays) {
    // 安全網: 通常の勝敗判定ロジックなら7人・毎日1人追放でここに到達しない設計
    throw new Error(`日数上限(${game.config.maxDays})に到達: 終局しないロジックの不具合の可能性`);
  }

  game.day += 1;
  game.votes = {};
  game.night = emptyNight();
  game.phase = 'night';
  return game;
}

function stepVote(game) {
  const aliveVoterIds = aliveIds(game);
  const pending = nextPendingVoter(game, aliveVoterIds);
  if (pending === undefined) {
    return tallyVotes(game, aliveVoterIds, aliveVoterIds);
  }
  if (pending === game.humanIndex) {
    game.pendingInput = { type: 'vote', options: aliveVoterIds.filter((id) => id !== pending) };
    return game;
  }
  game.votes[pending] = botVote(game, game.botState, pending);
  return game;
}

function stepRunoff(game) {
  const aliveVoterIds = aliveIds(game);
  const pending = nextPendingVoter(game, aliveVoterIds);
  if (pending === undefined) {
    return tallyVotes(game, aliveVoterIds, game.runoffCandidates);
  }
  if (pending === game.humanIndex) {
    game.pendingInput = {
      type: 'vote',
      options: game.runoffCandidates.filter((id) => id !== pending),
    };
    return game;
  }
  game.votes[pending] = botVote(game, game.botState, pending);
  return game;
}

// --- 人間の入力API ------------------------------------------------------------

export function submitNightAction(game, targetId) {
  if (!game.pendingInput || game.pendingInput.type !== 'night') return false;
  if (!game.pendingInput.options.includes(targetId)) return false;

  const n = game.night;
  if (n.cursor === 'guard') {
    n.guardTarget = targetId;
    n.cursor = 'wolf';
  } else if (n.cursor === 'wolf') {
    n.killTarget = targetId;
    n.cursor = 'seer';
  } else if (n.cursor === 'seer') {
    n.seerTarget = targetId;
    n.cursor = 'resolve';
  } else {
    return false;
  }

  game.pendingInput = null;
  advance(game);
  return true;
}

export function submitStatement(game, entry) {
  if (!game.pendingInput || game.pendingInput.type !== 'statement') return false;
  const actorId = game.turnOrder[game.turnCursor];
  if (actorId !== game.humanIndex) return false;
  if (!isValidStatement(game, actorId, entry)) return false;

  game.pendingInput = null;
  pushLog(game, actorId, entry);
  game.turnCursor += 1;
  advance(game);
  return true;
}

export function submitVote(game, targetId) {
  if (!game.pendingInput || game.pendingInput.type !== 'vote') return false;
  if (!game.pendingInput.options.includes(targetId)) return false;

  game.votes[game.humanIndex] = targetId;
  game.pendingInput = null;
  advance(game);
  return true;
}
