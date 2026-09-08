'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MAIL_STATUSES } from '@/lib/domain/mail_types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * メール受信箱の絞り込み(状態 / 担当 / 受信箱 / 未読 / 件名)。
 * 対応歴の ActivitiesFilterBar と同じ方式で、URL クエリに反映して再取得する。
 */
export function MailFilterBar({
  initialQ,
  initialStatus,
  initialAssignee,
  initialBox,
  initialUnread,
  currentUserId,
  assigneeOptions,
  boxOptions,
}: {
  initialQ: string;
  initialStatus: string;
  /** '' = 全員 / 'me' = 自分 / 'none' = 未割当 / それ以外 = users.id */
  initialAssignee: string;
  initialBox: string;
  initialUnread: boolean;
  currentUserId: string;
  assigneeOptions: { id: string; name: string }[];
  boxOptions: { id: number; address: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState(initialStatus);
  const [assignee, setAssignee] = useState(initialAssignee);
  const [box, setBox] = useState(initialBox);
  const [unread, setUnread] = useState(initialUnread);

  const push = (next: {
    q: string;
    status: string;
    assignee: string;
    box: string;
    unread: boolean;
  }) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const set = (k: string, v: string) => {
      if (v) params.set(k, v);
      else params.delete(k);
    };
    set('q', next.q.trim());
    set('status', next.status);
    set('assignee', next.assignee === 'me' ? currentUserId : next.assignee);
    set('box', next.box);
    set('unread', next.unread ? '1' : '');
    params.delete('page');
    // 条件を変えたら分割ビューの選択は解除する(別スレッドが右に残らないように)
    params.delete('selected');
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/mail?${qs}` : '/mail'));
  };

  const submit = () => push({ q, status, assignee, box, unread });

  const reset = () => {
    setQ('');
    setStatus('');
    setAssignee('');
    setBox('');
    setUnread(false);
    push({ q: '', status: '', assignee: '', box: '', unread: false });
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Select className="w-28" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">全状態</option>
        {MAIL_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
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
      {boxOptions.length > 1 && (
        <Select className="w-52" value={box} onChange={(e) => setBox(e.target.value)}>
          <option value="">全受信箱</option>
          {boxOptions.map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.address}
            </option>
          ))}
        </Select>
      )}
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
        絞り込む
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={pending}>
        クリア
      </Button>
    </form>
  );
}
