'use server';

/**
 * メニューバー(ナビゲーション)設定の保存 Server Action (admin 限定)。
 * CLAUDE.md §5.10b 参照。並び順 + 表示ON/OFF を一括保存する。
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './auth';
import { DEFAULT_NAV_ITEMS } from './nav_items';

export interface NavActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface NavSaveItem {
  id: string;
  sort_order: number;
  is_visible: boolean;
}

export async function saveNavOrder(items: NavSaveItem[]): Promise<NavActionResult> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: 'ナビゲーション設定は admin のみ可能です' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: '更新する項目がありません' };
  }

  const supabase = await createClient();
  const defById = new Map(DEFAULT_NAV_ITEMS.map((d) => [d.id, d]));

  // upsert で保存(migration 適用済みなら更新、テーブル空でも作成される)。
  // label / href / match_prefix は本機能では編集対象外のため既定値で固定する。
  let updated = 0;
  for (const it of items) {
    const def = defById.get(it.id);
    if (!def) continue; // 既知のナビ項目のみ許可(ホワイトリスト)
    const { error } = await supabase.from('nav_items').upsert(
      {
        id: it.id,
        label: def.label,
        href: def.href,
        match_prefix: def.match_prefix,
        sort_order: it.sort_order,
        is_visible: it.is_visible,
      },
      { onConflict: 'id' },
    );
    if (error) {
      return { ok: false, error: `${it.id} の保存に失敗しました: ${error.message}` };
    }
    updated++;
  }

  // メニューバーは共通レイアウトで描画されるためレイアウトごと再検証する
  revalidatePath('/', 'layout');
  return { ok: true, message: `${updated}件の設定を保存しました` };
}

/** ロール管理(/settings/roles): メニュー項目ごとの表示許可ロールを保存する */
export interface NavRoleSaveItem {
  id: string;
  /** null = 全ロール表示 */
  visible_roles: string[] | null;
}

const VALID_ROLES = new Set(['admin', 'manager', 'sales', 'viewer', 'support']);

export async function saveNavRoles(items: NavRoleSaveItem[]): Promise<NavActionResult> {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    return { ok: false, error: 'ロール管理は admin のみ可能です' };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: '更新する項目がありません' };
  }

  const supabase = await createClient();
  const defById = new Map(DEFAULT_NAV_ITEMS.map((d) => [d.id, d]));

  let updated = 0;
  for (const it of items) {
    const def = defById.get(it.id);
    if (!def) continue; // 既知のナビ項目のみ許可(ホワイトリスト)
    // ロール値の検証(不正な文字列はDBに入れない)
    const roles =
      it.visible_roles === null ? null : it.visible_roles.filter((r) => VALID_ROLES.has(r));
    if (roles !== null && roles.length === 0) {
      return { ok: false, error: `「${def.label}」の表示ロールが0件です(誰も見られなくなります)` };
    }
    // upsert(migration 適用済みなら更新、行が無くても既定値で作成される)。
    // sort_order / is_visible は /settings/navigation の管理対象のため触らない
    // (行が無い場合のみ既定値が入る)。
    const { error } = await supabase.from('nav_items').upsert(
      {
        id: it.id,
        label: def.label,
        href: def.href,
        match_prefix: def.match_prefix,
        parent_id: def.parent_id ?? null,
        visible_roles: roles,
      },
      { onConflict: 'id' },
    );
    if (error) {
      return { ok: false, error: `${it.id} の保存に失敗しました: ${error.message}` };
    }
    updated++;
  }

  revalidatePath('/', 'layout');
  return { ok: true, message: `${updated}件のロール設定を保存しました` };
}
