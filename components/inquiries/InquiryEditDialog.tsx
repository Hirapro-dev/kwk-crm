'use client';

import { AdMasterPicker } from '@/components/masters/AdMasterPicker';
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
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Inquiry } from '@/lib/domain/inquiries';
import { updateInquiry } from '@/lib/domain/inquiry_actions';
import { EDITABLE_INQUIRY_COLUMNS } from '@/lib/domain/inquiry_extra_edit';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 問合せ詳細の編集ダイアログ(CLAUDE.md §8.1 `/inquiries/[id]`。2026-09-18)。
 * 会員詳細の MemberEditDialog と同じく、項目管理(/settings/objects/inquiries)の「詳細」表示ON の項目を
 * セクション順に並べる。DB 列はホワイトリスト(EDITABLE_INQUIRY_COLUMNS)、可変項目(extra)は定義済みキー。
 * フォームは forms から選択、広告ID は【取得】で広告マスタから。備考は詳細画面のインライン編集(RemarksEditor)に任せる。
 */
interface Props {
  inquiry: Inquiry;
  detailFields: FieldDefinition[];
  forms: Array<{ id: number; name: string }>;
}

const EXCLUDED_EXTRA = new Set(['備考']);

function toDateTimeLocal(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16);
}

export function InquiryEditDialog({ inquiry, detailFields, forms }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adPickerOpen, setAdPickerOpen] = useState(false);

  const editable = detailFields.filter(
    (f) =>
      !f.is_placeholder &&
      ((f.is_in_db && EDITABLE_INQUIRY_COLUMNS.has(f.field_name)) ||
        (!f.is_in_db && !EXCLUDED_EXTRA.has(f.field_name))),
  );
  const record = inquiry as unknown as Record<string, unknown>;
  const extra = (inquiry.extra ?? {}) as Record<string, unknown>;
  const [form, setForm] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const f of editable) {
      const raw = f.is_in_db ? record[f.field_name] : extra[f.field_name];
      if (f.field_name === 'registered_at') o[f.field_name] = toDateTimeLocal(raw);
      else if (f.data_type === 'date') o[f.field_name] = raw ? String(raw).slice(0, 10) : '';
      else o[f.field_name] = raw == null ? '' : String(raw);
    }
    return o;
  });
  const setField = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  // 連続する同じ section_name をまとめる(会員編集と同じ)
  const groups: { name: string | null; fields: FieldDefinition[] }[] = [];
  for (const f of editable) {
    const name = f.section_name ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else groups.push({ name, fields: [f] });
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const cols: Record<string, string | number | null> = {};
      const ex: Record<string, string> = {};
      for (const f of editable) {
        const v = form[f.field_name] ?? '';
        if (f.is_in_db) {
          if (f.field_name === 'form_id') cols.form_id = v ? Number(v) : null;
          else cols[f.field_name] = v;
        } else ex[f.field_name] = v;
      }
      // 登録日時は日本時間として解釈して ISO に
      if (typeof cols.registered_at === 'string' && cols.registered_at)
        cols.registered_at = `${cols.registered_at}:00+09:00`;
      const r = await updateInquiry({ id: inquiry.id, ...cols, extra: ex } as Parameters<
        typeof updateInquiry
      >[0]);
      if (r.error) {
        setError(r.error);
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
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="max-w-[90%] sm:max-w-[720px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>問合せ情報の編集</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {groups.map((g, gi) => (
              <div key={g.name ?? `g${gi}`} className="space-y-3">
                {g.name && (
                  <p className="border-b pb-1 text-xs font-semibold text-slate-600">{g.name}</p>
                )}
                {g.fields.map((f) => {
                  const label = f.label ?? f.field_name;
                  const v = form[f.field_name] ?? '';
                  if (f.field_name === 'form_id') {
                    return (
                      <div key={f.field_name} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{label}</Label>
                        <Select value={v} onChange={(e) => setField('form_id', e.target.value)}>
                          <option value="">(未設定)</option>
                          {forms.map((fm) => (
                            <option key={fm.id} value={fm.id}>
                              {fm.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  }
                  if (f.field_name === 'ad_id') {
                    return (
                      <div key={f.field_name} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{label}</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            value={v}
                            onChange={(e) => setField('ad_id', e.target.value)}
                            placeholder="例: N0000003"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 whitespace-nowrap"
                            onClick={() => setAdPickerOpen(true)}
                          >
                            取得
                          </Button>
                        </div>
                      </div>
                    );
                  }
                  const long = !f.is_in_db && v.length > 60;
                  return (
                    <div key={f.field_name} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      {long ? (
                        <Textarea
                          value={v}
                          rows={3}
                          onChange={(e) => setField(f.field_name, e.target.value)}
                        />
                      ) : (
                        <Input
                          type={
                            f.field_name === 'registered_at'
                              ? 'datetime-local'
                              : f.data_type === 'date'
                                ? 'date'
                                : f.data_type === 'number'
                                  ? 'number'
                                  : 'text'
                          }
                          value={v}
                          onChange={(e) => setField(f.field_name, e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {editable.length === 0 && (
              <p className="text-sm text-muted-foreground">
                編集できる項目がありません(項目管理で「詳細」表示をONにしてください)
              </p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 編集ダイアログより後ろに置く(同じ z-50 の固定要素は後ろが上に描かれる) */}
      <AdMasterPicker
        open={adPickerOpen}
        onOpenChange={setAdPickerOpen}
        onPick={(ad) => setField('ad_id', ad.id)}
      />
    </>
  );
}
