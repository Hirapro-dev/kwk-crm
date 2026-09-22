'use server';

/**
 * 通知設定の Server Actions。CLAUDE.md §5.20(migration 116)。本人の行だけ(RLS も同じ)。
 * - プッシュの購読(端末)の登録・解除
 * - プッシュ / メールの ON/OFF
 * - テスト送信
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { notifyUsers } from '@/lib/notify/task_notify';
import { createClient } from '@/lib/supabase/server';

export interface NotificationSettings {
  push_enabled: boolean;
  email_enabled: boolean;
  /** この端末以外も含めた購読数 */
  subscriptions: number;
  /** サーバーにプッシュの鍵が設定されているか */
  pushConfigured: boolean;
  /** 通知メールの差出人が設定されているか */
  emailConfigured: boolean;
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const me = await getCurrentUser();
  const supabase = await createClient();
  const [{ data: s }, { count }] = await Promise.all([
    supabase
      .from('user_notification_settings')
      .select('push_enabled, email_enabled')
      .eq('user_id', me.id)
      .maybeSingle(),
    supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }),
  ]);
  const row = s as { push_enabled: boolean; email_enabled: boolean } | null;
  return {
    push_enabled: row?.push_enabled ?? true,
    email_enabled: row?.email_enabled ?? true,
    subscriptions: count ?? 0,
    pushConfigured: !!(
      process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY
    ),
    emailConfigured: !!process.env.TASK_NOTIFY_FROM,
  };
}

export async function updateNotificationSettings(input: {
  push_enabled: boolean;
  email_enabled: boolean;
}): Promise<{ error?: string }> {
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase.from('user_notification_settings').upsert(
    {
      user_id: me.id,
      push_enabled: !!input.push_enabled,
      email_enabled: !!input.email_enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) return { error: `保存に失敗しました: ${error.message}` };
  return {};
}

/** ブラウザの PushSubscription(JSON)を登録する。同じ endpoint なら上書き */
export async function savePushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}): Promise<{ error?: string }> {
  const me = await getCurrentUser();
  if (!input?.endpoint?.startsWith('https://') || !input.keys?.p256dh || !input.keys?.auth)
    return { error: '購読情報が不正です' };
  const supabase = await createClient();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: me.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      user_agent: (input.userAgent ?? '').slice(0, 300) || null,
    },
    { onConflict: 'endpoint' },
  );
  if (error) return { error: `登録に失敗しました: ${error.message}` };
  return {};
}

export async function removePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const me = await getCurrentUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', me.id);
  if (error) return { error: `解除に失敗しました: ${error.message}` };
  return {};
}

/** 自分宛にテスト通知を送る(設定が効いているかの確認用) */
export async function sendTestNotification(): Promise<{ push: number; email: number }> {
  const me = await getCurrentUser();
  return notifyUsers([me.id], {
    title: 'ひらプロタスクのテスト通知',
    body: 'この通知が見えれば設定は完了です',
    url: '/task',
    tag: 'test',
  });
}
