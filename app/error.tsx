'use client';

/**
 * グローバルエラー境界(仕様書 §12.4: 個人情報をログに出さない)。
 * Next.js が render-time / Server Component で投げられた例外をキャッチする。
 */

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 本番運用ではここで監視サービスに送る想定。
    // 個人情報を含む可能性があるため、message は出さず digest のみ。
    if (process.env.NODE_ENV !== 'production') {
      console.error('App error:', error);
    }
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold">予期せぬエラーが発生しました</h2>
      <p className="text-sm text-muted-foreground">
        画面を再読込しても解決しない場合は、管理者にご連絡ください。
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          ErrorID: {error.digest}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={reset}>再試行</Button>
        <Button variant="outline" onClick={() => window.location.assign('/')}>
          ダッシュボードへ
        </Button>
      </div>
    </div>
  );
}
