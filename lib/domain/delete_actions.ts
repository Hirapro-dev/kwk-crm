'use server';

/**
 * 一覧画面からのレコード論理削除 (単体・一括) の Server Actions。
 *
 * 仕様書 §4.3: 物理削除禁止。deleted_at をセットする論理削除のみ。
 * 権限: admin のみ (既存の会員削除・対応歴削除と同じ)。
 *   UI 側でもボタンを出さないが、UI を迂回されても RPC 側 (migration 73) の
 *   admin チェックで弾かれる。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/** 一覧から削除できるオブジェクトと、削除後に再検証する一覧パス。 */
const DELETABLE_OBJECTS = {
  members: '/members',
  inquiries: '/inquiries',
  applications: '/applications',
  article_reactions: '/article-reactions',
  withdrawal_parents: '/withdrawal-parents',
  withdrawal_children: '/withdrawal-children',
} as const;

export type DeletableObject = keyof typeof DELETABLE_OBJECTS;

/**
 * 一度に削除できる上限。RPC 側 (migration 73) と同じ値。
 * 誤操作時の被害を限定するための安全弁で、
 * 「全選択」が画面に読み込み済みの行のみを対象とする仕様のため通常は到達しない。
 * ※ 'use server' ファイルは async 関数以外を export できないため非公開にしている。
 */
const DELETE_MAX_IDS = 500;

export interface DeleteRecordsResult {
  /** 実際に論理削除された件数 (既に削除済みの行は数えない) */
  deleted?: number;
  error?: string;
}

/**
 * 選択されたレコードをまとめて論理削除する。
 *
 * @param object 対象オブジェクト (ホワイトリスト外は拒否)
 * @param ids    主キーの配列。対象6オブジェクトはいずれも text 主キー。
 */
export async function deleteRecords(
  object: DeletableObject,
  ids: string[],
): Promise<DeleteRecordsResult> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { error: '削除は管理者のみ可能です' };
  }

  const listPath = DELETABLE_OBJECTS[object];
  if (!listPath) {
    return { error: '削除できないオブジェクトです' };
  }

  // 空文字・重複を除いてから送る (チェックボックスの取り違え対策)
  const cleaned = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id !== '')));
  if (cleaned.length === 0) {
    return { error: '削除するレコードが選択されていません' };
  }
  if (cleaned.length > DELETE_MAX_IDS) {
    return { error: `一度に削除できるのは${DELETE_MAX_IDS}件までです` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('soft_delete_records', {
    p_object: object,
    p_ids: cleaned,
  });

  if (error) {
    // migration 73 未適用 (関数なし) などのケース
    return { error: `削除に失敗しました: ${error.message}` };
  }

  revalidatePath(listPath);
  return { deleted: typeof data === 'number' ? data : cleaned.length };
}
