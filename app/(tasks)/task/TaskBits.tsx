'use client';

import { Select } from '@/components/ui/select';
import { UserAvatar } from '@/components/users/UserAvatar';
import { setTaskCompleted, updateTask } from '@/lib/domain/task_actions';
import { type DueTone, dueTone, todayJst } from '@/lib/domain/task_pure';
import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** タスク一覧・詳細で共通の小部品(CLAUDE.md §5.20): 完了チェック、期日、担当の行内編集 */

export interface UserOption {
  id: string;
  full_name: string | null;
  avatar_path?: string | null;
}

/** スマホ向けの期日バッジ(Asana 風の色付きピル。編集は詳細で) */
const BADGE_CLASS: Record<DueTone, string> = {
  done: 'bg-slate-100 text-muted-foreground line-through',
  overdue: 'bg-red-50 text-red-700',
  today: 'bg-amber-50 text-amber-700',
  soon: 'bg-amber-50 text-amber-700',
  normal: 'bg-slate-100 text-foreground',
  none: 'bg-transparent text-muted-foreground',
};

export function DueBadge({
  dueDate,
  completedAt,
}: { dueDate: string | null; completedAt: string | null }) {
  const tone = dueTone(dueDate, completedAt, todayJst());
  if (!dueDate) return null;
  // 今年なら「M月D日」、それ以外は「YYYY年M月D日」
  const [y, m, d] = dueDate.split('-').map(Number);
  const thisYear = Number(todayJst().slice(0, 4));
  const label = y === thisYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[tone]}`}>
      {label}
    </span>
  );
}

const TONE_CLASS: Record<DueTone, string> = {
  done: 'text-muted-foreground line-through',
  overdue: 'text-red-700 font-medium',
  today: 'text-amber-700 font-medium',
  soon: 'text-amber-700',
  normal: 'text-foreground',
  none: 'text-muted-foreground',
};

export function CompleteCheck({
  taskId,
  completed,
  onChanged,
}: { taskId: number; completed: boolean; onChanged?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(completed);
  return (
    <button
      type="button"
      aria-label={local ? '未完了に戻す' : '完了にする'}
      title={local ? '未完了に戻す' : '完了にする'}
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        const next = !local;
        setLocal(next);
        startTransition(async () => {
          const r = await setTaskCompleted(taskId, next);
          if (r.error) {
            setLocal(!next);
            alert(r.error);
            return;
          }
          onChanged?.();
          router.refresh();
        });
      }}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${
        local
          ? 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-slate-400 text-transparent hover:border-emerald-600 hover:text-emerald-600'
      }`}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </button>
  );
}

export function DueDateCell({
  taskId,
  dueDate,
  completedAt,
  editable = true,
}: { taskId: number; dueDate: string | null; completedAt: string | null; editable?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(dueDate ?? '');
  const [pending, startTransition] = useTransition();
  const tone = dueTone(value || null, completedAt, todayJst());
  if (!editable) return <span className={`text-xs ${TONE_CLASS[tone]}`}>{value || '-'}</span>;
  return (
    <input
      type="date"
      value={value}
      disabled={pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        startTransition(async () => {
          const r = await updateTask(taskId, { due_date: v || null });
          if (r.error) alert(r.error);
          else router.refresh();
        });
      }}
      className={`h-9 rounded border border-input bg-background px-1 text-base sm:h-7 sm:border-transparent sm:bg-transparent sm:text-xs sm:hover:border-input focus:border-input focus:outline-none ${TONE_CLASS[tone]}`}
      aria-label="期日"
    />
  );
}

export function AssigneeCell({
  taskId,
  assigneeId,
  assigneeNameRaw,
  users,
}: {
  taskId: number;
  assigneeId: string | null;
  assigneeNameRaw: string | null;
  users: UserOption[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(assigneeId ?? '');
  const [pending, startTransition] = useTransition();
  const selected = users.find((u) => u.id === value) ?? null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {/* アイコン + 名前(セレクト)。migration 114 */}
      {selected && (
        <UserAvatar name={selected.full_name} avatarPath={selected.avatar_path} size={22} />
      )}
      <Select
        value={value}
        disabled={pending}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          startTransition(async () => {
            const r = await updateTask(taskId, { assignee_id: v || null });
            if (r.error) alert(r.error);
            else router.refresh();
          });
        }}
        className="h-9 max-w-[200px] border-input bg-background px-1 text-base sm:h-7 sm:max-w-[160px] sm:border-transparent sm:bg-transparent sm:text-xs sm:hover:border-input"
        aria-label="担当"
      >
        <option value="">{assigneeNameRaw ? `${assigneeNameRaw}(未登録)` : '担当なし'}</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name ?? u.id}
          </option>
        ))}
      </Select>
    </span>
  );
}
