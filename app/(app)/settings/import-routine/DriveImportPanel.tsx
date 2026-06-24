'use client';

/**
 * 定期取込(Drive)パネル (#1)
 *
 * オブジェクトごとに Drive ファイルを設定・保存し、
 * 「プレビュー」(ドライラン) → 「取込実行」(upsert) を行う。
 * まとめて取り込みボタンで有効オブジェクトを順次処理。
 */

import { CheckCircle2, CloudDownload, Loader2, Play, PlayCircle, Save, XCircle } from 'lucide-react';
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

/* ─────────────────────────────────────────────
   バルクインポートの1ステップの状態
───────────────────────────────────────────── */
interface BulkStep {
  object: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: CommitResult;
  elapsedMs?: number;
}

function formatMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}秒`;
  return `${Math.floor(ms / 60_000)}分${Math.round((ms % 60_000) / 1000)}秒`;
}

/* ─────────────────────────────────────────────
   まとめて取り込みセクション
───────────────────────────────────────────── */
function BulkImportSection({
  sources,
  configured,
  onAllDone,
}: {
  sources: ImportSource[];
  configured: boolean;
  onAllDone: () => void;
}) {
  const targets = sources.filter((s) => s.enabled && s.drive_file_id);
  const [steps, setSteps] = useState<BulkStep[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'error').length;
  const totalCount = steps.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // 残り時間の推定
  const doneSteps = steps.filter((s) => s.elapsedMs !== undefined);
  const avgMs = doneSteps.length > 0
    ? doneSteps.reduce((sum, s) => sum + (s.elapsedMs ?? 0), 0) / doneSteps.length
    : null;
  const remainingSteps = totalCount - doneCount;
  const estimatedRemainMs = avgMs !== null ? avgMs * remainingSteps : null;

  const onStart = async () => {
    if (targets.length === 0) return;
    setFinished(false);
    setRunning(true);
    const initial: BulkStep[] = targets.map((s) => ({
      object: s.object,
      label: IMPORT_OBJECTS[s.object]?.label ?? s.object,
      status: 'pending',
    }));
    setSteps(initial);

    const updated = [...initial];
    for (let i = 0; i < targets.length; i++) {
      const src = targets[i];
      if (!src) continue;
      const cur = updated[i];
      if (!cur) continue;
      updated[i] = { ...cur, status: 'running' };
      setSteps([...updated]);
      const startedAt = Date.now();
      try {
        const res = await runDriveImport(src.object);
        const elapsedMs = Date.now() - startedAt;
        updated[i] = {
          ...cur,
          status: res?.ok ? 'done' : 'error',
          result: res ?? { ok: false, error: '取込に失敗しました' },
          elapsedMs,
        };
      } catch (e) {
        updated[i] = {
          ...cur,
          status: 'error',
          result: { ok: false, error: e instanceof Error ? e.message : '取込エラー' },
          elapsedMs: Date.now() - startedAt,
        };
      }
      setSteps([...updated]);
    }
    setRunning(false);
    setFinished(true);
    onAllDone();
  };

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">まとめて取り込み</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              「有効」チェック済みのオブジェクト（{targets.length}件）を順番に取り込みます
            </p>
          </div>
          <Button
            size="sm"
            onClick={onStart}
            disabled={running || !configured || targets.length === 0}
            className="shrink-0 gap-1.5"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            {running ? '取込中...' : 'まとめて取り込み'}
          </Button>
        </div>

        {/* プログレスバー */}
        {(running || finished) && totalCount > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{doneCount} / {totalCount} 完了</span>
              <span>
                {running && estimatedRemainMs !== null
                  ? `残り約 ${formatMs(estimatedRemainMs)}`
                  : finished
                  ? '完了'
                  : ''}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* ステップ一覧 */}
            <ul className="space-y-1 pt-1">
              {steps.map((step) => (
                <li key={step.object} className="flex items-start gap-2 text-xs">
                  {step.status === 'pending' && (
                    <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
                  )}
                  {step.status === 'running' && (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  )}
                  {step.status === 'done' && (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                  )}
                  {step.status === 'error' && (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <span className={
                    step.status === 'running' ? 'font-medium' :
                    step.status === 'done' ? 'text-green-700' :
                    step.status === 'error' ? 'text-destructive' :
                    'text-muted-foreground'
                  }>
                    {step.label}
                    {step.status === 'running' && ' を取込中...'}
                    {step.status === 'done' && step.result?.ok && (
                      <span className="ml-1 text-muted-foreground">
                        {step.result.upserted?.toLocaleString()}件
                        {step.elapsedMs ? ` (${formatMs(step.elapsedMs)})` : ''}
                      </span>
                    )}
                    {step.status === 'error' && (
                      <span className="ml-1">— {step.result?.error}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DriveImportPanel({ sources, configured }: Props) {
  const router = useRouter();
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

      {/* まとめて取り込みセクション */}
      <BulkImportSection
        sources={sources}
        configured={configured}
        onAllDone={() => router.refresh()}
      />

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
  const [updateOnly, setUpdateOnly] = useState(source.update_only);
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
      try {
        const res = await saveImportSource({
          object: source.object,
          drive_file_id: fileId,
          drive_file_id_2: isInquiries ? fileId2 || undefined : undefined,
          enabled,
          update_only: updateOnly,
        });
        setSaveMsg(res?.ok ? '保存しました' : (res?.error ?? '保存に失敗しました'));
        if (res?.ok) router.refresh();
      } catch (e) {
        setSaveMsg(e instanceof Error ? e.message : '保存に失敗しました');
      } finally {
        setStage('idle');
      }
    });
  };

  const onPreview = () => {
    setCommitted(null);
    setStage('previewing');
    startBusy(async () => {
      try {
        const res = await previewDriveImport(source.object);
        setPreview(
          res ?? { ok: false, error: '結果を取得できませんでした。ページを再読み込みしてください。' },
        );
      } catch (e) {
        setPreview({ ok: false, error: e instanceof Error ? e.message : '取得に失敗しました' });
      } finally {
        setStage('idle');
      }
    });
  };

  const onRun = () => {
    setStage('running');
    startBusy(async () => {
      try {
        const res = await runDriveImport(source.object);
        setCommitted(
          res ?? { ok: false, error: '結果を取得できませんでした。ページを再読み込みしてください。' },
        );
        if (res?.ok) router.refresh();
      } catch (e) {
        setCommitted({ ok: false, error: e instanceof Error ? e.message : '取込に失敗しました' });
      } finally {
        setStage('idle');
      }
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
          <label className="flex items-center gap-1 text-xs" title="既存IDの更新のみ・新規レコードは作成しない">
            <input
              type="checkbox"
              checked={updateOnly}
              onChange={(e) => setUpdateOnly(e.target.checked)}
            />
            更新のみ
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
            {updateOnly && <>スキップ {preview.skippedCount ?? 0} ／ </>}
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
            {(committed.skippedCount ?? 0) > 0 &&
              ` (新規ID ${committed.skippedCount} 件はスキップ)`}
            {(committed.errorCount ?? 0) > 0 && ` (エラー ${committed.errorCount} 件は除外)`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
