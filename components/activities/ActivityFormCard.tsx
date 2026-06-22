'use client';

import { useRouter } from 'next/navigation';
import { ActivityForm } from './ActivityForm';
import type { BunruiPair } from '@/lib/domain/activities_types';

/**
 * ActivityForm の Server Component から呼べるラッパー。
 *
 * 役割:
 *   - 活動登録成功後に router.refresh() を呼び、親 Server Component の活動履歴を再取得
 *   - 折りたたみ状態(initiallyOpen=false) で初期表示し、「+ 活動を追加」ボタンから展開
 *
 * 利用箇所: 会員詳細ページの「活動」カード
 */
export function ActivityFormCard({
  memberId,
  bunruiList,
  recentPairs,
}: {
  memberId: string;
  bunruiList: string[];
  recentPairs: BunruiPair[];
}) {
  const router = useRouter();

  return (
    <ActivityForm
      fixedMemberId={memberId}
      bunruiList={bunruiList}
      recentPairs={recentPairs}
      initiallyOpen={false}
      onAfterSubmit={() => {
        router.refresh();
      }}
    />
  );
}
