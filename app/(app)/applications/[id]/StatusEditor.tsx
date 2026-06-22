'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { updateApplicationStatus } from '@/lib/domain/application_actions';
import {
  APP_STATUSES,
  FLOW_TYPES,
  type AppStatus,
  type FlowType,
} from '@/lib/domain/applications_constants';

export function StatusEditor({
  applicationId,
  currentStatus,
  currentFlowType,
}: {
  applicationId: string;
  currentStatus: AppStatus | null;
  currentFlowType: FlowType | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(currentStatus ?? '');
  const [flowType, setFlowType] = useState<string>(currentFlowType ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await updateApplicationStatus({
        application_id: applicationId,
        status: status || undefined,
        flow_type: flowType || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? '更新失敗');
        return;
      }
      setSuccess('更新しました');
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border bg-card p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>ステータス</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">(変更しない)</option>
            {APP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label>入出金区分</Label>
          <Select value={flowType} onChange={(e) => setFlowType(e.target.value)}>
            <option value="">(変更しない)</option>
            {FLOW_TYPES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700">
          {success}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? '更新中…' : '更新'}
        </Button>
      </div>
    </form>
  );
}
