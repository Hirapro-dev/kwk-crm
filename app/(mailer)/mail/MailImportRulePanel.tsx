'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveMailImportRule } from '@/lib/domain/mail_import_rule_actions';
import {
  FIELD_COLUMNS,
  FIELD_COLUMN_LABELS,
  FORM_NAME_SOURCES,
  FORM_NAME_SOURCE_LABELS,
  type FormNameSource,
  type MailImportRule,
  applyRule,
  parseMailBody,
  subjectWithoutName,
} from '@/lib/domain/mail_import_rules';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

/**
 * 取込候補のメール詳細に出す「取込ルール」パネル(CLAUDE.md §5.16)。
 * 開いているメールを見本に、件名・本文の行・本文の「ラベル: 値」を選びながらルールを作り、
 * 同じ画面でプレビュー(切り出した項目・フォーム名)を確認して保存する。
 * プレビューはサーバーの実行と同じ純粋関数(applyRule)で計算するため、保存後の結果と一致する。
 */

export interface MailImportRuleSample {
  mailBoxId: number | null;
  mailBoxAddress: string | null;
  fromAddress: string;
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
}

interface Props {
  sample: MailImportRuleSample;
  /** このメールに一致している既存ルール(無ければ null = 新規作成) */
  existingRule: MailImportRule | null;
  isAdmin: boolean;
}

/** ラベルの割り当て先の選択肢(未割当 / 各項目 / 可変項目=ラベル名をキーにする) */
const NONE = '';
const EXTRA = '__extra__';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

function initialFieldMap(
  labels: string[],
  existing: MailImportRule | null,
): Record<string, string> {
  if (existing) return { ...existing.field_map };
  // 新規作成時は、本文のラベルから分かりやすいものだけ初期割当てする
  const guess: Record<string, string> = {};
  for (const l of labels) {
    if (/名前|氏名/.test(l) && !/カナ|かな|フリガナ/.test(l)) guess[l] = 'name';
    else if (/カナ|かな|フリガナ/.test(l)) guess[l] = 'name_kana';
    else if (/メール/.test(l)) guess[l] = 'email';
    else if (/電話|TEL|Tel/.test(l)) guess[l] = 'phone';
    else if (/郵便/.test(l)) guess[l] = 'postal_code';
    else if (/住所/.test(l)) guess[l] = 'address';
    else if (/日時|完了日|登録日/.test(l)) guess[l] = 'registered_at';
  }
  return guess;
}

export function MailImportRulePanel({ sample, existingRule, isAdmin }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const parsed = useMemo(() => parseMailBody(sample.textBody, sample.htmlBody), [sample]);
  const labelNames = useMemo(() => Object.keys(parsed.labels), [parsed]);

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
  const [source, setSource] = useState<FormNameSource>(
    existingRule?.form_name_source ?? 'body_line',
  );
  const [param, setParam] = useState(existingRule?.form_name_param ?? '1');
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(() =>
    initialFieldMap(labelNames, existingRule),
  );

  const preview = useMemo(
    () =>
      applyRule(
        { form_name_source: source, form_name_param: param, field_map: fieldMap },
        { subject: sample.subject, textBody: sample.textBody, htmlBody: sample.htmlBody },
      ),
    [source, param, fieldMap, sample],
  );

  const setTarget = (label: string, v: string) =>
    setFieldMap((prev) => {
      const next = { ...prev };
      if (v === NONE) delete next[label];
      else if (v === EXTRA) next[label] = `extra:${label}`;
      else next[label] = v;
      return next;
    });

  const targetValue = (label: string): string => {
    const t = fieldMap[label];
    if (!t) return NONE;
    return t.startsWith('extra:') ? EXTRA : t;
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
              <Label className="text-xs text-muted-foreground">件名に含む文字</Label>
              <Input
                value={subjectContains}
                onChange={(e) => setSubjectContains(e.target.value)}
                disabled={!isAdmin}
                placeholder="空欄なら件名で絞らない"
              />
              <p className="text-[11px] text-muted-foreground">
                短くすると同じ型のメールにまとめて一致します(例:
                【未来予測分析レポート請求】本人確認完了)
              </p>
            </div>
          </div>
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
                    <th className="px-2 py-1.5 font-medium">入れる項目</th>
                  </tr>
                </thead>
                <tbody>
                  {labelNames.map((l) => (
                    <tr key={l} className="border-t">
                      <td className="whitespace-nowrap px-2 py-1.5">{l}</td>
                      <td className="max-w-[260px] truncate px-2 py-1.5 text-muted-foreground">
                        {parsed.labels[l]}
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className={selectClass}
                          value={targetValue(l)}
                          onChange={(e) => setTarget(l, e.target.value)}
                          disabled={!isAdmin}
                        >
                          <option value={NONE}>(入れない)</option>
                          {FIELD_COLUMNS.map((c) => (
                            <option key={c} value={c}>
                              {FIELD_COLUMN_LABELS[c]}
                            </option>
                          ))}
                          <option value={EXTRA}>可変項目「{l}」</option>
                        </select>
                      </td>
                    </tr>
                  ))}
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
                <dt className="text-muted-foreground">{FIELD_COLUMN_LABELS[k]}</dt>
                <dd>{preview.fields[k]}</dd>
              </div>
            ))}
            <dt className="text-muted-foreground">登録日時</dt>
            <dd>{preview.registeredAt ?? '(未指定 → 受信日時を使います)'}</dd>
            {Object.entries(preview.extra).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">可変項目「{k}」</dt>
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
            会員の自動照合の結果は、自動作成の機能(段階③)で表示します。
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
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={pending || labelNames.length === 0}>
              {pending ? '保存中…' : existingRule ? 'ルールを更新' : 'ルールを保存'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
