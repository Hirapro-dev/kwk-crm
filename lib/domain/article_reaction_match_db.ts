/**
 * 記事反応リストの会員照合で使う DB 参照(CLAUDE.md §5.13b)。判断は純粋関数 matchReactionsByEmail が行い、
 * ここはメールアドレスの一覧から候補の会員(削除済みを除く)を読むだけ。取込(import_article_reaction_clicks.ts)と
 * 一括の会員検索(article_reaction_actions.ts)の両方から使う。サービスロールのクライアントを渡すこと。
 */

import { type MemberForMatch, normalizeName } from '@/lib/domain/article_reaction_clicks';

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

/** ilike のパターンに使えない文字(% _ , ( ) と空白)を含む名前は候補検索の対象外にする */
const UNSAFE_NAME = /[%_,()\s\u3000\\]/;

/**
 * 読者名前と一致しうる会員の候補を返す(氏名照合の前段。2026-09-23)。
 * 会員氏名は「久保田 雄樹」のように空白が入ることがあるため、空白を除いた名前の各文字の間に % を挟んだ
 * ilike で候補を引き、厳密な一致(空白を除いて等しい)は純粋関数側で判定する。
 */
export async function loadMemberCandidatesByNames(
  supabase: Db,
  names: Array<string | null | undefined>,
): Promise<MemberForMatch[]> {
  const list = [
    ...new Set(names.map((n) => normalizeName(n)).filter((n) => n && !UNSAFE_NAME.test(n))),
  ];
  const members = new Map<string, MemberForMatch>();
  const PER = 50;
  for (let i = 0; i < list.length; i += PER) {
    const chunk = list.slice(i, i + PER);
    const or = chunk.map((n) => `name.ilike.${[...n].join('%')}`).join(',');
    const { data, error } = await supabase
      .from('members')
      .select('id, name, email1, email2, email3')
      .is('deleted_at', null)
      .or(or)
      .limit(1000);
    if (error) throw new Error(`会員の検索(氏名)に失敗: ${error.message}`);
    for (const m of (data ?? []) as MemberForMatch[]) {
      if (chunk.includes(normalizeName(m.name))) members.set(m.id, m);
    }
  }
  return [...members.values()];
}
