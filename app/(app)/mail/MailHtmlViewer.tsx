'use client';

import { useState } from 'react';

/**
 * HTML メール本文の表示(仕様書 §5.15 セキュリティ)。
 *
 * サニタイズ用ライブラリは入れず、ブラウザの隔離機構で守る:
 *   - iframe の sandbox 属性(値なし)= スクリプト・フォーム送信・ポップアップ・
 *     親ページへのアクセスをすべて禁止
 *   - srcdoc 内に CSP を埋め込み、画像を含む外部リソースの読み込みを禁止
 *     (開封トラッキング用の画像ビーコン対策)。インラインスタイルのみ許可
 *   - referrer を送らない
 * 本文を親ページの DOM に直接描画しないので、HTML 中のスクリプトやスタイルが
 * CRM 側に影響することはない。
 */
export function MailHtmlViewer({ html, collapsed = false }: { html: string; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);

  if (!open) {
    return (
      <button
        type="button"
        className="mt-2 text-xs text-primary hover:underline"
        onClick={() => setOpen(true)}
      >
        HTML 版を表示
      </button>
    );
  }

  const doc = `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none';">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>body{margin:8px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;word-break:break-word}</style>
</head><body>${html}</body></html>`;

  return (
    <div className="mt-2">
      {collapsed && (
        <button
          type="button"
          className="mb-1 text-xs text-primary hover:underline"
          onClick={() => setOpen(false)}
        >
          HTML 版を閉じる
        </button>
      )}
      <p className="mb-1 text-[11px] text-muted-foreground">
        画像や外部コンテンツは読み込まずに表示しています。
      </p>
      <iframe
        title="メール本文(HTML)"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={doc}
        className="h-[480px] w-full rounded border bg-white"
      />
    </div>
  );
}
