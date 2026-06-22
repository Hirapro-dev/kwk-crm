'use client';

/**
 * アプリ画面用のエラー境界。`app/error.tsx` よりも詳細なフォールバック。
 */

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('App error:', error);
    }
  }, [error]);

  return (
    <div className="rounded border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-3">
        {/* 赤いアクセントアイコン */}
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          <span className="text-lg font-bold">!</span>
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="text-base font-bold text-foreground">
              画面の読み込み中にエラーが発生しました
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              フィルタ条件や検索キーワードが原因の場合があります。条件をクリアして再試行してください。
            </p>
          </div>

          {/* エラー詳細(開発時の調査用) */}
          {error.message && (
            <details className="rounded border bg-secondary/30 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-foreground">
                エラー詳細
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-destructive">
                {error.message}
              </pre>
              {error.digest && (
                <p className="mt-2 font-mono text-muted-foreground">
                  ErrorID: {error.digest}
                </p>
              )}
            </details>
          )}

          <div className="flex gap-2">
            <Button onClick={reset}>再試行</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
