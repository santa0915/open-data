// config.js — 配役・進行・疑心度モデルの全係数(game-design.md §2/§4 準拠)
//
// 数値を1つでも変えたら balance.test.mjs(全自動対戦300回の機械ゲート)を
// 必ず再走すること(development-guide.md §2)。係数の意味と「上げると何が
// 起きるか」も development-guide.md §2 の表を参照。

export function defaultConfig() {
  return {
    // 配役(7人固定): 侵入者2・調査員1・警備員1・乗組員3(game-design.md §2)
    roles: { wolf: 2, seer: 1, guard: 1, crew: 3 },

    // 昼の発言巡数・終局までの日数上限(8日超は balance.test が不具合として検知する安全網)
    discussionRounds: 2,
    maxDays: 8,

    // 疑心度モデルの係数。
    // sus[b][t] = ボットbが他者tへ抱く疑心度(初期0、更新規則は bots.js 参照)
    //
    // 【balance.test 対応でgame-design.md §4の初期値から調整済み】
    // 実装直後の初期値(coConflict2.0/reportWolf4.0/reportClear2.0/
    // suspectNudge1.0/trustNudge0.8/misvote1.5/goodvote2.0/noise0.5、
    // seerCoRate0.8/fakeCoRate0.35)では300シード全自動対戦のクルー側勝率が
    // 約20%(30〜70%の機械ゲート未達)だった。原因は「侵入者は自分の相方に
    // 投票しない(sus=-∞)」ため7票中2票が構造的にクルー側へ流れ続けること、
    // かつ suspectNudge が強くノイズ由来の的外れな疑いさえ即座に全員へ伝播・
    // 便乗させてしまい、初日にクルーが誤追放される確率が「完全ランダムより
    // 悪化」していたこと(計測: 初日追放が実際に侵入者だった率が約20% <
    // 母数比2/7≈29%)。
    // 対策として suspectNudge を大きく下げて「根拠の薄い便乗」を弱め、
    // reportWolf を上げて「調査員の本物の報告」の相対的な効き目を強めた
    // (=ノイズは伝染しにくく、真実の情報はよく効くモデルへ)。あわせて
    // seerCoRate を上げ(調査員が早く名乗り出るほど真の情報が早く出回る)、
    // fakeCoRate をやや下げた(侵入者の偽COが強すぎる便乗を誘発しないよう
    // 抑制)。300シードでの実測: クルー側勝率 約44.7〜46%、全ゲーム3日以内に
    // 終局(development-guide.md §2の手順通り、この表を正としてgame-design.md
    // 側の更新が必要)。
    susModel: {
      coConflict: 2.0, // 対抗COが発生した時、CO者全員への加算(全ボット視点)
      reportWolf: 5.0, // 「tは侵入者だ」報告での加算(発言者への信頼度で減衰)【調整: 4.0→5.0】
      reportClear: 2.0, // 「tは侵入者ではない」報告での減算(同上)
      suspectNudge: 0.05, // suspect発言での加算(同上)【調整: 1.0→0.05、便乗連鎖の抑制】
      trustNudge: 0.8, // trust発言での減算(同上)
      misvote: 1.5, // クルーを追放してしまった投票者への加算(全ボット視点)
      goodvote: 2.0, // 侵入者を追放できた投票者への減算(同上)
      noise: 0.5, // 毎朝の乱数ノイズ幅(±noise、一様分布)
    },

    // ボットの行動確率(発言選択に使う。夜行動には確率要素なし)
    seerCoRate: 0.95, // 調査員ボットが初日(day=1・最初の発言機会)にCOする確率【調整: 0.8→0.95】
    fakeCoRate: 0.15, // 侵入者ボット1体(相方より若いid側)が騙りCOする確率(ゲーム中1回のみ)【調整: 0.35→0.15】
  };
}
