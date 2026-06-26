/**
 * 監査ログ(アクティブログ) — admin のみ。誰がいつ何を作成/編集/削除したかを表示。
 * /settings 配下なので layout で admin 制御済み。 (CLAUDE.md §5.12)
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type AuditAction,
  type AuditLogRow,
  TABLE_LABEL,
  displayAction,
  fieldLabel,
  listAuditActorOptions,
  listAuditLog,
} from '@/lib/domain/audit_log';
import { formatDateTime } from '@/lib/utils/date';
import { AuditLogFilterBar } from './AuditLogFilterBar';

export const metadata = { title: '監査ログ' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    table?: string;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
  }>;
}

const ACTION_STYLE: Record<string, string> = {
  作成: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  編集: 'bg-blue-50 text-blue-700 border-blue-200',
  削除: 'bg-red-50 text-red-700 border-red-200',
  復元: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** 値を表示用に短く整形 */
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(空)';
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.length > 40) s = `${s.slice(0, 40)}…`;
  return s;
}

function ChangeDetail({ row }: { row: AuditLogRow }) {
  if (row.action === 'INSERT') return <span className="text-muted-foreground">新規作成</span>;
  if (row.action === 'DELETE') return <span className="text-muted-foreground">物理削除</span>;
  const entries = Object.entries(row.changes ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="space-y-0.5">
      {entries.map(([col, ch]) => (
        <div key={col} className="text-xs">
          <span className="font-medium">{fieldLabel(col)}</span>:{' '}
          <span className="text-muted-foreground line-through">{fmtVal(ch.old)}</span>{' '}
          <span aria-hidden>→</span> <span className="text-foreground">{fmtVal(ch.new)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const action = (sp.action || undefined) as AuditAction | undefined;

  const [rows, actorOptions] = await Promise.all([
    listAuditLog({
      tableName: sp.table || undefined,
      actorId: sp.actor || undefined,
      action,
      from: sp.from ? `${sp.from}T00:00:00+09:00` : undefined,
      to: sp.to ? `${sp.to}T23:59:59+09:00` : undefined,
      limit: 300,
    }),
    listAuditActorOptions(),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="AUD"
          iconColor="#e11d48"
          viewName="監査ログ(操作履歴)"
          totalCount={rows.length}
          actions={<span className="text-xs text-muted-foreground">最新 {rows.length} 件</span>}
        />
        <div className="px-4 py-2 text-xs text-muted-foreground">
          会員・申込・対応歴・ユーザーに対する作成/編集/削除の履歴です（最大300件・最新順）。一括取込など実行者が特定できない操作は記録されません。
        </div>
        <PanelFilterBar>
          <AuditLogFilterBar
            initialTable={sp.table ?? ''}
            initialAction={sp.action ?? ''}
            initialActor={sp.actor ?? ''}
            initialFrom={sp.from ?? ''}
            initialTo={sp.to ?? ''}
            actorOptions={actorOptions}
          />
        </PanelFilterBar>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50 hover:bg-gray-50">
                <TableHead className="h-9 whitespace-nowrap">日時</TableHead>
                <TableHead className="h-9 whitespace-nowrap">実行者</TableHead>
                <TableHead className="h-9 whitespace-nowrap">操作</TableHead>
                <TableHead className="h-9 whitespace-nowrap">対象</TableHead>
                <TableHead className="h-9 whitespace-nowrap">レコードID</TableHead>
                <TableHead className="h-9">変更内容</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    記録がありません
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const act = displayAction(r);
                  return (
                    <TableRow key={r.id} className="sf-row-hover align-top">
                      <TableCell className="whitespace-nowrap py-2 text-xs">
                        {formatDateTime(r.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-sm font-medium">
                        {r.actor_name ?? '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2">
                        <Badge variant="outline" className={ACTION_STYLE[act] ?? ''}>
                          {act}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 text-sm">
                        {TABLE_LABEL[r.table_name] ?? r.table_name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2 font-mono text-xs">
                        {r.record_id ?? '-'}
                      </TableCell>
                      <TableCell className="py-2">
                        <ChangeDetail row={r} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
