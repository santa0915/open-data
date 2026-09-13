// render.js — DOM描画層(状態を読むだけ。ロジック状態は一切変更しない)
//
// 方針は姉妹作(ichimon 等)と同じ: このモジュールは「状態をDOMに反映する」
// だけを担い、イベントハンドラの登録(=入力)は main.js が行う。
// 画面はタイトル/役職配布/夜/朝/昼/投票/結果の7つ(architecture.md §6)。
// 単一HTML内のセクションを hidden の付け外しで切り替える。
//
// キャラの見た目は「色付き丸+目」のみ(豆型・宇宙服輪郭・バイザーは禁止 —
// docs/adr/0002)。ここで完結させ、Canvasは使わない(DOM要素+CSSのみ)。

// 役職の日本語ラベル・簡単な説明(役職配布カード・結果画面の役職公開用)。
// text.js にも同種のマップがあるが、UI層はロジック層(text.js)に依存を
// 増やさずここで完結させる(小さな定数の重複はUI都合として許容する)。
const ROLE_LABEL = { wolf: '侵入者', seer: '調査員', guard: '警備員', crew: '乗組員' };
const ROLE_DESC = {
  wolf: '夜に1人を襲う。正体を隠して切り抜けろ。',
  seer: '夜に1人の正体を知ることができる。',
  guard: '夜に1人を護衛できる(連続で同じ人は守れない)。',
  crew: '特別な力はない。話し合いと投票で侵入者を見抜こう。',
};

/** 画面(セクション)を切り替える。screens = { name: el, ... }。 */
export function showScreen(screens, name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * キャラアバター(色付き丸+目)を作る。size省略時は既定サイズ。
 * dead=true なら灰色化+目を閉じた線にする(死亡表示)。
 */
export function characterAvatar(player, { size = 40, dead = false } = {}) {
  const wrap = el('div', 'avatar');
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.style.background = dead ? '#4a5166' : player.color;
  if (dead) wrap.classList.add('dead');

  const eyeSize = Math.max(3, Math.round(size * 0.12));
  const eyeGap = size * 0.28;
  for (const side of [-1, 1]) {
    const eye = el('div', dead ? 'eye eye-closed' : 'eye');
    eye.style.width = `${eyeSize}px`;
    eye.style.height = `${eyeSize}px`;
    eye.style.left = `calc(50% + ${side * eyeGap}px - ${eyeSize / 2}px)`;
    wrap.appendChild(eye);
  }
  return wrap;
}

/** 役職バッジ(色つきの短いラベル)。 */
function roleBadge(role) {
  const badge = el('span', `role-badge role-${role}`, ROLE_LABEL[role] ?? role);
  return badge;
}

// --- 役職配布 ---------------------------------------------------------------

/** 役職配布画面を更新する。humanIndex=-1(観戦専用)は本作のUIでは使わない前提。 */
export function renderReveal(ui, game) {
  const me = game.players[game.humanIndex];
  ui.revealAvatar.textContent = '';
  ui.revealAvatar.appendChild(characterAvatar(me, { size: 72 }));
  ui.revealName.textContent = me.name;
  ui.revealRoleBadge.textContent = '';
  ui.revealRoleBadge.appendChild(roleBadge(me.role));
  ui.revealDesc.textContent = ROLE_DESC[me.role] ?? '';

  if (me.role === 'wolf') {
    const partner = game.players.find((p) => p.role === 'wolf' && p.id !== me.id);
    ui.revealPartner.hidden = false;
    ui.revealPartner.textContent = `相方の侵入者は「${partner.name}」だ。`;
  } else {
    ui.revealPartner.hidden = true;
  }
}

// --- 生存者一覧(色アイコン+名前+CO/死亡バッジ) -------------------------------

export function renderSurvivorRow(ui, game) {
  ui.survivorRow.textContent = '';
  for (const p of game.players) {
    const card = el('div', 'survivor-card');
    if (!p.alive) card.classList.add('is-dead');
    card.appendChild(characterAvatar(p, { size: 40, dead: !p.alive }));
    const name = el('div', 'survivor-name', p.name);
    card.appendChild(name);
    const badges = el('div', 'survivor-badges');
    if (p.coSeer) badges.appendChild(el('span', 'badge badge-co', 'CO'));
    if (!p.alive) badges.appendChild(el('span', 'badge badge-dead', '死亡'));
    card.appendChild(badges);
    ui.survivorRow.appendChild(card);
  }
}

// --- 船内ログ ---------------------------------------------------------------

/** ログに1行追加し、自動スクロールする(発言はアイコン+名前+セリフ形式)。 */
export function appendLogLine(ui, text, { actorId, players } = {}) {
  const row = el('div', 'log-row');
  if (actorId !== null && actorId !== undefined && players) {
    row.appendChild(characterAvatar(players[actorId], { size: 24 }));
  }
  row.appendChild(el('span', 'log-text', text));
  ui.shipLog.appendChild(row);
  ui.shipLog.scrollTop = ui.shipLog.scrollHeight;
}

// --- 夜 -----------------------------------------------------------------

const NIGHT_PROMPT = {
  guard: '護衛する相手を選ぼう(連続で同じ相手は守れない)。',
  wolf: '襲撃する相手を選ぼう。',
  seer: '調査する相手を選ぼう。',
};

/** 夜画面: 自分の役職行動が必要なら選択肢を、無ければ待機表示を出す。 */
export function renderNight(ui, game) {
  const me = game.players[game.humanIndex];
  const waiting = !(game.pendingInput && game.pendingInput.type === 'night');
  ui.nightWaiting.hidden = !waiting;
  ui.nightPicker.hidden = waiting;
  if (waiting) {
    ui.nightWaitingText.textContent =
      me.role === 'crew' || !me.alive
        ? '夜がふけていく…朝を待とう。'
        : '他の乗組員たちが夜の行動を終えるのを待っている…';
    return;
  }
  ui.nightPrompt.textContent = NIGHT_PROMPT[me.role] ?? '';
  ui.nightOptions.textContent = '';
  for (const id of game.pendingInput.options) {
    const target = game.players[id];
    const btn = el('button', 'target-btn');
    btn.type = 'button';
    btn.dataset.target = String(id);
    btn.appendChild(characterAvatar(target, { size: 32 }));
    btn.appendChild(el('span', null, target.name));
    ui.nightOptions.appendChild(btn);
  }
}

// --- 朝 -----------------------------------------------------------------

export function renderMorning(ui, game) {
  const last = [...game.log].reverse().find((l) => l.entry.kind === 'death' || l.entry.kind === 'noDeath');
  ui.morningSummary.textContent = '';
  if (last && last.entry.kind === 'death') {
    const victim = game.players[last.entry.target];
    ui.morningSummary.appendChild(characterAvatar(victim, { size: 40, dead: true }));
    ui.morningSummary.appendChild(
      el('p', null, `${victim.name}が夜のうちに襲われた。正体は${ROLE_LABEL[last.entry.role]}だった。`),
    );
  } else {
    ui.morningSummary.appendChild(el('p', null, '今朝は誰も欠けていない。犠牲者は出なかった。'));
  }

  const me = game.players[game.humanIndex];
  const myResult = me.role === 'seer'
    ? game.investigations.find((r) => r.seerId === me.id && r.day === game.day)
    : null;
  ui.morningSeerResult.hidden = !myResult;
  if (myResult) {
    const target = game.players[myResult.target];
    ui.morningSeerResult.textContent = '';
    ui.morningSeerResult.appendChild(characterAvatar(target, { size: 28 }));
    ui.morningSeerResult.appendChild(
      el('span', null, `調査結果: ${target.name}は${myResult.isWolf ? '侵入者だった' : '侵入者ではなかった'}。`),
    );
  }
}

// --- 昼(発言メニュー) -------------------------------------------------------

/** 発言メニューの二段(kind選択→対象選択)+reportのみ三段目(真偽選択)。 */
export function renderStatementMenu(ui, game, stage) {
  const isMyTurn = game.pendingInput && game.pendingInput.type === 'statement'
    && game.turnOrder[game.turnCursor] === game.humanIndex;

  ui.dayWaiting.hidden = isMyTurn;
  ui.statementMenu.hidden = !isMyTurn;
  if (!isMyTurn) return;

  const { kinds, targets } = game.pendingInput.options;

  const showKinds = !stage.kind;
  const showTargets = stage.kind && ['suspect', 'trust', 'report'].includes(stage.kind) && stage.target === null;
  const showTruth = stage.kind === 'report' && stage.target !== null && stage.isWolf === null;

  ui.statementKinds.hidden = !showKinds;
  ui.statementTargets.hidden = !showTargets;
  ui.statementTruth.hidden = !showTruth;
  ui.statementBack.hidden = showKinds;

  if (showKinds) {
    ui.statementKinds.textContent = '';
    const labels = {
      'co-seer': '「わたしは調査員だ」とCOする',
      report: '調査結果を報告する',
      suspect: '「あやしい」と言う',
      trust: '「信じる」と言う',
      pass: '様子を見る(パス)',
    };
    for (const kind of kinds) {
      const btn = el('button', 'menu-btn', labels[kind] ?? kind);
      btn.type = 'button';
      btn.dataset.kind = kind;
      ui.statementKinds.appendChild(btn);
    }
  }

  if (showTargets) {
    ui.statementTargets.textContent = '';
    for (const id of targets) {
      const target = game.players[id];
      const btn = el('button', 'target-btn');
      btn.type = 'button';
      btn.dataset.target = String(id);
      btn.appendChild(characterAvatar(target, { size: 32 }));
      btn.appendChild(el('span', null, target.name));
      ui.statementTargets.appendChild(btn);
    }
  }

  if (showTruth) {
    ui.statementTruth.textContent = '';
    const targetName = game.players[stage.target].name;
    for (const [value, label] of [[true, `${targetName}は侵入者だ`], [false, `${targetName}は侵入者ではない`]]) {
      const btn = el('button', 'menu-btn', label);
      btn.type = 'button';
      btn.dataset.truth = String(value);
      ui.statementTruth.appendChild(btn);
    }
  }
}

// --- 投票 -----------------------------------------------------------------

export function renderVoteHeading(ui, game) {
  ui.voteHeading.textContent = game.phase === 'runoff' ? '決選投票(同数のためもう一度)' : '投票';
}

export function renderVotePicker(ui, game) {
  const waiting = !(game.pendingInput && game.pendingInput.type === 'vote');
  ui.voteWaiting.hidden = !waiting;
  ui.votePicker.hidden = waiting;
  if (waiting) return;

  ui.voteOptions.textContent = '';
  for (const id of game.pendingInput.options) {
    const target = game.players[id];
    const btn = el('button', 'target-btn');
    btn.type = 'button';
    btn.dataset.target = String(id);
    btn.appendChild(characterAvatar(target, { size: 32 }));
    btn.appendChild(el('span', null, target.name));
    ui.voteOptions.appendChild(btn);
  }
}

// --- 結果 -----------------------------------------------------------------

export function renderResult(ui, game, stats) {
  ui.resultBanner.textContent = game.winner === 'crew' ? 'クルー側の勝利!' : '侵入者側の勝利…';
  ui.resultBanner.className = game.winner === 'crew' ? 'result-banner win' : 'result-banner lose';

  ui.resultRoster.textContent = '';
  for (const p of game.players) {
    const row = el('div', 'result-row');
    if (!p.alive) row.classList.add('is-dead');
    row.appendChild(characterAvatar(p, { size: 32, dead: !p.alive }));
    row.appendChild(el('span', 'result-name', p.name));
    row.appendChild(roleBadge(p.role));
    if (!p.alive) row.appendChild(el('span', 'badge badge-dead', '死亡'));
    if (p.id === game.humanIndex) row.appendChild(el('span', 'badge badge-you', 'あなた'));
    ui.resultRoster.appendChild(row);
  }

  ui.resultStats.textContent = '';
  ui.resultStats.appendChild(el('p', null, `通算プレイ数: ${stats.plays}`));
  ui.resultStats.appendChild(el('p', null, `クルー側勝利: ${stats.crewWins}  /  侵入者側勝利: ${stats.wolfWins}`));
}
