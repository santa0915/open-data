// stage.js — 敵定義(ENEMY_TYPES)とステージのウェーブタイムライン(STAGE)
//
// データ駆動: 敵種別ごとの数値・ボスの数値・ウェーブの出現タイミングは
// すべてここに集約する(docs/game-design.md §5,§6)。game.js / enemies.js は
// この形を読むだけで、個々の敵種別やタイミングをハードコードしない。
//
// ウェーブの `at` はフェーズ開始からの秒(0..15)。`side` は側方オフセットの
// 基準値(px、spawn.sideRange の範囲内)。'random' なら rng で
// [-sideRange, +sideRange] から毎回抽選する。編隊(count>1)は同じ side
// から interval 秒間隔で連続出現する(docs/architecture.md §5)。
//
// 割り切り: game-design.md §6 の表は「zako×3編隊×2波、carrier×1(8s)」の
// ように内容を文章で示すのみで、個々の出現秒までは確定していない。本ファイル
// の `at` は文章中に明示された秒(carrier(8s)・arc(19s,25s)・tank(35s) =
// ステージ絶対時刻)をフェーズ内相対秒に変換した値を基準に、残りの編隊は
// フェーズ内でテンポよく散るように著者が具体化したもの(仕様書の不備ではなく
// 「タイムラインの中身はstage.jsで定義する」という仕様書の指示どおりの作業)。

export const ENEMY_TYPES = {
  zako: {
    hp: 1,
    speed: 160, // -f方向への直進速度 [px/s]
    radius: 12,
    score: 100,
    swayAmplitude: 40, // 側方(s)への正弦波スウェイの振幅 [px]
    swayPeriod: 1.6, // スウェイの周期 [s]
  },
  arc: {
    hp: 1,
    speed: 200,
    radius: 12,
    score: 150,
    turnDuration: 1.5, // 出現後この秒数だけ自機方向へ旋回する
    turnRate: 1.2, // 旋回角速度 [rad/s]
  },
  tank: {
    hp: 4,
    speed: 80,
    radius: 18,
    score: 300,
    fireInterval: 2.2, // 自機狙い弾の発射間隔 [s]
    bulletSpeed: 240,
    bulletRadius: 4,
  },
  carrier: {
    hp: 2,
    speed: 120,
    radius: 14,
    score: 200,
    // 撃破時にカプセルを落とす(オレンジ色で識別 = render側の話。ここでは
    // 「カプセルを落とす種別である」ことだけをデータとして持たせる)
    dropsCapsule: true,
  },
};

export const STAGE = {
  phases: [
    // phaseCount 0: 右(0-15s)
    {
      waves: [
        { at: 2, type: 'zako', count: 3, interval: 0.35, side: -150 },
        { at: 8, type: 'carrier', count: 1, side: 0 },
        { at: 10, type: 'zako', count: 3, interval: 0.35, side: 150 },
      ],
    },
    // phaseCount 1: 上(15-30s)。arcの出現は絶対時刻19s/25s(=相対4s/10s)
    {
      waves: [
        { at: 2, type: 'zako', count: 3, interval: 0.35, side: -150 },
        { at: 4, type: 'arc', count: 1, side: -100 },
        { at: 7, type: 'carrier', count: 1, side: 0 },
        { at: 10, type: 'arc', count: 1, side: 100 },
      ],
    },
    // phaseCount 2: 左(30-45s)。tankの出現は絶対時刻35s(=相対5s)
    {
      waves: [
        { at: 2, type: 'zako', count: 3, interval: 0.35, side: -150 },
        { at: 5, type: 'tank', count: 1, side: 0 },
        { at: 9, type: 'zako', count: 3, interval: 0.35, side: 150 },
        { at: 12, type: 'carrier', count: 1, side: 0 },
      ],
    },
    // phaseCount 3: 下(45-60s)。zako・arc混成 + tank×2 + carrier×1
    {
      waves: [
        { at: 2, type: 'zako', count: 3, interval: 0.35, side: -150 },
        { at: 5, type: 'arc', count: 1, side: 100 },
        { at: 7, type: 'tank', count: 1, side: -150 },
        { at: 9, type: 'carrier', count: 1, side: 0 },
        { at: 11, type: 'tank', count: 1, side: 150 },
      ],
    },
  ],

  // phaseCount 4以降(ボス帯)。数値はENEMY_TYPESと同様にここへ集約する。
  boss: {
    hp: 60,
    radius: 48,
    score: 5000,
    anchorDistance: 240, // 中心から現在のf方向へこの距離の点がアンカー
    anchorSpeed: 120, // アンカーへ寄る速度 [px/s]
    swayAmplitude: 140, // アンカー近傍でのs方向スウェイ振幅 [px]
    swayPeriod: 4, // スウェイ周期 [s]
    attackInterval: 1.8, // 攻撃パターンの間隔 [s](2種を交互に使用)
    fanCount: 5, // ①自機狙いNウェイの弾数
    fanAngleStepDeg: 24, // Nウェイの弾間角度 [deg]
    fanBulletSpeed: 220,
    pairBulletSpeed: 280, // ②自機狙い2連の弾速
    pairInterval: 0.15, // 2連の発射間隔 [s]
    // ボス出現中、6秒ごとにzako×3の編隊が湧く(game-design.md §5)
    zakoWave: { interval: 6, count: 3, spawnInterval: 0.35 },
  },
};
