'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { devLogout } from '@/lib/domain/dev_auth_actions';
import { createClient } from '@/lib/supabase/client';

/**
 * ログアウトボタン。
 * dev_auth_user Cookie と Supabase セッションの両方をクリアする。
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const onClick = () => {
    startTransition(async () => {
      // Cookie ベース dev-auth(あれば)
      await devLogout();
      // Supabase セッション(あれば)
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="ml-1 rounded px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-50"
    >
      {pending ? '...' : 'ログアウト'}
    </button>
  );
}
