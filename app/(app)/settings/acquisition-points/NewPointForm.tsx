'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { upsertAcquisitionPoint } from '@/lib/domain/master_actions';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** 顧客情報取得ポイントの新規追加フォーム(折りたたみ式) */
export function NewPointForm({ nextSortOrder }: { nextSortOrder: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await upsertAcquisitionPoint({
        name,
        sort_order: nextSortOrder,
        is_active: true,
      });
      if (!res.ok) {
        setError(res.error ?? '追加失敗');
        return;
      }
      setSuccess(`「${name}」を追加しました`);
      setName('');
      router.refresh();
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        取得ポイントを追加
      </Button>
    );
  }
  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">取得ポイントを追加</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[20rem] flex-1 space-y-1">
            <Label htmlFor="new-point-name">名前 *</Label>
            <Input
              id="new-point-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? '追加中…' : '追加'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
            閉じる
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
          {success && <span className="text-xs text-green-700">{success}</span>}
        </form>
      </CardContent>
    </Card>
  );
}
