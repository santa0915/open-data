// sound.js — WebAudioによる効果音(音声アセット不要・合成のみ)
//
// 方針・実装は姉妹作(cosmo-merge 等)と同一の tone ヘルパ方式。外部音源を
// 持たずリポジトリを自己完結に保つ。ブラウザの自動再生ポリシーにより
// AudioContext は最初のユーザー操作の後でしか作れないため、初回の play*
// 呼び出しで遅延初期化する。

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
function tone(freq, duration, volume, type = 'sine', delay = 0) {
  const ac = ensureContext();
  if (!ac || !enabled) return;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration);
}

/** 発言音: 小さなクリック。 */
export function playStatement() {
  tone(720, 0.05, 0.08, 'square');
}

/** 犠牲(夜の死亡)音: 低くこもった音。 */
export function playDeath() {
  tone(140, 0.5, 0.18, 'sine');
}

/** 追放音: ドラム的な2音(タンタン)。 */
export function playExile() {
  tone(110, 0.12, 0.22, 'triangle');
  tone(90, 0.22, 0.22, 'triangle', 0.14);
}

/** 勝利音: 明るく上昇する和音。 */
export function playWin() {
  tone(523, 0.18, 0.2, 'sine');
  tone(659, 0.18, 0.16, 'sine', 0.1);
  tone(784, 0.3, 0.18, 'sine', 0.2);
}

/** 敗北音: 下降する2音。 */
export function playLose() {
  tone(300, 0.35, 0.2, 'sawtooth');
  tone(200, 0.5, 0.2, 'sawtooth', 0.2);
}

/** ミュート切り替え。現在の有効状態を返す。 */
export function toggleSound() {
  enabled = !enabled;
  return enabled;
}

export function isSoundEnabled() {
  return enabled;
}
