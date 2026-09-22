'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  type NotificationSettings,
  getNotificationSettings,
  removePushSubscription,
  savePushSubscription,
  sendTestNotification,
  updateNotificationSettings,
} from '@/lib/domain/notification_actions';
import { useEffect, useState, useTransition } from 'react';

/**
 * 通知の設定ダイアログ(migration 116)。
 * - この端末でプッシュ通知を受け取る(ブラウザの許可 → 購読をサーバーに登録)/ 解除
 * - プッシュ / メールの ON/OFF
 * - テスト通知
 * iPhone は「ホーム画面に追加」した状態でないとプッシュを受け取れないため、その旨を出す。
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = `${base64}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function NotificationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [thisDevice, setThisDevice] = useState<'unsupported' | 'denied' | 'off' | 'on'>('off');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isIos = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  const refreshDevice = async () => {
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setThisDevice('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setThisDevice('denied');
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    const sub = await reg?.pushManager.getSubscription();
    setThisDevice(sub ? 'on' : 'off');
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときだけ読み直す
  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    getNotificationSettings().then(setSettings);
    refreshDevice();
  }, [open]);

  const subscribe = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const key = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
        if (!key) throw new Error('サーバーにプッシュ通知の鍵が設定されていません');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('ブラウザで通知が許可されませんでした');
        const reg =
          (await navigator.serviceWorker.getRegistration('/sw.js')) ??
          (await navigator.serviceWorker.register('/sw.js'));
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        const json = sub.toJSON();
        const r = await savePushSubscription({
          endpoint: json.endpoint ?? '',
          keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
          userAgent: navigator.userAgent,
        });
        if (r.error) throw new Error(r.error);
        setMessage('この端末でプッシュ通知を受け取ります');
        await refreshDevice();
        setSettings(await getNotificationSettings());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const unsubscribe = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await removePushSubscription(sub.endpoint);
          await sub.unsubscribe();
        }
        setMessage('この端末のプッシュ通知を解除しました');
        await refreshDevice();
        setSettings(await getNotificationSettings());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const toggle = (patch: Partial<Pick<NotificationSettings, 'push_enabled' | 'email_enabled'>>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    startTransition(async () => {
      const r = await updateNotificationSettings({
        push_enabled: next.push_enabled,
        email_enabled: next.email_enabled,
      });
      if (r.error) setError(r.error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-[92%] sm:max-w-[460px]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>通知の設定</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-1 text-sm">
          <p className="text-xs text-muted-foreground">
            担当に割り当てられたとき、コメントで「@あなた」と呼ばれたときに通知します。
          </p>

          <section className="space-y-2 rounded border p-3">
            <h3 className="text-sm font-semibold">この端末のプッシュ通知</h3>
            {thisDevice === 'unsupported' && (
              <p className="text-xs text-muted-foreground">
                このブラウザはプッシュ通知に対応していません。
                {isIos &&
                  !standalone &&
                  ' iPhone では、共有メニューから「ホーム画面に追加」して、そのアイコンから開くと使えます。'}
              </p>
            )}
            {thisDevice === 'denied' && (
              <p className="text-xs text-red-600">
                ブラウザで通知がブロックされています。ブラウザの設定でこのサイトの通知を許可してください。
              </p>
            )}
            {(thisDevice === 'off' || thisDevice === 'on') && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs">
                  {thisDevice === 'on' ? '受け取る設定になっています' : 'まだ設定されていません'}
                </span>
                {thisDevice === 'on' ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={unsubscribe}>
                    この端末で解除
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={pending || !settings?.pushConfigured}
                    onClick={subscribe}
                  >
                    この端末で受け取る
                  </Button>
                )}
              </div>
            )}
            {isIos && !standalone && thisDevice !== 'unsupported' && (
              <p className="text-xs text-muted-foreground">
                iPhone は「ホーム画面に追加」したアイコンから開いたときだけ通知が届きます。
              </p>
            )}
            {settings && !settings.pushConfigured && (
              <p className="text-xs text-amber-700">
                サーバーにプッシュ通知の鍵が未設定です(管理者向け)。
              </p>
            )}
            {settings && (
              <p className="text-xs text-muted-foreground">
                登録済みの端末: {settings.subscriptions} 台
              </p>
            )}
          </section>

          <section className="space-y-2 rounded border p-3">
            <h3 className="text-sm font-semibold">通知の受け取り方</h3>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings?.push_enabled ?? true}
                disabled={!settings || pending}
                onChange={(e) => toggle({ push_enabled: e.target.checked })}
              />
              プッシュ通知(登録した全端末)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings?.email_enabled ?? true}
                disabled={!settings || pending}
                onChange={(e) => toggle({ email_enabled: e.target.checked })}
              />
              メール(登録メールアドレス宛)
              {settings && !settings.emailConfigured && (
                <span className="text-xs text-amber-700">
                  ※ 差出人が未設定のため現在は送られません
                </span>
              )}
            </label>
          </section>

          {message && <p className="text-xs text-emerald-700">{message}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await sendTestNotification();
                setMessage(`テスト通知を送りました(プッシュ ${r.push} 台 / メール ${r.email} 通)`);
              })
            }
          >
            テスト通知を送る
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
