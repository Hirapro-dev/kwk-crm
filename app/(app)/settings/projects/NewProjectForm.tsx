'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { upsertProject } from '@/lib/domain/project_actions';

/**
 * 新規案件追加フォーム (管理者用)。
 *
 * 折りたたみ式: 初期表示は「+ 新規案件を追加」ボタンのみ。
 * クリックでフォーム展開、追加成功で折りたたみに戻る。
 */
export function NewProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await upsertProject({
        name,
        description: description || undefined,
        is_active: isActive,
      });
      if (!res.ok) {
        setError(res.error ?? '作成失敗');
        return;
      }
      setSuccess(`案件 "${name}" を追加しました`);
      setName('');
      setDescription('');
      setIsActive(true);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        新規案件を追加
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">新規案件を追加</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="new-project-name">案件名 *</Label>
            <Input
              id="new-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-project-desc">説明</Label>
            <Textarea
              id="new-project-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            有効
          </label>
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
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setError(null);
                setSuccess(null);
              }}
              disabled={pending}
            >
              閉じる
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? '保存中…' : '追加'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
