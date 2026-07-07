/**
 * 一覧のスクロール位置復元の共通ヘルパ (Client 専用)。
 *
 * 背景: アプリのスクロールコンテナは layout.tsx の <main overflow-y-auto>。
 * ブラウザ標準のスクロール復元は window にしか効かないため、内部スクロールする
 * <main> の位置を自前で sessionStorage に保存・復元する。
 *
 * キーは「パス + クエリ」単位。詳細ページへ遷移して戻ると同じ一覧キーで復元される。
 * フィルタ/ソートで query が変われば別キー扱い(=別の位置)になる。
 */

/** アプリの実スクロール要素 (<main>) を返す。 */
export function getMainScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('main');
}

/** 現在の URL(パス+クエリ)からストレージキーを生成。 */
export function scrollStorageKey(): string {
  if (typeof window === 'undefined') return 'scroll:';
  return `scroll:${window.location.pathname}${window.location.search}`;
}

export interface SavedScroll {
  /** main.scrollTop */
  top: number;
  /** 無限スクロールで読み込み済みの行数(全行描画の一覧では 0) */
  count: number;
}

export function readScroll(key: string): SavedScroll | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { top?: unknown; count?: unknown };
    if (typeof v.top !== 'number') return null;
    return { top: v.top, count: typeof v.count === 'number' ? v.count : 0 };
  } catch {
    return null;
  }
}

export function writeScroll(key: string, v: SavedScroll): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(v));
  } catch {
    // sessionStorage 不可(プライベートモード等)でも致命的でないため無視
  }
}
