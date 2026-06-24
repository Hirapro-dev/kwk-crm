/**
 * プロテクト会員一覧 /members/protects
 * 有効なプロテクト全件を「残り日数」ごとにグルーピング表示する。
 */

import Link from 'next/link';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getAllActiveProtects, type ProtectExpiringMember } from '@/lib/domain/dashboard';
import { formatDateTime } from '@/lib/utils/date';

export const metadata = { title: 'プロテクト会員一覧' };

// 残り日数ラベルと色を返す
function remainInfo(expiresAt: string): {
  days: number;
  label: string;
  color: string;
} {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return { days, label: '期限切れ', color: 'text-muted-foreground' };
  if (days === 1) return { days, label: '残り1日', color: 'text-destructive font-semibold' };
  if (days <= 3) return { days, label: `残り${days}日`, color: 'text-orange-500 font-medium' };
  return { days, label: `残り${days}日`, color: 'text-muted-foreground' };
}

// 残り日数 → グループキー（期限切れは -1 でまとめる）
function groupKey(expiresAt: string): number {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return days <= 0 ? -1 : days;
}

function groupLabel(key: number): string {
  if (key === -1) return '期限切れ';
  if (key === 1) return '残り1日';
  return `残り${key}日`;
}

function groupBadgeVariant(key: number): 'destructive' | 'outline' {
  return key !== -1 && key <= 3 ? 'destructive' : 'outline';
}

export default async function ProtectsPage() {
  const members = await getAllActiveProtects();

  // 残り日数でグルーピング
  const groups = new Map<number, ProtectExpiringMember[]>();
  for (const m of members) {
    const key = groupKey(m.protect_expires_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  // キーを昇順ソート（期限切れ=-1 は末尾）
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === -1) return 1;
    if (b === -1) return -1;
    return a - b;
  });

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="MEM"
          iconColor="#1589ee"
          viewName="プロテクト会員一覧"
          actions={
            <Link
              href="/members"
              className="text-xs text-muted-foreground hover:underline"
            >
              ← 会員一覧へ
            </Link>
          }
        />
      </Card>

      {members.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            現在プロテクト中の会員はいません
          </CardContent>
        </Card>
      ) : (
        sortedKeys.map((key) => {
          const rows = groups.get(key)!;
          return (
            <Card key={key} className="overflow-hidden">
              {/* グループヘッダー */}
              <div className="flex items-center gap-2 border-b bg-gray-50 px-4 py-2.5">
                <Badge variant={groupBadgeVariant(key)} className="text-xs">
                  {groupLabel(key)}
                </Badge>
                <span className="text-xs text-muted-foreground">{rows.length}件</span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 text-xs">解除日時</TableHead>
                    <TableHead className="h-8 text-xs">残り日数</TableHead>
                    <TableHead className="h-8 text-xs">会員ID</TableHead>
                    <TableHead className="h-8 text-xs">会員名</TableHead>
                    <TableHead className="h-8 text-xs">担当者</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((m) => {
                    const { label, color } = remainInfo(m.protect_expires_at);
                    const isUrgent = key !== -1 && key <= 3;
                    return (
                      <TableRow key={m.id} className="sf-row-hover">
                        <TableCell
                          className={`whitespace-nowrap py-2 text-xs font-medium ${isUrgent ? 'text-destructive' : ''}`}
                        >
                          {formatDateTime(m.protect_expires_at)}
                        </TableCell>
                        <TableCell className={`whitespace-nowrap py-2 text-xs ${color}`}>
                          {label}
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
            </Card>
          );
        })
      )}
    </div>
  );
}
