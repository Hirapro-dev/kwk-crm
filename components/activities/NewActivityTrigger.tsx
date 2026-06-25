'use client';

import { Button } from '@/components/ui/button';

/**
 * 会員詳細ページのカード間に置く「+ 新規対応歴作成」ボタン。
 * クリック時に open-activity-form カスタムイベントを dispatch し、
 * ActivityForm 側でフォームをオープン＆スクロールさせる。
 */
export function NewActivityTrigger() {
  const handleClick = () => {
    window.dispatchEvent(new CustomEvent('open-activity-form'));
  };

  return (
    <Button onClick={handleClick} className="w-full py-5 sm:w-auto sm:py-2 text-base sm:text-sm">
      + 新規対応歴作成
    </Button>
  );
}
