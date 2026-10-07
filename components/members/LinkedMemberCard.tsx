import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** 紐付いた会員の表示用の値(会員側の現在の値。問合せ・申込の列ではない) */
export interface LinkedMember {
  id: string;
  name: string | null;
  phone1?: string | null;
  /** 電話番号2・3 は会員の extra のキー(§5.4) */
  phone2?: string | null;
  phone3?: string | null;
  email1?: string | null;
  email2?: string | null;
  email3?: string | null;
  address?: string | null;
}

/** 空を除き、同じ値は 1 つにまとめて改行でつなぐ(電話・メールの 2 つ目以降も出す。2026-10-07) */
export function joinContacts(values: ReadonlyArray<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? '').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.join('\n');
}

/**
 * 問合せ・申込の詳細に出す「会員情報」カード(2026-10-07)。会員に紐付いているレコードだけに出す。
 * 値は会員(members)から読むので、会員側を直せばここにも反映される。会員ID・氏名は会員詳細へのリンク。
 */
export function LinkedMemberCard({ member }: { member: LinkedMember | null | undefined }) {
  if (!member) return null;
  const memberLink = (text: string) => (
    <Link href={`/members/${member.id}`} className="text-primary hover:underline">
      {text}
    </Link>
  );
  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: '会員ID', value: memberLink(member.id) },
    { label: '会員氏名', value: member.name ? memberLink(member.name) : '-' },
    {
      label: '電話番号',
      value: joinContacts([member.phone1, member.phone2, member.phone3]) || '-',
    },
    {
      label: 'メールアドレス',
      value: joinContacts([member.email1, member.email2, member.email3]) || '-',
    },
    { label: '住所', value: member.address || '-' },
  ];
  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">会員情報</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 flex-col border-b pb-2 lg:border-b-0">
              <dt className="truncate text-xs font-semibold tracking-wide text-slate-600">
                {r.label}
              </dt>
              <dd className="min-w-0 whitespace-pre-wrap break-words text-[15px] text-slate-900">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
