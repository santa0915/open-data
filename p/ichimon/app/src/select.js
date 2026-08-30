// select.js — 出題選択(docs/adr/0003-hensachi-model.md・0004-srs.md)
//
// 決定的(rng・nowは引数注入)。規則の順序は architecture.md §2 のとおり:
//   1. 対象 = areas に属し retired でない問題
//   2. mode 'review': isDue のものから due が古い順に size 件(不足なら少なく)
//   3. mode 'normal': isDue のものを最大 floor(size*reviewRatio) 件(due古い順)、
//      残りを「新規(attempts==0)優先 → 全体」から難易度重み付き抽選
//   4. 同一セッション内の重複なし。順序はシャッフル(rng)
//
// 「isDue な問題」は復習対象という意味なので、一度も回答していない問題
// (attempts===0)は due=0 でも復習プールに含めない(SRSは既出の問題の
// 再出題間隔を管理する仕組みのため)。この判断は仕様書に明記がない箇所の
// 実装上の割り切り。

import { CONFIG } from './config.js';
import { initialRecord, isDue } from './srs.js';
import { shuffle } from './rng.js';

/** progress.records から該当レコードを取り出す。未回答なら初期値。 */
function getRecord(progress, id) {
  return (progress && progress.records && progress.records[id]) || initialRecord();
}

/** areas に属し、settings.types(あれば)に合致し、retired でない問題。 */
function targetQuestions(pack, settings) {
  // 形式フィルタ(v1.3 — adr/0006)。null/undefined = 全形式。
  // type 省略の問題は recall として扱う(v1パック互換)
  const types = settings.types == null ? null : new Set(settings.types);
  return pack.questions.filter(
    (q) =>
      settings.areas.includes(q.area) &&
      !q.retired &&
      (types === null || types.has(q.type === undefined ? 'recall' : q.type))
  );
}

/** 一度でも回答済み(attempts>0)かつ isDue な問題(=復習対象)。 */
function dueQuestions(pack, progress, settings, now) {
  return targetQuestions(pack, settings).filter((q) => {
    const rec = getRecord(progress, q.id);
    return rec.attempts > 0 && isDue(rec, now);
  });
}

/** due古い順(長く待たされている=dueが小さいものが先)にソートする。 */
function sortByDueAsc(list, progress) {
  return list
    .slice()
    .sort((a, b) => getRecord(progress, a.id).due - getRecord(progress, b.id).due);
}

/** 問題の難易度値を、パックのスケールに応じて取り出す。 */
function difficultyOf(pack, q) {
  return pack.difficultyScale === 'stars' ? q.level : q.hensachi;
}

/**
 * settings.target(常に偏差値40〜70の軸で表現される)を、パックのスケールに
 * 写像する。hensachiパックはそのまま。starsパックは1〜5へ線形写像し、
 * 同じ式・同じσで重みを計算する(adr/0003 §4のスケール抽象)。
 */
function mapTarget(pack, target) {
  if (pack.difficultyScale !== 'stars') return target;
  const { hensachiMin, hensachiMax, starsMin, starsMax } = CONFIG;
  const ratio = (target - hensachiMin) / (hensachiMax - hensachiMin);
  return starsMin + ratio * (starsMax - starsMin);
}

/** 正規分布重み(σ=config.selectSigma)。target直近が最大、離れるほど減衰。 */
function gaussianWeight(value, target, sigma) {
  const d = value - target;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

/**
 * 重み付き非復元抽出。count件、または items が尽きるまで rng で選び続ける。
 * 選ぶたびに重みを再計算するのでプールが減っても比率は保たれる。
 */
function weightedPick(items, weightFn, count, rng) {
  const pool = items.slice();
  const picked = [];

  for (let k = 0; k < count && pool.length > 0; k++) {
    const weights = pool.map(weightFn);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = total > 0 ? rng() * total : 0;
    let idx = pool.length - 1; // 浮動小数の誤差対策のフォールバック
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return picked;
}

/**
 * 出題選択。settings = { areas, target, size, mode: 'normal'|'review' }。
 * @returns {object[]} question の配列(重複なし・シャッフル済み)
 */
export function selectQuestions(pack, progress, settings, rng, now) {
  const candidates = targetQuestions(pack, settings);
  const dueSorted = sortByDueAsc(dueQuestions(pack, progress, settings, now), progress);

  let picked;
  if (settings.mode === 'review') {
    picked = dueSorted.slice(0, settings.size);
  } else {
    const reviewCount = Math.min(Math.floor(settings.size * CONFIG.reviewRatio), dueSorted.length);
    const reviewPicks = dueSorted.slice(0, reviewCount);
    const reviewIds = new Set(reviewPicks.map((q) => q.id));
    const remainingPool = candidates.filter((q) => !reviewIds.has(q.id));

    const mappedTarget = mapTarget(pack, settings.target);
    const weightFn = (q) => gaussianWeight(difficultyOf(pack, q), mappedTarget, CONFIG.selectSigma);

    const remainingCount = settings.size - reviewPicks.length;
    const newPool = remainingPool.filter((q) => getRecord(progress, q.id).attempts === 0);
    const newPicks = weightedPick(newPool, weightFn, remainingCount, rng);

    const newIds = new Set(newPicks.map((q) => q.id));
    const restPool = remainingPool.filter((q) => !newIds.has(q.id));
    const restPicks = weightedPick(restPool, weightFn, remainingCount - newPicks.length, rng);

    picked = [...reviewPicks, ...newPicks, ...restPicks];
  }

  return shuffle(rng, picked);
}

/** 復習待ち件数(ホームのバッジ用)。settings.areas のみ参照する。 */
export function dueCount(pack, progress, settings, now) {
  return dueQuestions(pack, progress, settings, now).length;
}
