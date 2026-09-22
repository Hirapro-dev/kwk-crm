'use client';

import type { InfiniteSelectionContext } from '@/components/layout/InfiniteTable';
import { matchArticleReactionsByEmail } from '@/lib/domain/article_reaction_actions';
import { useState, useTransition } from 'react';

/**
 * 記事反応リストの一括操作(CLAUDE.md §5.13b)。チェックした行のメールアドレスを会員の email1〜3 と
 * 完全一致で照合し、1 人に絞れた行に会員ID・会員氏名を入れる。選択中バー(InfiniteTable)に描画される。
 * 実行は Server Action matchArticleReactionsByEmail(viewer 不可、1 回 500 件まで)。
 */
interface Props {
  ctx: InfiniteSelectionContext;
}

export function ArticleReactionBulkActions({ ctx }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await matchArticleReactionsByEmail(ctx.ids);
      if (r.error) {
        setMessage(r.error);
        return;
      }
      setMessage(
        `会員を検索しました: 紐付け ${r.linked ?? 0} / 複数候補 ${r.multiple ?? 0} / 該当なし ${r.none ?? 0} / メールなし ${r.noEmail ?? 0}`,
      );
      await ctx.refresh();
      ctx.clear();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending || ctx.ids.length === 0}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs hover:bg-accent disabled:opacity-50"
        title="メールアドレスが会員の Eメール1〜3 のどれかと完全一致した行に会員IDを入れます"
      >
        {pending ? '検索中…' : '会員を検索(メール一致)'}
      </button>
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
