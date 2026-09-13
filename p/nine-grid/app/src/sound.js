// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 方針は姉妹作と同じ(外部音源ゼロ=ライセンス管理対象ゼロ)。
// パズルゲームなので音は控えめに、操作の確認音に徹する。

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

/** 数字を置いた: 柔らかいクリック。 */
export function playPlace() {
  tone(520, 0.06, 0.08, 'triangle');
}

/** 重複が発生した: 低いブザー(責めない程度に短く)。 */
export function playConflict() {
  tone(180, 0.15, 0.1, 'sawtooth');
}

/** メモ・消去・取り消し: さらに控えめなクリック。 */
export function playSoft() {
  tone(400, 0.04, 0.05, 'triangle');
}

/** ヒント: 2音の上昇。 */
export function playHint() {
  tone(660, 0.08, 0.08, 'sine');
  tone(880, 0.12, 0.08, 'sine', 0.07);
}

/** 完成: 4音のアルペジオ。 */
export function playWin() {
  tone(523, 0.15, 0.12, 'triangle');
  tone(659, 0.15, 0.12, 'triangle', 0.13);
  tone(784, 0.15, 0.12, 'triangle', 0.26);
  tone(1047, 0.4, 0.12, 'triangle', 0.39);
}

export function toggleSound() {
  enabled = !enabled;
  return enabled;
}
