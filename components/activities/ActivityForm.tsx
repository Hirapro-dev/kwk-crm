'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createActivity } from '@/lib/domain/activity_actions';
import type { BunruiPair } from '@/lib/domain/activities_types';

/** 接触種別(大分類) 固定選択肢 */
const CONTACT_TYPES = [
  'アウト',
  'イン',
  'LINE／メール',
  '対面接触（個別面談）',
  'その他',
] as const;
type ContactType = (typeof CONTACT_TYPES)[number];

/** 接触内容(中分類) 固定選択肢 */
const CONTACT_CONTENTS = ['営業', '営業サポート', 'サポートチーム対応'] as const;

/** s_bunrui に保存するフラグ */
const FLAG_CONNECTED = '通電';
const FLAG_ABSENT = '不在';
const FLAG_IN_PERSON = '接触対応';

/**
 * 対応歴入力フォーム(仕様書 §8.2「主役画面」)。
 *
 * - member_id は親(会員詳細画面の場合)から受け取って固定。
 *   グローバル(/activities)から呼ぶ場合は memberLocked=false で入力欄を表示。
 * - 大分類はプルダウン(既存値)。中・小分類はフリー入力可。
 * - 楽観的更新は親側で onAfterSubmit を使ってリストに先頭追加する想定。
 */

export interface ActivityFormProps {
  /** 会員詳細画面から呼ぶ場合、固定で渡す。 */
  fixedMemberId?: string;
  bunruiList: string[];
  recentPairs: BunruiPair[];
  onAfterSubmit?: (id: number) => void;
  /** デフォルトでは折りたたみ。true ならいきなり開いた状態に */
  initiallyOpen?: boolean;
}

export function ActivityForm({
  fixedMemberId,
  bunruiList,
  recentPairs,
  onAfterSubmit,
  initiallyOpen = true,
}: ActivityFormProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const [memberId, setMemberId] = useState(fixedMemberId ?? '');
  const [dBunrui, setDBunrui] = useState<ContactType | ''>('');
  const [mBunrui, setMBunrui] = useState('');
  const [description, setDescription] = useState('');
  // 日時はユーザーから見て"いま"が入っている状態が分かりやすいので、
  // クライアントマウント時にローカルタイムゾーン基準の現在時刻を入れる。
  // SSR と CSR で値が変わると Hydration エラーになるため、初期値は空で
  // useEffect で代入する。
  const [registeredAtLocal, setRegisteredAtLocal] = useState('');

  useEffect(() => {
    setRegisteredAtLocal(getNowDatetimeLocal());
    // 初回マウントのみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // チェック状態(通電と不在は排他)
  const [connected, setConnected] = useState(false);
  const [absent, setAbsent] = useState(false);
  const [inPerson, setInPerson] = useState(false);

  // 接触種別が変わったらチェックを自動制御
  useEffect(() => {
    if (dBunrui === 'イン') {
      // イン: 通電を自動ON、不在/接触対応はクリア
      setConnected(true);
      setAbsent(false);
      setInPerson(false);
    } else if (dBunrui === '対面接触（個別面談）') {
      // 対面接触: 接触対応を自動ON、通電/不在はクリア
      setConnected(false);
      setAbsent(false);
      setInPerson(true);
    } else {
      // アウト/LINE／メール/その他/未選択: 全クリア(アウトは手動入力)
      setConnected(false);
      setAbsent(false);
      setInPerson(false);
    }
  }, [dBunrui]);

  const reset = () => {
    setDBunrui('');
    setMBunrui('');
    setDescription('');
    // リセット時も「現在時刻」に戻す(空にしない)。連続入力時に毎回最新の今が入る。
    setRegisteredAtLocal(getNowDatetimeLocal());
    setConnected(false);
    setAbsent(false);
    setInPerson(false);
    if (!fixedMemberId) setMemberId('');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});
    setSuccess(null);
    // チェック状態を s_bunrui にパイプ区切りで格納
    const flags: string[] = [];
    if (connected) flags.push(FLAG_CONNECTED);
    if (absent) flags.push(FLAG_ABSENT);
    if (inPerson) flags.push(FLAG_IN_PERSON);
    const sBunrui = flags.length > 0 ? flags.join('|') : undefined;

    startTransition(async () => {
      const res = await createActivity({
        member_id: memberId || undefined,
        d_bunrui: dBunrui,
        m_bunrui: mBunrui || undefined,
        s_bunrui: sBunrui,
        description: description || undefined,
        registered_at_local: registeredAtLocal || undefined,
      });
      if (!res.ok) {
        setServerError(res.error ?? '登録に失敗しました');
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setSuccess('登録しました');
      reset();
      if (res.id !== undefined) onAfterSubmit?.(res.id);
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="default">
        + 対応歴を追加
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label="対応歴入力フォーム"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">対応歴を記録</h2>
        {!initiallyOpen && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            閉じる
          </Button>
        )}
      </div>

      {!fixedMemberId && (
        <Field
          label="対象会員ID"
          hint="未指定でも記録できます(社内対応歴など)"
          errors={fieldErrors['member_id']}
        >
          <Input
            placeholder="K-0000000"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value.toUpperCase())}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="接触種別 *" errors={fieldErrors['d_bunrui']}>
          <Select
            value={dBunrui}
            onChange={(e) => setDBunrui(e.target.value as ContactType | '')}
            required
          >
            <option value="">選択してください</option>
            {CONTACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="接触内容" errors={fieldErrors['m_bunrui']}>
          <Select value={mBunrui} onChange={(e) => setMBunrui(e.target.value)}>
            <option value="">選択してください</option>
            {CONTACT_CONTENTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="状態" errors={fieldErrors['s_bunrui']}>
        <div className="flex flex-wrap gap-4 pt-1">
          <CheckLabel
            label="通電"
            checked={connected}
            // アウト時のみ手動操作可。イン時は自動ONで編集不可。それ以外は無効
            disabled={dBunrui !== 'アウト'}
            onChange={(v) => {
              setConnected(v);
              if (v) setAbsent(false); // 排他: 通電ON時は不在OFF
            }}
          />
          <CheckLabel
            label="不在"
            checked={absent}
            disabled={dBunrui !== 'アウト'}
            onChange={(v) => {
              setAbsent(v);
              if (v) setConnected(false); // 排他: 不在ON時は通電OFF
            }}
          />
          <CheckLabel
            label="接触対応"
            checked={inPerson}
            // 対面接触選択時に自動ON&編集不可。それ以外は無効
            disabled={true}
            onChange={() => { /* 自動制御のみ */ }}
          />
        </div>
      </Field>

      <Field
        label="日時"
        hint="デフォルトは現在日時。必要なら変更できます"
        errors={fieldErrors['registered_at_local']}
      >
        <Input
          type="datetime-local"
          value={registeredAtLocal}
          onChange={(e) => setRegisteredAtLocal(e.target.value)}
        />
      </Field>

      <Field label="コメント" errors={fieldErrors['description']}>
        <Textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="対応内容を記入"
        />
      </Field>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700">
          {success}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={reset} disabled={pending}>
          リセット
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? '登録中…' : '登録'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  errors,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors?.map((e, i) => (
        <p key={i} className="text-xs text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}

function CheckLabel({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 text-sm ${
        disabled ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input"
      />
      {label}
    </label>
  );
}

/**
 * 現在時刻を <input type="datetime-local"> の value 形式 "YYYY-MM-DDTHH:mm" で返す。
 *
 * - new Date().toISOString() は UTC で返るため、そのまま使うと日本時間とズレる。
 * - ローカルタイムゾーンで各要素を取得し、ゼロ埋めして文字列化する。
 * - 秒・ミリ秒は datetime-local の既定挙動に合わせて "分" まで。
 */
function getNowDatetimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
