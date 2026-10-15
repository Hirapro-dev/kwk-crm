'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  approveMailOutbox,
  cancelMailOutbox,
  rejectMailOutbox,
  retryMailOutbox,
  updateMailOutbox,
} from '@/lib/domain/mail_outbox_actions';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ScheduleField } from './ScheduleField';

interface Perms {
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  edit: boolean;
  retry: boolean;
}

interface Initial {
  body: string;
  cc: string;
  to: string;
  subject: string;
  fromName: string;
  scheduledAt: string;
}

/**
 * 送信待ちメールの操作(CLAUDE.md §5.15 migration 124)。
 * 承認 / 差し戻し(理由必須)/ 取消 / 修正して出し直す / 送り直す。表示するボタンは権限(サーバーで判定)に従う。
 */
export function OutboxActions({
  id,
  kind,
  perms,
  initial,
}: {
  id: string;
  kind: 'reply' | 'new';
  perms: Perms;
  initial: Initial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'reject' | 'edit'>('none');
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<Initial>(initial);

  const run = (
    fn: () => Promise<{ error?: string; message?: string; threadId?: string | null }>,
    after?: (r: { threadId?: string | null }) => void,
  ) => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        router.refresh();
        return;
      }
      setDone(r.message ?? '完了しました');
      setMode('none');
      after?.(r);
      router.refresh();
    });
  };

  if (!Object.values(perms).some(Boolean)) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {perms.approve && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => {
              if (!window.confirm('このメールを承認しますか?(予約が無ければすぐに送信されます)'))
                return;
              run(() => approveMailOutbox(id));
            }}
          >
            承認する
          </Button>
        )}
        {perms.retry && (
          <Button size="sm" disabled={pending} onClick={() => run(() => retryMailOutbox(id))}>
            もう一度送る
          </Button>
        )}
        {perms.reject && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')}
          >
            差し戻す
          </Button>
        )}
        {perms.edit && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setForm(initial);
              setMode(mode === 'edit' ? 'none' : 'edit');
            }}
          >
            修正する
          </Button>
        )}
        {perms.cancel && (
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600"
            disabled={pending}
            onClick={() => {
              if (!window.confirm('このメールを取り消しますか?(送信されません)')) return;
              run(() => cancelMailOutbox(id));
            }}
          >
            取り消す
          </Button>
        )}
        {pending && <span className="text-xs text-muted-foreground">処理中…</span>}
        {done && <span className="text-xs text-emerald-700">{done}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {mode === 'reject' && (
        <div className="space-y-1 rounded border p-2 text-xs">
          差し戻しの理由(作成者に表示されます)
          <Textarea
            aria-label="差し戻しの理由"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
          />
          <Button
            size="sm"
            disabled={pending || !reason.trim()}
            onClick={() => run(() => rejectMailOutbox(id, reason))}
          >
            差し戻す
          </Button>
        </div>
      )}

      {mode === 'edit' && (
        <form
          className="space-y-2 rounded border p-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              updateMailOutbox({
                id,
                body: form.body,
                cc: form.cc,
                fromName: form.fromName,
                scheduledAt: form.scheduledAt,
                ...(kind === 'new' ? { to: form.to, subject: form.subject } : {}),
              }),
            );
          }}
        >
          <p className="text-muted-foreground">
            保存すると、もう一度「承認待ち」になります(承認済みのものも承認し直しになります)。
          </p>
          {kind === 'new' && (
            <>
              <div>
                宛先
                <Input
                  aria-label="宛先"
                  className="mt-1"
                  value={form.to}
                  onChange={(e) => setForm({ ...form, to: e.target.value })}
                  disabled={pending}
                />
              </div>
              <div>
                件名
                <Input
                  aria-label="件名"
                  className="mt-1"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  disabled={pending}
                />
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 basis-40">
              差出人表示名
              <Input
                aria-label="差出人表示名"
                className="mt-1"
                maxLength={80}
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                disabled={pending}
              />
            </div>
            <div className="flex-1 basis-40">
              CC(任意)
              <Input
                aria-label="CC"
                className="mt-1"
                value={form.cc}
                onChange={(e) => setForm({ ...form, cc: e.target.value })}
                disabled={pending}
              />
            </div>
          </div>
          <div>
            本文(署名・引用を含む)
            <Textarea
              aria-label="本文"
              className="mt-1"
              rows={14}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              disabled={pending}
            />
          </div>
          <ScheduleField
            value={form.scheduledAt}
            onChange={(v) => setForm({ ...form, scheduledAt: v })}
            disabled={pending}
          />
          <Button type="submit" size="sm" disabled={pending || !form.body.trim()}>
            保存して承認を依頼し直す
          </Button>
        </form>
      )}
    </div>
  );
}
