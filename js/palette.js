// merihari ─ palette.js: カテゴリ色(ライト/ダーク)と状態色。
// 既定の有彩色 7 色は dataviz の検証(OKLCH 帯・彩度・隣接ペアの CVD 分離・通常視の分離・コントラスト)を両モードで通した組み合わせ:
//   light: #2a78d6,#eb6834,#1baf7a,#eda100,#6250d6,#008300,#e34948 (緑↔赤は 6–8 の床 → 凡例と直接ラベルで二重符号化)
//   dark : #3987e5,#d95926,#199e70,#c98500,#9085e9,#008300,#e66767(#1f1f1d 上)
// 生活・移動・その他は「強調しない灰色」の役(識別は凡例とラベルで担保)。

export const DEFAULT_COLORS = {
  research: '#2a78d6', class: '#eb6834', english: '#1baf7a', job: '#eda100', hunt: '#6250d6',
  rest: '#008300', sns: '#e34948', life: '#718096', transit: '#a0aec0', sleep: '#8d9bb5', other: '#4a5568',
};
export const DARK_OF = {
  '#2a78d6': '#3987e5', '#eb6834': '#d95926', '#1baf7a': '#199e70', '#eda100': '#c98500', '#6250d6': '#9085e9',
  '#008300': '#008300', '#e34948': '#e66767', '#718096': '#8b94a6', '#a0aec0': '#6b7383', '#4a5568': '#b0b4c0', '#8d9bb5': '#6f7d99',
  // 旧既定色(v0.4.0 以前)を使い続けている場合のダーク版
  '#2b6cb0': '#7fb0e8', '#6b46c1': '#a78bfa', '#2c7a7b': '#4fd1c5', '#b7791f': '#d69e2e', '#c05621': '#ed8936', '#38a169': '#68d391', '#e53e3e': '#fc8181',
};
/** v0.4.0 以前の既定色 → 新しい既定色(migrate で置き換える) */
export const LEGACY_COLORS = {
  research: '#2b6cb0', class: '#6b46c1', english: '#2c7a7b', job: '#b7791f', hunt: '#c05621', rest: '#38a169', sns: '#e53e3e',
};
/** 追加カテゴリに順に割り当てる色(有彩色 7 → 灰) */
export const EXTRA_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#6250d6', '#008300', '#e34948', '#718096'];

export const isDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** 表示用の色(ダークモードなら既知の色はダーク版に) */
export function displayColor(hex) {
  if (!hex) return isDark() ? '#8b94a6' : '#718096';
  const h = hex.toLowerCase();
  return isDark() ? (DARK_OF[h] || hex) : hex;
}

/** 状態色(増減の良し悪し)。文字に使うのでアイコン(▲▼)とラベルを必ず添える */
export const STATUS = { good: { light: '#006300', dark: '#0ca30c' }, bad: { light: '#c53030', dark: '#e66767' } };
export const statusColor = (kind) => STATUS[kind][isDark() ? 'dark' : 'light'];
