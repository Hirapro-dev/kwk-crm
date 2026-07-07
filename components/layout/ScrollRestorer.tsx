'use client';

/**
 * 全行を一括描画する一覧(レポート結果など)向けのスクロール位置復元。
 * ページ全体(window)/<main> のスクロール位置を保存し、同じ URL に戻ったとき復元する。
 *
 * 無限スクロール一覧では代わりに InfiniteTable が件数込みで復元するため、
 * こちらは使わない。何も描画しない(副作用のみ)。
 */

import { useEffect } from 'react';
import {
  applyScrollTop,
  currentScrollTop,
  readScroll,
  scrollStorageKey,
  subscribeScroll,
  writeScroll,
} from './scroll_restore';

export function ScrollRestorer() {
  useEffect(() => {
    const key = scrollStorageKey();

    // 復元: 高さ確定のタイミング差を吸収するため数フレーム試行する
    const saved = readScroll(key);
    if (saved && saved.top > 0) {
      let tries = 0;
      const restore = () => {
        applyScrollTop(saved.top);
        tries += 1;
        if (tries < 6 && Math.abs(currentScrollTop() - saved.top) > 2) {
          requestAnimationFrame(restore);
        }
      };
      requestAnimationFrame(restore);
    }

    // 保存: スクロールのたびに(rAF で間引いて)現在位置を記録
    let raf = 0;
    const unsubscribe = subscribeScroll(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => writeScroll(key, { top: currentScrollTop(), count: 0 }));
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
