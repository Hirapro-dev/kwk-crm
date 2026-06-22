/**
 * (app) グループ全体のローディング(Server Component の suspense 境界)。
 * 仕様書 §10 Phase 7 仕上げ。
 */

export default function Loading() {
  return (
    <div className="space-y-4 p-2">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-card" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border bg-card" />
    </div>
  );
}
