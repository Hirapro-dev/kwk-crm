/**
 * 定期取込(Google Drive 連携)設定ページ (#1 / admin 限定 / CLAUDE.md §5.10c)
 *
 * 各オブジェクトに Drive の指定CSVを紐づけ、ボタン1つでプレビュー→取込(upsert)する。
 * /settings レイアウトで admin チェック済み。
 */

import { getImportSources } from '@/lib/domain/import_sources';
import { getProtectImportSource } from '@/lib/domain/protect_import_actions';
import { isDriveConfigured } from '@/lib/google/drive';
import { DriveImportPanel } from './DriveImportPanel';
import { ProtectImportPanel } from './ProtectImportPanel';

// 大量行(会員 約2.4万件)の取込に備え、実行時間上限を確保(Vercel 最大300s)
export const maxDuration = 300;

export default async function ImportRoutinePage() {
  const [sources, protectSource] = await Promise.all([getImportSources(), getProtectImportSource()]);
  const configured = isDriveConfigured();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">定期取込（Google Drive 連携）</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Google Drive 上の指定CSVを各オブジェクトに紐づけ、ボタン1つで取込（IDで突合・無ければ新規）します。
          確定前にプレビューできます。
        </p>
      </div>
      <DriveImportPanel sources={sources} configured={configured} />

      <div>
        <h2 className="mb-2 text-sm font-bold text-muted-foreground">プロテクト設定取込</h2>
        <ProtectImportPanel source={protectSource} configured={configured} />
      </div>
    </div>
  );
}
