/**
 * データ取込ページ (#2 突発アップロード / admin 限定)
 *
 * オブジェクトのテンプレCSVをダウンロード → 入力 → アップロード →
 * ドライランプレビュー(新規/更新/エラー件数) → 確定で upsert。
 * /settings レイアウトで admin チェック済み。CLAUDE.md §6 / §5.9。
 */

import { ImportPanel } from './ImportPanel';

// 大量行の取込に備え、実行時間上限を確保(Vercel 最大300s)
export const maxDuration = 300;

export default function ImportSettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">データ取込（CSVアップロード）</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          オブジェクトのテンプレートCSVをダウンロードして入力し、アップロードでレコードを更新・追加します。
          IDで突合し、既存なら更新・無ければ新規作成します。確定前に内容をプレビューできます。
        </p>
      </div>
      <ImportPanel />
    </div>
  );
}
