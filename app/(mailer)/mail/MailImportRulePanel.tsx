'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { processMailMessageImport } from '@/lib/domain/mail_import_exec_actions';
import { saveMailImportRule } from '@/lib/domain/mail_import_rule_actions';
import {
  FIELD_COLUMN_LABELS,
  FORM_NAME_SOURCES,
  FORM_NAME_SOURCE_LABELS,
  type FieldColumn,
  type FormNameSource,
  IMPORT_TARGETS,
  IMPORT_TARGET_LABELS,
  type ImportTarget,
  type MailImportRule,
  applyRule,
  guessFieldTarget,
  guessFormLabel,
  parseMailBody,
  ruleMatches,
  subjectWithoutName,
} from '@/lib/domain/mail_import_rules';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  FORM_TARGET,
  ImportRuleTargetSelect,
  type InquiryFieldOption,
  buildTargetOptions,
  selectClass,
} from './ImportRuleTargetSelect';

/**
 * 取込候補のメール詳細に出す「取込ルール」パネル(CLAUDE.md §5.16)。
 * 開いているメールを見本に、件名・本文の行・本文の「ラベル: 値」を選びながらルールを作り、
 * 同じ画面でプレビュー(切り出した項目・フォーム名)を確認して保存する。
 * プレビューはサーバーの実行と同じ純粋関数(applyRule)で計算するため、保存後の結果と一致する。
 * 「入れる項目」には問合せオブジェクトの全項目(DB 列 + 項目管理で定義済みの可変項目)を出し、
 * 既存の可変項目と同じキーに入れられるようにする(Salesforce 由来のデータと同じ形で集計できる)。
 */

export interface MailImportRuleSample {
  mailBoxId: number | null;
  mailBoxAddress: string | null;
  fromAddress: string;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
}

export type { InquiryFieldOption };

interface Props {
  sample: MailImportRuleSample;
  /** このメールに一致している既存ルール(無ければ null = 新規作成) */
  existingRule: MailImportRule | null;
  isAdmin: boolean;
  /** 問合せオブジェクトの項目(項目管理 /settings/objects/inquiries の定義) */
  inquiryFields: InquiryFieldOption[];
  /** 見本にしている受信メッセージ(mail_messages.id)と、その処理結果(§5.16 段階③) */
  messageRowId: string;
  importStatus: 'pending' | 'done' | 'error' | null;
  importNote: string | null;
  inquiryId: string | null;
  /** 取込先が LP のとき作成した LP(migration 99) */
  lpEntryId?: string | null;
}

function initialFieldMap(
  labels: string[],
  existing: MailImportRule | null,
  definedExtraKeys: Set<string>,
): Record<string, string> {
  if (existing) return { ...existing.field_map };
  // 新規作成時の初期割当て: ラベル名から問合せの項目を推定(純粋関数 guessFieldTarget)
  const guess: Record<string, string> = {};
  for (const l of labels) {
    const t = guessFieldTarget(l, definedExtraKeys);
    if (t) guess[l] = t;
  }
  return guess;
}

export function MailImportRulePanel({
  sample,
  existingRule,
  isAdmin,
  inquiryFields,
  messageRowId,
  importStatus,
  importNote,
  inquiryId,
  lpEntryId = null,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const parsed = useMemo(() => parseMailBody(sample.textBody, sample.htmlBody), [sample]);
  const labelNames = useMemo(() => Object.keys(parsed.labels), [parsed]);
  const options = useMemo(() => buildTargetOptions(inquiryFields), [inquiryFields]);
  const extraLabel = (key: string) =>
    options.extras.find((e) => e.value === `extra:${key}`)?.label ?? key;

  const [name, setName] = useState(
    existingRule?.name ?? subjectWithoutName(sample.subject).slice(0, 60),
  );
  const [isActive, setIsActive] = useState(existingRule?.is_active ?? true);
  const [useMailBox, setUseMailBox] = useState(
    existingRule ? existingRule.mail_box_id !== null : true,
  );
  const [useFrom, setUseFrom] = useState(existingRule ? !!existingRule.from_address : true);
  const [subjectContains, setSubjectContains] = useState(
    existingRule?.subject_contains ?? subjectWithoutName(sample.subject),
  );
  // 新規作成時、本文に「フォーム名」のラベルがあればそれをフォーム名の取り元にし、その値を本文キーワードの
  // 既定値にする(エキスパのフォーム通知など。フォーム名は件名に無いので、件名ではなく本文で絞る)
  const guessedFormLabel = existingRule ? null : guessFormLabel(labelNames);
  const [bodyContains, setBodyContains] = useState(
    existingRule?.body_contains ??
      (guessedFormLabel ? (parsed.labels[guessedFormLabel] ?? '') : ''),
  );
  const [source, setSource] = useState<FormNameSource>(
    existingRule?.form_name_source ?? (guessedFormLabel ? 'body_label' : 'body_line'),
  );
  const [param, setParam] = useState(existingRule?.form_name_param ?? guessedFormLabel ?? '1');
  // 取込先(問合せ / LP)とフォーム名キーワード(migration 99)
  const [target, setImportTarget] = useState<ImportTarget>(existingRule?.target ?? 'inquiry');
  const [formNameContains, setFormNameContains] = useState(existingRule?.form_name_contains ?? '');
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(() =>
    initialFieldMap(labelNames, existingRule, options.extraKeys),
  );

  const preview = useMemo(
    () =>
      applyRule(
        { form_name_source: source, form_name_param: param, field_map: fieldMap },
        { subject: sample.subject, textBody: sample.textBody, htmlBody: sample.htmlBody },
      ),
    [source, param, fieldMap, sample],
  );

  // 編集中の一致条件でこのメール自身が一致するか(保存前に条件の書き間違いに気づけるように)
  const draftMatches = useMemo(
    () =>
      ruleMatches(
        {
          id: existingRule?.id ?? 0,
          name,
          is_active: true,
          sort_order: 0,
          mail_box_id: useMailBox ? sample.mailBoxId : null,
          from_address: useFrom ? sample.fromAddress : null,
          subject_contains: subjectContains,
          body_contains: bodyContains,
          form_name_contains: formNameContains,
          target,
          form_name_source: source,
          form_name_param: param,
          field_map: fieldMap,
        },
        {
          mailBoxId: sample.mailBoxId,
          fromAddress: sample.fromAddress,
          subject: sample.subject,
          textBody: sample.textBody,
          htmlBody: sample.htmlBody,
        },
      ),
    [
      existingRule,
      name,
      useMailBox,
      useFrom,
      subjectContains,
      bodyContains,
      formNameContains,
      target,
      source,
      param,
      fieldMap,
      sample,
    ],
  );

  // 「フォーム」を選んだラベルは field_map には入れず、フォーム名の取り方(本文のラベルの値)に反映する
  const isFormLabel = (label: string) => source === 'body_label' && param === label;
  const setTarget = (label: string, target: string) => {
    if (target === FORM_TARGET) {
      setSource('body_label');
      setParam(label);
      setFieldMap((prev) => {
        const next = { ...prev };
        delete next[label];
        return next;
      });
      return;
    }
    if (isFormLabel(label)) {
      // フォーム名の取り元だったラベルを別の項目に変えたら、取り方を既定(本文1行目)に戻す
      setSource('body_line');
      setParam('1');
    }
    setFieldMap((prev) => {
      const next = { ...prev };
      if (target === '') delete next[label];
      else next[label] = target;
      return next;
    });
  };

  // 「このメールを処理」: 保存済みのルールで実際に問合せを作る(結果はメールに記録される)
  const handleProcess = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await processMailMessageImport(messageRowId);
      if (r.error) {
        setMessage({ kind: 'error', text: r.error });
        return;
      }
      const o = r.outcome;
      setMessage({
        kind: o?.status === 'error' ? 'error' : 'ok',
        text: o ? `処理結果: ${o.note}` : '処理しました',
      });
      router.refresh();
    });
  };

  const handleSave = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await saveMailImportRule({
        id: existingRule?.id,
        name,
        isActive,
        mailBoxId: useMailBox ? sample.mailBoxId : null,
        fromAddress: useFrom ? sample.fromAddress : null,
        subjectContains,
        bodyContains,
        formNameContains,
        target,
        formNameSource: source,
        formNameParam: param,
        fieldMap,
      });
      if (r.error) {
        setMessage({ kind: 'error', text: r.error });
        return;
      }
      setMessage({
        kind: 'ok',
        text: existingRule ? 'ルールを更新しました' : 'ルールを保存しました',
      });
      router.refresh();
    });
  };

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-base">取込ルール</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          {existingRule
            ? `このメールに一致するルール「${existingRule.name}」を編集します。`
            : 'このメールに一致するルールはありません。このメールを見本に新しいルールを作ります。'}
          {!isAdmin && ' ルールの変更は管理者のみ行えます。'}
        </p>
        <p className="mt-1 text-xs">
          <span className="text-muted-foreground">このメールの処理結果: </span>
          {inquiryId ? (
            <a
              href={`/inquiries/${inquiryId}`}
              className="sf-link"
              target="_blank"
              rel="noreferrer"
            >
              問合せ {inquiryId}
            </a>
          ) : lpEntryId ? (
            <a href={`/lp/${lpEntryId}`} className="sf-link" target="_blank" rel="noreferrer">
              LP {lpEntryId}
            </a>
          ) : importStatus === 'error' ? (
            <span className="text-destructive">エラー</span>
          ) : importStatus === 'pending' ? (
            <span>ルール未一致</span>
          ) : (
            <span>未処理</span>
          )}
          {importNote && <span className="ml-1 text-muted-foreground">({importNote})</span>}
        </p>
      </CardHeader>
      <CardContent className="space-y-5 p-4 text-sm">
        {/* 一致条件 */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            一致条件(すべて満たすメールに適用)
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">ルール名</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                件名に含むキーワード(空白区切り)
              </Label>
              <Input
                value={subjectContains}
                onChange={(e) => setSubjectContains(e.target.value)}
                disabled={!isAdmin}
                placeholder="空欄なら件名で絞らない"
              />
              <p className="text-[11px] text-muted-foreground">
                すべてのキーワードを含む件名に一致します(語順は問いません)。例: 「本人確認完了
                kioxia
                Google広告経由」。件名に無い語(本文のフォーム名など)はここではなく「本文に含むキーワード」に入れてください
              </p>
            </div>
            <div className="space-y-1 sm:col-start-2">
              <Label className="text-xs text-muted-foreground">
                本文に含むキーワード(空白区切り)
              </Label>
              <Input
                value={bodyContains}
                onChange={(e) => setBodyContains(e.target.value)}
                disabled={!isAdmin}
                placeholder="空欄なら本文で絞らない"
              />
              <p className="text-[11px] text-muted-foreground">
                件名では区別できない型(例:
                本文1行目だけが「受信データ」と「本人確認完了」で違う)を分けるときに使います
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">取込先</Label>
              <select
                className={selectClass}
                value={target}
                onChange={(e) => setImportTarget(e.target.value as ImportTarget)}
                disabled={!isAdmin}
              >
                {IMPORT_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {IMPORT_TARGET_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                LP を選ぶと問合せではなく
                LP(§5.17)に入れます。氏名・かな・メール・広告ID・登録日時だけを取り込み、会員の紐付けはしません
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                フォーム名に含むキーワード(空白区切り)
              </Label>
              <Input
                value={formNameContains}
                onChange={(e) => setFormNameContains(e.target.value)}
                disabled={!isAdmin}
                placeholder="空欄ならフォーム名で絞らない"
              />
              <p className="text-[11px] text-muted-foreground">
                下の「フォーム名の取り方」で決めたフォーム名にすべて含むときに一致します(例:
                「LP」「メールマガジン」)。本文の他の場所は見ません
              </p>
            </div>
          </div>
          <p className={draftMatches ? 'text-xs text-emerald-700' : 'text-xs text-destructive'}>
            {draftMatches
              ? 'この条件は、このメールに一致します。'
              : 'この条件は、このメールに一致しません(キーワードを見直してください)。'}
          </p>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={useMailBox}
                onChange={(e) => setUseMailBox(e.target.checked)}
                disabled={!isAdmin || sample.mailBoxId === null}
              />
              受信箱を限定: {sample.mailBoxAddress ?? '(不明)'}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={useFrom}
                onChange={(e) => setUseFrom(e.target.checked)}
                disabled={!isAdmin}
              />
              差出人を限定: {sample.fromAddress}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={!isAdmin}
              />
              有効
            </label>
          </div>
        </section>

        {/* フォーム名 */}
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
                if (s === 'body_label' && !parsed.labels[param]) setParam(labelNames[0] ?? '');
              }}
              disabled={!isAdmin}
            >
              {FORM_NAME_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {FORM_NAME_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            {source === 'body_line' && (
              <select
                className={selectClass}
                value={param}
                onChange={(e) => setParam(e.target.value)}
                disabled={!isAdmin}
              >
                {parsed.lines.map((line, i) => (
                  <option key={`${i}-${line}`} value={String(i + 1)}>
                    {i + 1}行目: {line.length > 60 ? `${line.slice(0, 60)}…` : line}
                  </option>
                ))}
              </select>
            )}
            {source === 'body_label' && (
              <select
                className={selectClass}
                value={param}
                onChange={(e) => setParam(e.target.value)}
                disabled={!isAdmin}
              >
                {labelNames.map((l) => (
                  <option key={l} value={l}>
                    {l}: {parsed.labels[l]}
                  </option>
                ))}
              </select>
            )}
            {source === 'fixed' && (
              <Input
                value={param}
                onChange={(e) => setParam(e.target.value)}
                disabled={!isAdmin}
                placeholder="フォーム名"
              />
            )}
          </div>
        </section>

        {/* 項目の対応 */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            本文の「ラベル: 値」→ 問合せの項目({labelNames.length} 件のラベルを検出)
          </h3>
          {labelNames.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              本文に「ラベル: 値」の形の行がありません。このメールの型はルールで取り込めません。
            </p>
          ) : (
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">ラベル</th>
                    <th className="px-2 py-1.5 font-medium">このメールの値</th>
                    <th className="px-2 py-1.5 font-medium">入れる項目(問合せの項目から選択)</th>
                  </tr>
                </thead>
                <tbody>
                  {labelNames.map((l) => {
                    const current = isFormLabel(l) ? FORM_TARGET : (fieldMap[l] ?? '');
                    return (
                      <tr key={l} className="border-t">
                        <td className="whitespace-nowrap px-2 py-1.5">{l}</td>
                        <td className="max-w-[260px] truncate px-2 py-1.5 text-muted-foreground">
                          {parsed.labels[l]}
                        </td>
                        <td className="px-2 py-1.5">
                          <ImportRuleTargetSelect
                            label={l}
                            value={current}
                            onChange={(t) => setTarget(l, t)}
                            options={options}
                            disabled={!isAdmin}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* プレビュー */}
        <section className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
          <h3 className="text-xs font-semibold text-emerald-800">
            プレビュー(このメールを取り込むとこうなります)
          </h3>
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">フォーム名</dt>
            <dd>
              {preview.formName ?? <span className="text-destructive">(取得できません)</span>}
            </dd>
            {(Object.keys(preview.fields) as Array<keyof typeof preview.fields>).map((k) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">
                  {options.columns.find((c) => c.value === k)?.label ??
                    FIELD_COLUMN_LABELS[k as FieldColumn]}
                </dt>
                <dd>{preview.fields[k]}</dd>
              </div>
            ))}
            <dt className="text-muted-foreground">登録日時</dt>
            <dd>{preview.registeredAt ?? '(未指定 → 受信日時を使います)'}</dd>
            {Object.entries(preview.extra).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{extraLabel(k)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {preview.errors.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-destructive">
              {preview.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            {target === 'lp'
              ? '取込先が LP のため、フォーム名・氏名・かな・メール・広告ID・登録日時だけを LP に入れます(可変項目は入りません)。会員の紐付けはしません。'
              : '会員の自動照合は、保存後に「このメールを処理」または受信時に自動で行われ、結果は問合せ一覧に出ます。'}
          </p>
        </section>

        {message && (
          <p
            className={
              message.kind === 'ok' ? 'text-xs text-emerald-700' : 'text-xs text-destructive'
            }
          >
            {message.text}
          </p>
        )}
        {isAdmin && (
          <div className="flex flex-wrap justify-end gap-2">
            {existingRule && (
              <Button
                variant="outline"
                onClick={handleProcess}
                disabled={pending}
                title="保存済みのルールでこのメールから問合せを作ります(既に作成済みなら何もしません)"
              >
                {pending ? '処理中…' : 'このメールを処理'}
              </Button>
            )}
            <Button onClick={handleSave} disabled={pending || labelNames.length === 0}>
              {pending ? '保存中…' : existingRule ? 'ルールを更新' : 'ルールを保存'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
