// config.js — 全チューニング定数の一元管理
//
// 難易度の定義はすべてここ。数値の根拠は docs/game-design.md §4 を参照。

export function defaultConfig() {
  return {
    // 難易度プリセット。
    //   targetClues: ヒント(初期配置)数の目標値。掘れなければ +2 まで許容
    //   requireSinglesSolvable: 「ネイキッド/ヒドゥンシングルだけで解ける」
    //     ことを保証するか(論理だけで解ける=試行錯誤・仮置き不要)
    difficulties: {
      easy: { name: 'かんたん', targetClues: 40, requireSinglesSolvable: true },
      normal: { name: 'ふつう', targetClues: 34, requireSinglesSolvable: true },
      hard: { name: 'むずかしい', targetClues: 28, requireSinglesSolvable: false },
    },

    // 「きょうの1問」が使う難易度(シードは日付から決まる → main.js)
    dailyDifficulty: 'normal',

    // パズル生成のリトライ上限(条件を満たせない場合はベスト解を返す)
    generatorMaxAttempts: 20,

    // 自動保存の間隔 [s](操作時は即保存。これはタイマー進行の保存用)
    autosaveInterval: 5,
  };
}
