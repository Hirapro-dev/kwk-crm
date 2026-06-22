'use client';

/**
 * 定期取込(Drive)パネル (#1)
 *
 * オブジェクトごとに Drive ファイルを設定・保存し、
 * 「プレビュー」(ドライラン) → 「取込実行」(upsert) を行う。
 */

import { CloudDownload, Loader2, Play, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ImportSource } from '@/lib/domain/import_sources';
import {
  previewDriveImport,
  runDriveImport,
  saveImportSource,
} from '@/lib/domain/import_drive_actions';
import type { CommitResult, PreviewResult } from '@/lib/domain/import_actions';
import { IMPORT_OBJECTS } from '@/lib/import/schema';
import { formatDateTime } from '@/lib/utils/date';

interface Props {
  sources: ImportSource[];
  configured: boolean;
}

export function DriveImportPanel({ sources, configured }: Props) {
  return (
    <div className="space-y-4">
      {!configured && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="space-y-1 p-4 text-sm">
            <p className="font-bold text-amber-800">
              Google サービスアカウントが未設定です
            </p>
            <p className="text-amber-700">
              サーバーの環境変数 <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_JSON</code>{' '}
              にサービスアカウントキー(JSON)を設定し、取込対象のファイル/フォルダを そのSAのメールアドレスに
              「閲覧者」で共有してください。設定後にこの画面の取込が有効になります。
            </p>
          </CardContent>
        </Card>
      )}

      {sources.map((s) => (
        <DriveSourceCard key={s.object} source={s} configured={configured} />
      ))}
    </div>
  );
}

function DriveSourceCard({
  source,
  configured,
}: {
  source: ImportSource;
  configured: boolean;
}) {
  const router = useRouter();
  const def = IMPORT_OBJECTS[source.object];
  const [fileId, setFileId] = useState(source.drive_file_id ?? '');
  const [fileId2, setFileId2] = useState(source.drive_file_id_2 ?? '');
  const [enabled, setEnabled] = useState(source.enabled);
  const isInquiries = source.object === 'inquiries';
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<CommitResult | null>(null);
  const [busy, startBusy] = useTransition();
  const [stage, setStage] = useState<'idle' | 'saving' | 'previewing' | 'running'>('idle');

  if (!def) return null;

  const onSave = () => {
    setSaveMsg(null);
    setStage('saving');
    startBusy(async () => {
      const res = await saveImportSource({
        object: source.object,
        drive_file_id: fileId,
        drive_file_id_2: isInquiries ? fileId2 || undefined : undefined,
        enabled,
      });
      setSaveMsg(res.ok ? '保存しました' : (res.error ?? '保存失敗'));
      setStage('idle');
      if (res.ok) router.refresh();
    });
  };

  const onPreview = () => {
    setCommitted(null);
    setStage('previewing');
    startBusy(async () => {
      const res = await previewDriveImport(source.object);
      setPreview(res);
      setStage('idle');
    });
  };

  const onRun = () => {
    setStage('running');
    startBusy(async () => {
      const res = await runDriveImport(source.object);
      setCommitted(res);
      setStage('idle');
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b py-3">
        <CardTitle className="text-sm">{def.label}</CardTitle>
        {source.last_run_at && (
          <span className="text-[11px] text-muted-foreground">
            最終実行: {formatDateTime(source.last_run_at)} ·{' '}
            <span
              className={
                source.last_run_status === 'success'
                  ? 'text-green-700'
                  : 'text-destructive'
              }
            >
              {source.last_run_message ?? source.last_run_status}
            </span>
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-[11px] text-muted-foreground" htmlFor={`f-${source.object}`}>
              Drive ファイルID または 共有URL
            </label>
            <Input
              id={`f-${source.object}`}
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              placeholder="例: 1AbC... または https://drive.google.com/file/d/.../view"
              className="h-8 text-sm"
            />
          </div>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            有効
          </label>
          <Button variant="outline" size="sm" onClick={onSave} disabled={busy}>
            {stage === 'saving' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            保存
          </Button>
        </div>

        {/* 問合せは2フォーム(KAWARA版 / 機密保持・CP)を統合取込するため2ファイル目を指定可能 */}
        {isInquiries && (
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground" htmlFor={`f2-${source.object}`}>
              2つ目のファイル(任意・問合せの別フォーム由来CSV)
            </label>
            <Input
              id={`f2-${source.object}`}
              value={fileId2}
              onChange={(e) => setFileId2(e.target.value)}
              placeholder="例: 機密保持・CP のCSVファイルID / 共有URL"
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              2フォームのCSVを統合し、問合せID(TA-)で突合します。共通列はカラム、フォーム固有列は extra に格納されます。
            </p>
          </div>
        )}
        {saveMsg && <p className="text-xs text-muted-foreground">{saveMsg}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onPreview}
            disabled={busy || !configured || !source.drive_file_id}
            title={!source.drive_file_id ? '先にファイルを保存してください' : ''}
          >
            {stage === 'previewing' ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="mr-1 h-3.5 w-3.5" />
            )}
            Driveから取得してプレビュー
          </Button>
          {preview?.ok && (preview.validCount ?? 0) > 0 && (
            <Button size="sm" onClick={onRun} disabled={busy}>
              {stage === 'running' ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1 h-3.5 w-3.5" />
              )}
              取込実行
            </Button>
          )}
        </div>

        {preview && !preview.ok && (
          <p role="alert" className="text-sm text-destructive">
            {preview.error}
          </p>
        )}
        {preview?.ok && (
          <p className="text-xs">
            総行数 {preview.totalRows} ／{' '}
            <span className="text-green-700">新規 {preview.newCount}</span> ／{' '}
            <span className="text-primary">更新 {preview.updateCount}</span> ／{' '}
            <span className={(preview.errorCount ?? 0) > 0 ? 'text-destructive' : ''}>
              エラー {preview.errorCount}
            </span>
            {preview.ignoredHeaders && preview.ignoredHeaders.length > 0 && (
              <span className="ml-2 text-amber-600">
                無視列: {preview.ignoredHeaders.join(' / ')}
              </span>
            )}
          </p>
        )}
        {preview?.ok && preview.errors && preview.errors.length > 0 && (
          <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-destructive">
            {preview.errors.map((er) => (
              <li key={er.row}>
                {er.row}行目: {er.message}
              </li>
            ))}
          </ul>
        )}

        {committed && !committed.ok && (
          <p role="alert" className="text-sm text-destructive">
            {committed.error}
          </p>
        )}
        {committed?.ok && (
          <p role="status" className="text-sm text-green-700">
            {committed.upserted?.toLocaleString()} 件を取り込みました。
            {(committed.errorCount ?? 0) > 0 && ` (エラー ${committed.errorCount} 件は除外)`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
