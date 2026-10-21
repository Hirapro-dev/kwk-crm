'use client';

import { Input } from '@/components/ui/input';
import type { MailSendMode } from '@/lib/domain/mail_outbox';

/**
 * 送信日時の指定(送信予約。CLAUDE.md §5.15 migration 124)。
 * 値は datetime-local の文字列(日本時間 "YYYY-MM-DDTHH:mm")。空 = 承認したらすぐ送る。
 */
export function ScheduleField({
  value,
  onChange,
  disabled,
  direct = false,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** そのまま送信(承認なし)を選んでいるとき。案内文と選択肢の文言を変える */
  direct?: boolean;
}) {
  const scheduled = value !== '';
  return (
    <fieldset className="space-y-1 text-xs" disabled={disabled}>
      <legend className="mb-1">送信日時</legend>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" checked={!scheduled} onChange={() => onChange('')} />
          {direct ? 'すぐ送る' : '承認されたらすぐ送る'}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={scheduled}
            onChange={() => onChange(defaultScheduleValue())}
          />
          日時を指定する(送信予約)
        </label>
        {scheduled && (
          <Input
            type="datetime-local"
            aria-label="送信日時"
            className="h-8 w-auto"
            value={value}
            step={60}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
      {direct ? (
        <p className="text-[11px] text-muted-foreground">
          承認なしで送信します。{scheduled ? '指定した日時に送信されます。' : ''}
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          送信すると「承認待ち」になり、承認者(admin / manager)が承認したときに送信されます。
          {scheduled && ' 予約した日時より後に承認された場合は、承認した時点で送信されます。'}
        </p>
      )}
    </fieldset>
  );
}

/** 「日時を指定」を選んだときの初期値: 1 時間後の 0 分(日本時間) */
function defaultScheduleValue(): string {
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000 + 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}T${p(j.getUTCHours())}:00`;
}

/**
 * 送信方法の選択(2026-10-16)。承認者(admin / manager)にだけ出す。
 * direct = 承認せずにそのまま送信する(左・既定。2026-10-21 ユーザー指定)/ approval = 承認を依頼する
 */
export function SendModeField({
  value,
  onChange,
  disabled,
}: {
  value: MailSendMode;
  onChange: (v: MailSendMode) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-1 text-xs" disabled={disabled}>
      <legend className="mb-1">送信方法</legend>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" checked={value === 'direct'} onChange={() => onChange('direct')} />
          承認せずにそのまま送信する
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={value === 'approval'}
            onChange={() => onChange('approval')}
          />
          承認を依頼する
        </label>
      </div>
    </fieldset>
  );
}
