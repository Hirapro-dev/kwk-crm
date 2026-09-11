'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * メーラーのヘッダー検索(担当 / 未読 / 検索語 / 期間)。
 * 検索語は会員ID(K-XXXXXXXXX)・メールアドレス・キーワード(件名/本文)のどれかを
 * 自動判定する(lib/domain/mail_search.ts の classifyMailSearchQuery)。
 * 状態・分類は MailStatusTabs、受信箱は左のフォルダで選ぶため、ここでは扱わない。
 * URL クエリに反映して再取得する(対応歴の ActivitiesFilterBar と同じ方式)。
 */
export function MailFilterBar({
  initialQ,
  initialAssignee,
  initialUnread,
  initialDateFrom,
  initialDateTo,
  currentUserId,
  assigneeOptions,
}: {
  initialQ: string;
  /** '' = 全員 / 'me' = 自分 / 'none' = 未割当 / それ以外 = users.id */
  initialAssignee: string;
  initialUnread: boolean;
  /** "YYYY-MM-DD"(日本時間)。空文字なら未指定 */
  initialDateFrom: string;
  initialDateTo: string;
  currentUserId: string;
  assigneeOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [assignee, setAssignee] = useState(initialAssignee);
  const [unread, setUnread] = useState(initialUnread);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);

  const push = (next: {
    q: string;
    assignee: string;
    unread: boolean;
    dateFrom: string;
    dateTo: string;
  }) => {
    // タブ・受信箱は維持する
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    const set = (k: string, v: string) => {
      if (v) params.set(k, v);
      else params.delete(k);
    };
    set('q', next.q.trim());
    set('assignee', next.assignee === 'me' ? currentUserId : next.assignee);
    set('unread', next.unread ? '1' : '');
    set('from', next.dateFrom);
    set('to', next.dateTo);
    params.delete('page');
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/mail?${qs}` : '/mail'));
  };

  const submit = () => push({ q, assignee, unread, dateFrom, dateTo });

  const reset = () => {
    setQ('');
    setAssignee('');
    setUnread(false);
    setDateFrom('');
    setDateTo('');
    push({ q: '', assignee: '', unread: false, dateFrom: '', dateTo: '' });
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
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Input
          type="date"
          aria-label="期間(開始)"
          className="w-36"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <span>〜</span>
        <Input
          type="date"
          aria-label="期間(終了)"
          className="w-36"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => setDateTo(e.target.value)}
        />
      </div>
      <Input
        className="w-64"
        placeholder="会員ID・メールアドレス・キーワードで検索"
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
