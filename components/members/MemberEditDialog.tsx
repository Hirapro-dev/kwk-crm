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
import type { MemberWithOwner } from '@/lib/domain/types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/** プロテクト者の選択肢 */
export interface ProtectUserOption {
  id: string;
  full_name: string | null;
}

interface Props {
  member: MemberWithOwner;
  /** 現在のログインユーザーのロール。'admin' のときのみプロテクト編集UIを表示 */
  currentUserRole?: string;
  /** プロテクト者・定期連絡者の候補一覧 (ユーザー全員) */
  protectUsers?: ProtectUserOption[];
}

/** ISO/タイムスタンプ文字列を input[type=date] 用の YYYY-MM-DD に変換 */
function toDateInput(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function MemberEditDialog({ member, currentUserRole, protectUsers = [] }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isAdmin = currentUserRole === 'admin';

  // プロテクト期限が 2099 以降なら「無期限(固定)」扱い
  const initialUnlimited = (member.protect_expires_at ?? '') >= '2099-01-01';

  const [form, setForm] = useState({
    name: member.name ?? '',
    name_kana: member.name_kana ?? '',
    email1: member.email1 ?? '',
    email2: ((member as unknown as Record<string, unknown>).email2 as string) ?? '',
    email3: ((member as unknown as Record<string, unknown>).email3 as string) ?? '',
    phone1: member.phone1 ?? '',
    postal_code: member.postal_code ?? '',
    address: ((member as unknown as Record<string, unknown>).address as string) ?? '',
    do_not_call: member.do_not_call ?? false,
  });

  // 定期連絡者 (ユーザー検索コンボボックス)
  const [regularContactId, setRegularContactId] = useState<string | null>(
    member.regular_contact_id ?? null,
  );

  // プロテクト編集用 state (admin のみ)
  const [protectUserId, setProtectUserId] = useState(member.protect_by_user_id ?? '');
  const [protectDate, setProtectDate] = useState(
    initialUnlimited ? '' : toDateInput(member.protect_expires_at),
  );
  const [protectUnlimited, setProtectUnlimited] = useState(initialUnlimited);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({
      ...prev,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));

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

          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <Field label="氏名">
              <Input value={form.name} onChange={set('name')} />
            </Field>
            <Field label="氏名（カナ）">
              <Input value={form.name_kana} onChange={set('name_kana')} />
            </Field>
            <Field label="電話">
              <Input value={form.phone1} onChange={set('phone1')} type="tel" />
            </Field>
            <Field label="メール1">
              <Input value={form.email1} onChange={set('email1')} type="email" />
            </Field>
            <Field label="メール2">
              <Input value={form.email2} onChange={set('email2')} type="email" />
            </Field>
            <Field label="メール3">
              <Input value={form.email3} onChange={set('email3')} type="email" />
            </Field>
            <Field label="郵便番号">
              <Input value={form.postal_code} onChange={set('postal_code')} />
            </Field>
            <Field label="住所">
              <Input value={form.address} onChange={set('address')} />
            </Field>
            <div className="flex items-center gap-2">
              <input
                id="do_not_call"
                type="checkbox"
                checked={form.do_not_call}
                onChange={set('do_not_call')}
                className="h-4 w-4"
              />
              <Label htmlFor="do_not_call">架電NG</Label>
            </div>

            <Field label="定期連絡者">
              <UserCombobox
                users={protectUsers}
                value={regularContactId}
                onChange={setRegularContactId}
                placeholder="名前で検索（空欄で全員表示）"
              />
            </Field>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
