'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { type UpdateMailThreadInput, updateMailThread } from '@/lib/domain/mail_actions';
import { MAIL_STATUSES, type MailStatus } from '@/lib/domain/mail_types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * スレッドの担当・ステータス・会員紐付けを変更する操作行。
 * 変更は即時保存し、router.refresh() で表示を更新する。
 */
export function MailThreadControls({
  threadId,
  status,
  assigneeId,
  memberId,
  assigneeOptions,
  canEdit,
}: {
  threadId: string;
  status: MailStatus;
  assigneeId: string | null;
  memberId: string | null;
  assigneeOptions: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [memberInput, setMemberInput] = useState(memberId ?? '');

  const apply = (patch: Omit<UpdateMailThreadInput, 'id'>) => {
    setError(null);
    startTransition(async () => {
      const r = await updateMailThread({ id: threadId, ...patch });
      if (r.error) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  if (!canEdit) {
    return (
      <div className="text-xs text-muted-foreground">
        状態: {status} / 担当: {assigneeOptions.find((u) => u.id === assigneeId)?.name ?? '未割当'}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 text-xs">
        <span>状態</span>
        <Select
          aria-label="状態"
          className="w-28"
          value={status}
          disabled={pending}
          onChange={(e) => apply({ status: e.target.value as MailStatus })}
        >
          {MAIL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <span>担当</span>
        <Select
          aria-label="担当"
          className="w-44"
          value={assigneeId ?? ''}
          disabled={pending}
          onChange={(e) => apply({ assigneeId: e.target.value || null })}
        >
          <option value="">未割当</option>
          {assigneeOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>
      <form
        className="flex items-center gap-1 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ memberId: memberInput.trim() || null });
        }}
      >
        <span>会員ID</span>
        <Input
          aria-label="会員ID"
          className="w-36 font-mono"
          placeholder="K-0000000"
          value={memberInput}
          disabled={pending}
          onChange={(e) => setMemberInput(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          紐付け
        </Button>
        {memberId && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setMemberInput('');
              apply({ memberId: null });
            }}
          >
            解除
          </Button>
        )}
      </form>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
