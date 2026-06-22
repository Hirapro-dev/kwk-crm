'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toggleFavorite } from '@/lib/domain/report_actions';

export function FavoriteButton({
  reportId,
  isFavorited,
}: {
  reportId: string;
  isFavorited: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      await toggleFavorite(reportId);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label={isFavorited ? 'お気に入りを解除' : 'お気に入りに追加'}
      className="text-lg"
    >
      <span aria-hidden>{isFavorited ? '★' : '☆'}</span>
    </button>
  );
}
