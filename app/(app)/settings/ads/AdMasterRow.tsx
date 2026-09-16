'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { upsertAdMaster } from '@/lib/domain/master_actions';
import type { AdMaster } from '@/lib/domain/masters';
import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** 広告マスタの1行(閲覧 ↔ 編集)。広告IDは編集不可。案件マスタの ProjectRow と同じ操作感 */
export function AdMasterRow({ ad }: { ad: AdMaster }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adType, setAdType] = useState(ad.ad_type);
  const [name, setName] = useState(ad.name);
  const [isActive, setIsActive] = useState(ad.is_active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await upsertAdMaster({
        id: ad.id,
        ad_type: adType,
        name,
        is_active: isActive,
        isUpdate: true,
      });
      if (!res.ok) {
        setError(res.error ?? '保存失敗');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };
  const onCancel = () => {
    setAdType(ad.ad_type);
    setName(ad.name);
    setIsActive(ad.is_active);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <TableRow className={ad.is_active ? 'sf-row-hover' : 'sf-row-hover opacity-60'}>
        <TableCell className="py-2 font-mono text-xs">{ad.id}</TableCell>
        <TableCell className="py-2 text-sm">{ad.ad_type}</TableCell>
        <TableCell className="py-2 text-sm font-medium">{ad.name}</TableCell>
        <TableCell className="py-2 text-center">
          <input type="checkbox" checked={ad.is_active} disabled aria-label="有効" />
        </TableCell>
        <TableCell className="py-2 text-right">
          <button
            type="button"
            aria-label="編集"
            onClick={() => setEditing(true)}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow className="bg-accent/30">
      <TableCell className="py-2 font-mono text-xs">{ad.id}</TableCell>
      <TableCell className="py-2">
        <Input
          value={adType}
          onChange={(e) => setAdType(e.target.value)}
          maxLength={100}
          aria-label="広告種別"
        />
      </TableCell>
      <TableCell className="py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          aria-label="広告媒体名"
        />
      </TableCell>
      <TableCell className="py-2 text-center">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          aria-label="有効"
        />
      </TableCell>
      <TableCell className="py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <Button size="sm" onClick={onSave} disabled={pending || !name.trim() || !adType.trim()}>
              {pending ? '...' : '保存'}
            </Button>
            <button
              type="button"
              aria-label="キャンセル"
              onClick={onCancel}
              disabled={pending}
              className="grid h-7 w-7 place-items-center rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
