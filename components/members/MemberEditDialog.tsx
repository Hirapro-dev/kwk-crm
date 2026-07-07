'use client';

import { UserCombobox } from '@/components/members/UserCombobox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateMember } from '@/lib/domain/member_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import type { MemberWithOwner } from '@/lib/domain/types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** プロテクト者の選択肢 */
export interface ProtectUserOption {
  id: string;
  full_name: string | null;
}

/**
 * 専用UIを持つ / 編集不可(PK・システム・計算列)のため、動的フォームの汎用ループから除外するフィールド。
 * - protect_by_user_id / protect_expires_at → 下部「プロテクト設定(管理者のみ)」で編集
 * - regular_contact_id                      → 下部「定期連絡者」コンボボックスで編集
 * - protect_released_at                     → 計算表示(経過日数)のため編集不可
 */
const SPECIAL_OR_READONLY_FIELDS = new Set<string>([
  'id',
  'owner_id',
  'protect_by_user_id',
  'protect_expires_at',
  'protect_released_at',
  'regular_contact_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'legacy_sf_id',
]);

interface Props {
  member: MemberWithOwner;
  /** 現在のログインユーザーのロール。'admin' のときのみプロテクト編集UIを表示 */
  currentUserRole?: string;
  /** プロテクト者・定期連絡者の候補一覧 (ユーザー全員) */
  protectUsers?: ProtectUserOption[];
  /** 詳細フィールド定義 (is_visible_detail=true, sort_order_detail 順)。動的編集フォームの元。 */
  detailFields?: FieldDefinition[];
}

/** ISO/タイムスタンプ文字列を input[type=date] 用の YYYY-MM-DD に変換 */
function toDateInput(value: unknown): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

/** ISO/タイムスタンプ文字列を input[type=datetime-local] 用の YYYY-MM-DDTHH:mm に変換 */
function toDateTimeLocal(value: unknown): string {
  if (!value) return '';
  return String(value).slice(0, 16);
}

/** レコード値をフォーム入力用の初期値に変換 */
function initValue(dataType: FieldDefinition['data_type'], raw: unknown): string | boolean {
  if (dataType === 'boolean') return raw === true;
  if (dataType === 'date') return toDateInput(raw);
  if (dataType === 'datetime') return toDateTimeLocal(raw);
  return raw == null ? '' : String(raw);
}

export function MemberEditDialog({
  member,
  currentUserRole,
  protectUsers = [],
  detailFields = [],
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isAdmin = currentUserRole === 'admin';

  // 動的編集対象: 実DBカラム(is_in_db)のみ。空白セル/専用UI/計算列/extra(jsonb)は除外。
  const editableFields = detailFields.filter(
    (f) => f.is_in_db && !f.is_placeholder && !SPECIAL_OR_READONLY_FIELDS.has(f.field_name),
  );

  // プロテクト期限が 2099 以降なら「無期限(固定)」扱い
  const initialUnlimited = (member.protect_expires_at ?? '') >= '2099-01-01';

  const record = member as unknown as Record<string, unknown>;
  const [form, setForm] = useState<Record<string, string | boolean>>(() => {
    const o: Record<string, string | boolean> = {};
    for (const f of editableFields) {
      o[f.field_name] = initValue(f.data_type, record[f.field_name]);
    }
    return o;
  });

  // 定期連絡者 (ユーザー検索コンボボックス)
  const [regularContactId, setRegularContactId] = useState<string | null>(
    member.regular_contact_id ?? null,
  );

  // 架電NG (do_not_call は詳細フィールドに含まれないため個別に扱う)
  const [doNotCall, setDoNotCall] = useState(member.do_not_call ?? false);

  // プロテクト編集用 state (admin のみ)
  const [protectUserId, setProtectUserId] = useState(member.protect_by_user_id ?? '');
  const [protectDate, setProtectDate] = useState(
    initialUnlimited ? '' : toDateInput(member.protect_expires_at),
  );
  const [protectUnlimited, setProtectUnlimited] = useState(initialUnlimited);

  const setField = (key: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      // admin のときだけプロテクト項目を送信する
      const protectPayload = isAdmin
        ? {
            protect_by_user_id: protectUserId || null,
            protect_expires_at: protectUserId
              ? protectUnlimited
                ? '2099-12-31'
                : protectDate || null
              : null,
          }
        : {};
      const result = await updateMember({
        id: member.id,
        ...form,
        do_not_call: doNotCall,
        regular_contact_id: regularContactId,
        ...protectPayload,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  // 連続する同じ section_name をまとめて見出し表示する
  const groups: { name: string | null; fields: FieldDefinition[] }[] = [];
  for (const f of editableFields) {
    const name = f.section_name ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else groups.push({ name, fields: [f] });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        編集
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90%] sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>会員情報の編集</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            {groups.map((group, gi) => (
              <div key={group.name ?? `g${gi}`} className="space-y-3">
                {group.name && (
                  <p className="border-b pb-1 text-xs font-semibold text-slate-600">{group.name}</p>
                )}
                {group.fields.map((f) => (
                  <FieldInput
                    key={f.field_name}
                    field={f}
                    value={form[f.field_name]}
                    onChange={(v) => setField(f.field_name, v)}
                  />
                ))}
              </div>
            ))}

            {/* 架電NG (詳細フィールド外だが編集可能に保持) */}
            <div className="flex items-center gap-2">
              <input
                id="do_not_call"
                type="checkbox"
                checked={doNotCall}
                onChange={(e) => setDoNotCall(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="do_not_call">架電NG</Label>
            </div>

            {/* 定期連絡者 (専用コンボボックス) */}
            <div className="space-y-3">
              <p className="border-b pb-1 text-xs font-semibold text-slate-600">担当者</p>
              <Field label="定期連絡者">
                <UserCombobox
                  users={protectUsers}
                  value={regularContactId}
                  onChange={setRegularContactId}
                  placeholder="名前で検索（空欄で全員表示）"
                />
              </Field>
            </div>

            {/* プロテクト編集 (admin のみ) */}
            {isAdmin && (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-xs font-semibold text-amber-700">プロテクト設定（管理者のみ）</p>
                <Field label="プロテクト者">
                  <UserCombobox
                    users={protectUsers}
                    value={protectUserId || null}
                    onChange={(id) => setProtectUserId(id ?? '')}
                    placeholder="名前で検索（空欄で全員表示）"
                  />
                </Field>
                <Field label="プロテクト終了日">
                  <Input
                    type="date"
                    value={protectDate}
                    onChange={(e) => setProtectDate(e.target.value)}
                    disabled={!protectUserId || protectUnlimited}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <input
                    id="protect_unlimited"
                    type="checkbox"
                    checked={protectUnlimited}
                    onChange={(e) => setProtectUnlimited(e.target.checked)}
                    disabled={!protectUserId}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="protect_unlimited">無期限（固定）にする</Label>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** データ型に応じた入力欄を描画する */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const label = field.label ?? field.field_name;

  if (field.data_type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input
          id={`f_${field.field_name}`}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor={`f_${field.field_name}`}>{label}</Label>
      </div>
    );
  }

  const inputType =
    field.data_type === 'date'
      ? 'date'
      : field.data_type === 'datetime'
        ? 'datetime-local'
        : field.data_type === 'number'
          ? 'number'
          : 'text';

  return (
    <Field label={label}>
      <Input
        type={inputType}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
