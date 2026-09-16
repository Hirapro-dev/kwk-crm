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
import { searchAdMasters } from '@/lib/domain/master_actions';
import { useEffect, useState } from 'react';

/**
 * 広告マスタから 1 件選ぶダイアログ(CLAUDE.md §5.18)。
 * 会員の編集・新規登録フォームの「広告媒体名 / 広告ID」の【取得】ボタンから開き、
 * 選んだ広告の ID と媒体名を呼び出し側の両方の欄に反映する。
 */
export interface PickedAd {
  id: string;
  name: string;
  ad_type: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (ad: PickedAd) => void;
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function AdMasterPicker({ open, onOpenChange, onPick }: Props) {
  const [q, setQ] = useState('');
  const [adType, setAdType] = useState('');
  const [adTypes, setAdTypes] = useState<string[]>([]);
  const [rows, setRows] = useState<PickedAd[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 開いたとき・検索条件が変わったときに取り直す(入力が止まってから 300ms)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const r = await searchAdMasters({ q, adType: adType || undefined });
      if (r.error) {
        setError(r.error);
        setRows([]);
        return;
      }
      setError(null);
      setRows(r.rows ?? []);
      if (r.adTypes) setAdTypes(r.adTypes);
    }, 300);
    return () => clearTimeout(t);
  }, [open, q, adType]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92%] sm:max-w-[640px]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>広告マスタから取得</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="広告ID・広告媒体名で検索"
              className="min-w-[16rem] flex-1"
              autoFocus
            />
            <select
              className={selectClass}
              value={adType}
              onChange={(e) => setAdType(e.target.value)}
              aria-label="広告種別で絞り込み"
            >
              <option value="">種別: すべて</option>
              {adTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="max-h-[50vh] overflow-y-auto rounded border">
            {rows === null ? (
              <p className="p-3 text-xs text-muted-foreground">読み込み中…</p>
            ) : rows.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">該当する広告がありません</p>
            ) : (
              <ul className="text-xs">
                {rows.map((ad) => (
                  <li key={ad.id} className="border-t first:border-t-0">
                    <button
                      type="button"
                      onClick={() => {
                        onPick(ad);
                        onOpenChange(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                    >
                      <span className="w-24 shrink-0 font-mono">{ad.id}</span>
                      <span className="w-28 shrink-0 text-muted-foreground">{ad.ad_type}</span>
                      <span className="min-w-0 flex-1 truncate">{ad.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            1 件選ぶと、広告ID と広告媒体名の両方に反映されます。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
