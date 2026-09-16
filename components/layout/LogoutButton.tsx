'use client';

import { devLogout } from '@/lib/domain/dev_auth_actions';
import { createClient } from '@/lib/supabase/client';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * ログアウトボタン。
 * dev_auth_user Cookie と Supabase セッションの両方をクリアする。
 * variant='menu' はメニューの項目として描画する(メーラーの歯車メニュー内など)。
 */
export function LogoutButton({ variant = 'header' }: { variant?: 'header' | 'menu' }) {
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
  if (variant === 'menu') {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={pending}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {pending ? 'ログアウト中…' : 'ログアウト'}
      </button>
    );
  }
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
