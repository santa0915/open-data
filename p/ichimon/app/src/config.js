// config.js — 全チューニング定数の一元管理
//
// ロジック層の各モジュールはマジックナンバーを直書きせず、必ずここを参照する。
// 数値の根拠:
//   - 偏差値重み・adaptive → docs/adr/0003-hensachi-model.md
//   - Leitner箱の間隔      → docs/adr/0004-srs.md

export const CONFIG = {
  // --- select.js: 出題選択 -------------------------------------------
  // 偏差値重み抽選(正規分布)の標準偏差(σ)。目標偏差値からの距離を
  // この幅で重み付けする(adr/0003 §2)。stars スケールのパックは
  // target を starsMin〜starsMax へ線形写像したうえで同じ式・同じσを使う
  selectSigma: 5,

  // 1セット(session)のデフォルト問題数
  sessionSize: 10,

  // normalモードで復習(isDueな問題)を混ぜる最大割合。
  // floor(size * reviewRatio) 件を上限に、due古い順で優先出題する(adr/0004)
  reviewRatio: 0.4,

  // セッション内適応(adaptive、既定ON)の1問あたりの target 移動量。
  // 正解: +adaptiveStep / 不正解: -adaptiveStep(スケール範囲内でクランプ)
  adaptiveStep: 1.5,

  // 偏差値スケール(difficultyScale: 'hensachi')の値域
  hensachiMin: 40,
  hensachiMax: 70,

  // starsスケール(difficultyScale: 'stars'。低学年パック向け)の値域
  starsMin: 1,
  starsMax: 5,

  // --- srs.js: Leitner方式 --------------------------------------------
  // 箱0〜4ごとの再出題間隔[日]。正解で箱+1(上限4)・不正解で箱0(adr/0004)。
  // 受験直前期向けの短縮系(例: [0,1,2,4,7])への差し替えは拡張候補
  boxIntervalsDays: [0, 1, 3, 7, 21],
};
