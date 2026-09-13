// config.js — 全チューニング定数の一元管理
//
// 手触りに関わる数値はすべてここに集約する。各値の意味と「変えると何が
// 起きるか」は docs/development-guide.md のチューニング表を参照。
// 注意: ジャンプ高さはレベル設計と強く結合している(2タイル=単独で越えられる、
// 3タイル=2人の積み重ねが必要、4タイル=積んでも越えられない)。
// gravity / jumpVelocity を変えたら必ず tests/game.test.mjs の到達高さ検証と
// 全レベルの実プレイを通すこと。

export function defaultConfig() {
  return {
    // タイルサイズと盤面(レベルは全て「1画面固定」28×16タイル)
    tile: 32,
    cols: 28,
    rows: 16,

    player: {
      width: 24,
      height: 30,
      moveMax: 260, // 最大横速度 [px/s]
      groundAccel: 2600, // 地上での加速度 [px/s^2]
      airAccel: 1600, // 空中での加速度(地上より鈍く)
      groundDecel: 2200, // 入力なし時の地上減速度
      airDecel: 300, // 入力なし時の空中減速度(慣性を残す)
      jumpVelocity: 640, // ジャンプ初速 [px/s]。最高到達 ≈ 85px ≈ 2.7タイル
      jumpCutVelocity: 240, // ボタンを離したとき上昇速度をここまで削る(可変ジャンプ)
      coyoteTime: 0.08, // 足場を離れてもジャンプできる猶予 [s]
      jumpBuffer: 0.12, // 着地前の先行入力を保持する時間 [s]
    },

    physics: {
      gravity: 2400, // [px/s^2]
      maxFallSpeed: 900, // 落下の終端速度(タイルすり抜け防止も兼ねる)
      fixedDt: 1 / 120, // 固定タイムステップ [s]
    },

    rules: {
      clearDelay: 1.4, // レベルクリア演出から次レベルへ進むまでの秒数
      introDuration: 1.6, // レベル名オーバーレイの表示秒数(描画専用)
    },

    // キー割り当て(main.js が参照)。KeyboardEvent.code で指定する
    keys: {
      p1: { left: 'KeyA', right: 'KeyD', jump: 'KeyW' },
      p2: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp' },
      retry: 'KeyR',
    },
  };
}
