'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * メーラー一覧の絞り込み(担当 / 未読 / 件名)。
 * 状態・分類は MailStatusTabs、受信箱は左のフォルダで選ぶため、ここでは扱わない。
 * URL クエリに反映して再取得する(対応歴の ActivitiesFilterBar と同じ方式)。
 */
export function MailFilterBar({
  initialQ,
  initialAssignee,
  initialUnread,
  currentUserId,
  assigneeOptions,
}: {
  initialQ: string;
  /** '' = 全員 / 'me' = 自分 / 'none' = 未割当 / それ以外 = users.id */
  initialAssignee: string;
  initialUnread: boolean;
  currentUserId: string;
  assigneeOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [assignee, setAssignee] = useState(initialAssignee);
  const [unread, setUnread] = useState(initialUnread);

  const push = (next: { q: string; assignee: string; unread: boolean }) => {
    // タブ・受信箱は維持する
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const set = (k: string, v: string) => {
      if (v) params.set(k, v);
      else params.delete(k);
    };
    set('q', next.q.trim());
    set('assignee', next.assignee === 'me' ? currentUserId : next.assignee);
    set('unread', next.unread ? '1' : '');
    params.delete('page');
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/mail?${qs}` : '/mail'));
  };

  const submit = () => push({ q, assignee, unread });

  const reset = () => {
    setQ('');
    setAssignee('');
    setUnread(false);
    push({ q: '', assignee: '', unread: false });
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Select className="w-40" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
        <option value="">担当: 全員</option>
        <option value="me">担当: 自分</option>
        <option value="none">担当: 未割当</option>
        {assigneeOptions.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
        未読のみ
      </label>
      <Input
        className="w-56"
        placeholder="件名で検索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Button type="submit" size="sm" disabled={pending}>
        検索
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={pending}>
        クリア
      </Button>
    </form>
  );
}
