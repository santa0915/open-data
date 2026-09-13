// render.js — DOM描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// 2画面構成: レベル選択(12面グリッド)とプレイ画面。タイルはCSS Gridで
// 敷き詰めた床/壁/ゴールの上に、箱とプレイヤーを絶対配置の要素として重ね、
// 移動はCSSトランジション(config.animation.moveDurationMs)で滑らかにする。
//
// 箱はSet<'x,y'>で位置管理されており個体識別が無いため、再描画のたびに
// 「前回位置に最も近い箱要素を使い回す」対応付けをして、動いた箱だけが
// トランジションするようにしている(boxViewの内部状態)。

/** レベル選択画面: 12面グリッドを組み立てる(クリック処理はmain.js側)。 */
export function renderLevelSelect(gridEl, levels, progress) {
  gridEl.textContent = '';
  levels.forEach((def, i) => {
    const card = document.createElement('button');
    card.className = 'level-card';
    card.dataset.levelIndex = String(i);

    const prog = progress[i] || {};
    const num = document.createElement('span');
    num.className = 'level-num';
    num.textContent = String(i + 1);

    const name = document.createElement('span');
    name.className = 'level-name';
    name.textContent = def.name;

    const stat = document.createElement('span');
    stat.className = 'level-stat';
    if (prog.cleared) {
      stat.textContent = `✓ ベスト${prog.bestPushes}押し / パー${def.par}`;
      card.classList.add('cleared');
    } else {
      stat.textContent = `パー${def.par}`;
    }

    card.append(num, name, stat);
    gridEl.appendChild(card);
  });
}

/**
 * プレイ画面の盤面DOMを新規に組み立てる。レベルを切り替えるたびに呼ぶ。
 * 床・壁・ゴールは静的なCSS Gridタイル、箱とプレイヤーは絶対配置の要素。
 */
export function createBoardView(boardEl, level, tileSize) {
  boardEl.textContent = '';
  boardEl.style.setProperty('--cols', level.cols);
  boardEl.style.setProperty('--rows', level.rows);
  boardEl.style.setProperty('--tile', `${tileSize}px`);
  boardEl.style.width = `${level.cols * tileSize}px`;
  boardEl.style.height = `${level.rows * tileSize}px`;

  for (let y = 0; y < level.rows; y++) {
    for (let x = 0; x < level.cols; x++) {
      const key = `${x},${y}`;
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.classList.add(level.walls.has(key) ? 'wall' : level.goals.has(key) ? 'goal' : 'floor');
      tile.style.gridColumn = String(x + 1);
      tile.style.gridRow = String(y + 1);
      boardEl.appendChild(tile);
    }
  }

  const playerEl = document.createElement('div');
  playerEl.className = 'player';
  boardEl.appendChild(playerEl);

  // 矢印ハイライト(ヒント用)。普段は非表示。
  const hintArrowEl = document.createElement('div');
  hintArrowEl.className = 'hint-arrow';
  hintArrowEl.hidden = true;
  boardEl.appendChild(hintArrowEl);

  return {
    boardEl,
    level,
    tileSize,
    playerEl,
    hintArrowEl,
    boxEls: [], // { el, x, y } の配列(前回位置を覚えておき、再利用して動かす)
  };
}

function placeEl(el, x, y, tileSize) {
  el.style.left = `${x * tileSize}px`;
  el.style.top = `${y * tileSize}px`;
}

/**
 * 現在のゲーム状態を盤面に反映する。boxViewの箱要素は前回位置と現在位置を
 * 突き合わせて使い回す(同じ位置の箱はそのまま、無くなった位置↔増えた位置を
 * ペアリングして移動アニメーションさせる)。
 */
export function renderBoard(view, game, deadBoxes) {
  const { boardEl, tileSize } = view;
  placeEl(view.playerEl, game.player.x, game.player.y, tileSize);

  const prevBoxes = view.boxEls;
  const nextKeys = [...game.boxes];
  const prevKeys = prevBoxes.map((b) => `${b.x},${b.y}`);

  const unchanged = [];
  const remainingNext = [];
  for (const key of nextKeys) {
    const idx = prevKeys.indexOf(key);
    if (idx >= 0) {
      unchanged.push(prevBoxes[idx]);
      prevKeys[idx] = null; // 使用済み
    } else {
      remainingNext.push(key);
    }
  }
  const remainingPrev = prevBoxes.filter((_, i) => prevKeys[i] !== null);

  const nextBoxEls = [...unchanged];
  remainingNext.forEach((key, i) => {
    const [x, y] = key.split(',').map(Number);
    const reused = remainingPrev[i];
    const el = reused ? reused.el : document.createElement('div');
    if (!reused) {
      el.className = 'box';
      boardEl.appendChild(el);
    }
    placeEl(el, x, y, tileSize);
    nextBoxEls.push({ el, x, y });
  });
  // 余った要素(箱の総数は変わらない設計なので通常は発生しないが念のため除去)
  for (let i = remainingNext.length; i < remainingPrev.length; i++) {
    remainingPrev[i].el.remove();
  }

  for (const b of nextBoxEls) {
    const key = `${b.x},${b.y}`;
    b.el.classList.toggle('on-goal', game.level.goals.has(key));
    b.el.classList.toggle('dead', Boolean(deadBoxes && deadBoxes.has(key)));
  }

  view.boxEls = nextBoxEls;
}

/** ヒントの矢印を箱の位置・方向に合わせて表示する。nullなら非表示。 */
export function renderHint(view, hint) {
  const { hintArrowEl, tileSize } = view;
  if (!hint || !hint.box) {
    hintArrowEl.hidden = true;
    return;
  }
  const [x, y] = hint.box.split(',').map(Number);
  hintArrowEl.hidden = false;
  hintArrowEl.dataset.dir = hint.dir;
  hintArrowEl.textContent = { up: '↑', down: '↓', left: '←', right: '→' }[hint.dir] || '';
  placeEl(hintArrowEl, x, y, tileSize);
}

/** HUD(レベル名・歩数・押し数・パー)を更新する。 */
export function renderHud(ui, levelDef, game) {
  ui.levelNameEl.textContent = levelDef.name;
  ui.movesEl.textContent = String(game.moves);
  ui.pushesEl.textContent = String(game.pushes);
  ui.parEl.textContent = String(levelDef.par);
}

/** 詰み警告バナーの表示/非表示。 */
export function renderWarning(ui, hasDeadBoxes) {
  ui.warningEl.hidden = !hasDeadBoxes;
}

/** クリアオーバーレイの表示。 */
export function showClearOverlay(ui, { pushes, moves, par, best, isNewBest }) {
  const diff = pushes - par;
  const diffText = diff === 0 ? 'パーどおり!' : diff > 0 ? `パー+${diff}` : `パー${diff}`;
  ui.clearStatsEl.textContent = `押し数 ${pushes}(${diffText}) ・ 歩数 ${moves}`;
  ui.clearBestEl.textContent = isNewBest
    ? 'ベスト更新!'
    : best
      ? `ベスト: ${best.bestPushes}押し / ${best.bestMoves}歩`
      : '';
  ui.clearOverlayEl.hidden = false;
}

export function hideClearOverlay(ui) {
  ui.clearOverlayEl.hidden = true;
}

/** 画面(レベル選択/プレイ)の切り替え。 */
export function showScreen(screens, name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}
