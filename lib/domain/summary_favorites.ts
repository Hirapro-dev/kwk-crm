'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from './auth';

/**
 * サマリお気に入り (CLAUDE.md §5.11)。
 * フォーム集計などのサマリ表示条件を保存し、ダイアログから再表示する。
 * テーブル未適用(migration 37 未実行)時はフォールバックして画面を壊さない。
 */

export interface SummaryFavorite {
  id: string;
  name: string;
  summary_type: string;
  config: Record<string, string>;
  visibility: 'private' | 'public';
  created_by: string | null;
  creator_name: string | null;
}

const SELECT = `id, name, summary_type, config, visibility, created_by,
  creator:users!summary_favorites_created_by_fkey(full_name)`;

/** 閲覧可能なお気に入り一覧(RLSで public + 自分のものに自然に絞られる)。 */
export async function listSummaryFavorites(): Promise<SummaryFavorite[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('summary_favorites')
      .select(SELECT)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      summary_type: r.summary_type as string,
      config: (r.config as Record<string, string>) ?? {},
      visibility: r.visibility as 'private' | 'public',
      created_by: (r.created_by as string | null) ?? null,
      creator_name:
        ((r.creator as { full_name: string | null } | null)?.full_name as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

/** お気に入りを作成する。 */
export async function createSummaryFavorite(input: {
  name: string;
  summaryType: string;
  config: Record<string, string>;
  visibility: 'private' | 'public';
}): Promise<{ error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: '名前を入力してください' };
  try {
    const me = await getCurrentUser();
    const supabase = await createClient();
    const { error } = await supabase.from('summary_favorites').insert({
      name,
      summary_type: input.summaryType,
      config: input.config,
      visibility: input.visibility,
      created_by: me.id,
    });
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : '保存に失敗しました' };
  }
}

/** お気に入りを論理削除する(作成者 or admin)。 */
export async function deleteSummaryFavorite(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('summary_favorites')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : '削除に失敗しました' };
  }
}
