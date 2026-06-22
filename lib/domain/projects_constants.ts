/**
 * projects ドメインの client-safe な型のみ。
 * Client Component からも安全に import できる(server only モジュールに依存しない)。
 *
 * lib/domain/projects.ts は createClient (next/headers) を import するため、
 * Client から直接 import すると next/headers が Client バンドルに混入してビルドエラーになる。
 * 定数だけを使う Client Component はこのファイルから取る。
 *
 * 2026-05 更新: projects.category カラムを廃止したため ProjectCategory 型・列挙を削除。
 */

export interface Project {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
