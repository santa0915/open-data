// render.js — Canvas 描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// 責務: ゲーム状態(game.js)を毎フレーム Canvas に描く。
// 星のパラレックス・爆発パーティクルは純粋に見た目の問題なので、ゲーム状態では
// なくこのモジュール内部に保持する(Math.random の使用もこの演出内部のみ許可 —
// docs/architecture.md §1 の規約)。
// クリア/ゲームオーバーの文字は DOM オーバーレイ側(main.js/index.html)。

import { DIRS } from './directions.js';

// 星のパラレックス2層。-f方向に流れてスクロール方向を体感させる
// (docs/game-design.md §8)。速度はarchitecture.md §7の指定値。
const STAR_LAYERS = [
  { count: 60, speed: 40, size: 1.2, alpha: 0.45 },
  { count: 30, speed: 90, size: 2.0, alpha: 0.8 },
];

// 敵種別ごとの色(carrierはカプセル持ちの識別としてオレンジ — 仕様指定)
const ENEMY_COLORS = {
  zako: '#6ee7ff',
  arc: '#8dff6e',
  tank: '#c98dff',
  carrier: '#ffab4a',
};

/** キャンバスの必要論理サイズを返す(index.html/main.js が使う)。 */
export function canvasSize(config) {
  return { width: config.board.width, height: config.board.height };
}

/**
 * レンダラを生成する。
 * @returns {{ draw(game), addBurst(x, y, big) }}
 */
export function createRenderer(canvas, config) {
  const ctx = canvas.getContext('2d');
  const W = config.board.width;
  const H = config.board.height;
  const particles = []; // { x, y, vx, vy, life, color, size }
  let frame = 0; // 点滅などの時間源(描画専用)

  // 星は初期化時に一度だけばら撒く(位置の更新は毎フレームの流し込み)
  const stars = STAR_LAYERS.map((layer) => ({
    ...layer,
    points: Array.from({ length: layer.count }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
    })),
  }));

  /** 爆発位置に破裂パーティクルを追加する(main.js が explosion イベントで呼ぶ)。 */
  function addBurst(x, y, big) {
    const count = big ? 60 : 16;
    const colors = big ? ['#ff8dc7', '#ffd76a', '#ffffff'] : ['#ffd76a', '#ff9a5a'];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const speed = (big ? 120 : 70) + Math.random() * (big ? 260 : 160);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: (big ? 0.7 : 0.45) + Math.random() * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: big ? 4 : 3,
      });
    }
  }

  /** 星のパラレックス。現在のfの逆方向へ流し、盤面端でラップする。 */
  function drawStars(game, dt) {
    const f = DIRS[game.dirIndex].f;
    for (const layer of stars) {
      ctx.fillStyle = `rgba(221, 228, 242, ${layer.alpha})`;
      for (const p of layer.points) {
        p.x = (p.x - f.x * layer.speed * dt + W) % W;
        p.y = (p.y - f.y * layer.speed * dt + H) % H;
        ctx.fillRect(p.x, p.y, layer.size, layer.size);
      }
    }
  }

  /** 自機: shipAngle で回転した三角形+ノズル。無敵中は点滅。 */
  function drawShip(game) {
    const player = game.player;
    if (!player.alive) return;
    // 無敵中は点滅(6フレーム周期)。復活直後であることを伝える定石表現
    if (player.invincible > 0 && Math.floor(frame / 6) % 2 === 0) return;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(game.shipAngle);

    // ノズル(後方の噴射炎。長さを揺らして推進感を出す)
    const flame = 10 + Math.random() * 6;
    ctx.fillStyle = '#ffab4a';
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-10 - flame, 0);
    ctx.lineTo(-10, 4);
    ctx.closePath();
    ctx.fill();

    // 機体(前方が尖った三角形)
    ctx.fillStyle = '#dde4f2';
    ctx.strokeStyle = '#6ee7ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /** 敵1体。種別ごとに色・形を変える(全て手続き描画のオリジナル造形)。 */
  function drawEnemy(enemy) {
    const color = ENEMY_COLORS[enemy.type] || '#ffffff';
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    // 敵の「前」は保持フレームの-f方向。見た目もそちらへ向ける
    ctx.rotate(Math.atan2(-enemy.frame.f.y, -enemy.frame.f.x));
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;

    const r = enemy.r;
    if (enemy.type === 'zako') {
      // ひし形
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(0, -r * 0.8);
      ctx.lineTo(-r, 0);
      ctx.lineTo(0, r * 0.8);
      ctx.closePath();
      ctx.fill();
    } else if (enemy.type === 'arc') {
      // 三日月(旋回機の軽さを出す)
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI * 0.6, Math.PI * 0.6);
      ctx.quadraticCurveTo(-r * 0.2, 0, Math.cos(-Math.PI * 0.6) * r, Math.sin(-Math.PI * 0.6) * r);
      ctx.closePath();
      ctx.fill();
    } else if (enemy.type === 'tank') {
      // 重装の角形+砲口
      ctx.fillRect(-r, -r * 0.75, r * 2, r * 1.5);
      ctx.fillStyle = '#2a2a3a';
      ctx.beginPath();
      ctx.arc(r * 0.4, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeRect(-r, -r * 0.75, r * 2, r * 1.5);
    } else {
      // carrier: 六角形(輸送機)。オレンジでカプセル持ちを識別させる
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r * 0.8;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** ボス: 多重リングのコア+盤面上部のHPバー。 */
  function drawBoss(boss) {
    ctx.save();
    ctx.translate(boss.x, boss.y);

    // 外殻(ゆっくり回転するリング)
    ctx.rotate(frame * 0.01);
    ctx.strokeStyle = '#ff8dc7';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a0 = (Math.PI / 3) * i + 0.15;
      const a1 = (Math.PI / 3) * (i + 1) - 0.15;
      ctx.moveTo(Math.cos(a0) * boss.r, Math.sin(a0) * boss.r);
      ctx.arc(0, 0, boss.r, a0, a1);
    }
    ctx.stroke();

    // コア(被弾するほど明滅が速くなる)
    const pulse = 0.75 + 0.25 * Math.sin(frame * (0.05 + 0.1 * (1 - boss.hp / boss.maxHp)));
    ctx.fillStyle = `rgba(255, 141, 199, ${pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, boss.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, boss.r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // HPバー(盤面上部の固定位置)
    const barW = 360;
    const barX = (W - barW) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(barX, 14, barW, 8);
    ctx.fillStyle = '#ff8dc7';
    ctx.fillRect(barX, 14, barW * Math.max(0, boss.hp / boss.maxHp), 8);
  }

  function drawBullets(game) {
    ctx.fillStyle = '#ffe79a';
    for (const b of game.playerBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff5a5a';
    for (const b of game.enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** カプセル: 点滅するオレンジのダイヤ(取ると強化 — 目立たせる)。 */
  function drawCapsules(game) {
    const blink = 0.6 + 0.4 * Math.sin(frame * 0.25);
    for (const c of game.capsules) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(Math.PI / 4);
      ctx.globalAlpha = blink;
      ctx.fillStyle = '#ffab4a';
      ctx.fillRect(-c.r * 0.7, -c.r * 0.7, c.r * 1.4, c.r * 1.4);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffe79a';
      ctx.lineWidth = 2;
      ctx.strokeRect(-c.r * 0.7, -c.r * 0.7, c.r * 1.4, c.r * 1.4);
      ctx.restore();
    }
  }

  /** 右上の方位コンパス+次回切替までの残りゲージ。警告中は点滅。 */
  function drawCompass(game) {
    const cx = W - 54;
    const cy = 54;
    const radius = 26;
    const cfg = config.direction;

    const flash = game.warning && Math.floor(frame / 8) % 2 === 0;

    // 外周リング = 残り時間ゲージ(12時から時計回りに減っていく)
    const remain = 1 - game.phaseTimer / cfg.cycleDuration;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = flash ? '#ff5a5a' : '#6ee7ff';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
    ctx.stroke();

    // 現在の方向を指す矢印(切替に合わせて回頭 — shipAngleと同じトゥイーン感)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(game.shipAngle);
    ctx.fillStyle = flash ? '#ff5a5a' : '#dde4f2';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 警告中は画面縁を赤くパルスさせる(切替2秒前の合図)。 */
  function drawWarningEdge(game) {
    if (!game.warning) return;
    const pulse = 0.25 + 0.25 * Math.sin(frame * 0.3);
    ctx.strokeStyle = `rgba(255, 90, 90, ${pulse})`;
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, W - 12, H - 12);
  }

  function updateAndDrawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 1フレーム描画する。main.js が requestAnimationFrame ごとに呼ぶ。 */
  function draw(game) {
    frame++;
    const dt = 1 / 60; // 演出専用なので描画レート依存で十分

    ctx.fillStyle = '#0a0e1e';
    ctx.fillRect(0, 0, W, H);

    drawStars(game, dt);
    drawCapsules(game);
    for (const enemy of game.enemies) drawEnemy(enemy);
    if (game.boss) drawBoss(game.boss);
    drawBullets(game);
    drawShip(game);
    updateAndDrawParticles(dt);
    drawCompass(game);
    drawWarningEdge(game);
  }

  return { draw, addBurst };
}
