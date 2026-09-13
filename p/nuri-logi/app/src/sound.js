// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 方針は姉妹作(hako-oshi)と同じ(外部音源ゼロ=ライセンス管理対象ゼロ)。
// 塗る/×/undo/ライン確定チャイム/クリアのアルペジオを区別できる音色にする。

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

/** 塗る: 短い高めのクリック。 */
export function playFill() {
  tone(520, 0.05, 0.05, 'triangle');
}

/** ×を付ける: 塗るより低め・別音色。 */
export function playCross() {
  tone(300, 0.05, 0.05, 'square');
}

/** アンドゥ: 下降する2音。 */
export function playUndo() {
  tone(500, 0.05, 0.06, 'triangle');
  tone(380, 0.06, 0.06, 'triangle', 0.05);
}

/** 行/列が数字どおりに確定した: 短いチャイム。 */
export function playLineDone() {
  tone(880, 0.09, 0.05, 'sine');
}

/** ヒント: 誤りの指摘(低めのブザー)。 */
export function playHintMistake() {
  tone(220, 0.12, 0.08, 'sawtooth');
}

/** ヒント: 次の確定マスを開示(上昇する2音)。 */
export function playHintDeduce() {
  tone(660, 0.08, 0.07, 'sine');
  tone(880, 0.12, 0.07, 'sine', 0.07);
}

/** クリア: 4音のアルペジオ。 */
export function playClear() {
  tone(523, 0.15, 0.1, 'triangle');
  tone(659, 0.15, 0.1, 'triangle', 0.13);
  tone(784, 0.15, 0.1, 'triangle', 0.26);
  tone(1047, 0.4, 0.1, 'triangle', 0.39);
}

export function toggleSound() {
  enabled = !enabled;
  return enabled;
}
