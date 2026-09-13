// text.js — 構造化発言(entry)→日本語セリフ変換。状態を持たない純粋な文字列変換のみ
// (architecture.md §1)。UIとテストの両方が同じ文言を使う。
//
// バリエーションは rng ではなく「id+day の決定的ハッシュ」で選ぶ
// (architecture.md §2・§3: rng消費順序を乱さないため)。同じ(actorId, day, kind)の
// 組み合わせなら常に同じ文言になる。

const ROLE_LABEL = {
  wolf: '侵入者',
  seer: '調査員',
  guard: '警備員',
  crew: '乗組員',
};

/**
 * id+dayから決定的に 0..(n-1) を選ぶハッシュ。rngは一切使わない
 * (architecture.md §2: rng消費順序を乱さないため)。単純な乗算加算だけだと
 * 桁あふれで下位ビットにdayの影響がほぼ出ない事故が起きるため、
 * mulberry32同様のビット拡散(imul+xorshift)を1段挟んで均す。
 */
function pickVariant(a, b, n) {
  let h = (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 1, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  h = (h ^ (h >>> 14)) >>> 0;
  return h % n;
}

function nameOf(players, id) {
  const p = players[id];
  return p ? p.name : '???';
}

/**
 * toSpeech(logEntry, players) → 日本語1文。
 * logEntry は game.log の要素と同じ形 { day, phase, actorId, entry }。
 */
export function toSpeech(logEntry, players) {
  const { day, actorId, entry } = logEntry;
  const who = actorId !== null && actorId !== undefined ? nameOf(players, actorId) : null;

  switch (entry.kind) {
    case 'co-seer': {
      const variants = ['わたしは調査員だ。', 'わたしが調査員だよ。', '実は、わたしが調査員なんだ。'];
      return `${who}「${variants[pickVariant(actorId, day, variants.length)]}」`;
    }
    case 'report': {
      const t = nameOf(players, entry.target);
      const variants = entry.isWolf
        ? [`${t}は侵入者だ。`, `${t}を調べた——侵入者だった。`, `間違いない、${t}は侵入者だ。`]
        : [`${t}は侵入者ではない。`, `${t}を調べた——シロだった。`, `${t}は潔白だ。`];
      return `${who}「${variants[pickVariant(actorId, day, variants.length)]}」`;
    }
    case 'suspect': {
      const t = nameOf(players, entry.target);
      const variants = [`${t}があやしい。`, `${t}の言動が気になる。`, `${t}を疑ってる。`];
      return `${who}「${variants[pickVariant(actorId, day, variants.length)]}」`;
    }
    case 'trust': {
      const t = nameOf(players, entry.target);
      const variants = [`${t}を信じる。`, `${t}は大丈夫だと思う。`, `${t}はクルー側だと思う。`];
      return `${who}「${variants[pickVariant(actorId, day, variants.length)]}」`;
    }
    case 'pass': {
      const variants = ['様子を見よう。', 'もう少し様子見かな。', '今は何とも言えない。'];
      return `${who}「${variants[pickVariant(actorId, day, variants.length)]}」`;
    }
    case 'death': {
      const t = nameOf(players, entry.target);
      const variants = [
        `朝——${t}の姿がなかった。`,
        `${t}が夜のうちに姿を消した。`,
        `${t}が犠牲になった。`,
      ];
      return variants[pickVariant(entry.target, day, variants.length)];
    }
    case 'noDeath': {
      const variants = ['今朝は誰も欠けていない。', '全員無事に朝を迎えた。', '犠牲者は出なかった。'];
      return variants[pickVariant(0, day, variants.length)];
    }
    case 'exile': {
      const t = nameOf(players, entry.target);
      const role = ROLE_LABEL[entry.role] ?? entry.role;
      const variants = [
        `${t}が追放された。正体は${role}だった。`,
        `投票の結果、${t}が船を追われた——${role}だった。`,
        `${t}が追放。役職は${role}。`,
      ];
      return variants[pickVariant(entry.target, day, variants.length)];
    }
    case 'voteResult': {
      const variants = ['投票の結果が明らかになった。', '開票が行われた。', '票が集計された。'];
      return variants[pickVariant(0, day, variants.length)];
    }
    case 'gameEnd': {
      const variants =
        entry.winner === 'crew'
          ? ['侵入者を全員追い出した。クルー側の勝利!', 'クルーの勝利——船に平和が戻った。']
          : ['侵入者が数で並んだ。侵入者側の勝利…', '船はもう乗っ取られた——侵入者側の勝利。'];
      return variants[pickVariant(0, day, variants.length)];
    }
    default:
      return '';
  }
}
