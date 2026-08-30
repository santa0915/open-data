// schema.js — 問題パックの検証(docs/data-design.md §1 の不変条件)
//
// エラーは最初の1件で止めず、全件配列で返す(データ作成側が1回の実行で
// まとめて直せるようにするため)。
// schemaVersion 2 で出題形式 type(recall/choice/written/ordering)を導入
// (adr/0006)。schemaVersion 1 のパックは全問 recall として解釈する(後方互換)。

const ID_PATTERN = /^[a-z0-9]+-[a-z0-9]+-\d{4}$/;

const VALID_TYPES = new Set(['recall', 'choice', 'written', 'ordering']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 配列が「すべて非空文字列かつ相互に重複なし」であるか。 */
function isDistinctStringArray(arr) {
  return (
    Array.isArray(arr) &&
    arr.every(isNonEmptyString) &&
    new Set(arr).size === arr.length
  );
}

/** ルビ記法 '{…|…}' の括弧が対応しているか(単純な深さカウント)。 */
function hasBalancedBraces(text) {
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false; // 開いていない ')' 相当
    }
  }
  return depth === 0;
}

/**
 * パックを検証する。
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePack(pack) {
  const errors = [];

  if (!pack || typeof pack !== 'object') {
    return { ok: false, errors: ['パックがオブジェクトではありません'] };
  }
  if (pack.schemaVersion !== 1 && pack.schemaVersion !== 2) {
    errors.push(`schemaVersion が不正です(1|2 のみ): ${pack.schemaVersion}`);
  }
  if (!isNonEmptyString(pack.id)) {
    errors.push('パックの id が空です');
  }
  if (pack.difficultyScale !== 'hensachi' && pack.difficultyScale !== 'stars') {
    errors.push(`difficultyScale が不正です(hensachi|stars のみ): ${pack.difficultyScale}`);
  }
  if (!Array.isArray(pack.areas) || pack.areas.length === 0) {
    errors.push('areas が定義されていません');
  }
  if (!Array.isArray(pack.questions)) {
    errors.push('questions が配列ではありません');
    return { ok: false, errors };
  }

  const areaIds = new Set(Array.isArray(pack.areas) ? pack.areas.map((a) => a && a.id) : []);
  const seenIds = new Set();

  pack.questions.forEach((q, index) => {
    const label = q && isNonEmptyString(q.id) ? q.id : `questions[${index}]`;

    if (!q || typeof q !== 'object') {
      errors.push(`[${label}] question がオブジェクトではありません`);
      return;
    }

    if (!isNonEmptyString(q.id)) {
      errors.push(`[${label}] id が空です`);
    } else {
      if (!ID_PATTERN.test(q.id)) {
        errors.push(`[${label}] id が命名規則(pack-area-####)に反しています`);
      } else if (isNonEmptyString(pack.id) && areaIds.has(q.area) && !q.id.startsWith(`${pack.id}-${q.area}-`)) {
        errors.push(`[${label}] id がパックID/分野IDの組み合わせと一致しません`);
      }
      if (seenIds.has(q.id)) {
        errors.push(`[${label}] id が重複しています`);
      }
      seenIds.add(q.id);
    }

    if (!areaIds.has(q.area)) {
      errors.push(`[${label}] area が areas に存在しません: ${q.area}`);
    }

    if (!isNonEmptyString(q.question)) errors.push(`[${label}] question が空です`);
    if (!isNonEmptyString(q.answer)) errors.push(`[${label}] answer が空です`);
    if (!isNonEmptyString(q.explanation)) errors.push(`[${label}] explanation が空です`);
    if (!isNonEmptyString(q.source)) errors.push(`[${label}] source が空です`);
    if (!isNonEmptyString(q.license)) errors.push(`[${label}] license が空です`);

    // --- 出題形式ごとの不変条件(type — schemaVersion 2 / adr/0006) ---
    // type 省略は recall 扱い(v1互換)。schemaVersion 1 で recall 以外は不可
    const type = q.type === undefined ? 'recall' : q.type;
    if (!VALID_TYPES.has(type)) {
      errors.push(`[${label}] type が不正です(recall|choice|written|ordering): ${q.type}`);
    } else if (pack.schemaVersion === 1 && type !== 'recall') {
      errors.push(`[${label}] schemaVersion 1 のパックでは type '${type}' を使えません(schemaVersion 2 に上げること)`);
    } else if (type === 'choice') {
      // 4択: choices は誤答3つ・非空・相互重複なし・answer と重複なし
      if (!isDistinctStringArray(q.choices) || q.choices.length !== 3) {
        errors.push(`[${label}] choice は choices(誤答3つ・非空・重複なし)が必要です`);
      } else if (q.choices.includes(q.answer)) {
        errors.push(`[${label}] choices に answer と同じ選択肢が含まれています`);
      }
    } else if (type === 'written') {
      // 記述: points は採点ポイント2〜3個・非空
      if (
        !Array.isArray(q.points) ||
        q.points.length < 2 ||
        q.points.length > 3 ||
        !q.points.every(isNonEmptyString)
      ) {
        errors.push(`[${label}] written は points(採点ポイント2〜3個・非空)が必要です`);
      }
    } else if (type === 'ordering') {
      // 整序: items は正しい順序の4項目・相互重複なし。answer は items.join('→')
      if (!isDistinctStringArray(q.items) || q.items.length !== 4) {
        errors.push(`[${label}] ordering は items(4項目・非空・重複なし)が必要です`);
      } else if (q.answer !== q.items.join('→')) {
        errors.push(`[${label}] ordering の answer が items.join('→') と一致しません`);
      }
    }

    if (pack.difficultyScale === 'hensachi') {
      if (typeof q.hensachi !== 'number' || q.hensachi < 40 || q.hensachi > 70) {
        errors.push(`[${label}] hensachi が範囲外です(40〜70): ${q.hensachi}`);
      }
    } else if (pack.difficultyScale === 'stars') {
      if (typeof q.level !== 'number' || q.level < 1 || q.level > 5) {
        errors.push(`[${label}] level が範囲外です(1〜5): ${q.level}`);
      }
    }

    for (const field of ['question', 'answer', 'explanation']) {
      if (isNonEmptyString(q[field]) && !hasBalancedBraces(q[field])) {
        errors.push(`[${label}] ${field} のルビ括弧 {…|…} が対応していません`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
