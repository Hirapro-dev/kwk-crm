'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { upsertAdMaster } from '@/lib/domain/master_actions';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** 広告マスタの新規追加フォーム(折りたたみ式。案件マスタと同じ) */
export function NewAdMasterForm({ adTypes }: { adTypes: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [adType, setAdType] = useState(adTypes[0] ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await upsertAdMaster({ id, ad_type: adType, name, is_active: true });
      if (!res.ok) {
        setError(res.error ?? '追加失敗');
        return;
      }
      setSuccess(`広告 ${id}(${name})を追加しました`);
      setId('');
      setName('');
      router.refresh();
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        広告を追加
      </Button>
    );
  }
  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">広告を追加</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="new-ad-id">広告ID *</Label>
            <Input
              id="new-ad-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="例: N0000300"
              required
              maxLength={50}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-ad-type">広告種別 *</Label>
            <Input
              id="new-ad-type"
              value={adType}
              onChange={(e) => setAdType(e.target.value)}
              list="ad-type-options"
              required
              maxLength={100}
            />
            <datalist id="ad-type-options">
              {adTypes.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-ad-name">広告媒体名 *</Label>
            <Input
              id="new-ad-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? '追加中…' : '追加'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
              閉じる
            </Button>
            {error && <span className="text-xs text-destructive">{error}</span>}
            {success && <span className="text-xs text-green-700">{success}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
