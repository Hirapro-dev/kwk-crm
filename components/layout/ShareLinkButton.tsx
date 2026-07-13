'use client';

/**
 * 共有リンクボタン。
 * 現在ページ(または指定URL)のリンクをクリップボードにコピーする。
 * ログイン済みメンバー間での URL 共有用。受け取った人はログイン後、
 * 権限(RLS)に従って同じレコード/レポートを閲覧する(公開リンクではない)。
 */

import { Button } from '@/components/ui/button';
import { Check, Share2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  /** コピー対象URL。未指定なら現在ページのURL。 */
  url?: string;
  /** ボタンラベル(既定「共有」)。 */
  label?: string;
}

export function ShareLinkButton({ url, label = '共有' }: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const target = url ?? (typeof window !== 'undefined' ? window.location.href : '');
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
    } catch {
      // クリップボードAPIが使えない環境(非HTTPS等)のフォールバック
      const ta = document.createElement('textarea');
      ta.value = target;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // これ以上は何もできないため黙って終了
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-live="polite"
      title="このページのリンクをコピー"
    >
      {copied ? (
        <>
          <Check className="mr-1 h-3.5 w-3.5" />
          コピーしました
        </>
      ) : (
        <>
          <Share2 className="mr-1 h-3.5 w-3.5" />
          {label}
        </>
      )}
    </Button>
  );
}
