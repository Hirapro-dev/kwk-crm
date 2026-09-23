/**
 * 記事反応リストの会員照合で使う DB 参照(CLAUDE.md §5.13b)。判断は純粋関数 matchReactionsByEmail が行い、
 * ここはメールアドレスの一覧から候補の会員(削除済みを除く)を読むだけ。取込(import_article_reaction_clicks.ts)と
 * 一括の会員検索(article_reaction_actions.ts)の両方から使う。サービスロールのクライアントを渡すこと。
 */

import type { MemberForMatch } from '@/lib/domain/article_reaction_clicks';

const CHUNK = 200;

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;

/** email1〜3 のどれかが一覧のメール(小文字)に一致する会員を返す(会員ID で重複なし) */
export async function loadMembersByEmails(
  supabase: Db,
  emails: string[],
): Promise<MemberForMatch[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const members = new Map<string, MemberForMatch>();
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    for (const col of ['email1', 'email2', 'email3'] as const) {
      const { data, error } = await supabase
        .from('members')
        .select('id, name, email1, email2, email3')
        .is('deleted_at', null)
        .in(col, chunk);
      if (error) throw new Error(`会員の検索に失敗: ${error.message}`);
      for (const m of (data ?? []) as MemberForMatch[]) members.set(m.id, m);
    }
  }
  return [...members.values()];
}
