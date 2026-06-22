/**
 * 申込一覧画面(仕様書 §8.1)
 */

import Link from 'next/link';
import { Suspense } from 'react';
import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { SortHeader } from '@/components/layout/SortHeader';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PaginationBar } from '@/components/ui/pagination-link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type AppStatus,
  APP_STATUSES,
  listApplications,
} from '@/lib/domain/applications';
import { listProjects } from '@/lib/domain/projects';
import { formatDate } from '@/lib/utils/date';
import { ApplicationsFilterBar } from './ApplicationsFilterBar';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    project?: string;
    status?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}

const STATUS_VARIANT: Record<AppStatus, 'default' | 'secondary' | 'outline' | 'success'> = {
  対応中: 'default',
  未購入: 'outline',
  完了: 'success',
  出金: 'secondary',
  資金移動: 'secondary',
};

export default async function ApplicationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? '1', 10) || 1;
  const projectId = sp.project ? Number.parseInt(sp.project, 10) : undefined;
  const status = (sp.status as AppStatus | undefined) && APP_STATUSES.includes(sp.status as AppStatus)
    ? (sp.status as AppStatus)
    : undefined;

  const [result, projects] = await Promise.all([
    listApplications({
      q: sp.q,
      projectId,
      status,
      sort: sp.sort,
      dir: sp.dir === 'desc' ? 'desc' : 'asc',
      page,
      pageSize: 50,
    }),
    listProjects(),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="APP"
          iconColor="#1589ee"
          viewName="申込一覧"
          totalCount={result.total}
        />

        <PanelFilterBar>
          <Suspense>
            <ApplicationsFilterBar
              initialQ={sp.q ?? ''}
              initialProjectId={sp.project ?? ''}
              initialStatus={sp.status ?? ''}
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            />
          </Suspense>
        </PanelFilterBar>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader field="id" label="申込ID" /></TableHead>
              <TableHead><SortHeader field="application_date" label="申込日" /></TableHead>
              <TableHead><SortHeader field="member_id" label="会員" /></TableHead>
              <TableHead><SortHeader field="project_id" label="案件" /></TableHead>
              <TableHead><SortHeader field="status" label="ステータス" /></TableHead>
              <TableHead><SortHeader field="flow_type" label="区分" /></TableHead>
              <TableHead className="text-right"><SortHeader field="payment_amount" label="入金額" /></TableHead>
              <TableHead><SortHeader field="owner_id" label="担当" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  該当する申込がありません
                </TableCell>
              </TableRow>
            ) : (
              result.rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">
                    <Link
                      href={`/applications/${a.id}`}
                      className="text-primary hover:underline"
                    >
                      {a.id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(a.application_date)}</TableCell>
                  <TableCell className="text-sm">
                    {a.member ? (
                      <Link
                        href={`/members/${a.member.id}`}
                        className="text-primary hover:underline"
                      >
                        {a.member.name}
                      </Link>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {a.project ? a.project.name : '-'}
                  </TableCell>
                  <TableCell>
                    {a.status ? (
                      <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{a.flow_type ?? '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.payment_amount !== null
                      ? `¥${Number(a.payment_amount).toLocaleString()}`
                      : '-'}
                  </TableCell>
                  <TableCell className="text-sm">{a.owner?.full_name ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath="/applications"
        searchParams={sp}
      />
    </div>
  );
}
