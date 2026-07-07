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
import {
  type SummaryFavorite,
  deleteSummaryFavorite,
  updateSummaryFavorite,
} from '@/lib/domain/summary_favorites';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  favorites: SummaryFavorite[];
  /** 現在のユーザーID(自分のお気に入りのみ編集・削除可) */
  currentUserId: string;
}

const TYPE_LABELS: Record<string, string> = {
  forms: 'フォーム集計',
  customers: '新規顧客取得',
  payment: '入金',
};

/** サマリページ上部の「お気に入り」ボタン → 一覧ダイアログ。クリックで保存条件を再表示。 */
export function SummaryFavoritesButton({ favorites, currentUserId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // 編集中のお気に入り(null = 編集ダイアログ非表示)
  const [editing, setEditing] = useState<SummaryFavorite | null>(null);
  const [editName, setEditName] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'public'>('private');
  const [editError, setEditError] = useState<string | null>(null);

  const openFavorite = (fav: SummaryFavorite) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fav.config)) {
      if (v) params.set(k, v);
    }
    setOpen(false);
    router.push(`/summary?${params.toString()}`);
  };

  const startEdit = (fav: SummaryFavorite) => {
    setEditError(null);
    setEditName(fav.name);
    setEditVisibility(fav.visibility);
    setEditing(fav);
  };

  const handleUpdate = () => {
    if (!editing) return;
    setEditError(null);
    startTransition(async () => {
      const res = await updateSummaryFavorite({
        id: editing.id,
        name: editName,
        visibility: editVisibility,
      });
      if (res.error) {
        setEditError(res.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  };

  const onDelete = (id: string) => {
    startTransition(async () => {
      await deleteSummaryFavorite(id);
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        ★ お気に入り
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90%] sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>サマリお気に入り</DialogTitle>
          </DialogHeader>

          {favorites.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              お気に入りはまだありません。
              <br />
              フォーム集計タブの ★ ボタンから保存できます。
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y overflow-y-auto">
              {favorites.map((fav) => (
                <li key={fav.id} className="flex items-center gap-2 py-2">
                  <button
                    type="button"
                    onClick={() => openFavorite(fav)}
                    className="flex-1 text-left hover:underline"
                  >
                    <span className="text-sm font-medium">{fav.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {TYPE_LABELS[fav.summary_type] ?? fav.summary_type} ·{' '}
                      {fav.visibility === 'public' ? '全員' : '自分のみ'}
                      {fav.creator_name ? ` · ${fav.creator_name}` : ''}
                    </span>
                  </button>
                  {fav.created_by === currentUserId && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={pending}
                        onClick={() => startEdit(fav)}
                      >
                        編集
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                        disabled={pending}
                        onClick={() => onDelete(fav.id)}
                      >
                        削除
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* 編集ダイアログ(名前・公開範囲) */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-[90%] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>お気に入りを編集</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">名前</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
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
                      name="edit-visibility"
                      checked={editVisibility === key}
                      onChange={() => setEditVisibility(key)}
                      className="h-4 w-4"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {editError && <p className="text-sm text-destructive">{editError}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={handleUpdate} disabled={pending || !editName.trim()}>
              {pending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
