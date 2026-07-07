/**
 * 一覧のスクロール位置復元の共通ヘルパ (Client 専用)。
 *
 * 背景: このアプリは body/html に高さ制限が無く、レイアウトの親が min-h-screen のため、
 * 実際にスクロールするのは <main> ではなく window(ページ全体) になる。
 * ただし環境やページによって <main overflow-y-auto> 自体がスクロールするケースもあり得るため、
 * window と main の「両方」を対象に読み書き・購読して取りこぼしを防ぐ。
 *
 * キーは「パス + クエリ」単位。詳細ページへ遷移して戻ると同じ一覧キーで復元される。
 * フィルタ/ソートで query が変われば別キー扱い(=別の位置)になる。
 */

/** 現在の URL(パス+クエリ)からストレージキーを生成。 */
export function scrollStorageKey(): string {
  if (typeof window === 'undefined') return 'scroll:';
  return `scroll:${window.location.pathname}${window.location.search}`;
}

export interface SavedScroll {
  /** スクロール量(px) */
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

/** 実際にスクロールしている量。window と <main> の大きい方を採用する。 */
export function currentScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  const main = document.querySelector('main');
  const mainTop = main ? main.scrollTop : 0;
  const winTop = window.scrollY || document.documentElement.scrollTop || 0;
  return mainTop > winTop ? mainTop : winTop;
}

/** window と <main> の両方に位置を適用する(スクロールしない方はクランプされ無害)。 */
export function applyScrollTop(top: number): void {
  if (typeof window === 'undefined') return;
  const main = document.querySelector('main');
  if (main) main.scrollTop = top;
  window.scrollTo(0, top);
}

/** window と <main> の両方の scroll イベントを購読する。解除関数を返す。 */
export function subscribeScroll(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const main = document.querySelector('main');
  window.addEventListener('scroll', cb, { passive: true });
  main?.addEventListener('scroll', cb, { passive: true });
  return () => {
    window.removeEventListener('scroll', cb);
    main?.removeEventListener('scroll', cb);
  };
}
