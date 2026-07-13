'use server';

/**
 * ヘッダー検索ボックスのインクリメンタル検索(候補ドロップダウン)用 Server Action。
 * 会員/問合せ/申込を横断し、各カテゴリ最大5件を整形して返す。
 * 既存の一覧検索(listMembers / listInquiries / listApplications)を再利用するため、
 * RLS は実行ユーザーの権限で自然に適用される(全体検索ページ /search と同じ挙動)。
 */

import { listApplications } from './applications';
import { listInquiries } from './inquiries';
import { listMembers } from './members';

export type QuickSearchKind = 'member' | 'inquiry' | 'application';

export interface QuickSearchItem {
  kind: QuickSearchKind;
  /** 表示用オブジェクト名(顧客情報 / 問合せ / 申込) */
  objectLabel: string;
  /** クリック時の遷移先(詳細ページ) */
  href: string;
  /** タイトル(氏名など) */
  title: string;
  /** サブ情報(「・」区切りで整形済み) */
  sub: string;
}

/** カテゴリごとの候補表示上限 */
const PER_KIND = 5;

export async function quickSearch(qRaw: string): Promise<QuickSearchItem[]> {
  const q = (qRaw ?? '').trim();
  if (!q) return [];

  const [members, inquiries, applications] = await Promise.all([
    listMembers({ q, page: 1, pageSize: 10 }),
    listInquiries({ q, page: 1, pageSize: 10 }),
    listApplications({ q, page: 1, pageSize: 10 }),
  ]);

  const items: QuickSearchItem[] = [];

  // 顧客情報: ID・電話番号・住所・メールアドレス
  for (const m of members.rows.slice(0, PER_KIND)) {
    items.push({
      kind: 'member',
      objectLabel: '顧客情報',
      href: `/members/${m.id}`,
      title: m.name ?? '(名称未設定)',
      sub: [m.id, m.phone1, m.address, m.email1].filter(Boolean).join(' ・ '),
    });
  }

  // 問合せ: ID・メール・フォーム名
  for (const r of inquiries.rows.slice(0, PER_KIND)) {
    items.push({
      kind: 'inquiry',
      objectLabel: '問合せ',
      href: `/inquiries/${r.id}`,
      title: r.name ?? '(氏名なし)',
      sub: [r.id, r.email, r.form?.name].filter(Boolean).join(' ・ '),
    });
  }

  // 申込: ID・案件名
  for (const a of applications.rows.slice(0, PER_KIND)) {
    items.push({
      kind: 'application',
      objectLabel: '申込',
      href: `/applications/${a.id}`,
      title: a.member?.name ?? a.member_id ?? a.id,
      sub: [a.id, a.project?.name].filter(Boolean).join(' ・ '),
    });
  }

  return items;
}
