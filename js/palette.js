// merihari ─ palette.js: カテゴリ色(ライト/ダーク)と状態色。
// v0.15.2: 既定色をさらに淡いパステルに(緑を薄く・オレンジはピーチに)。色は文字には使わず(凡例・ラベルで二重符号化)、円・棒・ブロック・チップの地に使う。
// 生活・移動・その他・睡眠は「強調しない」役(灰みのある淡色)。ユーザーは設定でカテゴリごとに色(カラーコード)を自由に変えられる。

export const DEFAULT_COLORS = {
  research: '#9ccbee', class: '#f9cfa8', english: '#b4e3d2', job: '#f7e6a8', hunt: '#cfc3ef',
  rest: '#cfe9c3', sns: '#f7bdbd', life: '#cfd7e1', transit: '#dbe1e8', sleep: '#d6daf1', other: '#e0dcd3',
};
export const DARK_OF = {
  '#cfd7e1': '#8d99a8', '#dbe1e8': '#7b8592', '#e0dcd3': '#a8a39a', '#d6daf1': '#8f98c8',
  // 旧既定色(v0.15.1)
  '#b8c4d3': '#8d99a8', '#cdd5de': '#7b8592', '#d4cfc4': '#a8a39a', '#c7cdee': '#8f98c8',
  // 旧既定色(v0.4.1〜v0.15.0)を使い続けている場合のダーク版
  '#2a78d6': '#3987e5', '#eb6834': '#d95926', '#1baf7a': '#199e70', '#eda100': '#c98500', '#6250d6': '#9085e9',
  '#008300': '#008300', '#e34948': '#e66767', '#718096': '#8b94a6', '#a0aec0': '#6b7383', '#4a5568': '#b0b4c0', '#8d9bb5': '#6f7d99',
  // 旧既定色(v0.4.0 以前)
  '#2b6cb0': '#7fb0e8', '#6b46c1': '#a78bfa', '#2c7a7b': '#4fd1c5', '#b7791f': '#d69e2e', '#c05621': '#ed8936', '#38a169': '#68d391', '#e53e3e': '#fc8181',
};
/** 過去の既定色 → 新しい既定色(migrate で置き換える。自分で選んだ色は触らない) */
export const LEGACY_COLORS = {
  research: ['#2b6cb0', '#2a78d6', '#7fb3e6'], class: ['#6b46c1', '#eb6834', '#f5b07a'], english: ['#2c7a7b', '#1baf7a', '#7fd1b3'], job: ['#b7791f', '#eda100', '#f6d97a'], hunt: ['#c05621', '#6250d6', '#b9a6e8'],
  rest: ['#38a169', '#008300', '#9fd8a0'], sns: ['#e53e3e', '#e34948', '#f49a9a'], life: ['#718096', '#b8c4d3'], transit: ['#a0aec0', '#cdd5de'], sleep: ['#8d9bb5', '#c7cdee'], other: ['#4a5568', '#d4cfc4'],
};
/** 配色のプリセット(v0.15.3・設定 › カテゴリ「配色をまとめて変える」)。id ごとの色と、既定に無いカテゴリへ順に割り当てる色 */
export const PALETTES = {
  pastel: { name: 'パステル', colors: { research: '#9ccbee', class: '#f9cfa8', english: '#b4e3d2', job: '#f7e6a8', hunt: '#cfc3ef', rest: '#cfe9c3', sns: '#f7bdbd', life: '#cfd7e1', transit: '#dbe1e8', sleep: '#d6daf1', other: '#e0dcd3' }, extra: ['#9ccbee', '#f9cfa8', '#b4e3d2', '#f7e6a8', '#cfc3ef', '#cfe9c3', '#f7bdbd', '#f9d9ec', '#bfe3ea', '#e6dcc3'] },
  soft: { name: 'やわらか', colors: { research: '#7fb3e6', class: '#f5b07a', english: '#7fd1b3', job: '#f6d97a', hunt: '#b9a6e8', rest: '#9fd8a0', sns: '#f49a9a', life: '#b8c4d3', transit: '#cdd5de', sleep: '#c7cdee', other: '#d4cfc4' }, extra: ['#7fb3e6', '#f5b07a', '#7fd1b3', '#f6d97a', '#b9a6e8', '#9fd8a0', '#f49a9a', '#e9a9d2', '#8fd0dd', '#d3c08e'] },
  vivid: { name: 'くっきり', colors: { research: '#2a78d6', class: '#eb6834', english: '#1baf7a', job: '#eda100', hunt: '#6250d6', rest: '#008300', sns: '#e34948', life: '#718096', transit: '#a0aec0', sleep: '#8d9bb5', other: '#4a5568' }, extra: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#008300', '#e34948', '#c2185b', '#0097a7', '#8d6e63'] },
  pt2: { name: 'パステル Pt.2', colors: { research: '#8095ce', class: '#c58ade', english: '#90c4e9', job: '#b1beea', hunt: '#8869a5', rest: '#b1beea', sns: '#c58ade', life: '#d4d9ea', transit: '#dfe3f0', sleep: '#cdd3ec', other: '#e2e0ea' }, extra: ['#8095ce', '#c58ade', '#90c4e9', '#b1beea', '#8869a5', '#a7b6e3', '#d4a9ea', '#b7d4ee'] },
  mono: { name: 'しずか', colors: { research: '#6f8fb3', class: '#9db1c8', english: '#b9c8d8', job: '#cdd7e2', hunt: '#86a0bd', rest: '#bccbb8', sns: '#c9a4a4', life: '#d8dce1', transit: '#e2e5e9', sleep: '#dadeeb', other: '#dcd9d3' }, extra: ['#6f8fb3', '#9db1c8', '#b9c8d8', '#cdd7e2', '#86a0bd', '#bccbb8', '#c9a4a4', '#b7a9c4', '#a9bfb9', '#c8b9a4'] },
};
/** 追加カテゴリに順に割り当てる色 / 設定の色の候補(パステル 12 色) */
export const EXTRA_COLORS = ['#9ccbee', '#f9cfa8', '#b4e3d2', '#f7e6a8', '#cfc3ef', '#cfe9c3', '#f7bdbd', '#cfd7e1', '#f9d9ec', '#bfe3ea', '#e6dcc3', '#d6daf1'];

export const isDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** 表示用の色(ダークモードなら既知の色はダーク版に) */
export function displayColor(hex) {
  if (!hex) return isDark() ? '#8b94a6' : '#cfd7e1';
  const h = hex.toLowerCase();
  return isDark() ? (DARK_OF[h] || hex) : hex;
}

/** 状態色(増減の良し悪し)。文字に使うのでアイコン(▲▼)とラベルを必ず添える */
export const STATUS = { good: { light: '#006300', dark: '#0ca30c' }, bad: { light: '#c53030', dark: '#e66767' } };
export const statusColor = (kind) => STATUS[kind][isDark() ? 'dark' : 'light'];
