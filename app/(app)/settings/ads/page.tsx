/**
 * /settings/ads — 広告マスタ(管理者用。CLAUDE.md §5.18)
 * 広告ID / 広告種別 / 広告媒体名 の一覧・追加・行内編集(有効/無効)。/settings 配下のため admin チェック済み。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listAdMasters, listAdTypes } from '@/lib/domain/masters';
import Link from 'next/link';
import { AdMasterRow } from './AdMasterRow';
import { NewAdMasterForm } from './NewAdMasterForm';

export default async function SettingsAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const [ads, adTypes] = await Promise.all([
    listAdMasters({ q: sp.q, adType: sp.type || undefined }),
    listAdTypes(),
  ]);

  return (
    <div className="space-y-3">
      <NewAdMasterForm adTypes={adTypes} />
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="AD"
          iconColor="#0ea5e9"
          viewName="広告マスタ"
          totalCount={ads.length}
        />
        <PanelFilterBar>
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="広告ID・広告媒体名で検索"
              className="h-8 w-72 rounded border border-input bg-white px-2 text-sm"
            />
            <select
              name="type"
              defaultValue={sp.type ?? ''}
              className="h-8 rounded border border-input bg-white px-2 text-sm"
              aria-label="広告種別で絞り込み"
            >
              <option value="">種別: すべて</option>
              {adTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-8 rounded bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              検索
            </button>
            {(sp.q || sp.type) && (
              <Link href="/settings/ads" className="sf-link text-sm">
                クリア
              </Link>
            )}
          </form>
        </PanelFilterBar>
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9 w-28">広告ID</TableHead>
              <TableHead className="h-9 w-40">広告種別</TableHead>
              <TableHead className="h-9">広告媒体名</TableHead>
              <TableHead className="h-9 w-16 text-center">有効</TableHead>
              <TableHead className="h-9 w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                  該当する広告がありません(migration 96 が未適用の場合は空になります)
                </TableCell>
              </TableRow>
            ) : (
              ads.map((ad) => <AdMasterRow key={ad.id} ad={ad} />)
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
