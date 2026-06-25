'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { type SummaryFavorite, deleteSummaryFavorite } from '@/lib/domain/summary_favorites';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  favorites: SummaryFavorite[];
  /** 現在のユーザーID(自分のお気に入りのみ削除可) */
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

  const openFavorite = (fav: SummaryFavorite) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fav.config)) {
      if (v) params.set(k, v);
    }
    setOpen(false);
    router.push(`/summary?${params.toString()}`);
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                      disabled={pending}
                      onClick={() => onDelete(fav.id)}
                    >
                      削除
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
