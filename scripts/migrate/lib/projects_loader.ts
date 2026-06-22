/**
 * 移行スクリプト共通: projects テーブルから name → id マップを取得
 * applications 移行時に project_name → project_id 解決に使用
 */

import type { MigrateClient } from './db';

export interface ProjectLite {
  id: number;
  name: string;
}

export async function loadProjectsMap(supabase: MigrateClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`projects ロード失敗: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const p of data as ProjectLite[]) {
      map.set(p.name, p.id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}
