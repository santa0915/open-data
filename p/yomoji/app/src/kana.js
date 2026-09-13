// kana.js — 文字セット・基準文字化・ローマ字→かな変換(すべて純関数・依存ゼロ)
//
// 仕様: docs/game-design.md §3 / docs/architecture.md §2
//
// 使える文字(KANA_SET・計74字):
//   清音45(「あ〜ん」から「を」を除く)+濁音20+半濁音5+小書き ゃゅょっ
// 「を」「ー」「ゐゑ」・小書き ぁぃぅぇぉ は答えにも入力にも使わない
// (一般名詞での頻度が低く、キーボードを複雑にする割に合わないため → adr/0003)

export const KANA_SET = new Set([
  ...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん',
  ...'がぎぐげござじずぜぞだぢづでどばびぶべぼ',
  ...'ぱぴぷぺぽ',
  ...'ゃゅょっ',
]);

// --- 基準文字(toBaseKana): 「おしい」判定の正規化 ---
// 濁点・半濁点を除去し、小書きを大書きに直す。対象外の文字はそのまま返す。

const DAKUON_TO_SEION = {
  が: 'か', ぎ: 'き', ぐ: 'く', げ: 'け', ご: 'こ',
  ざ: 'さ', じ: 'し', ず: 'す', ぜ: 'せ', ぞ: 'そ',
  だ: 'た', ぢ: 'ち', づ: 'つ', で: 'て', ど: 'と',
  ば: 'は', び: 'ひ', ぶ: 'ふ', べ: 'へ', ぼ: 'ほ',
};

const HANDAKUON_TO_SEION = {
  ぱ: 'は', ぴ: 'ひ', ぷ: 'ふ', ぺ: 'へ', ぽ: 'ほ',
};

const SMALL_TO_LARGE = { ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', っ: 'つ' };

/** 濁点・半濁点除去+小書き→大書き。清音や対象外の文字はそのまま返す。 */
export function toBaseKana(ch) {
  return DAKUON_TO_SEION[ch] || HANDAKUON_TO_SEION[ch] || SMALL_TO_LARGE[ch] || ch;
}

// --- 画面キーボードの「゛゜小」変換サイクル(cycleKana) ---
// - か行/さ行/た行(つを除く): 清音⇄濁音の2サイクル(か→が→か)
// - は行: 清音→濁音→半濁音の3サイクル(は→ば→ぱ→は)
// - や・ゆ・よ: 清音⇄小書きの2サイクル(や→ゃ→や)
// - つ: 清音→小書き→濁音の3サイクル(つ→っ→づ→つ)。
//   答え語彙に「みかづき」「かなづち」があり、画面キーボードだけの
//   ユーザー(スマホ)も「づ」に到達できる必要があるため
// - 上記以外(あ・ん・な行・ま行・ら行・わ 等)は何もしない(同じ文字を返す)
//
// 不変条件: KANA_SET の全74字が「基本キー(清音45)+cycleKana の反復」で
// 到達可能であること(kana.test.mjs が網羅検証する)

const CYCLE_NEXT = {
  // か行など(濁点トグル)
  か: 'が', が: 'か',
  き: 'ぎ', ぎ: 'き',
  く: 'ぐ', ぐ: 'く',
  け: 'げ', げ: 'け',
  こ: 'ご', ご: 'こ',
  さ: 'ざ', ざ: 'さ',
  し: 'じ', じ: 'し',
  す: 'ず', ず: 'す',
  せ: 'ぜ', ぜ: 'せ',
  そ: 'ぞ', ぞ: 'そ',
  た: 'だ', だ: 'た',
  ち: 'ぢ', ぢ: 'ち',
  て: 'で', で: 'て',
  と: 'ど', ど: 'と',
  // は行(3サイクル)
  は: 'ば', ば: 'ぱ', ぱ: 'は',
  ひ: 'び', び: 'ぴ', ぴ: 'ひ',
  ふ: 'ぶ', ぶ: 'ぷ', ぷ: 'ふ',
  へ: 'べ', べ: 'ぺ', ぺ: 'へ',
  ほ: 'ぼ', ぼ: 'ぽ', ぽ: 'ほ',
  // 小書きトグル
  や: 'ゃ', ゃ: 'や',
  ゆ: 'ゅ', ゅ: 'ゆ',
  よ: 'ょ', ょ: 'よ',
  // つ は小書き→濁音を経由する3サイクル(「づ」への唯一の画面キーボード導線)
  つ: 'っ', っ: 'づ', づ: 'つ',
};

/** 直前に入力した文字の「゛゜小」変換サイクルを1段進める。対象外は同じ文字。 */
export function cycleKana(ch) {
  return CYCLE_NEXT[ch] || ch;
}

// --- ローマ字→かな変換(romajiToKana) ---
// 標準ヘボン式+訓令式の主要どころに対応(§2参照)。拗音(きゃ等)は
// 子音+小書きの「2文字」で返す(盤面は1マス1かなのため)。

const ROMAJI_TABLE = {
  // 直音(清音)
  a: ['あ'], i: ['い'], u: ['う'], e: ['え'], o: ['お'],
  ka: ['か'], ki: ['き'], ku: ['く'], ke: ['け'], ko: ['こ'],
  sa: ['さ'], si: ['し'], shi: ['し'], su: ['す'], se: ['せ'], so: ['そ'],
  ta: ['た'], ti: ['ち'], chi: ['ち'], tu: ['つ'], tsu: ['つ'], te: ['て'], to: ['と'],
  na: ['な'], ni: ['に'], nu: ['ぬ'], ne: ['ね'], no: ['の'],
  ha: ['は'], hi: ['ひ'], hu: ['ふ'], fu: ['ふ'], he: ['へ'], ho: ['ほ'],
  ma: ['ま'], mi: ['み'], mu: ['む'], me: ['め'], mo: ['も'],
  ya: ['や'], yu: ['ゆ'], yo: ['よ'],
  ra: ['ら'], ri: ['り'], ru: ['る'], re: ['れ'], ro: ['ろ'],
  wa: ['わ'],

  // 濁音・半濁音
  ga: ['が'], gi: ['ぎ'], gu: ['ぐ'], ge: ['げ'], go: ['ご'],
  za: ['ざ'], zi: ['じ'], ji: ['じ'], zu: ['ず'], ze: ['ぜ'], zo: ['ぞ'],
  da: ['だ'], di: ['ぢ'], du: ['づ'], de: ['で'], do: ['ど'],
  ba: ['ば'], bi: ['び'], bu: ['ぶ'], be: ['べ'], bo: ['ぼ'],
  pa: ['ぱ'], pi: ['ぴ'], pu: ['ぷ'], pe: ['ぺ'], po: ['ぽ'],

  // 拗音(2文字で返す: 子音のかな+小書きゃゅょ)
  kya: ['き', 'ゃ'], kyu: ['き', 'ゅ'], kyo: ['き', 'ょ'],
  sha: ['し', 'ゃ'], sya: ['し', 'ゃ'], shu: ['し', 'ゅ'], syu: ['し', 'ゅ'], sho: ['し', 'ょ'], syo: ['し', 'ょ'],
  cha: ['ち', 'ゃ'], tya: ['ち', 'ゃ'], cya: ['ち', 'ゃ'],
  chu: ['ち', 'ゅ'], tyu: ['ち', 'ゅ'], cyu: ['ち', 'ゅ'],
  cho: ['ち', 'ょ'], tyo: ['ち', 'ょ'], cyo: ['ち', 'ょ'],
  nya: ['に', 'ゃ'], nyu: ['に', 'ゅ'], nyo: ['に', 'ょ'],
  hya: ['ひ', 'ゃ'], hyu: ['ひ', 'ゅ'], hyo: ['ひ', 'ょ'],
  mya: ['み', 'ゃ'], myu: ['み', 'ゅ'], myo: ['み', 'ょ'],
  rya: ['り', 'ゃ'], ryu: ['り', 'ゅ'], ryo: ['り', 'ょ'],
  gya: ['ぎ', 'ゃ'], gyu: ['ぎ', 'ゅ'], gyo: ['ぎ', 'ょ'],
  ja: ['じ', 'ゃ'], jya: ['じ', 'ゃ'], zya: ['じ', 'ゃ'],
  ju: ['じ', 'ゅ'], jyu: ['じ', 'ゅ'], zyu: ['じ', 'ゅ'],
  jo: ['じ', 'ょ'], jyo: ['じ', 'ょ'], zyo: ['じ', 'ょ'],
  bya: ['び', 'ゃ'], byu: ['び', 'ゅ'], byo: ['び', 'ょ'],
  pya: ['ぴ', 'ゃ'], pyu: ['ぴ', 'ゅ'], pyo: ['ぴ', 'ょ'],

  // x/l 接頭: 小書き単体
  xya: ['ゃ'], lya: ['ゃ'], xyu: ['ゅ'], lyu: ['ゅ'], xyo: ['ょ'], lyo: ['ょ'],
  xtu: ['っ'], xtsu: ['っ'], ltu: ['っ'], ltsu: ['っ'],
};

const MAX_TOKEN_LEN = Math.max(...Object.keys(ROMAJI_TABLE).map((k) => k.length));

// n/y を除く子音(n は撥音として、y は拗音の一部として別扱いするため除外)
const CONSONANT_RE = /[bcdfghjklmpqrstvwxz]/i;
const isConsonant = (ch) => CONSONANT_RE.test(ch);

/** s がいずれかの変換トークンの前方一致になっているか(入力途中の判定用)。 */
function isPendingPrefix(s) {
  return Object.keys(ROMAJI_TABLE).some((token) => token.startsWith(s));
}

/**
 * ローマ字バッファを先頭から逐次かなに変換する。
 * @param {string} buffer - 未確定のローマ字入力(a-z の連なり)
 * @returns {{ kanas: string[], rest: string }}
 *   kanas: 変換できた分(拗音は2文字に分解して積む)
 *   rest:  まだ変換できない残り(続きの入力待ち。次回の呼び出しに使う)
 *
 * 処理順(1文字ずつではなく、以下の規則を優先度順に適用):
 *   1. 'nn'              → ん
 *   2. n + 子音(yを除く) → ん を先出し(残りの子音は次周で処理)
 *   3. 子音の重複         → 促音「っ」(例: tta → っ + た)
 *   4. ROMAJI_TABLE の最長一致(4→1文字)
 *   5. 上記いずれにも一致しないが何かのトークンの前方一致 → 入力待ちとして rest に残す
 *   6. 前方一致にすらならない先頭文字は捨てて再試行する(エラーにしない)
 */
export function romajiToKana(buffer) {
  const kanas = [];
  let rest = String(buffer).toLowerCase();

  while (rest.length > 0) {
    if (rest.startsWith('nn')) {
      kanas.push('ん');
      rest = rest.slice(2);
      continue;
    }
    if (rest[0] === 'n' && rest.length >= 2 && rest[1] !== 'y' && isConsonant(rest[1])) {
      kanas.push('ん');
      rest = rest.slice(1);
      continue;
    }
    if (rest.length >= 2 && rest[0] === rest[1] && isConsonant(rest[0])) {
      kanas.push('っ');
      rest = rest.slice(1);
      continue;
    }

    let matched = false;
    for (let len = Math.min(MAX_TOKEN_LEN, rest.length); len >= 1; len--) {
      const head = rest.slice(0, len);
      const kana = ROMAJI_TABLE[head];
      if (kana) {
        kanas.push(...kana);
        rest = rest.slice(len);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (isPendingPrefix(rest)) break; // 続きの入力待ち
    rest = rest.slice(1); // 変換不能な先頭文字を捨てて再試行
  }

  return { kanas, rest };
}
