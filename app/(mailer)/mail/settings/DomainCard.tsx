'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { recheckMailDomains, registerMailDomain } from '@/lib/domain/mail_box_actions';
import { dkimCnameRecords } from '@/lib/domain/mail_box_settings';
import type { DomainIdentity, DomainIdentityStatus } from '@/lib/mail/ses_identity';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CopyButton } from './CopyButton';

const STATUS_LABEL: Record<DomainIdentityStatus, { label: string; className: string }> = {
  unregistered: { label: 'SES 未登録', className: 'text-muted-foreground' },
  pending: { label: '検証待ち(DNS 未確認)', className: 'text-amber-700' },
  verified: { label: '検証済み(送信可)', className: 'text-emerald-700' },
  failed: { label: '検証失敗', className: 'text-red-600' },
  unknown: { label: '状態不明', className: 'text-red-600' },
};

/**
 * 送信ドメイン1件分。SES への登録ボタンと、DNS に貼る DKIM の CNAME 3本を表示する。
 * 登録直後は Server Action の戻り値でトークンを出し、以降はページ再取得で SES から取り直す。
 */
export function DomainCard({
  identity,
  sesConfigured,
}: {
  identity: DomainIdentity;
  sesConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<DomainIdentity>(identity);

  const onRegister = () => {
    setError(null);
    startTransition(async () => {
      const r = await registerMailDomain(local.domain);
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.identity) setLocal(r.identity);
      router.refresh();
    });
  };

  const onRecheck = () => {
    setError(null);
    startTransition(async () => {
      const r = await recheckMailDomains();
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  const st = STATUS_LABEL[local.status];
  const records = dkimCnameRecords(local.domain, local.dkimTokens);

  return (
    <div className="rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{local.domain}</span>
          <Badge variant="outline" className={`text-[10px] ${st.className}`}>
            {st.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {local.status === 'unregistered' && (
            <Button size="sm" onClick={onRegister} disabled={pending || !sesConfigured}>
              {pending ? '登録中…' : 'SES に登録'}
            </Button>
          )}
          {local.status !== 'unregistered' && local.status !== 'verified' && (
            <Button size="sm" variant="outline" onClick={onRecheck} disabled={pending}>
              {pending ? '確認中…' : '再確認'}
            </Button>
          )}
        </div>
      </div>

      {local.detail && <p className="mt-1 text-xs text-red-600">{local.detail}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {(local.status === 'pending' || local.status === 'failed') && records.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-muted-foreground">
            このドメインの DNS(Xserver の「DNS レコード設定」等)に次の CNAME
            を3本追加してください。ホスト名の入力欄にドメインが自動で付く場合は「ホスト名(入力用)」の値を使います。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-normal">ホスト名(入力用)</th>
                  <th className="py-1 pr-2 font-normal">種別</th>
                  <th className="py-1 pr-2 font-normal">内容</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.host} className="border-t">
                    <td className="py-1 pr-2 font-mono">
                      <span className="mr-1 break-all">{r.hostLabel}</span>
                      <CopyButton text={r.hostLabel} />
                    </td>
                    <td className="py-1 pr-2 font-mono">{r.type}</td>
                    <td className="py-1 pr-2 font-mono">
                      <span className="mr-1 break-all">{r.value}</span>
                      <CopyButton text={r.value} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {local.status === 'failed' && (
            <p className="text-red-600">
              SES が CNAME を確認できませんでした。DNS
              の値(特に末尾のドット有無・ホスト名の重複)を確認してから「再確認」を押してください。
            </p>
          )}
        </div>
      )}

      {local.status === 'verified' && (
        <p className="mt-1 text-xs text-muted-foreground">
          このドメインのアドレスからメーラーで送信できます。
        </p>
      )}
    </div>
  );
}
