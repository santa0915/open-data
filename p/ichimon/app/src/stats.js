// stats.js — progress と pack群からの集計(保存しない・毎回計算 — product-design.md §5)
//
// 「回答した」とは progress のレコードが attempts>0 であることを指す。
// hensachiの帯集計(byBand)は difficultyScale:'hensachi' のパックのみ対象
// (starsスケールに帯の概念はまだ無い — v1はhensachiパックのみ同梱のため
// 実害はない、という仕様書に明記のない割り切り)。

import { CONFIG } from './config.js';

function ratio(correct, attempts) {
  return attempts > 0 ? correct / attempts : 0;
}

// byType の表示順(形式の正準順 — adr/0006)
const TYPE_ORDER = ['recall', 'choice', 'written', 'ordering'];

/** hensachi値を5刻みの帯ラベルに変換する(例: 42 → '40-45'、70 → '65-70')。 */
function bandLabel(hensachi) {
  const { hensachiMin, hensachiMax } = CONFIG;
  const step = 5;
  const raw = Math.floor((hensachi - hensachiMin) / step) * step + hensachiMin;
  const start = Math.min(Math.max(raw, hensachiMin), hensachiMax - step);
  return `${start}-${start + step}`;
}

/**
 * @param {object[]} packs
 * @param {{ records: object }} progress
 */
export function overallStats(packs, progress) {
  const records = (progress && progress.records) || {};

  let totalAnswered = 0;
  let totalCorrect = 0;
  const areaAgg = new Map(); // areaId -> { name, attempts, correct }
  const bandAgg = new Map(); // band -> { attempts, correct }
  const typeAgg = new Map(); // type -> { attempts, correct }(形式別 — v1.3)
  const topicAgg = new Map(); // topic -> { attempts, correct }

  for (const pack of packs) {
    const areaNames = new Map(pack.areas.map((a) => [a.id, a.name]));

    for (const q of pack.questions) {
      const record = records[q.id];
      if (!record || record.attempts === 0) continue;

      totalAnswered += record.attempts;
      totalCorrect += record.correct;

      if (!areaAgg.has(q.area)) {
        areaAgg.set(q.area, { name: areaNames.get(q.area) || q.area, attempts: 0, correct: 0 });
      }
      const areaEntry = areaAgg.get(q.area);
      areaEntry.attempts += record.attempts;
      areaEntry.correct += record.correct;

      if (pack.difficultyScale === 'hensachi') {
        const band = bandLabel(q.hensachi);
        if (!bandAgg.has(band)) bandAgg.set(band, { attempts: 0, correct: 0 });
        const bandEntry = bandAgg.get(band);
        bandEntry.attempts += record.attempts;
        bandEntry.correct += record.correct;
      }

      // 形式別(type省略はrecall扱い — v1パック互換)
      const type = q.type === undefined ? 'recall' : q.type;
      if (!typeAgg.has(type)) typeAgg.set(type, { attempts: 0, correct: 0 });
      const typeEntry = typeAgg.get(type);
      typeEntry.attempts += record.attempts;
      typeEntry.correct += record.correct;

      if (!topicAgg.has(q.topic)) topicAgg.set(q.topic, { attempts: 0, correct: 0 });
      const topicEntry = topicAgg.get(q.topic);
      topicEntry.attempts += record.attempts;
      topicEntry.correct += record.correct;
    }
  }

  const byArea = [...areaAgg.entries()].map(([id, v]) => ({
    id,
    name: v.name,
    attempts: v.attempts,
    accuracy: ratio(v.correct, v.attempts),
  }));

  const byBand = [...bandAgg.entries()]
    .map(([band, v]) => ({ band, attempts: v.attempts, accuracy: ratio(v.correct, v.attempts) }))
    .sort((a, b) => a.band.localeCompare(b.band));

  const byType = [...typeAgg.entries()]
    .map(([type, v]) => ({ type, attempts: v.attempts, accuracy: ratio(v.correct, v.attempts) }))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

  const weakTopics = [...topicAgg.entries()]
    .map(([topic, v]) => ({ topic, attempts: v.attempts, accuracy: ratio(v.correct, v.attempts) }))
    .filter((t) => t.attempts >= 3)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  return {
    totalAnswered,
    accuracy: ratio(totalCorrect, totalAnswered),
    byArea,
    byBand,
    byType,
    weakTopics,
  };
}
