// render.js — DOM描画層(状態を読むだけ。ゲーム状態は一切変更しない)
//
// 方針は nine-grid と同じ DOM UI(ターン制・文字中心 → nine-grid adr/0004)。
// このモジュールは「DOMを組み立てる」「状態をDOMに反映する」だけを担い、
// イベントハンドラの登録(=入力)は main.js が行う。
// 唯一の例外として、reveal(1マスずつめくる)のアニメーションだけは
// ここで setTimeout を使う(architecture.md §7。rAFループは不要)。

/** 1マスめくりの間隔 [ms](game-design.md §8: 0.25s)。 */
export const REVEAL_INTERVAL = 250;

/**
 * 盤面(tries行 × length列)を生成して返す。
 * @param {HTMLElement} boardEl - 盤面のコンテナ(空にして作り直す)
 * @param {object} config - defaultConfig()
 * @returns {HTMLElement[][]} rows[r][c] のセル要素
 */
export function buildBoard(boardEl, config) {
  boardEl.textContent = '';
  boardEl.style.setProperty('--cols', String(config.length));
  const rows = [];
  for (let r = 0; r < config.tries; r++) {
    const row = [];
    for (let c = 0; c < config.length; c++) {
      const cell = document.createElement('div');
      cell.className = 'tile';
      boardEl.appendChild(cell);
      row.push(cell);
    }
    rows.push(row);
  }
  return rows;
}

// 50音表の列(あ行→わ行)。や行・わ行は歯抜けなので null で段を合わせる。
// 画面には「右から左へ あ行・か行…」で並べる(game-design.md §5)ため、
// main/render 側では逆順に描画する。
const KANA_COLUMNS = [
  ['あ', 'い', 'う', 'え', 'お'],
  ['か', 'き', 'く', 'け', 'こ'],
  ['さ', 'し', 'す', 'せ', 'そ'],
  ['た', 'ち', 'つ', 'て', 'と'],
  ['な', 'に', 'ぬ', 'ね', 'の'],
  ['は', 'ひ', 'ふ', 'へ', 'ほ'],
  ['ま', 'み', 'む', 'め', 'も'],
  ['や', null, 'ゆ', null, 'よ'],
  ['ら', 'り', 'る', 'れ', 'ろ'],
  ['わ', null, null, null, 'ん'],
];

/**
 * 50音の画面キーボードを生成して返す。
 * @param {HTMLElement} kbEl - キーボードのコンテナ
 * @returns {Map<string, HTMLButtonElement>} かな → キー要素(色反映用)
 */
export function buildKeyboard(kbEl) {
  kbEl.textContent = '';
  const keys = new Map();
  // 右がわ(あ行)から読む日本語の50音表に合わせ、DOM(左→右)へは逆順で置く
  for (const column of [...KANA_COLUMNS].reverse()) {
    const colEl = document.createElement('div');
    colEl.className = 'kb-col';
    for (const kana of column) {
      if (kana === null) {
        const spacer = document.createElement('span');
        spacer.className = 'kb-gap';
        colEl.appendChild(spacer);
        continue;
      }
      const btn = document.createElement('button');
      btn.className = 'key';
      btn.dataset.kana = kana;
      btn.textContent = kana;
      colEl.appendChild(btn);
      keys.set(kana, btn);
    }
    kbEl.appendChild(colEl);
  }
  return keys;
}

/** 1マスへ内容と判定を反映する。mark が null なら入力中/空マス扱い。 */
function paintTile(cell, kana, mark) {
  cell.textContent = kana || '';
  cell.classList.toggle('filled', Boolean(kana));
  cell.classList.remove('hit', 'blow', 'miss', 'close');
  if (mark) {
    cell.classList.add(mark.state);
    if (mark.close) {
      cell.classList.add('close');
      // 「おしい」バッジ(太枠+右上の ゛?)。CSSの ::after で描く手もあるが、
      // textContent で消えるため子要素として付け直す
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '゛?';
      cell.appendChild(badge);
    }
  }
}

/**
 * ゲーム状態を盤面と画面キーボードへ反映する。毎回全面更新(32マスなら十分軽い)。
 * @param {object} game - ゲーム状態(読み取りのみ)
 * @param {object} ui - { rows, keys }
 * @param {number} [animateRow] - このindexの行だけ1マスずつ遅延させてめくる
 */
export function render(game, ui, animateRow = -1) {
  const { rows, keys } = ui;

  for (let r = 0; r < rows.length; r++) {
    const guess = game.guesses[r];
    for (let c = 0; c < rows[r].length; c++) {
      const cell = rows[r][c];
      if (guess) {
        if (r === animateRow) {
          // めくり演出: 中身は先に消し、1マスずつ時間差で確定表示する
          paintTile(cell, '', null);
          setTimeout(() => {
            paintTile(cell, guess.kanas[c], guess.marks[c]);
            cell.classList.add('flip');
          }, c * REVEAL_INTERVAL);
        } else {
          paintTile(cell, guess.kanas[c], guess.marks[c]);
        }
      } else if (r === game.guesses.length) {
        paintTile(cell, game.current[c], null); // 入力中の行
      } else {
        paintTile(cell, '', null);
      }
    }
  }

  // キーボードの色(hit > blow > miss。close は反映しない → game-design.md §6)
  for (const [kana, btn] of keys) {
    btn.classList.remove('hit', 'blow', 'miss');
    const state = game.keyboard[kana];
    if (state) btn.classList.add(state);
  }
}

/** reveal 演出の合計時間 [ms](終局オーバーレイの表示待ちに使う)。 */
export function revealDuration(config) {
  return config.length * REVEAL_INTERVAL + 150;
}

let toastTimer = 0;

/** トーストを表示する(前のトーストは上書き)。 */
export function showToast(toastEl, message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

/** 盤面をシェイクする(CSSアニメーションのクラスを付け直すだけ)。 */
export function shake(boardEl) {
  boardEl.classList.remove('shake');
  void boardEl.offsetWidth; // リフロー強制でアニメーションを再発火させる定石
  boardEl.classList.add('shake');
}
