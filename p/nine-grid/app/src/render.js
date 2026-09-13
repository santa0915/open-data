// render.js — DOM描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// 本作の描画は Canvas ではなく DOM(9×9のボタングリッド)。理由は
// docs/adr/0004-dom-ui.md を参照(ターン制・文字中心・フォーカス管理)。
// このモジュールは「DOMを組み立てる」「状態をDOMに反映する」だけを担い、
// イベントハンドラの登録(=入力)は main.js が行う。

import { remainingCounts } from './game.js';

/**
 * 盤面(81ボタン)と数字パッド(9ボタン)を生成して返す。
 * @param {HTMLElement} boardEl - 盤面のコンテナ(空にして作り直す)
 * @param {HTMLElement} padEl - 数字パッドのコンテナ
 * @returns {{ cells: HTMLButtonElement[], padButtons: HTMLButtonElement[] }}
 */
export function buildBoard(boardEl, padEl) {
  boardEl.textContent = '';
  const cells = [];
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.index = String(i);
    // 3×3ブロックの太罫線はCSSクラスで表現する
    const r = Math.floor(i / 9);
    const c = i % 9;
    if (c % 3 === 0 && c !== 0) cell.classList.add('block-left');
    if (r % 3 === 0 && r !== 0) cell.classList.add('block-top');
    boardEl.appendChild(cell);
    cells.push(cell);
  }

  padEl.textContent = '';
  const padButtons = [];
  for (let d = 1; d <= 9; d++) {
    const btn = document.createElement('button');
    btn.className = 'pad';
    btn.dataset.digit = String(d);
    const digit = document.createElement('span');
    digit.className = 'pad-digit';
    digit.textContent = String(d);
    const count = document.createElement('span');
    count.className = 'pad-count';
    btn.append(digit, count);
    padEl.appendChild(btn);
    padButtons.push(btn);
  }
  return { cells, padButtons };
}

/** メモ(候補ビットマスク)を3×3のミニ数字で表示する要素を作る。 */
function renderNotes(mask) {
  const wrap = document.createElement('span');
  wrap.className = 'notes';
  for (let d = 1; d <= 9; d++) {
    const s = document.createElement('span');
    s.textContent = mask & (1 << d) ? String(d) : '';
    wrap.appendChild(s);
  }
  return wrap;
}

/** ゲーム状態を盤面・パッド・HUDへ反映する。毎回全面更新(81マスなら十分軽い)。 */
export function render(game, ui) {
  const { cells, padButtons, noteBtn, timeEl, diffEl, hintsEl } = ui;
  const sel = game.selected;
  const selValue = sel >= 0 ? game.board[sel] : 0;
  const selRow = Math.floor(sel / 9);
  const selCol = sel % 9;
  const selBox = sel >= 0 ? Math.floor(selRow / 3) * 3 + Math.floor(selCol / 3) : -1;

  for (let i = 0; i < 81; i++) {
    const cell = cells[i];
    const v = game.board[i];

    cell.textContent = '';
    if (v) cell.textContent = String(v);
    else if (game.notes[i]) cell.appendChild(renderNotes(game.notes[i]));

    const r = Math.floor(i / 9);
    const c = i % 9;
    const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    cell.classList.toggle('given', game.givens[i] !== 0);
    cell.classList.toggle('selected', i === sel);
    cell.classList.toggle(
      'peer',
      sel >= 0 && i !== sel && (r === selRow || c === selCol || box === selBox)
    );
    cell.classList.toggle('same', selValue !== 0 && v === selValue && i !== sel);
    cell.classList.toggle('conflict', game.conflicts.has(i));
  }

  const counts = remainingCounts(game);
  padButtons.forEach((btn, k) => {
    const d = k + 1;
    btn.querySelector('.pad-count').textContent = String(counts[d]);
    btn.classList.toggle('exhausted', counts[d] <= 0);
  });

  noteBtn.classList.toggle('active', game.noteMode);
  timeEl.textContent = formatTime(game.elapsed);
  diffEl.textContent = game.config.difficulties[game.difficulty].name;
  hintsEl.textContent = String(game.hintsUsed);
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
}
