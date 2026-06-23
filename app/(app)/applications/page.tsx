/**
 * 申込一覧画面(仕様書 §8.1)
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { APP_STATUSES, type AppStatus, listApplications } from '@/lib/domain/applications';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { listProjects } from '@/lib/domain/projects';
import { Suspense } from 'react';
import { ApplicationsFilterBar } from './ApplicationsFilterBar';
import { ApplicationsInfinite } from './ApplicationsInfinite';

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

export default async function ApplicationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const projectId = sp.project ? Number.parseInt(sp.project, 10) : undefined;
  const status =
    (sp.status as AppStatus | undefined) && APP_STATUSES.includes(sp.status as AppStatus)
      ? (sp.status as AppStatus)
      : undefined;

  const [result, projects] = await Promise.all([
    listApplications({
      q: sp.q,
      projectId,
      status,
      sort: sp.sort,
      dir: sp.dir === 'desc' ? 'desc' : 'asc',
      page: 1,
      pageSize: LIST_PAGE_SIZE,
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

        {/* 無限スクロール表示 */}
        <ApplicationsInfinite
          key={`${sp.q ?? ''}|${sp.project ?? ''}|${sp.status ?? ''}|${sp.sort ?? ''}|${sp.dir ?? ''}`}
          initialRows={result.rows}
          total={result.total}
          params={{
            q: sp.q,
            projectId,
            status,
            sort: sp.sort,
            dir: sp.dir === 'desc' ? 'desc' : 'asc',
          }}
        />
      </Card>
    </div>
  );
}
