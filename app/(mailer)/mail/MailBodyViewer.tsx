'use client';

import { useState } from 'react';

/**
 * メール本文の表示(仕様書 §5.15 セキュリティ)。
 *
 * HTML 本文があれば HTML 版を既定で表示し、テキスト版に切り替えられる。
 * サニタイズ用ライブラリは入れず、ブラウザの隔離機構で守る:
 *   - iframe の sandbox 属性(値なし)= スクリプト・フォーム送信・ポップアップ・
 *     親ページへのアクセスをすべて禁止
 *   - srcdoc 内に CSP を埋め込み、画像を含む外部リソースの読み込みを既定で禁止
 *     (開封トラッキング用の画像ビーコン対策)。インラインスタイルのみ許可
 *   - 「画像を表示」を押したときだけ、そのメールに限り https の画像を許可する
 *     (利用者の明示操作。自動では読み込まない)
 *   - referrer を送らない
 * 本文を親ページの DOM に直接描画しないので、HTML 中のスクリプトやスタイルが
 * CRM 側に影響することはない。
 */
export function MailBodyViewer({ text, html }: { text: string | null; html: string | null }) {
  const hasHtml = !!html?.trim();
  const hasText = !!text?.trim();
  const [mode, setMode] = useState<'html' | 'text'>(hasHtml ? 'html' : 'text');
  const [loadImages, setLoadImages] = useState(false);

  if (!hasHtml && !hasText) {
    return <p className="text-sm text-muted-foreground">(本文なし)</p>;
  }

  const toggle = hasHtml && hasText && (
    <button
      type="button"
      className="text-xs text-primary hover:underline"
      onClick={() => setMode(mode === 'html' ? 'text' : 'html')}
    >
      {mode === 'html' ? 'テキスト版を表示' : 'HTML 版を表示'}
    </button>
  );

  if (mode === 'text' || !hasHtml) {
    return (
      <div>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">{text}</pre>
        {toggle && <div className="mt-2">{toggle}</div>}
      </div>
    );
  }

  const imgSrc = loadImages ? 'https: data:' : "'none'";
  const doc = `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src ${imgSrc}; media-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none';">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>body{margin:8px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;word-break:break-word}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        {loadImages ? (
          <span>画像を読み込んで表示しています。</span>
        ) : (
          <>
            <span>画像や外部コンテンツは読み込まずに表示しています。</span>
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setLoadImages(true)}
            >
              画像を表示
            </button>
          </>
        )}
        {toggle}
      </div>
      {/* 下端をドラッグして高さを変えられる(iframe 内はスクリプト禁止のため自動調整はしない) */}
      <div className="h-[560px] min-h-[200px] resize-y overflow-hidden rounded border bg-white">
        <iframe
          key={loadImages ? 'img' : 'noimg'}
          title="メール本文(HTML)"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={doc}
          className="h-full w-full"
        />
      </div>
    </div>
  );
}
