/**
 * 移行スクリプト共通: forms テーブルから name → id のマップを取得
 * inquiries 移行時に form_name → form_id 解決に使用
 */

import type { MigrateClient } from './db';

export interface FormLite {
  id: number;
  name: string;
}

export async function loadFormsMap(supabase: MigrateClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('forms')
      .select('id, name')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`forms ロード失敗: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const f of data as FormLite[]) {
      map.set(f.name, f.id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}
