'use server';

/**
 * 記事反応リストの一括操作(CLAUDE.md §5.13b。migration 117)。
 *
 * matchArticleReactionsByEmail: 一覧でチェックした行のメールアドレスを会員の email1〜3 と完全一致(小文字化)で
 * 照合し、1 人に絞れた行に会員ID・会員氏名を入れる。メールで当たらない行は読者名前が会員氏名と一致する会員が
 * 1 人だけなら紐付ける(2026-09-23)。複数候補・該当なし・メールなしの行は変えない。
 * 判断は純粋関数 matchReactionsByEmail。viewer 不可、1 回 500 件まで。
 * 書込みはサービスロール(article_reactions の RLS 書込は admin のみのため。§5.14 と同じ方針)。
 */

import { matchReactionsByEmail } from '@/lib/domain/article_reaction_clicks';
import {
  loadMemberCandidatesByNames,
  loadMembersByEmails,
} from '@/lib/domain/article_reaction_match_db';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';

const MAX_IDS = 500;
const CHUNK = 200;

export interface MatchByEmailResult {
  error?: string;
  linked?: number;
  /** linked のうち氏名一致で紐付けた件数 */
  linkedByName?: number;
  multiple?: number;
  none?: number;
  noEmail?: number;
}

export async function matchArticleReactionsByEmail(ids: string[]): Promise<MatchByEmailResult> {
  const me = await getCurrentUser();
  if (me.role === 'viewer') return { error: '閲覧専用ユーザーは会員検索を実行できません' };
  const targetIds = [...new Set(ids.map((s) => String(s).trim()).filter(Boolean))];
  if (targetIds.length === 0) return { error: '対象が選択されていません' };
  if (targetIds.length > MAX_IDS) return { error: `一度に処理できるのは ${MAX_IDS} 件までです` };

  const supabase = createServiceRoleClient();
  const { data: reactions, error: rErr } = await supabase
    .from('article_reactions')
    .select('id, email, member_name')
    .in('id', targetIds)
    .is('deleted_at', null);
  if (rErr) return { error: `記事反応の取得に失敗: ${rErr.message}` };
  const rows = (reactions ?? []) as Array<{
    id: string;
    email: string | null;
    member_name: string | null;
  }>;

  let members: Awaited<ReturnType<typeof loadMembersByEmails>>;
  try {
    // メールで当たらない行の氏名照合用に、読者名前(member_name。メールのある行だけ)と一致しうる会員も読む
    const withEmail = rows.filter((r) => (r.email ?? '').trim() !== '');
    const byEmail = await loadMembersByEmails(
      supabase,
      withEmail.map((r) => r.email ?? ''),
    );
    const byName = await loadMemberCandidatesByNames(
      supabase,
      withEmail.map((r) => r.member_name),
    );
    const merged = new Map(byEmail.map((m) => [m.id, m]));
    for (const m of byName) merged.set(m.id, m);
    members = [...merged.values()];
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const result = matchReactionsByEmail(
    rows.map((r) => ({ id: r.id, email: r.email, name: r.member_name })),
    members,
  );
  for (let i = 0; i < result.linked.length; i += CHUNK) {
    const batch = result.linked
      .slice(i, i + CHUNK)
      .map((l) => ({ id: l.id, member_id: l.memberId, member_name: l.memberName }));
    // 既存行だけを更新する(id はこの関数が DB から読んだもの)。upsert は渡した列だけを更新する
    const { error } = await supabase.from('article_reactions').upsert(batch, { onConflict: 'id' });
    if (error) return { error: `会員の紐付けに失敗: ${error.message}` };
  }

  revalidatePath('/article-reactions');
  return {
    linked: result.linked.length,
    linkedByName: result.linked.filter((l) => l.by === 'name').length,
    multiple: result.multiple.length,
    none: result.none.length,
    noEmail: result.noEmail.length,
  };
}
