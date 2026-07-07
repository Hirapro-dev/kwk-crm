/**
 * スクロール位置復元の共通ヘルパ (Client 専用)。
 *
 * スクロール要素はページによって異なる:
 *   - レポート結果: テーブルを囲む [data-scroll-container] の内部 DIV がスクロールする
 *   - それ以外   : window(ページ全体)
 * そのため [data-scroll-container] があればそれを、無ければ window を対象にする。
 *
 * キーは「パス + クエリ」単位。詳細ページへ遷移して戻ると同じキーで復元される。
 */

/** スクロール対象要素。[data-scroll-container] があればそれ、無ければ null(=window)。 */
function scrollTargetEl(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector('[data-scroll-container]');
  return el instanceof HTMLElement ? el : null;
}

/** 現在の URL(パス+クエリ)からストレージキーを生成。 */
export function scrollStorageKey(): string {
  if (typeof window === 'undefined') return 'scroll:';
  return `scroll:${window.location.pathname}${window.location.search}`;
}

export interface SavedScroll {
  /** スクロール量(px) */
  top: number;
}

export function readScroll(key: string): SavedScroll | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { top?: unknown };
    if (typeof v.top !== 'number') return null;
    return { top: v.top };
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

/** 現在のスクロール量。 */
export function currentScrollTop(): number {
  const el = scrollTargetEl();
  if (el) return el.scrollTop;
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

/** スクロール位置を適用する。 */
export function applyScrollTop(top: number): void {
  const el = scrollTargetEl();
  if (el) {
    el.scrollTop = top;
    return;
  }
  if (typeof window !== 'undefined') window.scrollTo(0, top);
}

/** スクロールイベントを購読する。解除関数を返す。 */
export function subscribeScroll(cb: () => void): () => void {
  const el = scrollTargetEl();
  if (el) {
    el.addEventListener('scroll', cb, { passive: true });
    return () => el.removeEventListener('scroll', cb);
  }
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('scroll', cb, { passive: true });
  return () => window.removeEventListener('scroll', cb);
}
