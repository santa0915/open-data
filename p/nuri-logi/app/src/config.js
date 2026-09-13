// config.js — 全チューニング定数の一元管理
//
// 表示・保存・タイマーに関わる数値はすべてここに集約する(architecture.md §6/§7)。
// ロジック層(board/linesolver/solver/hint)はこの定数に依存しない。DOM/保存/
// 時刻はI/O層(render.js・main.js)の責務であり、本ファイル自体もDOM/
// Math.random/Date.nowを持ち込まない(値の定義のみ)。
// 本作は完全決定的(乱数レス)のため rng 関連の設定は存在しない。
//
// 軽微な数値差異はこちら側を正とし、game-design.mdを追従更新する
// (game-design.md冒頭の注記どおり)。

export function defaultConfig() {
  return {
    render: {
      // セルサイズ目安[px]。盤面の一辺のマス数(5/10/15)をキーにする
      // (architecture.md §6 / game-design.md §5「設計バジェットと構成」)。
      cellSizePx: { 5: 44, 10: 32, 15: 24 },
      // 15×15+クルー領域が幅520pxに収まらない場合に縮めてよい下限。
      // これ以下にはしない(タップ精度の下限。architecture.md §7)
      cellSizeMinPx: 22,
      // 5マスごとに太罫線を引く(architecture.md §6)
      thickLineEvery: 5,
    },

    storage: {
      // 問題ごとの { cleared, bestTimeSec, hintsUsed }(game-design.md §6)
      progressKey: 'nuri-logi.progress.v1',
      // 途中盤面の自動保存キーの接頭辞。問題インデックスを付けて使う
      // (例: `${boardKeyPrefix}${puzzleIndex}`)。historyは保存しない
      // (architecture.md §7「既知の割り切り」: 再開後のundoは再開点まで)
      boardKeyPrefix: 'nuri-logi.board.v1.',
    },

    timer: {
      // タイマー加算の間隔[ms]。phase==='playing'かつタブ可視時のみ加算する
      // (main.jsが管理。ロジック層はDate.nowを持たない。game-design.md §6)
      tickMs: 1000,
    },
  };
}
