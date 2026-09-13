// config.js — 全チューニング定数の一元管理
//
// 手触りに関わる数値はすべてここに集約する(docs/game-design.md が一次仕様。
// 本ファイルとの軽微な数値差異は本ファイル側を正とし、設計書を追従更新する
// 運用 — docs/game-design.md 冒頭の注記を参照)。
// 敵種別ごとの数値(HP・速度など)とボスの数値は stage.js 側(ENEMY_TYPES /
// STAGE.boss)に置く。ここに置くのは「盤面・方向システム・自機」という
// 本作の骨格に関わる定数のみ。

/**
 * デフォルト設定を新しいオブジェクトとして返す。
 * テストで縮小盤面や高速化した値に差し替えられるよう、共有定数ではなく
 * 毎回フレッシュなオブジェクトを生成する。
 */
export function defaultConfig() {
  return {
    // 盤面(プレイフィールド)。4方向の公平性のため正方形にする
    // (→ docs/adr/0003-direction-frame.md §1)。
    board: {
      width: 720,
      height: 720,
    },

    // 方向フレーム(directions.js)とスポーン・カリングの幾何。
    // 「中心 + f*(edgeDistance+aheadMargin) + s*offset」がスポーン位置。
    spawn: {
      edgeDistance: 360, // 中心から盤面の辺までの距離(=board幅の半分)
      aheadMargin: 30, // 前縁からさらに外側へ出す距離。画面外からの出現感を作る
      sideRange: 280, // 側方オフセットの範囲 [-sideRange, +sideRange]
      cullBackMargin: 60, // 後縁の外側60pxを超えたら削除(frameを持つ敵に適用)
      cullSideMargin: 80, // 側縁の外側80pxを超えたら削除(frameを持つ敵に適用)
      // frame を持たない実体(自弾・敵弾・カプセル)のカリングは前後左右を
      // 区別せず単純なAABBで行う。設計書に個別の数値が無いための簡略化
      // (docs/architecture.md に明記の無い割り切り。既知の割り切り §8 に準ずる思想)。
      genericCullMargin: 80,
    },

    // 15秒周期の方向切替シーケンス(docs/game-design.md §3)。
    direction: {
      cycleDuration: 15, // 1フェーズ(方向)の長さ [s]
      warningLead: 2, // 切替の何秒前から警告するか(13.0s = 15 - 2)
      turnDuration: 0.6, // shipAngle が目標角へ回頭しきるまでの時間 [s]
      spawnHoldDuration: 1.0, // 切替直後、スポーンを止める立て直し時間 [s]
    },

    // 自機(docs/game-design.md §4)。
    player: {
      speed: 300, // 移動速度 [px/s]。8方向、盤面内にクランプ
      radius: 10, // 当たり判定半径(見た目より小さめ = シューティングの定石)
      fireCooldown: 0.12, // ショットの連射間隔 [s]
      lives: 3,
      invincibleDuration: 2.5, // 被弾後の無敵時間 [s](点滅は render 側の演出)
    },

    // 自弾(docs/game-design.md §4)。向きは常に「現在の f」(回頭中も新方向)。
    bullet: {
      speed: 640,
      radius: 3,
      damage: 1,
      // 武器レベルの弾配置。Lv2はside方向±offsetの平行ツイン、
      // Lv3はツイン+前方±angleDegの斜め2発(計4発)。
      twinSideOffset: 8,
      obliqueAngleDeg: 22,
    },

    // カプセル(docs/game-design.md §5)。撃破地点からその敵のフレームの
    // -f方向へ漂う。半径・速度は敵種別に依らず一律。
    capsule: {
      radius: 12,
      driftSpeed: 60,
    },

    // スコアとメタ(docs/game-design.md §7)。敵撃破点・ボス撃破点は
    // stage.js(ENEMY_TYPES / STAGE.boss)側の score フィールドを見る。
    scoring: {
      capsuleMaxLevelBonus: 500, // 武器Lv3でカプセルを取った時の代替加点
      phaseSurviveBonus: 500, // フェーズ(15秒窓)を生き延びるごとの加点
      bestScoreKey: 'four-winds.best', // localStorage キー(main.js が使用)
    },

    // シミュレーションの固定タイムステップ(docs/architecture.md §4)。
    fixedDt: 1 / 120,
  };
}
