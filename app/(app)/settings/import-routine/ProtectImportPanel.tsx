'use client';

/**
 * プロテクト設定CSV取り込みパネル
 *
 * 2つの入力ソースに対応:
 *   1. ローカルCSVファイルをアップロード (優先)
 *   2. Google Drive ファイルID
 *
 * CSV列: Id, Member_ID__c, Name, OwnerId, protect__c
 *   protect__c = 'free'      → スキップ
 *   protect__c = '会社プロテクト' / 'ex sales' → 固定プロテクト(2099年)
 *   protect__c = ユーザー名  → フロールールで期限計算(非アクティブなら固定)
 */

import { CloudDownload, Loader2, Play, Save, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type {
  ProtectImportPreview,
  ProtectImportResult,
  ProtectImportSource,
} from '@/lib/domain/protect_import_actions';
import {
  previewProtectImport,
  previewProtectImportFromCsvText,
  runProtectImport,
  runProtectImportFromCsvText,
  saveProtectImportSource,
} from '@/lib/domain/protect_import_actions';
import { formatDateTime } from '@/lib/utils/date';

interface Props {
  source: ProtectImportSource;
  configured: boolean;
}

export function ProtectImportPanel({ source, configured }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ローカルファイル
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);

  // Drive 設定
  const [fileId, setFileId] = useState(source.drive_file_id ?? '');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [preview, setPreview] = useState<ProtectImportPreview | null>(null);
  const [result, setResult] = useState<ProtectImportResult | null>(null);
  const [busy, startBusy] = useTransition();
  const [stage, setStage] = useState<'idle' | 'saving' | 'reading' | 'previewing' | 'running'>('idle');

  // ── ファイル選択 ────────────────────────────
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setCsvFile(file);
    setCsvText(null);
    setPreview(null);
    setResult(null);
    if (!file) return;

    setStage('reading');
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvText(ev.target?.result as string ?? null);
      setStage('idle');
    };
    reader.onerror = () => setStage('idle');
    // Shift-JIS も考慮: まず UTF-8 で読む、文字化けがあれば Shift-JIS を試みる
    reader.readAsText(file, 'utf-8');
  };

  const onClearFile = () => {
    setCsvFile(null);
    setCsvText(null);
    setPreview(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Drive 保存 ─────────────────────────────
  const onSave = () => {
    setSaveMsg(null);
    setStage('saving');
    startBusy(async () => {
      try {
        const res = await saveProtectImportSource(fileId);
        setSaveMsg(res.ok ? '保存しました' : (res.error ?? '保存に失敗しました'));
        if (res.ok) router.refresh();
      } catch (e) {
        setSaveMsg(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setStage('idle');
      }
    });
  };

  // ── プレビュー ──────────────────────────────
  const onPreview = () => {
    setResult(null);
    setStage('previewing');
    startBusy(async () => {
      try {
        let res: ProtectImportPreview;
        if (csvText) {
          res = await previewProtectImportFromCsvText(csvText);
        } else {
          res = await previewProtectImport(fileId || (source.drive_file_id ?? ''));
        }
        setPreview(res);
      } catch (e) {
        setPreview({
          ok: false,
          error: e instanceof Error ? e.message : '取得に失敗しました',
          totalRows: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [],
        });
      } finally {
        setStage('idle');
      }
    });
  };

  // ── 取込実行 ───────────────────────────────
  const onRun = () => {
    setStage('running');
    startBusy(async () => {
      try {
        let res: ProtectImportResult;
        if (csvText) {
          res = await runProtectImportFromCsvText(csvText);
        } else {
          res = await runProtectImport(fileId || (source.drive_file_id ?? ''));
        }
        setResult(res);
        if (res.ok) router.refresh();
      } catch (e) {
        setResult({
          ok: false,
          error: e instanceof Error ? e.message : '取込に失敗しました',
          updated: 0, fixedCount: 0, normalCount: 0, skipCount: 0, errorCount: 0, errors: [],
        });
      } finally {
        setStage('idle');
      }
    });
  };

  const canPreview = !!(csvText || fileId || source.drive_file_id);
  const canRun = preview?.ok && (preview.fixedCount + preview.normalCount) > 0;

  return (
    <Card className="border-blue-200">
      <CardHeader className="flex flex-row items-start justify-between border-b py-3">
        <CardTitle className="text-sm">プロテクト設定（OwnerId CSV）</CardTitle>
        <div className="text-[11px] text-muted-foreground space-y-0.5 text-right">
          {source.last_run_at && (
            <div>
              最終実行: {formatDateTime(source.last_run_at)} ·{' '}
              <span className={source.last_run_status === 'success' ? 'text-green-700' : 'text-amber-600'}>
                {source.last_run_message ?? source.last_run_status}
              </span>
            </div>
          )}
          <div className="text-muted-foreground/70">
            固定 → 会社プロテクト / ex sales / 非アクティブ / 守田和之 / 植田雄輝
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">

        {/* ── ローカルファイルアップロード ── */}
        <div className="rounded-md border border-dashed p-3 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            ① ローカルCSVファイルを選択（推奨）
          </p>
          {!csvFile ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
              <Upload className="h-4 w-4 flex-shrink-0" />
              CSVファイルを選択…
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onFileChange}
                disabled={busy}
              />
            </label>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{csvFile.name}</span>
              <span className="text-muted-foreground text-xs">
                ({(csvFile.size / 1024).toFixed(0)} KB)
              </span>
              {stage === 'reading' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {csvText && <span className="text-green-700 text-xs">読み込み完了</span>}
              <button
                type="button"
                onClick={onClearFile}
                className="ml-auto text-muted-foreground hover:text-destructive"
                aria-label="ファイルをクリア"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* ── Drive ファイルID（補助） ── */}
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            ② Google Drive ファイルID（ローカルファイルなし時に使用）
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                value={fileId}
                onChange={(e) => setFileId(e.target.value)}
                placeholder="例: 1AbC... または https://drive.google.com/file/d/.../view"
                className="h-8 text-sm"
                disabled={!!csvFile}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onSave}
              disabled={busy || !!csvFile}
            >
              {stage === 'saving' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              保存
            </Button>
          </div>
          {saveMsg && <p className="text-xs text-muted-foreground">{saveMsg}</p>}
        </div>

        {/* ── アクションボタン ── */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={onPreview}
            disabled={busy || !canPreview || (!csvText && !configured && !source.drive_file_id)}
          >
            {stage === 'previewing' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="mr-1 h-3.5 w-3.5" />
            )}
            プレビュー（件数確認）
          </Button>
          {canRun && (
            <Button size="sm" onClick={onRun} disabled={busy}>
              {stage === 'running' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" />
              )}
              プロテクト設定を実行
            </Button>
          )}
        </div>

        {/* ── プレビュー結果 ── */}
        {preview && !preview.ok && (
          <p role="alert" className="text-sm text-destructive">{preview.error}</p>
        )}
        {preview?.ok && (
          <div className="rounded-md bg-muted/50 p-3 space-y-1 text-xs">
            <p className="font-medium">プレビュー結果（総行数: {preview.totalRows.toLocaleString()}）</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-4">
              <div><span className="text-amber-600 font-medium">固定プロテクト</span>: {preview.fixedCount.toLocaleString()} 件</div>
              <div><span className="text-primary font-medium">通常プロテクト</span>: {preview.normalCount.toLocaleString()} 件</div>
              <div><span className="text-muted-foreground">スキップ</span>: {preview.skipCount.toLocaleString()} 件</div>
              <div className={preview.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                エラー: {preview.errorCount}
              </div>
            </div>
            {preview.errors.length > 0 && (
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-destructive">
                {preview.errors.slice(0, 20).map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 順序固定
                  <li key={i}>{e.row}行目: {e.message}</li>
                ))}
                {preview.errors.length > 20 && <li>…他 {preview.errors.length - 20} 件</li>}
              </ul>
            )}
            {(preview.fixedCount + preview.normalCount) > 0 && (
              <p className="text-muted-foreground mt-1">
                上記 {(preview.fixedCount + preview.normalCount).toLocaleString()} 件を更新します。「プロテクト設定を実行」で確定してください。
              </p>
            )}
          </div>
        )}

        {/* ── 取込結果 ── */}
        {result && !result.ok && (
          <p role="alert" className="text-sm text-destructive">{result.error}</p>
        )}
        {result?.ok && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 space-y-1 text-sm">
            <p className="font-medium text-green-800">
              ✓ {result.updated.toLocaleString()} 件のプロテクトを設定しました
            </p>
            <p className="text-xs text-green-700">
              固定プロテクト {result.fixedCount} 件 / 通常プロテクト {result.normalCount} 件 / スキップ {result.skipCount} 件
              {result.errorCount > 0 && <span className="text-destructive ml-2">· エラー {result.errorCount} 件</span>}
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-destructive">
                {result.errors.slice(0, 20).map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 順序固定
                  <li key={i}>{e.memberId}: {e.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
