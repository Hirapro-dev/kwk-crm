/**
 * 全体検索結果(会員/問合せ/申込を横断)。
 * ヘッダー検索ボックスから ?q= で遷移してくる。既存の一覧検索(q)を再利用。
 */

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listApplications } from '@/lib/domain/applications';
import { listInquiries } from '@/lib/domain/inquiries';
import { listMembers } from '@/lib/domain/members';

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

const PER = 20;

export default async function SearchPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  if (!q) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold">検索</h1>
        <p className="text-sm text-muted-foreground">
          ヘッダーの検索ボックスにキーワードを入力してください(会員/問合せ/申込を横断検索します)。
        </p>
      </div>
    );
  }

  const [members, inquiries, applications] = await Promise.all([
    listMembers({ q, page: 1, pageSize: PER }),
    listInquiries({ q, page: 1, pageSize: PER }),
    listApplications({ q, page: 1, pageSize: PER }),
  ]);

  const totalHits = members.total + inquiries.total + applications.total;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">「{q}」の検索結果</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          全 {totalHits.toLocaleString()} 件(会員 {members.total} / 問合せ {inquiries.total} / 申込{' '}
          {applications.total})
        </p>
      </div>

      {totalHits === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            該当するレコードが見つかりませんでした。
          </CardContent>
        </Card>
      ) : (
        <>
          <ResultCard title={`会員 (${members.total})`} more={members.total > PER ? `/members?q=${encodeURIComponent(q)}` : undefined}>
            {members.rows.length === 0 ? (
              <Empty />
            ) : (
              members.rows.map((m) => {
                // 会員ID・プロテクト者・電話番号・メールアドレス・住所・累計入金額
                const sub = [
                  m.id,
                  m.protect_by_user?.full_name,
                  m.phone1,
                  m.email1,
                  m.address,
                  m.total_paid_amount != null
                    ? `累計入金 ¥${m.total_paid_amount.toLocaleString()}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ・ ');
                return (
                  <ResultRow
                    key={m.id}
                    href={`/members/${m.id}`}
                    title={m.name ?? '(名称未設定)'}
                    sub={sub}
                  />
                );
              })
            )}
          </ResultCard>

          <ResultCard title={`問合せ (${inquiries.total})`} more={inquiries.total > PER ? `/inquiries?q=${encodeURIComponent(q)}` : undefined}>
            {inquiries.rows.length === 0 ? (
              <Empty />
            ) : (
              inquiries.rows.map((r) => (
                <ResultRow
                  key={r.id}
                  href={`/inquiries/${r.id}`}
                  title={r.name ?? '(氏名なし)'}
                  sub={`${r.id}${r.email ? ` ・ ${r.email}` : ''}${r.form?.name ? ` ・ ${r.form.name}` : ''}`}
                />
              ))
            )}
          </ResultCard>

          <ResultCard title={`申込 (${applications.total})`} more={applications.total > PER ? `/applications?q=${encodeURIComponent(q)}` : undefined}>
            {applications.rows.length === 0 ? (
              <Empty />
            ) : (
              applications.rows.map((a) => (
                <ResultRow
                  key={a.id}
                  href={`/applications/${a.id}`}
                  title={a.id}
                  sub={`${a.member?.name ?? a.member_id ?? ''}${a.project?.name ? ` ・ ${a.project.name}` : ''}`}
                />
              ))
            )}
          </ResultCard>
        </>
      )}
    </div>
  );
}

function ResultCard({
  title,
  more,
  children,
}: {
  title: string;
  more?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b py-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        {more && (
          <Link href={more} className="text-xs text-primary hover:underline">
            一覧で全件表示 →
          </Link>
        )}
      </CardHeader>
      <CardContent className="divide-y p-0">{children}</CardContent>
    </Card>
  );
}

function ResultRow({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href} className="block px-4 py-2 hover:bg-accent/40">
      <div className="text-sm font-medium text-primary">{title}</div>
      <div className="truncate text-xs text-muted-foreground">{sub}</div>
    </Link>
  );
}

function Empty() {
  return <p className="px-4 py-3 text-xs text-muted-foreground">該当なし</p>;
}
