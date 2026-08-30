// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 方針は姉妹作と同じ(外部音源ゼロ=ライセンス管理対象ゼロ)。
// 学習アプリなので演出は控えめに: 正解○で小さく明るい音、×は短く低い音、
// セット終了で2音だけ(product-design.md §4)。

let ctx = null;
let enabled = true;

function ensureContext() {
  if (ctx) return ctx;
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AC) ctx = new AC();
  } catch {
    ctx = null; // 音が出ないだけでアプリは続行する
  }
  return ctx;
}

function tone(freq, duration, volume, type = 'triangle', delay = 0) {
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

/** 自己採点○: 小さく明るい1音。 */
export function playCorrect() {
  tone(880, 0.12, 0.08);
}

/** 自己採点×: 短く低い1音(責めない程度に控えめ)。 */
export function playWrong() {
  tone(220, 0.14, 0.06, 'sine');
}

/** セット終了: 2音の上昇(ささやかに)。 */
export function playDone() {
  tone(523, 0.15, 0.09);
  tone(784, 0.3, 0.09, 'triangle', 0.14);
}

/** 音のオン/オフを切り替え、切り替え後の状態を返す。 */
export function toggleSound() {
  enabled = !enabled;
  return enabled;
}
