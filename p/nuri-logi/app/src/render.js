// render.js — DOM描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// 2画面構成: パズル選択(12問グリッド)とプレイ画面。プレイ画面はCSS Gridで
// 「左上コーナー(空)+ 列クルー(上段)+ 行クルー(左列)+ セル本体」の
// (w+1)×(h+1)マスを1つのグリッドとして組み立てる(architecture.md §6)。
// セルサイズは呼び出し側(main.js)がconfig.jsの目安(44/32/24px、下限22px)から
// 計算して渡す。

const CELL_LABEL = { 0: '', 1: '', 2: '×' }; // CELL.UNKNOWN/FILLED/CROSS の表示文字(FILLEDはCSS背景で表現)

/** パズル選択画面: 12問のカードを組み立てる(クリックはmain.js側)。 */
export function renderPuzzleSelect(gridEl, puzzles, progress) {
  gridEl.textContent = '';
  puzzles.forEach((puzzle, i) => {
    const card = document.createElement('button');
    card.className = 'puzzle-card';
    card.dataset.puzzleIndex = String(i);

    const prog = progress[i] || {};
    const thumb = document.createElement('div');
    thumb.className = 'puzzle-thumb';

    if (prog.cleared) {
      card.classList.add('cleared');
      thumb.appendChild(buildThumbnail(puzzle));
    } else {
      thumb.textContent = '?';
      thumb.classList.add('unknown');
    }

    const meta = document.createElement('div');
    meta.className = 'puzzle-meta';
    const name = document.createElement('span');
    name.className = 'puzzle-name';
    name.textContent = prog.cleared ? puzzle.name : `${puzzle.grid.length}×${puzzle.grid.length}`;
    meta.appendChild(name);

    if (prog.cleared) {
      const stat = document.createElement('span');
      stat.className = 'puzzle-stat';
      stat.textContent = `${formatTime(prog.bestTimeSec)} ・ ヒント${prog.hintsUsed}回`;
      meta.appendChild(stat);
    }

    card.append(thumb, meta);
    gridEl.appendChild(card);
  });
}

/** クリア済みパズルのミニ完成絵(DOMピクセルグリッド)を組み立てる。 */
function buildThumbnail(puzzle) {
  const h = puzzle.grid.length;
  const w = puzzle.grid[0].length;
  const mini = document.createElement('div');
  mini.className = 'thumb-grid';
  mini.style.setProperty('--thumb-cols', w);
  mini.style.setProperty('--thumb-rows', h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = document.createElement('div');
      if (puzzle.grid[y][x] === '#') px.style.background = puzzle.color;
      mini.appendChild(px);
    }
  }
  return mini;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * プレイ画面の盤面DOMを新規に組み立てる(パズルを切り替えるたびに呼ぶ)。
 * @param {HTMLElement} container - 盤面全体を入れる要素
 * @param {object} puzzle - parsePuzzleの結果
 * @param {number} cellSize - このパズルで使うセルサイズ[px]
 * @param {number} thickEvery - 太罫線の間隔(config.render.thickLineEvery)
 */
export function createBoardView(container, puzzle, cellSize, thickEvery) {
  container.textContent = '';
  container.className = 'nonogram';
  container.style.setProperty('--cell', `${cellSize}px`);
  container.style.gridTemplateColumns = `auto repeat(${puzzle.w}, var(--cell))`;
  container.style.gridTemplateRows = `auto repeat(${puzzle.h}, var(--cell))`;

  // 左上コーナー(空)
  const corner = document.createElement('div');
  corner.className = 'corner';
  container.appendChild(corner);

  // 列クルー(上段。数字は縦に積む)
  const colClueEls = [];
  for (let x = 0; x < puzzle.w; x++) {
    const el = document.createElement('div');
    el.className = 'clue clue-col';
    if ((x + 1) % thickEvery === 0 && x !== puzzle.w - 1) el.classList.add('thick-right');
    for (const n of puzzle.clues.cols[x]) {
      const span = document.createElement('span');
      span.textContent = String(n);
      el.appendChild(span);
    }
    container.appendChild(el);
    colClueEls.push(el);
  }

  // 行クルー(左列。数字は横に並べる)+ セル本体
  const rowClueEls = [];
  const cellEls = new Array(puzzle.w * puzzle.h);
  for (let y = 0; y < puzzle.h; y++) {
    const rowClue = document.createElement('div');
    rowClue.className = 'clue clue-row';
    if ((y + 1) % thickEvery === 0 && y !== puzzle.h - 1) rowClue.classList.add('thick-bottom');
    for (const n of puzzle.clues.rows[y]) {
      const span = document.createElement('span');
      span.textContent = String(n);
      rowClue.appendChild(span);
    }
    container.appendChild(rowClue);
    rowClueEls.push(rowClue);

    for (let x = 0; x < puzzle.w; x++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      if ((x + 1) % thickEvery === 0 && x !== puzzle.w - 1) cell.classList.add('thick-right');
      if ((y + 1) % thickEvery === 0 && y !== puzzle.h - 1) cell.classList.add('thick-bottom');
      container.appendChild(cell);
      cellEls[y * puzzle.w + x] = cell;
    }
  }

  return { container, puzzle, cellSize, cellEls, rowClueEls, colClueEls };
}

/** 現在のcells配列を盤面DOMへ反映する(未定/塗り/×の見た目切り替え)。 */
export function renderCells(view, board) {
  const { puzzle, cellEls } = view;
  for (let i = 0; i < cellEls.length; i++) {
    const v = board.cells[i];
    const el = cellEls[i];
    el.classList.toggle('filled', v === 1);
    el.classList.toggle('crossed', v === 2);
    el.textContent = CELL_LABEL[v] || '';
  }
  void puzzle;
}

/** 行/列が数字どおりに完成しているか(isLineSatisfied)をクルー表示の濃淡に反映する。 */
export function renderClueDim(view, satisfiedRows, satisfiedCols) {
  view.rowClueEls.forEach((el, y) => el.classList.toggle('dim', satisfiedRows[y]));
  view.colClueEls.forEach((el, x) => el.classList.toggle('dim', satisfiedCols[x]));
}

/** ヒントのハイライト。type: 'mistake'(赤点滅) | 'deduce'(緑点滅) | null(消灯)。 */
export function renderHintHighlight(view, hint) {
  for (const el of view.cellEls) el.classList.remove('hint-mistake', 'hint-deduce');
  if (!hint) return;
  const idx = hint.y * view.puzzle.w + hint.x;
  view.cellEls[idx].classList.add(hint.type === 'mistake' ? 'hint-mistake' : 'hint-deduce');
}

/**
 * クリア演出を段階的に発火する(game-design.md §5):
 * 1) グリッド線・×がフェードアウト 2) 塗りマスが問題色に彩色
 * 3) コールバックで名前・タイム・ヒント数を表示
 */
export function playClearSequence(view, colorFadeMs, colorizeMs, onDone) {
  view.container.style.setProperty('--clear-color', view.puzzle.color);
  view.container.classList.add('clearing');
  setTimeout(() => {
    view.container.classList.add('colored');
    setTimeout(onDone, colorizeMs);
  }, colorFadeMs);
}

/** プレイ画面へ戻る際、クリア演出用のクラスを剥がす(次回の再生に備える)。 */
export function resetClearSequence(view) {
  view.container.classList.remove('clearing', 'colored');
}

export function showClearOverlay(ui, { name, timeSec, hintsUsed, best, isNewBest }) {
  ui.clearNameEl.textContent = name;
  ui.clearStatsEl.textContent = `タイム ${formatTime(timeSec)} ・ ヒント${hintsUsed}回`;
  ui.clearBestEl.textContent = isNewBest
    ? 'ベスト更新!'
    : best
      ? `ベスト: ${formatTime(best.bestTimeSec)}`
      : '';
  ui.clearOverlayEl.hidden = false;
}

export function hideClearOverlay(ui) {
  ui.clearOverlayEl.hidden = true;
}

/** 画面(パズル選択/プレイ)の切り替え。 */
export function showScreen(screens, name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

/** ツール切替ボタンの見た目(押されている方を強調)。 */
export function renderToolButtons(ui, tool) {
  ui.toolFillBtn.classList.toggle('active', tool === 'fill');
  ui.toolCrossBtn.classList.toggle('active', tool === 'cross');
}

/** タイマー表示(mm:ss)。 */
export function renderTimer(ui, sec) {
  ui.hudTimerEl.textContent = formatTime(sec);
}
