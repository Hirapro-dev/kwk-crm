'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createSummaryFavorite } from '@/lib/domain/summary_favorites';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  /** 保存対象のサマリ種別(forms 等) */
  summaryType: string;
  /** 保存ボタンを有効にするか(例: フォーム未選択時は false) */
  disabled?: boolean;
}

/** 現在のサマリ表示条件をお気に入り保存する ★ ボタン。 */
export function SaveFavoriteButton({ summaryType, disabled }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    setError(null);
    // 現在の URL クエリを config として保存
    const config: Record<string, string> = {};
    sp?.forEach((v, k) => {
      if (v) config[k] = v;
    });
    config.tab = summaryType;

    startTransition(async () => {
      const res = await createSummaryFavorite({ name, summaryType, config, visibility });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setName('');
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? 'フォームを選択すると保存できます' : 'この条件をお気に入りに保存'}
      >
        ★ お気に入り保存
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90%] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>お気に入りに保存</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">名前</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: 今月の特別レポート申込"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">公開範囲</Label>
              <div className="flex gap-4">
                {(
                  [
                    { key: 'private', label: '自分のみ' },
                    { key: 'public', label: '全員' },
                  ] as const
                ).map(({ key, label }) => (
                  <label key={key} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name="visibility"
                      checked={visibility === key}
                      onChange={() => setVisibility(key)}
                      className="h-4 w-4"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={pending || !name.trim()}>
              {pending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
