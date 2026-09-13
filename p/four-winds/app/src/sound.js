// sound.js — WebAudio による効果音(音声アセット不要・合成のみ)
//
// 外部音源ファイルを持たない理由: アセットのライセンス管理を不要にし、
// リポジトリを完全自己完結に保つため(姉妹作と同方針)。
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

/** 短い減衰トーンを鳴らす内部ヘルパ。endFreq を渡すと周波数がスイープする。 */
function tone(freq, duration, volume, type = 'sine', endFreq = null) {
  const ac = ensureContext();
  if (!ac || !enabled) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (endFreq !== null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), ac.currentTime + duration);
  }
  gain.gain.setValueAtTime(volume, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

/** ショット音: 連射で鳴り続けるため、ごく小さく短いピッ。 */
export function playShot() {
  tone(880, 0.04, 0.03, 'square');
}

/** 爆発音: 低域へ落ちるノイズ風。big はボス撃破などの大爆発。 */
export function playExplosion(big = false) {
  if (big) {
    tone(220, 0.6, 0.3, 'sawtooth', 40);
    tone(140, 0.8, 0.25, 'triangle', 30);
  } else {
    tone(180, 0.25, 0.18, 'sawtooth', 50);
  }
}

/** カプセル取得音: 明るい上昇2音。 */
export function playCapsule() {
  tone(660, 0.08, 0.15, 'sine');
  setTimeout(() => tone(880, 0.1, 0.15, 'sine'), 60);
}

/** パワーアップ音: 取得音より一段派手な上昇3音。 */
export function playPowerup() {
  tone(523, 0.09, 0.18, 'triangle');
  setTimeout(() => tone(659, 0.09, 0.18, 'triangle'), 80);
  setTimeout(() => tone(784, 0.16, 0.18, 'triangle'), 160);
}

/** 被弾音: 濁った下降音。 */
export function playPlayerHit() {
  tone(300, 0.3, 0.25, 'sawtooth', 80);
}

/** 切替警告音: 高めのビープ(HUD点滅と同期する合図)。 */
export function playWarning() {
  tone(1040, 0.12, 0.12, 'square');
  setTimeout(() => tone(1040, 0.12, 0.12, 'square'), 220);
}

/** 方向切替音: ホワッシュ(低→高への速いスイープで「回った」感を出す)。 */
export function playPhaseChange() {
  tone(120, 0.5, 0.2, 'sine', 720);
  tone(80, 0.5, 0.12, 'triangle', 480);
}

/** ボス出現音: 不穏な低音2連。 */
export function playBossSpawn() {
  tone(110, 0.5, 0.25, 'sawtooth');
  setTimeout(() => tone(82, 0.8, 0.25, 'sawtooth'), 350);
}

/** クリア音: 上昇するファンファーレ風4音。 */
export function playClear() {
  const notes = [523, 659, 784, 1046];
  notes.forEach((freq, i) => {
    setTimeout(() => tone(freq, 0.3, 0.2, 'triangle'), i * 140);
  });
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
