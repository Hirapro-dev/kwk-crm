import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold">ページが見つかりません</h2>
      <p className="text-sm text-muted-foreground">
        URL をお確かめください。リンク切れの場合は管理者にご連絡ください。
      </p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        ダッシュボードへ
      </Link>
    </div>
  );
}
