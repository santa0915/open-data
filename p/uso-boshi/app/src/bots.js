// bots.js — ボットAI(疑心度モデル・発言/投票/夜行動)
//
// game-design.md §4 を忠実に実装する。sus は「7x7の共有された1つの配列」
// (Float64Array(49), index = b*7+t)として持つ — createBotState(game) は
// game生成時に1度だけ呼ばれ、以後 game.botState として全ボットで共有される
// (architecture.md §4のシグネチャ通り、botStateは各関数に毎回渡される)。
//
// 役職文字列は game.js の ROLES と同じ値('wolf'|'seer'|'guard'|'crew')を
// 直接の文字列リテラルとして使う(game.js⇄bots.js の循環importを避けるための
// 意図的な割り切り。値がズレたら bots.test で即検知できる)。
//
// rng は game.rng() を通じてのみ消費する(架空のtie-break・確率判定のみ。
// 候補が1件しかない場面ではrngを消費しない — architecture.md §2の
// 「rng消費順序の固定」を壊さないため)。
//
// 【私的情報の扱い】調査員の調査結果は本人しか知らない確定情報のため、公開ログ
// (game.log)には載せず、observe() に合成イベント {kind:'seerResult'} を渡して
// 呼び出す側(game.js)から直接更新する。同様に「毎朝ノイズ」も {kind:'noise'}
// という合成イベントとして observe() に流し込むことで、bots.js の公開APIを
// architecture.md §4 に列挙された4関数ちょうどに保っている。

function susOf(botState, b, t) {
  return botState.sus[b * 7 + t];
}

function addSus(botState, b, t, delta) {
  const idx = b * 7 + t;
  const v = botState.sus[idx];
  if (v === Infinity || v === -Infinity) return; // 役職知識の絶対値(相方=-∞)は上書きしない
  botState.sus[idx] = v + delta;
}

/** 候補が1件ならrngを消費せずそのまま返す。複数なら乱数で等確率に選ぶ。 */
function pickTieBreak(rng, list) {
  if (list.length === 1) return list[0];
  const idx = Math.floor(rng() * list.length);
  return list[idx];
}

function maxSusTarget(game, botState, actorId, pool) {
  let best = -Infinity;
  let top = [];
  for (const t of pool) {
    const v = susOf(botState, actorId, t);
    if (v > best) {
      best = v;
      top = [t];
    } else if (v === best) {
      top.push(t);
    }
  }
  return pickTieBreak(game.rng, top);
}

function minSusTarget(game, botState, actorId, pool) {
  let worst = Infinity;
  let bottom = [];
  for (const t of pool) {
    const v = susOf(botState, actorId, t);
    if (v < worst) {
      worst = v;
      bottom = [t];
    } else if (v === worst) {
      bottom.push(t);
    }
  }
  return pickTieBreak(game.rng, bottom);
}

function aliveOthers(game, actorId) {
  return game.players.filter((p) => p.alive && p.id !== actorId).map((p) => p.id);
}

function hasSpokenBefore(game, actorId) {
  return game.log.some((l) => l.actorId === actorId);
}

function getPartner(game, wolfId) {
  return game.players.find((p) => p.role === 'wolf' && p.id !== wolfId);
}

/** 侵入者2人のうちidが若い方だけが「騙りCOに挑戦する係」(固定・rng不要)。 */
function isFakeCoDesignated(game, wolfId) {
  const wolfIds = game.players
    .filter((p) => p.role === 'wolf')
    .map((p) => p.id)
    .sort((a, b) => a - b);
  return wolfIds[0] === wolfId;
}

/**
 * ボット状態を作る。役職知識のうち「静的に決まっているもの」だけをここで
 * 埋め込む: 侵入者から見た相方への疑心は常に -∞(投票・疑い発言の対象にしない)。
 * 調査員の調査結果(±99)は毎晩の解決時に observe() 経由で動的に埋め込まれる。
 */
export function createBotState(game) {
  const sus = new Float64Array(7 * 7);
  const wolves = game.players.filter((p) => p.role === 'wolf');
  for (const w of wolves) {
    for (const other of wolves) {
      if (w.id === other.id) continue;
      sus[w.id * 7 + other.id] = -Infinity;
    }
  }
  return { sus };
}

/**
 * 発言・イベントで sus を更新する(全ボット共通の観測規則、game-design.md §4)。
 * logEntry は game.log と同じ形 { day, phase, actorId, entry }(人間の発言にも
 * 同じ規則を適用する — 人間だけ特別扱いしない)。
 */
export function observe(game, botState, logEntry) {
  const { actorId, entry } = logEntry;
  const M = game.config.susModel;

  switch (entry.kind) {
    case 'co-seer': {
      const coIds = game.players.filter((p) => p.coSeer).map((p) => p.id);
      if (coIds.length >= 2) {
        for (let b = 0; b < 7; b++) {
          for (const c of coIds) {
            if (b === c) continue;
            addSus(botState, b, c, M.coConflict);
          }
        }
      }
      break;
    }
    case 'report': {
      const c = actorId;
      const t = entry.target;
      const base = entry.isWolf ? M.reportWolf : -M.reportClear;
      for (let b = 0; b < 7; b++) {
        if (b === t) continue;
        const decay = Math.max(0.2, 1 - susOf(botState, b, c) / 10);
        addSus(botState, b, t, base * decay);
      }
      break;
    }
    case 'suspect': {
      const c = actorId;
      const t = entry.target;
      for (let b = 0; b < 7; b++) {
        if (b === t) continue;
        const decay = Math.max(0.2, 1 - susOf(botState, b, c) / 10);
        addSus(botState, b, t, M.suspectNudge * decay);
      }
      break;
    }
    case 'trust': {
      const c = actorId;
      const t = entry.target;
      for (let b = 0; b < 7; b++) {
        if (b === t) continue;
        const decay = Math.max(0.2, 1 - susOf(botState, b, c) / 10);
        addSus(botState, b, t, -M.trustNudge * decay);
      }
      break;
    }
    case 'exile': {
      const e = entry.target;
      const eWasWolf = entry.role === 'wolf';
      for (const [voterStr, targetId] of Object.entries(game.votes)) {
        if (targetId !== e) continue;
        const voter = Number(voterStr);
        for (let b = 0; b < 7; b++) {
          if (b === voter) continue;
          addSus(botState, b, voter, eWasWolf ? -M.goodvote : M.misvote);
        }
      }
      break;
    }
    case 'seerResult': {
      // 私的情報: 調査した本人(actorId=調査員)の行のみを更新する
      botState.sus[actorId * 7 + entry.target] = entry.isWolf ? 99 : -99;
      break;
    }
    case 'noise': {
      const amp = M.noise;
      for (let b = 0; b < 7; b++) {
        for (let t = 0; t < 7; t++) {
          if (b === t) continue;
          addSus(botState, b, t, (game.rng() * 2 - 1) * amp);
        }
      }
      break;
    }
    case 'pass':
    case 'death':
    case 'noDeath':
    case 'voteResult':
    case 'gameEnd':
    default:
      break; // 疑心度モデルに更新規則が無いイベント
  }
}

// --- 発言 ---------------------------------------------------------------

function genericStatement(game, botState, actorId) {
  const pool = aliveOthers(game, actorId);
  if (pool.length === 0) return { kind: 'pass' }; // 安全策(通常は起きない)

  let best = -Infinity;
  let top = [];
  for (const t of pool) {
    const v = susOf(botState, actorId, t);
    if (v > best) {
      best = v;
      top = [t];
    } else if (v === best) {
      top.push(t);
    }
  }
  if (best > 0) {
    return { kind: 'suspect', target: pickTieBreak(game.rng, top) };
  }

  // susが全員低い(=誰も怪しくない)場合: 最も信頼できる相手がいればtrust、
  // 本当に情報が無ければ(全員sus=0)pass。
  let worst = Infinity;
  let bottom = [];
  for (const t of pool) {
    const v = susOf(botState, actorId, t);
    if (v < worst) {
      worst = v;
      bottom = [t];
    } else if (v === worst) {
      bottom.push(t);
    }
  }
  if (worst < 0) {
    return { kind: 'trust', target: pickTieBreak(game.rng, bottom) };
  }
  return { kind: 'pass' };
}

function seerStatement(game, botState, seerId) {
  const player = game.players[seerId];
  if (player.coSeer) {
    const reportedCount = game.log.filter(
      (l) => l.actorId === seerId && l.entry.kind === 'report',
    ).length;
    const history = game.investigations.filter((r) => r.seerId === seerId);
    if (reportedCount < history.length) {
      const next = history[reportedCount]; // 古い順に未報告の1件を報告(常に真実)
      return { kind: 'report', target: next.target, isWolf: next.isWolf };
    }
    // 報告し尽くした(新しい調査結果がまだ無い)ターンは generic にフォールバック
  } else if (game.day === 1 && !hasSpokenBefore(game, seerId)) {
    if (game.rng() < game.config.seerCoRate) {
      return { kind: 'co-seer' };
    }
    // 初日の1回きりの賭けに外れたら、以後は正体を明かさず generic に徹する
  }
  return genericStatement(game, botState, seerId);
}

function pickFrameTarget(game, botState, wolfId) {
  const pool = game.players.filter((p) => p.alive && p.role !== 'wolf').map((p) => p.id);
  if (pool.length === 0) return null;
  return maxSusTarget(game, botState, wolfId, pool); // 疑われている生存クルーへ便乗して畳みかける
}

function wolfStatement(game, botState, wolfId) {
  const player = game.players[wolfId];
  if (player.coSeer) {
    const target = pickFrameTarget(game, botState, wolfId);
    if (target !== null) {
      return { kind: 'report', target, isWolf: true }; // 生存クルーへの偽告発
    }
  } else if (!hasSpokenBefore(game, wolfId)) {
    const partner = getPartner(game, wolfId);
    if (!partner.coSeer && game.rng() < game.config.fakeCoRate) {
      return { kind: 'co-seer' }; // 騙りCO(ゲーム中1回だけの挑戦)
    }
  }
  return genericStatement(game, botState, wolfId);
}

/** 発言(entry)を1つ決める。game.log を1件も汚さない純粋関数。 */
export function botStatement(game, botState, actorId) {
  const role = game.players[actorId].role;
  if (role === 'seer') return seerStatement(game, botState, actorId);
  if (role === 'wolf' && isFakeCoDesignated(game, actorId)) return wolfStatement(game, botState, actorId);
  return genericStatement(game, botState, actorId);
}

// --- 投票 -----------------------------------------------------------------

/** 生存者中sus最大(同点は乱数)。侵入者の-∞補正により相方は自然に除外される。 */
export function botVote(game, botState, actorId) {
  const candidateIds =
    game.phase === 'runoff' ? game.runoffCandidates : game.players.filter((p) => p.alive).map((p) => p.id);
  const pool = candidateIds.filter((id) => id !== actorId);
  return maxSusTarget(game, botState, actorId, pool);
}

// --- 夜行動 ---------------------------------------------------------------

function guardNight(game, botState, guardId) {
  const pool = game.players.filter(
    (p) => p.alive && p.id !== guardId && p.id !== game.lastGuardTarget,
  );
  const claimants = pool.filter((p) => p.coSeer);
  const list = (claimants.length > 0 ? claimants : pool).map((p) => p.id);
  return pickTieBreak(game.rng, list); // CO済み調査員を優先、いなければ乱数(連続同一護衛は禁止済み)
}

function wolfNight(game, botState, wolfId) {
  const pool = game.players.filter((p) => p.alive && p.role !== 'wolf');
  const realSeerCo = pool.find((p) => p.role === 'seer' && p.coSeer);
  if (realSeerCo) return realSeerCo.id; // 真調査員CO者を最優先
  return minSusTarget(game, botState, wolfId, pool.map((p) => p.id)); // 次点: 最も信頼されているクルー
}

function seerNight(game, botState, seerId) {
  const investigated = new Set(
    game.investigations.filter((r) => r.seerId === seerId).map((r) => r.target),
  );
  const alivePool = game.players.filter((p) => p.alive && p.id !== seerId);
  const fresh = alivePool.filter((p) => !investigated.has(p.id));
  const pool = (fresh.length > 0 ? fresh : alivePool).map((p) => p.id);
  return maxSusTarget(game, botState, seerId, pool); // 未調査の生存者からsus最大を選ぶ
}

/** 役職に応じた夜の対象決定。乗組員は呼ばれない想定。 */
export function botNight(game, botState, actorId) {
  const role = game.players[actorId].role;
  if (role === 'guard') return guardNight(game, botState, actorId);
  if (role === 'wolf') return wolfNight(game, botState, actorId);
  if (role === 'seer') return seerNight(game, botState, actorId);
  return null;
}
