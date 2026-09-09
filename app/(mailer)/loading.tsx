/**
 * (mailer) グループ(メーラー)のローディング。一覧・スレッドの枠だけ先に出す。
 */

export default function Loading() {
  return (
    <div className="space-y-3 p-2">
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="h-64 animate-pulse rounded-lg border bg-card" />
    </div>
  );
}
