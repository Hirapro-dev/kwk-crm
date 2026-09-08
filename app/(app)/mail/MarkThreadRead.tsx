'use client';

import { markMailThreadRead } from '@/lib/domain/mail_actions';
import { useEffect } from 'react';

/**
 * スレッドを開いたときに既読にする。
 * 描画中(サーバー)に書き込みを行わないよう、クライアント側のマウント時に呼ぶ。
 */
export function MarkThreadRead({ threadId }: { threadId: string }) {
  useEffect(() => {
    void markMailThreadRead(threadId);
  }, [threadId]);
  return null;
}
