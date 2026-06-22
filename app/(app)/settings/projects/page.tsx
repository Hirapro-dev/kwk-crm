/**
 * /settings/projects — 案件マスタ管理 (管理者用)
 *
 * - 表形式の一覧表示
 * - 鉛筆アイコンで行内編集 (ID は編集不可)
 * - 新規案件追加フォーム
 *
 * /settings 配下のため layout.tsx で admin チェック済 (二重チェックなし)。
 */

import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listProjects } from '@/lib/domain/projects';
import { NewProjectForm } from './NewProjectForm';
import { ProjectRow } from './ProjectRow';

export default async function SettingsProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="space-y-3">
      <NewProjectForm />

      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="PRJ"
          iconColor="#04844b"
          viewName="案件マスタ一覧"
          totalCount={projects.length}
        />

        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/50 hover:bg-secondary/50">
              <TableHead className="h-9 w-20">案件ID</TableHead>
              <TableHead className="h-9">案件名</TableHead>
              <TableHead className="h-9">説明</TableHead>
              <TableHead className="h-9 w-16 text-center">有効</TableHead>
              <TableHead className="h-9 w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-muted-foreground"
                >
                  案件マスタが登録されていません
                </TableCell>
              </TableRow>
            ) : (
              projects.map((p) => <ProjectRow key={p.id} project={p} />)
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
