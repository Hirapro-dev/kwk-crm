'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/**
 * 値をクリップボードにコピーする小さなボタン(DNS レコード・転送先アドレス用)。
 * 共有リンクの ShareLinkButton と同じ方式(クリップボード API 不可の環境はフォールバック)。
 */
export function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* これ以上は何もできない */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-input bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={label}
      title={label}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? 'コピーしました' : label}
    </button>
  );
}
