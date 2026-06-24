/**
 * /settings/flows — フロー自動化ルール管理
 *
 * 対応歴の「状態」フラグに応じて会員のプロテクトを自動設定するルールを管理する。
 * Salesforce Flow 相当の機能。
 */

import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { getAllActiveProtects } from '@/lib/domain/dashboard';
import { listFlowRules } from '@/lib/domain/flow_rules';
import { formatDateTime } from '@/lib/utils/date';
import { FlowRuleList } from './FlowRuleList';

function daysUntil(isoStr: string): number {
  return Math.ceil((new Date(isoStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default async function SettingsFlowsPage() {
  const [rules, activeProtects] = await Promise.all([
    listFlowRules(),
    getAllActiveProtects(),
  ]);

  const expiringSoon = activeProtects.filter((m) => daysUntil(m.protect_expires_at) <= 3);
  const expiringSoonIds = new Set(expiringSoon.map((m) => m.id));

  return (
    <div className="space-y-3">
      {/* 説明カード */}
      <Card className="p-4 text-sm text-muted-foreground space-y-1.5">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-primary" />
          フロー自動化について
        </div>
        <p>
          対応歴の入力時、「状態」チェックボックスの値とトリガーが一致したルールが自動実行されます。
        </p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>
            <strong>N日後のHH:MM</strong> — 登録日から N日後の指定時刻(JST)にプロテクトを解除します。Vercel Cron が毎日処理します。
          </li>
          <li>
            <strong>N時間後</strong> — 登録から N時間後に自動解除します。
          </li>
        </ul>
        <p className="text-xs">
          複数のルールがマッチした場合は「並び順」が小さいルールが優先されます。
        </p>
      </Card>

      {/* ルール一覧 */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="FLW"
          iconColor="#8b5cf6"
          viewName="フロー一覧"
          totalCount={rules.length}
        />
        <div className="p-4 space-y-3">
          <FlowRuleList rules={rules} />
        </div>
      </Card>

      {/* 現在プロテクト中の会員 */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="PRT"
          iconColor="#f59e0b"
          viewName="現在プロテクト中の会員"
          totalCount={activeProtects.length}
        />
        <CardContent className="p-0">
          {activeProtects.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">現在プロテクト中の会員はいません</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="bg-gray-50 hover:bg-gray-50">
                    <TableHead className="h-9 whitespace-nowrap">解除日時</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">残り</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">会員ID</TableHead>
                    <TableHead className="h-9">会員名</TableHead>
                    <TableHead className="h-9 whitespace-nowrap">プロテクト担当</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeProtects.map((m) => {
                    const days = daysUntil(m.protect_expires_at);
                    const isSoon = expiringSoonIds.has(m.id);
                    return (
                      <TableRow key={m.id} className="sf-row-hover">
                        <TableCell className={`whitespace-nowrap py-2 text-xs font-medium ${isSoon ? 'text-destructive' : ''}`}>
                          {formatDateTime(m.protect_expires_at)}
                        </TableCell>
                        <TableCell className={`whitespace-nowrap py-2 text-xs ${isSoon ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                          {days <= 0 ? '期限切れ' : `${days}日後`}
                        </TableCell>
                        <TableCell className="py-2 font-mono text-xs">
                          <Link href={`/members/${m.id}`} className="text-primary hover:underline">
                            {m.id}
                          </Link>
                        </TableCell>
                        <TableCell className="py-2 text-sm">{m.name ?? '-'}</TableCell>
                        <TableCell className="py-2 text-sm">
                          {m.protect_by_user?.full_name ?? '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
