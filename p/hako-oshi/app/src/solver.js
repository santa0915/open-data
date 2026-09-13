// solver.js — 押し数BFSソルバ(本作の品質の核。adr/0003)
//
// 標準的な倉庫番ソルバの構成: 「箱を1個押す」を1エッジとするBFS。
// 状態 = (箱集合, プレイヤーの正規化位置)。正規化により「押さずに歩き回る
// だけ」の状態爆発を消す(同じ箱配置でも歩き回れる範囲は1つの同値類)。
//
// 正規化の定義: 現在の箱配置のもとで、箱と壁を障害物としてプレイヤーが
// フラッドフィルで到達できるマスの集合を求め、そのうち座標 (y*cols+x) が
// 最小のマスを「代表点」とする。プレイヤーの実位置に関わらず、同じ到達域
// なら同じ代表点になるため、状態が一意化される。
//
// 遷移: いずれかの箱をいずれかの方向へ1押し。押すにはプレイヤーが箱の
// 反対側マス(押し位置)に到達可能である必要があり、これは代表点からの
// フラッドフィル結果(到達域)に押し位置が含まれるかで判定する。
// 押した先が角デッドロック(findDeadBoxes)なら、その手は展開しない。
//
// BFSなので最初に見つかる解が最短押し数。firstPush はヒント機能に使う。
// 訪問済み判定は「箱集合(ソート済み文字列)+代表点」のハッシュ文字列。
//
// 計算量: 内寸9×8=72マス・箱4個 → 理論上限 C(72,4)≈100万状態だが、壁・
// 到達可能性・デッドロック枝刈りにより実レベルは数千〜数万状態に収まる
// (architecture.md §5)。maxStates(既定20万)は安全マージン。

import { findDeadBoxes } from './deadlock.js';

const DIR_LIST = [
  { name: 'up', dx: 0, dy: -1 },
  { name: 'down', dx: 0, dy: 1 },
  { name: 'left', dx: -1, dy: 0 },
  { name: 'right', dx: 1, dy: 0 },
];

function key(x, y) {
  return `${x},${y}`;
}

/**
 * 箱と壁を障害物として、startから歩いて到達できるマスの集合(キー文字列の
 * Set)を返す。座標範囲は level.cols / level.rows の内側に制限する。
 */
function reachableFrom(level, boxes, start) {
  const startKey = key(start.x, start.y);
  const seen = new Set([startKey]);
  const stack = [start];

  while (stack.length > 0) {
    const { x, y } = stack.pop();
    for (const { dx, dy } of DIR_LIST) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.cols || ny >= level.rows) continue;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      if (level.walls.has(nk)) continue;
      if (boxes.has(nk)) continue;
      seen.add(nk);
      stack.push({ x: nx, y: ny });
    }
  }

  return seen;
}

/** 到達域のうち (y*cols+x) が最小のマスを代表点として返す。 */
function normalize(level, boxes, player) {
  const region = reachableFrom(level, boxes, player);
  let bestKey = null;
  let bestIdx = Infinity;
  let bestX = 0;
  let bestY = 0;

  for (const k of region) {
    const [x, y] = k.split(',').map(Number);
    const idx = y * level.cols + x;
    if (idx < bestIdx) {
      bestIdx = idx;
      bestKey = k;
      bestX = x;
      bestY = y;
    }
  }

  return { key: bestKey, x: bestX, y: bestY, region };
}

/** 箱集合を訪問済み判定用の正準文字列にする(ソートして連結)。 */
function boxesKey(boxes) {
  return [...boxes].sort().join(';');
}

function isSolved(level, boxes) {
  for (const b of boxes) {
    if (!level.goals.has(b)) return false;
  }
  return true;
}

/** visitedの親ポインタを辿ってpushSeq(古い順)を組み立てる。 */
function reconstructPath(visited, goalStateKey) {
  const actions = [];
  let k = goalStateKey;
  for (;;) {
    const entry = visited.get(k);
    if (!entry) break; // 初期状態まで遡り切った
    actions.push(entry.action);
    k = entry.prevKey;
  }
  return actions.reverse();
}

/**
 * 現局面から最短押し数の解を探索する。
 * @param {object} level - parseLevelの結果(cols, rows, walls, goals)
 * @param {Set<string>} boxes - 現在の箱集合('x,y')
 * @param {{x:number,y:number}} player - 現在のプレイヤー位置
 * @param {{maxStates?:number}} options
 * @returns {{status:'solved', pushes:number, firstPush:{box:string,dir:string}, pushSeq:Array}
 *         | {status:'unsolvable'} | {status:'exceeded'}}
 */
export function solve(level, boxes, player, { maxStates = 200000 } = {}) {
  if (isSolved(level, boxes)) {
    return { status: 'solved', pushes: 0, firstPush: null, pushSeq: [] };
  }

  const startNorm = normalize(level, boxes, player);
  const startStateKey = `${boxesKey(boxes)}|${startNorm.key}`;

  const visited = new Map(); // stateKey -> { prevKey, action } | null(初期状態)
  visited.set(startStateKey, null);

  const queue = [
    { boxes, normX: startNorm.x, normY: startNorm.y, stateKey: startStateKey },
  ];
  let head = 0;
  let statesExplored = 1; // 初期状態を1つとして数える

  while (head < queue.length) {
    if (statesExplored > maxStates) {
      return { status: 'exceeded' };
    }

    const cur = queue[head];
    head += 1;

    const region = reachableFrom(level, cur.boxes, { x: cur.normX, y: cur.normY });

    for (const box of cur.boxes) {
      const [bx, by] = box.split(',').map(Number);

      for (const dir of DIR_LIST) {
        const fromKey = key(bx - dir.dx, by - dir.dy);
        const destX = bx + dir.dx;
        const destY = by + dir.dy;
        const destKey = key(destX, destY);

        if (!region.has(fromKey)) continue; // 押し位置に到達できない
        if (level.walls.has(destKey)) continue;
        if (cur.boxes.has(destKey)) continue; // 箱2連続

        const newBoxes = new Set(cur.boxes);
        newBoxes.delete(box);
        newBoxes.add(destKey);

        // 角デッドロック枝刈り: 押した先で詰む手は展開しない
        const dead = findDeadBoxes(level, newBoxes);
        if (dead.has(destKey)) continue;

        // 押した後、プレイヤーは箱の元位置に立つ
        const newNorm = normalize(level, newBoxes, { x: bx, y: by });
        const newStateKey = `${boxesKey(newBoxes)}|${newNorm.key}`;

        if (visited.has(newStateKey)) continue;

        const action = { box, dir: dir.name };
        visited.set(newStateKey, { prevKey: cur.stateKey, action });
        statesExplored += 1;

        if (isSolved(level, newBoxes)) {
          const pushSeq = reconstructPath(visited, newStateKey);
          return {
            status: 'solved',
            pushes: pushSeq.length,
            firstPush: pushSeq[0],
            pushSeq,
          };
        }

        queue.push({
          boxes: newBoxes,
          normX: newNorm.x,
          normY: newNorm.y,
          stateKey: newStateKey,
        });
      }
    }
  }

  return { status: 'unsolvable' };
}
