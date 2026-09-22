/**
 * タスク通知の送信(Web Push + メール)。CLAUDE.md §5.20 / §13(migration 116)。サーバー専用。
 *
 * - 相手ごとの設定(user_notification_settings。行が無ければ両方 ON)を見て、プッシュは登録済みの全端末へ、
 *   メールは users.email へ送る。参照・購読の掃除はサービスロール。
 * - 失敗しても呼び出し元(タスク更新・コメント投稿)は止めない。プッシュの購読が失効(404 / 410)していたら行を消す。
 * - 環境変数: NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY / WEB_PUSH_SUBJECT(プッシュ)、
 *   TASK_NOTIFY_FROM(通知メールの差出人。SES の検証済みドメイン。無ければメールは送らない)、
 *   NEXT_PUBLIC_SITE_URL(メール内のリンク。無ければ https://crm.hirapro.com)。
 */

import {
  type TaskNotificationPayload,
  buildNotificationEmailText,
} from '@/lib/domain/task_notifications';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { sendViaSes } from '@/lib/mail/ses_send';
import { createServiceRoleClient } from '@/lib/supabase/server';
import webpush from 'web-push';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://crm.hirapro.com';

function vapidConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY
  );
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!vapidConfigured()) return false;
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.WEB_PUSH_SUBJECT ?? 'mailto:support@hirapro.jp',
      process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY as string,
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY as string,
    );
    vapidReady = true;
  }
  return true;
}

interface SubscriptionRow {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 1 端末へプッシュ。購読が失効していれば true(呼び出し側で行を消す) */
async function pushOne(sub: SubscriptionRow, payload: TaskNotificationPayload): Promise<boolean> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24, urgency: 'normal' },
    );
    return false;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410;
  }
}

/**
 * 指定ユーザーへ通知する。actorId(操作した本人)は除く。
 * 戻り値は送った数(プッシュ端末数 / メール数)。エラーは飲み込む。
 */
export async function notifyUsers(
  userIds: readonly string[],
  payload: TaskNotificationPayload,
  actorId?: string | null,
): Promise<{ push: number; email: number }> {
  const targets = [...new Set(userIds)].filter((id) => id && id !== actorId);
  const result = { push: 0, email: 0 };
  if (targets.length === 0) return result;
  try {
    const admin = createServiceRoleClient();
    const [{ data: settings }, { data: users }, { data: subs }] = await Promise.all([
      admin
        .from('user_notification_settings')
        .select('user_id, push_enabled, email_enabled')
        .in('user_id', targets),
      admin.from('users').select('id, email, is_active').in('id', targets),
      admin
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', targets),
    ]);
    const setting = new Map(
      (
        (settings ?? []) as Array<{
          user_id: string;
          push_enabled: boolean;
          email_enabled: boolean;
        }>
      ).map((s) => [s.user_id, s]),
    );
    const pushOn = (uid: string) => setting.get(uid)?.push_enabled ?? true;
    const emailOn = (uid: string) => setting.get(uid)?.email_enabled ?? true;

    // プッシュ
    if (ensureVapid()) {
      const gone: number[] = [];
      for (const sub of (subs ?? []) as SubscriptionRow[]) {
        if (!pushOn(sub.user_id)) continue;
        const expired = await pushOne(sub, payload);
        if (expired) gone.push(sub.id);
        else result.push++;
      }
      if (gone.length > 0) await admin.from('push_subscriptions').delete().in('id', gone);
      if (result.push > 0) {
        await admin
          .from('push_subscriptions')
          .update({ last_used_at: new Date().toISOString() })
          .in('user_id', targets);
      }
    }

    // メール
    const from = process.env.TASK_NOTIFY_FROM?.trim();
    const cfg = getMailAwsConfig();
    if (from && cfg) {
      const text = buildNotificationEmailText(payload, SITE_URL);
      for (const u of (users ?? []) as Array<{ id: string; email: string; is_active: boolean }>) {
        if (!u.is_active || !u.email || !emailOn(u.id)) continue;
        try {
          await sendViaSes(cfg, {
            fromAddress: from,
            fromName: 'ひらプロタスク',
            to: [u.email],
            subject: payload.title,
            text,
          });
          result.email++;
        } catch {
          /* 1 人分の失敗で他を止めない */
        }
      }
    }
  } catch {
    /* 通知は付随機能。失敗しても本体の処理は成功扱い */
  }
  return result;
}
