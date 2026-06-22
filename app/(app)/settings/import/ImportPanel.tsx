'use client';

/**
 * データ取込パネル (#2)
 *
 * 1. オブジェクト選択
 * 2. テンプレCSVダウンロード(ヘッダーのみ、クライアント生成)
 * 3. CSV選択 → プレビュー(ドライラン: 新規/更新/エラー件数 + サンプル)
 * 4. 「この内容で取込」で確定(upsert)
 */

import { Download, FileUp, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import {
  commitImport,
  type CommitResult,
  previewImport,
  type PreviewResult,
} from '@/lib/domain/import_actions';
import { IMPORT_OBJECTS, IMPORT_OBJECT_KEYS } from '@/lib/import/schema';

export function ImportPanel() {
  const router = useRouter();
  const [objectKey, setObjectKey] = useState(IMPORT_OBJECT_KEYS[0] ?? 'members');
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<CommitResult | null>(null);
  const [busy, startBusy] = useTransition();
  const [stage, setStage] = useState<'idle' | 'previewing' | 'committing'>('idle');

  const def = IMPORT_OBJECTS[objectKey]!;

  const resetResults = () => {
    setPreview(null);
    setCommitted(null);
  };

  const onSelectObject = (k: string) => {
    setObjectKey(k);
    setFile(null);
    setCsvText(null);
    resetResults();
  };

  const downloadTemplate = () => {
    const header = def.fields.map((f) => f.label).join(',');
    const blob = new Blob([`﻿${header}\n`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.object}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFileChange = async (f: File | null) => {
    setFile(f);
    resetResults();
    if (!f) {
      setCsvText(null);
      return;
    }
    setCsvText(await f.text());
  };

  const runPreview = () => {
    if (!csvText) return;
    setCommitted(null);
    setStage('previewing');
    startBusy(async () => {
      const res = await previewImport(objectKey, csvText);
      setPreview(res);
      setStage('idle');
    });
  };

  const runCommit = () => {
    if (!csvText) return;
    setStage('committing');
    startBusy(async () => {
      const res = await commitImport(objectKey, csvText);
      setCommitted(res);
      setStage('idle');
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">1. オブジェクトとテンプレート</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground" htmlFor="imp-obj">
                対象オブジェクト
              </label>
              <Select
                id="imp-obj"
                value={objectKey}
                onChange={(e) => onSelectObject(e.target.value)}
                className="h-8 w-48 text-sm"
              >
                {IMPORT_OBJECT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {IMPORT_OBJECTS[k]!.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-1 h-3.5 w-3.5" />
              テンプレートCSVをダウンロード
            </Button>
          </div>
          {def.note && <p className="text-xs text-muted-foreground">{def.note}</p>}
          <p className="text-[11px] text-muted-foreground">
            取込項目: {def.fields.map((f) => f.label).join(' / ')}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">2. CSVをアップロードしてプレビュー</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm"
            />
            <Button
              size="sm"
              onClick={runPreview}
              disabled={!csvText || busy}
            >
              {stage === 'previewing' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileUp className="mr-1 h-3.5 w-3.5" />
              )}
              プレビュー
            </Button>
            {file && (
              <span className="text-xs text-muted-foreground">{file.name}</span>
            )}
          </div>

          {preview && !preview.ok && (
            <p role="alert" className="text-sm text-destructive">
              {preview.error}
            </p>
          )}

          {preview?.ok && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Stat label="総行数" value={preview.totalRows ?? 0} />
                <Stat label="新規" value={preview.newCount ?? 0} tone="new" />
                <Stat label="更新" value={preview.updateCount ?? 0} tone="update" />
                <Stat
                  label="エラー"
                  value={preview.errorCount ?? 0}
                  tone={(preview.errorCount ?? 0) > 0 ? 'error' : undefined}
                />
              </div>

              <p className="text-[11px] text-muted-foreground">
                取込対象列: {preview.targetLabels?.join(' / ')}
                {preview.ignoredHeaders && preview.ignoredHeaders.length > 0 && (
                  <span className="ml-2 text-amber-600">
                    無視される列: {preview.ignoredHeaders.join(' / ')}
                  </span>
                )}
              </p>

              {preview.errors && preview.errors.length > 0 && (
                <div className="rounded border border-destructive/30 bg-destructive/5 p-2">
                  <p className="mb-1 text-xs font-bold text-destructive">
                    エラー行(先頭{preview.errors.length}件) — これらは取込されません
                  </p>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-destructive">
                    {preview.errors.map((er) => (
                      <li key={er.row}>
                        {er.row}行目: {er.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.sample && preview.sample.length > 0 && (
                <div className="overflow-x-auto">
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    サンプル(先頭{preview.sample.length}行)
                  </p>
                  <table className="text-xs">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="px-2 py-1 text-left">行</th>
                        <th className="px-2 py-1 text-left">ID</th>
                        <th className="px-2 py-1 text-left">処理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((s) => (
                        <tr key={s.row}>
                          <td className="px-2 py-0.5">{s.row}</td>
                          <td className="px-2 py-0.5 font-mono">{s.id}</td>
                          <td className="px-2 py-0.5">
                            <span
                              className={
                                s.mode === '新規'
                                  ? 'text-green-700'
                                  : 'text-primary'
                              }
                            >
                              {s.mode}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {preview?.ok && (preview.validCount ?? 0) > 0 && (
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">3. 取込を実行</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">
              有効な {preview.validCount?.toLocaleString()} 行(新規{' '}
              {preview.newCount} / 更新 {preview.updateCount})を {def.label}{' '}
              に取り込みます。この操作はレコードを上書きします。
            </p>
            <Button onClick={runCommit} disabled={busy}>
              {stage === 'committing' && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              この内容で取込
            </Button>

            {committed && !committed.ok && (
              <p role="alert" className="text-sm text-destructive">
                {committed.error}
                {committed.upserted ? `(${committed.upserted}件まで反映済み)` : ''}
              </p>
            )}
            {committed?.ok && (
              <p role="status" className="text-sm text-green-700">
                {committed.upserted?.toLocaleString()} 件を取り込みました。
                {(committed.errorCount ?? 0) > 0 &&
                  ` (エラー ${committed.errorCount} 件は除外)`}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'new' | 'update' | 'error';
}) {
  const color =
    tone === 'error'
      ? 'text-destructive'
      : tone === 'new'
        ? 'text-green-700'
        : tone === 'update'
          ? 'text-primary'
          : 'text-foreground';
  return (
    <div className="rounded border bg-card px-3 py-1.5 shadow-sm">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums ${color}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
