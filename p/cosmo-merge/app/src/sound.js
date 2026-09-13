// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 外部音源ファイルを持たない理由: アセットのライセンス管理を不要にし、
// リポジトリを完全自己完結に保つため。物足りなくなったら差し替え可
// (docs/development-guide.md の拡張案を参照)。
//
// ブラウザの自動再生ポリシーにより、AudioContext は最初のユーザー操作の
// 後でしか作れない。そのため初回の play* 呼び出しで遅延初期化する。

let ctx = null;
let enabled = true;

function ensureContext() {
  if (ctx) return ctx;
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AC) ctx = new AC();
  } catch {
    ctx = null; // 音が出ないだけでゲームは続行する
  }
  return ctx;
}

/** 短い減衰トーンを鳴らす内部ヘルパ。 */
function tone(freq, duration, volume, type = 'sine') {
  const ac = ensureContext();
  if (!ac || !enabled) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

/** 投下音: 低く短いクリック。 */
export function playDrop() {
  tone(180, 0.08, 0.15, 'triangle');
}

/** 合体音: ティアが高いほど低く豊かに(達成感の演出)。 */
export function playMerge(tier) {
  const freq = 520 * Math.pow(0.92, tier - 1);
  tone(freq, 0.18, 0.2, 'sine');
  tone(freq * 1.5, 0.12, 0.1, 'sine');
}

/** ゲームオーバー音: 下降する2音。 */
export function playGameOver() {
  tone(320, 0.35, 0.2, 'sawtooth');
  setTimeout(() => tone(210, 0.6, 0.2, 'sawtooth'), 180);
}

/** ミュート切り替え。現在の有効状態を返す。 */
export function toggleSound() {
  enabled = !enabled;
  return enabled;
}

export function isSoundEnabled() {
  return enabled;
}
