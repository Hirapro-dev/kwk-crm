'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TaskRow } from '@/lib/domain/tasks';
import Link from 'next/link';
import { CompleteCheck, DueDateCell } from './TaskBits';

/** マイタスクの一覧(§5.20)。行内で完了・期日を変更できる */
export function MyTaskList({ tasks }: { tasks: TaskRow[] }) {
  if (tasks.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">タスクはありません</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-gray-50 hover:bg-gray-50">
          <TableHead className="h-9 w-10" />
          <TableHead className="h-9">タスク</TableHead>
          <TableHead className="h-9 whitespace-nowrap">プロジェクト</TableHead>
          <TableHead className="h-9 whitespace-nowrap">会員</TableHead>
          <TableHead className="h-9 whitespace-nowrap">期日</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => (
          <TableRow key={t.id} className="sf-row-hover">
            <TableCell className="py-2">
              <CompleteCheck taskId={t.id} completed={!!t.completed_at} />
            </TableCell>
            <TableCell className="py-2">
              <Link href={`/task/${t.id}`} className="text-primary hover:underline">
                {t.name}
              </Link>
              {t.parent_task_id && (
                <span className="ml-2 text-[11px] text-muted-foreground">サブタスク</span>
              )}
              {(t.subtask_count ?? 0) > 0 && (
                <span className="ml-2 text-[11px] text-muted-foreground">
                  サブタスク {t.subtask_count}
                </span>
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap py-2 text-xs">
              {t.project ? (
                <Link href={`/task/projects/${t.project.id}`} className="sf-link">
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: t.project.color ?? '#94a3b8' }}
                  />
                  {t.project.name}
                </Link>
              ) : (
                '-'
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap py-2 text-xs">
              {t.member ? (
                <Link href={`/members/${t.member.id}`} className="sf-link">
                  {t.member.name ?? t.member.id}
                </Link>
              ) : (
                '-'
              )}
            </TableCell>
            <TableCell className="whitespace-nowrap py-2">
              <DueDateCell taskId={t.id} dueDate={t.due_date} completedAt={t.completed_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
