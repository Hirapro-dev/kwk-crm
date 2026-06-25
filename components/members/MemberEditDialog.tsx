'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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

interface Props {
  member: MemberWithOwner;
}

export function MemberEditDialog({ member }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: member.name ?? '',
    name_kana: member.name_kana ?? '',
    email1: member.email1 ?? '',
    email2: (member as unknown as Record<string, unknown>).email2 as string ?? '',
    email3: (member as unknown as Record<string, unknown>).email3 as string ?? '',
    phone1: member.phone1 ?? '',
    postal_code: member.postal_code ?? '',
    address: (member as unknown as Record<string, unknown>).address as string ?? '',
    customer_type: member.customer_type ?? '',
    do_not_call: member.do_not_call ?? false,
  });

  const set = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateMember({ id: member.id, ...form });
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
        <DialogContent>
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
            <Field label="顧客種別">
              <Input value={form.customer_type} onChange={set('customer_type')} />
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
