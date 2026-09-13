// theme.js — テーマ(進化チェーン)のデータ定義
//
// 「何が何に合体するか」の見た目・名前・スコアはすべてこのファイルだけで
// 決まる。フルーツ等の別テーマに差し替える場合もこのファイルの tiers を
// 書き換えるだけでよい(ロジック側は tier 番号しか見ない)。
// 制約:
//   - tiers は小さい順に並べる(radius が厳密に単調増加)
//   - 最大ティア同士の合体は「消滅+最終スコア」になる(game.js 参照)
//   - 最大 radius * 2 が board.width を超えないこと(theme.test.mjs で検証)

export const THEME = {
  name: 'コズモ',
  tiers: [
    // score は「そのティアのペアが合体したとき」に入る点数(三角数)
    { name: '星屑',   radius: 16,  score: 1,  colors: ['#b8c4d8', '#6b7a94'] },
    { name: '隕石',   radius: 22,  score: 3,  colors: ['#a58a6f', '#5c4a38'] },
    { name: '月',     radius: 29,  score: 6,  colors: ['#e8e4d8', '#9a968a'] },
    { name: '水星',   radius: 37,  score: 10, colors: ['#c9a97a', '#7a6248'] },
    { name: '火星',   radius: 46,  score: 15, colors: ['#e06a4a', '#8c3520'] },
    { name: '金星',   radius: 56,  score: 21, colors: ['#f2cf8a', '#b98a3e'] },
    { name: '地球',   radius: 67,  score: 28, colors: ['#5aa8e0', '#2a6a3a'] },
    { name: '海王星', radius: 79,  score: 36, colors: ['#4a6ae0', '#22348c'] },
    { name: '土星',   radius: 92,  score: 45, colors: ['#e8c27a', '#a8823e'], ring: true },
    { name: '木星',   radius: 106, score: 55, colors: ['#e0a878', '#94583a'], stripes: true },
    { name: '太陽',   radius: 121, score: 66, colors: ['#ffe07a', '#ff8c1a'], glow: true },
  ],
};
