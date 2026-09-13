// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 方針は姉妹作と同じ(外部音源ゼロ=ライセンス管理対象ゼロ)。
// 歩く音はごく小さく、押す/ブロック/undo/クリアはそれぞれ区別できる音色にする。

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

/** 歩く(箱を押さない移動): ごく小さいクリック。 */
export function playMove() {
  tone(300, 0.03, 0.02, 'triangle');
}

/** 箱を押す: やや低めのしっかりした音。 */
export function playPush() {
  tone(220, 0.09, 0.09, 'square');
}

/** 壁や箱に当たってブロックされた: コツンという短い低音。 */
export function playBlocked() {
  tone(140, 0.07, 0.08, 'sawtooth');
}

/** アンドゥ: 逆再生っぽい下降音。 */
export function playUndo() {
  tone(500, 0.05, 0.06, 'triangle');
  tone(380, 0.06, 0.06, 'triangle', 0.05);
}

/** ヒント: 2音の上昇。 */
export function playHint() {
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

/** リスタート: undoと似た確認音(main.jsがボタン/キー押下時に鳴らす)。 */
export function playRestart() {
  tone(320, 0.08, 0.07, 'square');
}

export function toggleSound() {
  enabled = !enabled;
  return enabled;
}
