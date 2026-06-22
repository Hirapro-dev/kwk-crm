'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { convertInquiryToMember } from '@/lib/domain/inquiry_actions';

/**
 * 問合せ詳細画面の会員化ボタン(仕様書 §8.1)。
 * 既存会員に紐づける or 新規会員を作成して紐づけるの2モード。
 */
export function ConvertButton({
  inquiryId,
  defaultName,
}: {
  inquiryId: string;
  defaultName: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'closed' | 'existing' | 'new'>('closed');
  const [existingId, setExistingId] = useState('');
  const [newName, setNewName] = useState(defaultName ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await convertInquiryToMember({
        inquiry_id: inquiryId,
        existing_member_id: mode === 'existing' ? existingId.toUpperCase() : undefined,
        new_member_name: mode === 'new' ? newName : undefined,
      });
      if (!res.ok) {
        setError(res.error ?? '会員化に失敗しました');
        return;
      }
      setSuccess(`会員化しました: ${res.memberId}`);
      setMode('closed');
      router.refresh();
    });
  };

  if (mode === 'closed') {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <Button onClick={() => setMode('new')}>+ 新規会員として作成</Button>
          <Button variant="outline" onClick={() => setMode('existing')}>
            既存会員に紐づける
          </Button>
        </div>
        {success && (
          <p role="status" className="text-sm text-green-700">
            {success}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      {mode === 'existing' ? (
        <div className="space-y-1">
          <Label>既存の会員ID</Label>
          <Input
            placeholder="K-0000000"
            value={existingId}
            onChange={(e) => setExistingId(e.target.value)}
          />
        </div>
      ) : (
        <div className="space-y-1">
          <Label>新規会員の氏名</Label>
          <Input
            placeholder="例: 山田 太郎"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            問合せのメール・電話・住所が初期値として転記されます
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setMode('closed')} disabled={pending}>
          キャンセル
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? '処理中…' : '会員化する'}
        </Button>
      </div>
    </div>
  );
}
