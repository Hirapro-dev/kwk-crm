'use client';

import { Button } from '@/components/ui/button';
import {
  deleteMailImportRule,
  moveMailImportRule,
  setMailImportRuleActive,
} from '@/lib/domain/mail_import_rule_actions';
import {
  FORM_NAME_SOURCE_LABELS,
  type MailImportRule,
  subjectKeywords,
} from '@/lib/domain/mail_import_rules';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { InquiryFieldOption } from '../ImportRuleTargetSelect';
import { ImportRuleEditDialog } from './ImportRuleEditDialog';

/**
 * /mail/settings のメール取込ルール一覧(CLAUDE.md §5.16)。
 * 有効/無効・判定順・削除と、編集ダイアログ(プレビュー無し)。新規作成は取込候補のメール詳細で行う。
 */
interface Props {
  rules: MailImportRule[];
  /** 受信箱(編集ダイアログの選択肢。「その他」は除く) */
  boxes: Array<{ id: number; address: string }>;
  /** 問合せオブジェクトの項目(編集ダイアログの「入れる項目」の選択肢) */
  inquiryFields: InquiryFieldOption[];
}

export function ImportRuleList({ rules, boxes, inquiryFields }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MailImportRule | null>(null);
  const boxAddresses: Record<number, string> = Object.fromEntries(
    boxes.map((b) => [b.id, b.address]),
  );

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  if (rules.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        ルールはまだありません。取込候補のメールを開いて「取込ルール」から作成してください。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      {error && <p className="px-4 pt-3 text-sm text-destructive">{error}</p>}
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs">
          <tr>
            <th className="px-3 py-2 font-medium">判定順</th>
            <th className="px-3 py-2 font-medium">ルール名</th>
            <th className="px-3 py-2 font-medium">一致条件</th>
            <th className="px-3 py-2 font-medium">フォーム名</th>
            <th className="px-3 py-2 font-medium">項目数</th>
            <th className="px-3 py-2 font-medium">有効</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={r.id} className="border-t">
              <td className="whitespace-nowrap px-3 py-2">
                <span className="mr-1 tabular-nums">{i + 1}</span>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                  aria-label="上へ"
                  disabled={pending || i === 0}
                  onClick={() => run(() => moveMailImportRule(r.id, 'up'))}
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                  aria-label="下へ"
                  disabled={pending || i === rules.length - 1}
                  onClick={() => run(() => moveMailImportRule(r.id, 'down'))}
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {r.mail_box_id !== null && (
                  <div>受信箱: {boxAddresses[r.mail_box_id] ?? r.mail_box_id}</div>
                )}
                {r.from_address && <div>差出人: {r.from_address}</div>}
                {subjectKeywords(r.subject_contains).length > 0 && (
                  <div>
                    件名にキーワード:{' '}
                    {subjectKeywords(r.subject_contains).map((k) => (
                      <span key={k} className="mr-1 rounded bg-muted px-1 py-0.5">
                        {k}
                      </span>
                    ))}
                    <span className="text-[10px]">(すべて含む)</span>
                  </div>
                )}
                {subjectKeywords(r.body_contains).length > 0 && (
                  <div>
                    本文にキーワード:{' '}
                    {subjectKeywords(r.body_contains).map((k) => (
                      <span key={k} className="mr-1 rounded bg-muted px-1 py-0.5">
                        {k}
                      </span>
                    ))}
                    <span className="text-[10px]">(すべて含む)</span>
                  </div>
                )}
                {r.mail_box_id === null &&
                  !r.from_address &&
                  !r.subject_contains &&
                  !r.body_contains && <div>(条件なし)</div>}
              </td>
              <td className="px-3 py-2 text-xs">
                {FORM_NAME_SOURCE_LABELS[r.form_name_source]}
                {r.form_name_param && (
                  <span className="text-muted-foreground">
                    (
                    {r.form_name_source === 'body_line'
                      ? `${r.form_name_param}行目`
                      : r.form_name_param}
                    )
                  </span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{Object.keys(r.field_map ?? {}).length}</td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={r.is_active}
                  disabled={pending}
                  onChange={(e) => run(() => setMailImportRuleActive(r.id, e.target.checked))}
                  aria-label="有効"
                />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label="編集"
                  title="編集"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label="削除"
                  title="削除"
                  onClick={() => {
                    if (window.confirm(`ルール「${r.name}」を削除します。よろしいですか?`)) {
                      run(() => deleteMailImportRule(r.id));
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <ImportRuleEditDialog
          key={editing.id}
          rule={editing}
          boxes={boxes}
          inquiryFields={inquiryFields}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
