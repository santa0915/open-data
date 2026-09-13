// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 方針は姉妹作と同じ(外部音源ゼロ=ライセンス管理対象ゼロ)。
// ことば当てなので音は控えめに、操作の確認音に徹する。

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

function tone(freq, duration, volume, type = 'sine', delay = 0) {
  const ac = ensureContext();
  if (!ac || !enabled) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

/** かなを1文字入力/削除した: 小さなキー音。 */
export function playType() {
  tone(480, 0.04, 0.05, 'triangle');
}

/** 行が確定してめくれた: 柔らかいクリック。 */
export function playReveal() {
  tone(620, 0.07, 0.08, 'triangle');
}

/** 無効な確定(4文字未満): 低いブザー(責めない程度に短く)。 */
export function playReject() {
  tone(180, 0.15, 0.1, 'sawtooth');
}

/** 勝利: 4音の上昇アルペジオ。 */
export function playWin() {
  tone(523, 0.15, 0.12, 'triangle');
  tone(659, 0.15, 0.12, 'triangle', 0.13);
  tone(784, 0.15, 0.12, 'triangle', 0.26);
  tone(1047, 0.4, 0.12, 'triangle', 0.39);
}

/** 敗北: 2音の下降(静かに)。 */
export function playLose() {
  tone(392, 0.2, 0.1, 'triangle');
  tone(262, 0.45, 0.1, 'triangle', 0.18);
}

export function toggleSound() {
  enabled = !enabled;
  return enabled;
}
