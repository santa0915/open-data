// ruby.js — '{漢字|かんじ}' 記法のパース(純関数。HTML生成はrender側の仕事)
//
// 対応しない括弧(閉じ忘れ・'|'なし等)はエラーにせず、そのまま地の文として
// 扱う(architecture.md §2)。ルビ記法の妥当性そのもの(括弧の対応)を
// エラー扱いするのは schema.js の役目で、ここではベストエフォートで解釈する。

/**
 * '{漢字|かんじ}' 記法を含むテキストを、地の文とルビ付き文字の断片列に分ける。
 * @param {string} text
 * @returns {{ text: string, ruby: string|null }[]}
 *
 * 例: '{信濃川|しなのがわ}は…' → [{text:'信濃川',ruby:'しなのがわ'},{text:'は…',ruby:null}]
 */
export function parseRuby(text) {
  const segments = [];
  let plainStart = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '{') {
      i += 1;
      continue;
    }

    const close = text.indexOf('}', i + 1);
    if (close === -1) {
      // 閉じ括弧が見つからない → 対応しない括弧。地の文として読み飛ばす
      i += 1;
      continue;
    }

    const inner = text.slice(i + 1, close);
    const bar = inner.indexOf('|');
    if (bar === -1) {
      // '|' がない → ルビ記法として不完全。地の文として読み飛ばす
      i = close + 1;
      continue;
    }

    // ここまでで妥当なルビ記法が1つ確定
    if (i > plainStart) {
      segments.push({ text: text.slice(plainStart, i), ruby: null });
    }
    segments.push({ text: inner.slice(0, bar), ruby: inner.slice(bar + 1) });

    i = close + 1;
    plainStart = i;
  }

  if (plainStart < text.length) {
    segments.push({ text: text.slice(plainStart), ruby: null });
  }

  return segments;
}
