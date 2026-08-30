// render.js — DOM描画層(状態を読むだけ。ロジック状態は一切変更しない)
//
// 方針は姉妹作(yomoji / nine-grid)と同じ: このモジュールは「状態をDOMに
// 反映する」だけを担い、イベントハンドラの登録(=入力)は main.js が行う。
// 画面は4つ(home / quiz / result / stats)。単一HTML内のセクションを
// hidden の付け外しで切り替える(architecture.md §6)。

import { parseRuby } from './ruby.js';
import { current } from './session.js';
import { CONFIG } from './config.js';

/** 画面を切り替える。screens = { home: el, quiz: el, result: el, stats: el }。 */
export function showScreen(screens, name) {
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

/** 要素生成の小さなヘルパ。 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * ルビ記法テキストを DocumentFragment に変換する。
 * parseRuby(純関数)の結果から <ruby>漢字<rt>かんじ</rt></ruby> を組み立てる。
 */
export function rubyFragment(text) {
  const frag = document.createDocumentFragment();
  for (const seg of parseRuby(text)) {
    if (seg.ruby) {
      const ruby = el('ruby');
      ruby.append(seg.text);
      ruby.appendChild(el('rt', null, seg.ruby));
      frag.appendChild(ruby);
    } else {
      frag.append(seg.text);
    }
  }
  return frag;
}

/** 偏差値を5刻みの帯表示にする(例: 57 → '偏差値55〜60')。 */
function bandText(hensachi) {
  const { hensachiMin, hensachiMax } = CONFIG;
  const start = Math.min(
    Math.max(Math.floor((hensachi - hensachiMin) / 5) * 5 + hensachiMin, hensachiMin),
    hensachiMax - 5
  );
  return `偏差値${start}〜${start + 5}`;
}

/** 正答率を '85%' 形式にする。 */
function pct(accuracy) {
  return `${Math.round(accuracy * 100)}%`;
}

/** pack.areas から分野名を引く。 */
function areaName(pack, areaId) {
  const area = pack.areas.find((a) => a.id === areaId);
  return area ? area.name : areaId;
}

// 出題形式の表示名(product-design.md §4.5)
export const TYPE_LABELS = {
  recall: '一問一答',
  choice: '4たく',
  written: 'きじゅつ',
  ordering: 'ならべかえ',
};

/** 問題のtype(省略はrecall — v1パック互換)。 */
function typeOf(question) {
  return question.type === undefined ? 'recall' : question.type;
}

// --- home ---------------------------------------------------------------

/**
 * ホーム画面を状態に合わせて更新する。
 * @param {object} ui - main.js が集めたDOM要素の束
 * @param {{ packs: object[], pack: object, settings, dueByPack: Object.<string,number> }} state
 *   packs: 登録済みパック一覧 / pack: 選択中のパック /
 *   dueByPack: パックIDごとの復習待ち件数(教科カードのバッジ用)
 */
export function renderHome(ui, { packs, pack, settings, dueByPack }) {
  // 教科カード(パック登録配列から生成。タップで教科を選ぶ)
  ui.subjectCards.textContent = '';
  for (const p of packs) {
    const card = el('button', 'card subject-card');
    card.type = 'button';
    card.dataset.pack = p.id;
    card.classList.toggle('on', p.id === pack.id);

    const info = el('div');
    const nameRow = el('div', 'subject-name', p.name);
    // 個人利用パック(adr/0005)は「個人」バッジで配布可能データと視覚的に区別
    if (p.distribution === 'private') nameRow.appendChild(el('span', 'private-badge', '個人'));
    info.appendChild(nameRow);
    const areaNames = p.areas.map((a) => a.name).join('・');
    info.appendChild(el('div', 'subject-note', `${areaNames} ${p.questions.length}問`));
    card.appendChild(info);

    const due = dueByPack[p.id] || 0;
    if (due > 0) card.appendChild(el('span', 'due-badge', `復習待ち ${due}問`));
    ui.subjectCards.appendChild(card);
  }

  // 分野チップ(選択中パックの分野。複数選択トグル)。毎回作り直す
  ui.areaChips.textContent = '';
  for (const area of pack.areas) {
    const chip = el('button', 'chip', area.name);
    chip.type = 'button';
    chip.dataset.area = area.id;
    chip.classList.toggle('on', settings.areas.includes(area.id));
    ui.areaChips.appendChild(chip);
  }

  // 出題形式フィルタ(すべて/一問一答/4たく/きじゅつ/ならべかえ — §4.5)。
  // settings.types は null(=すべて)か [type] の単一選択
  ui.typeChips.textContent = '';
  const selectedType = settings.types == null ? 'all' : settings.types[0];
  for (const [value, label] of [['all', 'すべて'], ...Object.entries(TYPE_LABELS)]) {
    const chip = el('button', 'chip', label);
    chip.type = 'button';
    chip.dataset.type = value;
    chip.classList.toggle('on', value === selectedType);
    ui.typeChips.appendChild(chip);
  }

  // 目標偏差値スライダーと現在値
  ui.targetSlider.value = String(settings.target);
  ui.targetValue.textContent = String(settings.target);

  // モード切替(ふつう / ふくしゅう)
  ui.modeNormal.classList.toggle('on', settings.mode === 'normal');
  ui.modeReview.classList.toggle('on', settings.mode === 'review');

  // おまかせ調整(adaptive)
  ui.adaptiveToggle.classList.toggle('on', settings.adaptive);
}

// --- quiz ---------------------------------------------------------------

/** choice: 選択肢4ボタン(シャッフル済み)。revealed後は正解緑・誤選択赤。 */
function renderChoiceOptions(ui, session, q, view, revealed) {
  ui.choiceOptions.textContent = '';
  for (const option of session.shuffles[q.id]) {
    const btn = el('button', 'option');
    btn.type = 'button';
    btn.dataset.option = option;
    btn.appendChild(rubyFragment(option));
    if (revealed) {
      btn.disabled = true;
      if (option === q.answer) btn.classList.add('correct');
      else if (option === view.picked) btn.classList.add('wrong');
      else btn.classList.add('faded');
    }
    ui.choiceOptions.appendChild(btn);
  }
}

/** ordering(回答中): タップ順に1,2,3,4の番号を振る(adr/0006 §5)。 */
function renderOrderingItems(ui, session, q, view) {
  ui.orderingItems.textContent = '';
  for (const item of session.shuffles[q.id]) {
    const order = view.picks.indexOf(item);
    const btn = el('button', 'order-item');
    btn.type = 'button';
    btn.dataset.item = item;
    btn.classList.toggle('picked', order >= 0);
    btn.disabled = order >= 0; // 選択済みの解除は「やりなおし」で行う
    btn.appendChild(el('span', 'order-num', order >= 0 ? String(order + 1) : '·'));
    btn.appendChild(rubyFragment(item));
    ui.orderingItems.appendChild(btn);
  }
  ui.orderingSubmit.disabled = view.picks.length !== session.shuffles[q.id].length;
}

/** ordering(結果): 自分の順序を位置ごとに✓✗で示し、正しい順序を並記する。 */
function renderOrderingResult(ui, q, arranged) {
  ui.orderingResult.textContent = '';
  arranged.forEach((item, i) => {
    const good = item === q.items[i];
    const row = el('div', 'order-compare-row');
    row.appendChild(el('span', `order-mark ${good ? 'good' : 'bad'}`, good ? '✓' : '✗'));
    const yours = el('span', 'order-yours');
    yours.append(`${i + 1}. `);
    yours.appendChild(rubyFragment(item));
    row.appendChild(yours);
    ui.orderingResult.appendChild(row);
  });
  const correctLine = el('div', 'order-correct-answer');
  correctLine.append('正しい順序: ');
  correctLine.appendChild(rubyFragment(q.items.join('→')));
  ui.orderingResult.appendChild(correctLine);
}

/**
 * 出題画面を session の状態(phase / index / 形式)に合わせて更新する。
 * 形式ごとのフローは product-design.md §4.5:
 *   recall:   問題 → こたえをみる → 答え+解説 → ○×
 *   written:  recallと同じ+模範解答・採点ポイント(全部言えていたら○)
 *   choice:   選択肢タップ(main.jsがsubmitAuto)→ 正解緑・誤選択赤+解説 → つぎへ
 *   ordering: タップ順に番号 → けってい → 位置ごと✓✗+解説 → つぎへ
 * @param {object} view - main.js が持つ回答中のUI状態
 *   { picked: string|null, arranged: string[]|null, picks: string[] }
 */
export function renderQuiz(ui, session, view) {
  const q = current(session);
  if (!q) return;
  const type = typeOf(q);

  // 進捗(3/10)とバー
  const total = session.list.length;
  ui.quizProgressText.textContent = `${session.index + 1} / ${total}`;
  ui.quizProgressBar.style.width = `${(session.index / total) * 100}%`;

  // 形式チップ(recallは表示なし)+分野・偏差値帯の表示
  ui.quizTypeChip.hidden = type === 'recall';
  ui.quizTypeChip.textContent = TYPE_LABELS[type];
  const scale = session.pack.difficultyScale;
  const difficulty = scale === 'stars' ? `★${q.level}` : bandText(q.hensachi);
  ui.quizMeta.textContent = `${areaName(session.pack, q.area)} ・ ${difficulty}`;

  // 問題文(ルビ対応)
  ui.quizQuestion.textContent = '';
  ui.quizQuestion.appendChild(rubyFragment(q.question));

  const revealed = session.phase === 'revealed';
  const selfGraded = type === 'recall' || type === 'written'; // 自己採点系

  // 操作ボタンの出し分け
  ui.revealBtn.hidden = !selfGraded || revealed;
  ui.gradeBtns.hidden = !(selfGraded && revealed);
  ui.gradeHint.hidden = !selfGraded;
  ui.nextBtn.hidden = !(!selfGraded && revealed);

  // choice: 選択肢は回答中も結果表示中も見せ続ける(色で正誤を示す)
  ui.choiceOptions.hidden = type !== 'choice';
  if (type === 'choice') renderChoiceOptions(ui, session, q, view, revealed);

  // ordering: 回答中のみ項目タップUIを見せる(結果は並記表示に切り替え)
  ui.orderingBlock.hidden = type !== 'ordering' || revealed;
  if (type === 'ordering' && !revealed) renderOrderingItems(ui, session, q, view);

  // 答え+解説(revealed のときだけ見せる)
  ui.answerBlock.hidden = !revealed;
  if (revealed) {
    // 大きな答え表示は自己採点系のみ(choiceは緑の選択肢、orderingは並記が答え)
    ui.quizAnswer.hidden = !selfGraded;
    if (selfGraded) {
      ui.quizAnswer.textContent = '';
      ui.quizAnswer.appendChild(rubyFragment(q.answer));
    }

    // written: 採点ポイントの箇条書き
    ui.writtenPoints.hidden = type !== 'written';
    if (type === 'written') {
      ui.writtenPointsList.textContent = '';
      for (const point of q.points) {
        const li = el('li');
        li.appendChild(rubyFragment(point));
        ui.writtenPointsList.appendChild(li);
      }
    }

    // ordering: 位置ごとの✓✗
    ui.orderingResult.hidden = type !== 'ordering';
    if (type === 'ordering') renderOrderingResult(ui, q, view.arranged);

    ui.quizExplanation.textContent = '';
    ui.quizExplanation.appendChild(rubyFragment(q.explanation));
  }
}

// --- result -------------------------------------------------------------

/**
 * 結果画面を更新する。
 * @param {object} ui
 * @param {object} pack - 分野名の解決用
 * @param {{ total, correct, byArea, wrong }} summaryData - session.summary() の戻り値
 */
export function renderResult(ui, pack, summaryData) {
  ui.resultScore.textContent = `${summaryData.correct} / ${summaryData.total}`;
  ui.resultMessage.textContent =
    summaryData.correct === summaryData.total
      ? '全問正解!すばらしい!'
      : summaryData.wrong.length <= 2
        ? 'あと少し!×の問題はわすれたころにまた出るよ'
        : '×の問題はわすれたころにまた出るよ';

  // 分野別内訳
  ui.resultByArea.textContent = '';
  for (const [areaId, v] of Object.entries(summaryData.byArea)) {
    const row = el('div', 'result-area-row');
    row.appendChild(el('span', 'result-area-name', areaName(pack, areaId)));
    row.appendChild(el('span', 'result-area-score', `${v.correct} / ${v.attempts}`));
    ui.resultByArea.appendChild(row);
  }

  // 今回の×一覧(答えつき)
  ui.resultWrongSection.hidden = summaryData.wrong.length === 0;
  ui.resultWrongList.textContent = '';
  for (const q of summaryData.wrong) {
    const item = el('div', 'wrong-item');
    const question = el('div', 'wrong-question');
    question.appendChild(rubyFragment(q.question));
    const answer = el('div', 'wrong-answer');
    answer.append('答え: ');
    answer.appendChild(rubyFragment(q.answer));
    item.appendChild(question);
    item.appendChild(answer);
    ui.resultWrongList.appendChild(item);
  }
  ui.retryWrongBtn.hidden = summaryData.wrong.length === 0;
}

// --- stats --------------------------------------------------------------

/** ラベル+正答率バー(CSS width%)+数値の1行を作る。 */
function statBarRow(label, accuracy, attempts) {
  const row = el('div', 'stat-row');
  row.appendChild(el('span', 'stat-label', label));
  const barWrap = el('div', 'stat-bar');
  const bar = el('div', 'stat-bar-fill');
  bar.style.width = `${Math.round(accuracy * 100)}%`;
  barWrap.appendChild(bar);
  row.appendChild(barWrap);
  row.appendChild(el('span', 'stat-value', `${pct(accuracy)}(${attempts}回)`));
  return row;
}

/**
 * 統計画面を更新する。
 * @param {object} ui
 * @param {object} statsData - stats.overallStats() の戻り値
 * @param {number} due - 復習待ち件数(全パック合計)
 * @param {object[]} packs - 収録パック一覧(個人利用パックのバッジ表示用)
 */
export function renderStats(ui, statsData, due, packs) {
  ui.statsTotals.textContent =
    statsData.totalAnswered === 0
      ? 'まだ回答がありません。ホームからはじめよう!'
      : `総回答数 ${statsData.totalAnswered}回 ・ 正答率 ${pct(statsData.accuracy)} ・ 復習待ち ${due}問`;

  // 収録パック名の一覧(個人利用パックには「個人」バッジ — adr/0005)
  ui.statsPacks.textContent = '収録: ';
  packs.forEach((p, i) => {
    if (i > 0) ui.statsPacks.append(' / ');
    ui.statsPacks.append(p.name);
    if (p.distribution === 'private') ui.statsPacks.appendChild(el('span', 'private-badge', '個人'));
  });

  ui.statsByArea.textContent = '';
  for (const area of statsData.byArea) {
    ui.statsByArea.appendChild(statBarRow(area.name, area.accuracy, area.attempts));
  }
  ui.statsByAreaSection.hidden = statsData.byArea.length === 0;

  ui.statsByBand.textContent = '';
  for (const band of statsData.byBand) {
    ui.statsByBand.appendChild(statBarRow(`偏差値${band.band}`, band.accuracy, band.attempts));
  }
  ui.statsByBandSection.hidden = statsData.byBand.length === 0;

  // 形式別の正答率(byType — v1.3)
  ui.statsByType.textContent = '';
  for (const t of statsData.byType) {
    ui.statsByType.appendChild(statBarRow(TYPE_LABELS[t.type] || t.type, t.accuracy, t.attempts));
  }
  ui.statsByTypeSection.hidden = statsData.byType.length === 0;

  ui.statsWeak.textContent = '';
  for (const topic of statsData.weakTopics) {
    const row = el('div', 'weak-row');
    row.appendChild(el('span', 'weak-topic', topic.topic));
    row.appendChild(el('span', 'weak-value', `${pct(topic.accuracy)}(${topic.attempts}回)`));
    ui.statsWeak.appendChild(row);
  }
  ui.statsWeakSection.hidden = statsData.weakTopics.length === 0;
}

// --- トースト -------------------------------------------------------------

let toastTimer = 0;

/** トーストを表示する(前のトーストは上書き)。 */
export function showToast(toastEl, message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}
