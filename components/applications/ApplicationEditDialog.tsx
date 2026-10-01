'use client';

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
import { updateApplication } from '@/lib/domain/application_actions';
import { EDITABLE_APPLICATION_COLUMNS, toJstDateTimeLocal } from '@/lib/domain/application_edit';
import { APP_STATUSES, FLOW_TYPES } from '@/lib/domain/applications_constants';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 申込詳細の編集ダイアログ(CLAUDE.md §8.1 `/applications/[id]`。admin のみ。2026-10-01)。
 * 問合せの編集(InquiryEditDialog)と同じく、項目管理(/settings/objects/applications)の「詳細」表示 ON の項目を
 * セクション順に並べる。DB 列はホワイトリスト(EDITABLE_APPLICATION_COLUMNS)、可変項目(extra)は定義済みキー。
 * 案件・担当・申込獲得者は選択式、ステータス・入金/移動は選択肢、起算日時は日本時間で入力する。
 */
interface Props {
  application: Record<string, unknown> & { id: string; extra?: Record<string, unknown> | null };
  detailFields: FieldDefinition[];
  projects: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}

function initialValue(f: FieldDefinition, raw: unknown): string {
  const type = EDITABLE_APPLICATION_COLUMNS[f.field_name];
  if (type === 'datetime') return toJstDateTimeLocal(raw);
  if (type === 'date' || f.data_type === 'date') return raw ? String(raw).slice(0, 10) : '';
  return raw == null ? '' : String(raw);
}

export function ApplicationEditDialog({ application, detailFields, projects, users }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editable = detailFields.filter(
    (f) => !f.is_placeholder && (f.is_in_db ? f.field_name in EDITABLE_APPLICATION_COLUMNS : true),
  );
  const extra = (application.extra ?? {}) as Record<string, unknown>;
  const makeInitial = () => {
    const o: Record<string, string> = {};
    for (const f of editable) {
      o[f.field_name] = initialValue(
        f,
        f.is_in_db ? application[f.field_name] : extra[f.field_name],
      );
    }
    return o;
  };
  const [form, setForm] = useState<Record<string, string>>(makeInitial);
  const setField = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  // 連続する同じ section_name をまとめる(会員・問合せの編集と同じ)
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
      const columns: Record<string, string> = {};
      const ex: Record<string, string> = {};
      for (const f of editable) {
        if (f.is_in_db) columns[f.field_name] = form[f.field_name] ?? '';
        else ex[f.field_name] = form[f.field_name] ?? '';
      }
      const r = await updateApplication({ id: application.id, columns, extra: ex });
      if (r.error) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  const selectFor = (f: FieldDefinition, v: string) => {
    const key = f.field_name;
    const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => setField(key, e.target.value);
    if (key === 'project_id')
      return (
        <Select value={v} onChange={onChange}>
          {!projects.some((p) => p.id === v) && <option value={v}>{v || '(未設定)'}</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      );
    if (key === 'owner_id' || key === 'acquirer_id')
      return (
        <Select value={v} onChange={onChange}>
          <option value="">(未設定)</option>
          {v && !users.some((u) => u.id === v) && <option value={v}>(無効なユーザー)</option>}
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      );
    if (key === 'status')
      return (
        <Select value={v} onChange={onChange}>
          {APP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      );
    if (key === 'flow_type')
      return (
        <Select value={v} onChange={onChange}>
          <option value="">(未設定)</option>
          {FLOW_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      );
    return null;
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setForm(makeInitial());
          setError(null);
          setOpen(true);
        }}
      >
        編集
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="max-w-[90%] sm:max-w-[720px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>申込情報の編集</DialogTitle>
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
                  const type = EDITABLE_APPLICATION_COLUMNS[f.field_name];
                  const select = selectFor(f, v);
                  return (
                    <div key={f.field_name} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        {label}
                        {type === 'datetime' && '(日本時間)'}
                      </Label>
                      {select ??
                        (!f.is_in_db && (f.field_name === '備考' || v.length > 60) ? (
                          <Textarea
                            value={v}
                            rows={3}
                            onChange={(e) => setField(f.field_name, e.target.value)}
                          />
                        ) : (
                          <Input
                            type={
                              type === 'datetime'
                                ? 'datetime-local'
                                : type === 'date' || f.data_type === 'date'
                                  ? 'date'
                                  : 'text'
                            }
                            inputMode={type === 'number' ? 'decimal' : undefined}
                            value={v}
                            placeholder={f.field_name === 'member_id' ? 'K-000000000' : undefined}
                            className={f.field_name === 'member_id' ? 'font-mono' : undefined}
                            onChange={(e) => setField(f.field_name, e.target.value)}
                          />
                        ))}
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
    </>
  );
}
