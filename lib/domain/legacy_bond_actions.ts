'use server';

/**
 * 旧社債管理の編集・次の期の作成(CLAUDE.md §5.13c「編集・自動計算・次の期の自動作成」。migration 130)。admin のみ。
 * 計算と入力の検証は純粋関数(lib/domain/legacy_bonds_calc.ts)。ここは DB とのやり取りだけ。
 * 書込みはサービスロール(作成を取り消すときの論理削除が、閲覧ポリシー(deleted_at IS NULL)で拒否されないように)。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import {
  type LegacyBondEditInput,
  buildLegacyBondPatch,
  planNextLegacyBond,
} from '@/lib/domain/legacy_bonds_calc';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const CALC_COLS =
  'id,member_id,member_name,application_no,application_id,project_name,project_id,bond_name,payment_amount,redemption_month,redemption_amount,prev_principal,prev_years,prev_interest_rate,result,partial_continue_amount,partial_redemption_amount,bank_info,withholding_exempt,next_bond_id';

async function requireAdmin(): Promise<string | null> {
  const me = await getCurrentUser();
  return me.role === 'admin' ? null : '旧社債管理を変更できるのは管理者のみです';
}

async function loadBond(id: string) {
  if (!/^KS-\d{9}$/.test(id)) return null;
  const { data } = await createServiceRoleClient()
    .from('legacy_bonds')
    .select(CALC_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return data as unknown as Parameters<typeof planNextLegacyBond>[0] & { id: string };
}

/** 詳細の「編集」を保存する。利息・源泉税・償還金額・一部継続金額は計算し直す */
export async function updateLegacyBond(
  id: string,
  input: LegacyBondEditInput,
): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const cur = await loadBond(id);
  if (!cur) return { error: '旧社債管理の行が見つかりません' };
  const r = buildLegacyBondPatch(cur, input);
  if (!r.patch) return { error: r.error };
  const { error } = await createServiceRoleClient()
    .from('legacy_bonds')
    .update(r.patch)
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  revalidatePath('/legacy-bonds');
  revalidatePath(`/legacy-bonds/${id}`);
  return {};
}

/** 継続した行から次の期の行を作る(年数を選ぶ)。作った行の ID を返す */
export async function continueLegacyBond(
  id: string,
  years: number,
): Promise<{ nextId?: string; error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const cur = await loadBond(id);
  if (!cur) return { error: '旧社債管理の行が見つかりません' };
  const plan = planNextLegacyBond(cur, Number(years));
  if (!plan.row) return { error: plan.error };

  const admin = createServiceRoleClient();
  // ID は DB の既定値 gen_legacy_bond_id()(KS-001000000 から)
  const { data: created, error: insErr } = await admin
    .from('legacy_bonds')
    .insert(plan.row)
    .select('id')
    .single();
  if (insErr || !created) return { error: `次の期の作成に失敗しました: ${insErr?.message ?? ''}` };
  const nextId = (created as { id: string }).id;

  // 元の行に次の期を記録する。同時に 2 回押された場合は先に記録した方だけを残し、こちらで作った行は取り消す
  const { data: linked, error: linkErr } = await admin
    .from('legacy_bonds')
    .update({ next_bond_id: nextId })
    .eq('id', id)
    .is('next_bond_id', null)
    .select('id');
  if (linkErr || !linked || linked.length === 0) {
    await admin
      .from('legacy_bonds')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', nextId);
    return { error: '次の期は既に作成されています(画面を読み直してください)' };
  }

  revalidatePath('/legacy-bonds');
  revalidatePath(`/legacy-bonds/${id}`);
  if (cur.member_id) revalidatePath(`/members/${cur.member_id}`);
  return { nextId };
}
