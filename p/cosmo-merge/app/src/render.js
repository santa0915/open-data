// render.js — Canvas 描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// 責務: ゲーム状態(game.js)を毎フレーム Canvas に描く。
// パーティクル(合体の爆発演出)は純粋に見た目の問題なので、ゲーム状態では
// なくこのモジュール内部に保持する。

// 盤面をキャンバス内に配置するときの余白(壁の描画スペース)
const MARGIN = 20;

/** キャンバスの必要論理サイズを返す(index.html/main.js が使う)。 */
export function canvasSize(config) {
  return {
    width: config.board.width + MARGIN * 2,
    height: config.board.height + MARGIN * 2,
  };
}

/**
 * レンダラを生成する。
 * @returns {{ draw(game), addBurst(x, y, tier) }}
 */
export function createRenderer(canvas, config, theme) {
  const ctx = canvas.getContext('2d');
  const particles = []; // { x, y, vx, vy, life, color }
  let frame = 0; // デッドライン点滅などの時間源(描画専用)

  /** 合体位置に破裂パーティクルを追加する(main.js が merge イベントで呼ぶ)。 */
  function addBurst(x, y, tier) {
    const def = theme.tiers[tier - 1];
    const count = 10 + tier * 2;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 80 + Math.random() * 160;
      particles.push({
        x: x + MARGIN,
        y: y + MARGIN,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0.5 + Math.random() * 0.3,
        color: def.colors[0],
      });
    }
  }

  function drawPlanet(x, y, tierIndex, alpha = 1) {
    const def = theme.tiers[tierIndex];
    const r = def.radius;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    if (def.glow) {
      ctx.shadowColor = def.colors[1];
      ctx.shadowBlur = 40;
    }

    // 本体: 左上に光源を置いた放射グラデーション
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    grad.addColorStop(0, def.colors[0]);
    grad.addColorStop(1, def.colors[1]);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 木星風の横縞
    if (def.stripes) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = alpha * 0.25;
      ctx.fillStyle = def.colors[1];
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(-r, i * r * 0.34 - r * 0.08, r * 2, r * 0.16);
      }
      ctx.restore();
    }

    // ハイライト(質感付け)
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.4, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;

    // 土星の環(本体の後に描いて手前側だけ見せる簡易表現)
    if (def.ring) {
      ctx.strokeStyle = def.colors[1];
      ctx.lineWidth = r * 0.14;
      ctx.globalAlpha = alpha * 0.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.45, r * 0.4, -0.25, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawBoard(game) {
    const { width, height, deadlineY } = config.board;

    // 盤面背景
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fillRect(MARGIN, MARGIN, width, height);

    // 壁(左・右・床)
    ctx.strokeStyle = '#5a6a8a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(MARGIN, MARGIN);
    ctx.lineTo(MARGIN, MARGIN + height);
    ctx.lineTo(MARGIN + width, MARGIN + height);
    ctx.lineTo(MARGIN + width, MARGIN);
    ctx.stroke();

    // デッドライン(危険時は点滅)
    const flash = game.danger && Math.floor(frame / 12) % 2 === 0;
    ctx.strokeStyle = flash ? '#ff5a5a' : 'rgba(255, 100, 100, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(MARGIN, MARGIN + deadlineY);
    ctx.lineTo(MARGIN + width, MARGIN + deadlineY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawAim(game) {
    if (game.phase !== 'playing') return;
    const { dropY, height } = config.board;
    const x = MARGIN + game.aimX;
    const ready = game.dropCooldown <= 0;

    // 投下ガイド線
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(x, MARGIN + dropY);
    ctx.lineTo(x, MARGIN + height);
    ctx.stroke();
    ctx.setLineDash([]);

    // 待機中の天体(クールダウン中は半透明)
    drawPlanet(x, MARGIN + dropY, game.currentTier - 1, ready ? 1 : 0.35);
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
      p.vy += 600 * dt;
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 1フレーム描画する。main.js が requestAnimationFrame ごとに呼ぶ。 */
  function draw(game) {
    frame++;
    const size = canvasSize(config);
    ctx.clearRect(0, 0, size.width, size.height);

    drawBoard(game);

    for (const b of game.world.bodies) {
      drawPlanet(MARGIN + b.x, MARGIN + b.y, b.tier - 1);
    }

    drawAim(game);
    updateAndDrawParticles(1 / 60); // 演出専用なので描画レート依存で十分
  }

  return { draw, addBurst };
}
