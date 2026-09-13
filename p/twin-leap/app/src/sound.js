// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 外部音源ファイルを持たない方針は cosmo-merge と同じ(ライセンス管理対象ゼロ)。
// AudioContext は自動再生ポリシーのため初回のユーザー操作後に遅延初期化する。

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

export function playJump() {
  tone(340, 0.12, 0.12, 'square');
}

export function playKey() {
  tone(660, 0.1, 0.15, 'sine');
  tone(880, 0.15, 0.15, 'sine', 0.08);
}

export function playUnlock() {
  tone(520, 0.12, 0.15, 'triangle');
  tone(780, 0.2, 0.15, 'triangle', 0.1);
}

export function playGate() {
  tone(240, 0.08, 0.12, 'square');
}

export function playDeath() {
  tone(200, 0.25, 0.18, 'sawtooth');
  tone(140, 0.35, 0.18, 'sawtooth', 0.12);
}

export function playClear() {
  tone(523, 0.14, 0.15, 'triangle');
  tone(659, 0.14, 0.15, 'triangle', 0.12);
  tone(784, 0.3, 0.15, 'triangle', 0.24);
}

export function playAllClear() {
  playClear();
  tone(1047, 0.5, 0.15, 'triangle', 0.4);
}

export function toggleSound() {
  enabled = !enabled;
  return enabled;
}
