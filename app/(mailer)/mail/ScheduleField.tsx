'use client';

import { Input } from '@/components/ui/input';

/**
 * 送信日時の指定(送信予約。CLAUDE.md §5.15 migration 124)。
 * 値は datetime-local の文字列(日本時間 "YYYY-MM-DDTHH:mm")。空 = 承認したらすぐ送る。
 */
export function ScheduleField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const scheduled = value !== '';
  return (
    <fieldset className="space-y-1 text-xs" disabled={disabled}>
      <legend className="mb-1">送信日時</legend>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" checked={!scheduled} onChange={() => onChange('')} />
          承認されたらすぐ送る
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
      <p className="text-[11px] text-muted-foreground">
        送信ボタンを押すと「承認待ち」になり、承認者(admin / manager)が承認したときに送信されます。
        {scheduled && ' 予約した日時より後に承認された場合は、承認した時点で送信されます。'}
      </p>
    </fieldset>
  );
}

/** 「日時を指定」を選んだときの初期値: 1 時間後の 0 分(日本時間) */
function defaultScheduleValue(): string {
  const j = new Date(Date.now() + 9 * 60 * 60 * 1000 + 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}T${p(j.getUTCHours())}:00`;
}
