// render.js — Canvas 描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// ビジュアルは「紙の上の積み木」風のフラットデザイン(→ docs/adr/0003)。
// 色はこのファイル冒頭の PALETTE に集約してある。

const PALETTE = {
  background: '#f4f1e8',
  boardLine: '#d8d2c2',
  solid: '#3d4354',
  solidTop: '#565e73',
  players: ['#e0564a', '#4a86e0'], // P1 = 赤, P2 = 青
  key: '#e8b02a',
  door: '#7a5a38',
  doorOpen: '#2e2620',
  spike: '#8a8f9c',
  plate: '#e07f2a',
  gate: '#c04a5a',
  text: '#3d4354',
};

export function canvasSize(config) {
  return { width: config.cols * config.tile, height: config.rows * config.tile };
}

export function createRenderer(canvas, config) {
  const ctx = canvas.getContext('2d');
  const T = config.tile;

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawTiles(game) {
    const level = game.level;
    for (let ty = 0; ty < level.rows; ty++) {
      for (let tx = 0; tx < level.cols; tx++) {
        if (!level.solid[ty][tx]) continue;
        ctx.fillStyle = PALETTE.solid;
        ctx.fillRect(tx * T, ty * T, T, T);
        // 上面だけ明るくして「地面の縁」を出す(上が空間のタイルのみ)
        if (ty > 0 && !level.solid[ty - 1][tx]) {
          ctx.fillStyle = PALETTE.solidTop;
          ctx.fillRect(tx * T, ty * T, T, 5);
        }
      }
    }
  }

  function drawDoor(game) {
    const d = game.door;
    ctx.fillStyle = PALETTE.door;
    roundRect(d.x, d.y, d.w, d.h, 6);
    ctx.fill();
    if (d.unlocked) {
      // 開いたドア: 暗い戸口をくり抜く
      ctx.fillStyle = PALETTE.doorOpen;
      roundRect(d.x + 5, d.y + 6, d.w - 10, d.h - 6, 5);
      ctx.fill();
    } else {
      // 鍵穴
      ctx.fillStyle = PALETTE.key;
      ctx.beginPath();
      ctx.arc(d.x + d.w / 2, d.y + d.h / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(d.x + d.w / 2 - 2, d.y + d.h / 2, 4, 10);
    }
  }

  function drawKey(game) {
    const key = game.key;
    if (!key || key.delivered) return;
    // 未取得時はふわふわ浮かせる(見つけやすさの演出)
    const bob = key.heldBy < 0 ? Math.sin(game.levelTime * 4) * 3 : 0;
    const x = key.x + 12;
    const y = key.y + 12 + bob;
    ctx.strokeStyle = PALETTE.key;
    ctx.fillStyle = PALETTE.key;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x - 4, y, 6, 0, Math.PI * 2); // 持ち手
    ctx.stroke();
    ctx.fillRect(x + 2, y - 2, 10, 4); // 軸
    ctx.fillRect(x + 8, y + 2, 3, 5); // 歯
  }

  function drawSpikes(game) {
    ctx.fillStyle = PALETTE.spike;
    for (const s of game.level.spikes) {
      const x = s.tx * T;
      const y = (s.ty + 1) * T;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        ctx.moveTo(x + i * 8, y);
        ctx.lineTo(x + i * 8 + 4, y - 16);
        ctx.lineTo(x + i * 8 + 8, y);
      }
      ctx.fill();
    }
  }

  function drawPlatesAndGates(game) {
    for (const p of game.level.plates) {
      const pressed = game.gateOpen; // 単一回路なので開=どこかが押されている
      ctx.fillStyle = PALETTE.plate;
      roundRect(p.tx * T + 4, p.ty * T + (pressed ? 26 : 22), T - 8, pressed ? 6 : 10, 3);
      ctx.fill();
    }
    for (const g of game.level.gates) {
      const x = g.tx * T;
      const y = g.ty * T;
      if (game.gateOpen) {
        // 開いたゲートは輪郭だけ残す(どこが閉まるかの予告)
        ctx.strokeStyle = PALETTE.gate;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 6, y + 2, T - 12, T - 4);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = PALETTE.gate;
        ctx.fillRect(x + 6, y, T - 12, T);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i < 3; i++) ctx.fillRect(x + 6, y + 4 + i * 10, T - 12, 3);
      }
    }
  }

  function drawPlayer(p, game) {
    ctx.fillStyle = PALETTE.players[p.index];
    roundRect(p.x, p.y, p.w, p.h, 7);
    ctx.fill();
    // 目: 向いている方向に寄せる(2人の区別と生き物感)
    const eyeY = p.y + 9;
    const offset = p.facing * 3;
    for (const ex of [p.x + 7 + offset, p.x + p.w - 7 + offset]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, eyeY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22262e';
      ctx.beginPath();
      ctx.arc(ex + p.facing * 1.5, eyeY, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawIntro(game) {
    if (game.levelTime > game.config.rules.introDuration) return;
    const def = game.levels[game.levelIndex];
    const { width } = canvasSize(game.config);
    ctx.fillStyle = 'rgba(61, 67, 84, 0.88)';
    roundRect(width / 2 - 190, 150, 380, 92, 12);
    ctx.fill();
    ctx.fillStyle = '#f4f1e8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText(`レベル ${game.levelIndex + 1}  ${def.name}`, width / 2, 190);
    ctx.font = '15px system-ui, sans-serif';
    ctx.fillText(def.hint, width / 2, 222);
  }

  function draw(game) {
    const { width, height } = canvasSize(config);
    ctx.fillStyle = PALETTE.background;
    ctx.fillRect(0, 0, width, height);

    drawDoor(game);
    drawTiles(game);
    drawSpikes(game);
    drawPlatesAndGates(game);
    drawKey(game);
    for (const p of game.players) drawPlayer(p, game);
    drawIntro(game);

    if (game.phase === 'clear') {
      ctx.fillStyle = 'rgba(61, 67, 84, 0.6)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffe07a';
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.fillText('クリア!', width / 2, height / 2);
    }
  }

  return { draw };
}
