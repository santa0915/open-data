// characters.js — オリジナルキャラクター7人(名前・色)
//
// 意匠は姉妹作 twin-leap の系統(色付き丸+目)を前提にした「名前+色コード」のみを
// ここに持つ(実際の描画は次工程の render.js)。実在人物・特定作品を強く想起させる
// 名前は避け、宇宙船クルーらしい親しみやすい和名+はっきり区別できる7色を選んだ
// (docs/adr/0002-naming-and-theme.md)。役職(配役)はゲームごとにrngで決まるため
// ここでは人物像を固定しない — 誰が侵入者になってもよい7人として設計している。

export const CHARACTERS = [
  { id: 0, name: 'ハル', color: '#ff7043' },
  { id: 1, name: 'レン', color: '#42a5f5' },
  { id: 2, name: 'ミオ', color: '#66bb6a' },
  { id: 3, name: 'ユズ', color: '#ffca28' },
  { id: 4, name: 'カイ', color: '#ab47bc' },
  { id: 5, name: 'ノア', color: '#26c6da' },
  { id: 6, name: 'ヒカリ', color: '#ec407a' },
];
