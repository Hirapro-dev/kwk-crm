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
import { saveMailImportRule } from '@/lib/domain/mail_import_rule_actions';
import {
  FORM_NAME_SOURCES,
  FORM_NAME_SOURCE_LABELS,
  type FormNameSource,
  type MailImportRule,
  subjectKeywords,
} from '@/lib/domain/mail_import_rules';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  ImportRuleTargetSelect,
  type InquiryFieldOption,
  buildTargetOptions,
  selectClass,
} from '../ImportRuleTargetSelect';

/**
 * /mail/settings からメール取込ルールを編集するダイアログ(CLAUDE.md §5.16)。
 * 見本のメールが無いのでプレビューは出せない。一致条件(受信箱・差出人・件名キーワード)、
 * フォーム名の取り方、本文のラベル → 問合せの項目の対応、有効/無効を直す。
 * 保存は取込候補のメール詳細と同じ Server Action(saveMailImportRule)。
 */
interface Props {
  rule: MailImportRule;
  boxes: Array<{ id: number; address: string }>;
  inquiryFields: InquiryFieldOption[];
  onClose: () => void;
}

export function ImportRuleEditDialog({ rule, boxes, inquiryFields, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => buildTargetOptions(inquiryFields), [inquiryFields]);

  const [name, setName] = useState(rule.name);
  const [isActive, setIsActive] = useState(rule.is_active);
  const [mailBoxId, setMailBoxId] = useState<string>(
    rule.mail_box_id === null ? '' : String(rule.mail_box_id),
  );
  const [fromAddress, setFromAddress] = useState(rule.from_address ?? '');
  const [subjectContains, setSubjectContains] = useState(rule.subject_contains ?? '');
  const [source, setSource] = useState<FormNameSource>(rule.form_name_source);
  const [param, setParam] = useState(rule.form_name_param ?? '');
  // ラベルの並びを保つため配列で持つ(オブジェクトのキー順に頼らない)
  const [rows, setRows] = useState<Array<{ label: string; target: string }>>(() =>
    Object.entries(rule.field_map ?? {}).map(([label, target]) => ({ label, target })),
  );
  const [newLabel, setNewLabel] = useState('');

  const keywords = subjectKeywords(subjectContains);

  const setTarget = (i: number, target: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, target } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));
  const addRow = () => {
    const label = newLabel.trim();
    if (!label || rows.some((r) => r.label === label)) return;
    setRows((prev) => [...prev, { label, target: '' }]);
    setNewLabel('');
  };

  const handleSave = () => {
    setError(null);
    const fieldMap: Record<string, string> = {};
    for (const r of rows) if (r.target) fieldMap[r.label] = r.target;
    startTransition(async () => {
      const res = await saveMailImportRule({
        id: rule.id,
        name,
        isActive,
        mailBoxId: mailBoxId === '' ? null : Number(mailBoxId),
        fromAddress: fromAddress.trim() || null,
        subjectContains: subjectContains.trim() || null,
        formNameSource: source,
        formNameParam: param,
        fieldMap,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92%] sm:max-w-[720px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>取込ルールを編集: {rule.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-1 text-sm">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              一致条件(すべて満たすメールに適用)
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">ルール名</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">受信箱</Label>
                <select
                  className={selectClass}
                  value={mailBoxId}
                  onChange={(e) => setMailBoxId(e.target.value)}
                >
                  <option value="">(受信箱で絞らない)</option>
                  {boxes.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.address}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">差出人(完全一致)</Label>
                <Input
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder="空欄なら差出人で絞らない"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  件名に含むキーワード(空白区切り)
                </Label>
                <Input
                  value={subjectContains}
                  onChange={(e) => setSubjectContains(e.target.value)}
                  placeholder="空欄なら件名で絞らない"
                />
                <p className="text-[11px] text-muted-foreground">
                  {keywords.length > 0
                    ? `${keywords.map((k) => `「${k}」`).join('')} をすべて含む件名に一致(語順は問いません)`
                    : '例: 「本人確認完了 kioxia Google広告経由」'}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              有効
            </label>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">フォーム名の取り方</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className={selectClass}
                value={source}
                onChange={(e) => {
                  const s = e.target.value as FormNameSource;
                  setSource(s);
                  if (s === 'body_line' && !/^\d+$/.test(param)) setParam('1');
                }}
              >
                {FORM_NAME_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {FORM_NAME_SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
              {source === 'body_line' && (
                <Input
                  type="number"
                  min={1}
                  value={param}
                  onChange={(e) => setParam(e.target.value)}
                  placeholder="行番号(空行は数えない)"
                />
              )}
              {source === 'body_label' && (
                <Input
                  value={param}
                  onChange={(e) => setParam(e.target.value)}
                  placeholder="本文のラベル(例: フォーム名)"
                />
              )}
              {source === 'fixed' && (
                <Input
                  value={param}
                  onChange={(e) => setParam(e.target.value)}
                  placeholder="フォーム名"
                />
              )}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              本文の「ラベル: 値」→ 問合せの項目
            </h3>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">ラベル</th>
                    <th className="px-2 py-1.5 font-medium">入れる項目(問合せの項目から選択)</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-2 text-muted-foreground">
                        ラベルがありません。下の欄から追加してください。
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => (
                    <tr key={r.label} className="border-t">
                      <td className="whitespace-nowrap px-2 py-1.5">{r.label}</td>
                      <td className="px-2 py-1.5">
                        <ImportRuleTargetSelect
                          label={r.label}
                          value={r.target}
                          onChange={(t) => setTarget(i, t)}
                          options={options}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          aria-label={`「${r.label}」の行を外す`}
                          onClick={() => removeRow(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRow();
                  }
                }}
                placeholder="本文のラベルを追加(例: お名前)"
                className="max-w-xs"
              />
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                行を追加
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              見本のメールを見ながら直したいときは、取込候補でそのメールを開いてください(プレビュー付きで編集できます)。
            </p>
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={pending || !name.trim()}>
            {pending ? '保存中…' : 'ルールを更新'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
