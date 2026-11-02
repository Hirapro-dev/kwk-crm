'use client';

import { ReportResultView } from '@/components/reports/ReportResultView';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { saveReport } from '@/lib/domain/report_actions';
import { previewReport } from '@/lib/domain/report_preview_action';
import {
  type FilterLogic,
  type FilterPath,
  addConditionTo,
  addGroupTo,
  countFilterConditions,
  describeFilterGroup,
  filterGroupFromDefinition,
  isFilterGroupItem,
  moveConditionTo,
  moveTargets,
  normalizeFilterGroup,
  removeItemAt,
  setGroupLogic,
  updateConditionAt,
} from '@/lib/reports/filter_tree';
import { type AllowedColumnDef, REPORT_SCHEMAS } from '@/lib/reports/schema_all';
import { SUMMARY_AGG_LABEL } from '@/lib/reports/summary';
import type {
  AggregateFunction,
  ChartAggregate,
  ChartType,
  FilterOperator,
  ReportChartConfig,
  ReportColumn,
  ReportDefinition,
  ReportDisplayConfig,
  ReportFilterCondition,
  ReportFilterGroup,
  ReportSummaryField,
  ReportTypeId,
  SummaryAggregate,
} from '@/lib/reports/types';
import { cn } from '@/lib/utils/cn';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

/**
 * Salesforce 風レポートビルダー (仕様書 §9.10)
 *
 * レイアウト (1 : 4):
 *   ┌──────────────────┬─────────────────────────────────────────────┐
 *   │ 左ペイン (1)      │ 右ペイン プレビュー (4)                     │
 *   │ ┌── タブ ──┐     │  ┌─ 上部ヘッダー: レポート名 / 公開範囲 ┐    │
 *   │ │アウトライン │ │ │  └─────────────────────────────────────┘    │
 *   │ │ フィルタ    │ │ │  ┌── テーブル (debounce 500ms で再実行)──┐ │
 *   │ └─────────┘     │  │  ヘッダー: 選択列                     │ │
 *   │                  │  │  ボディ: データ行 (最大50行表示)         │ │
 *   │ アウトライン:    │  └─────────────────────────────────────┘    │
 *   │  - 利用可能Field  │                                              │
 *   │  - 選択中の列    │                                              │
 *   │                  │                                              │
 *   │ フィルタ:        │                                              │
 *   │  - AND/OR        │                                              │
 *   │  - 条件リスト    │                                              │
 *   └──────────────────┴─────────────────────────────────────────────┘
 */

const FILTER_OPS: { value: FilterOperator; label: string; supports: string[] }[] = [
  {
    value: 'equals',
    label: '=',
    supports: ['text', 'number', 'enum', 'boolean', 'date', 'datetime'],
  },
  {
    value: 'not_equals',
    label: '≠',
    supports: ['text', 'number', 'enum', 'boolean', 'date', 'datetime'],
  },
  { value: 'contains', label: 'を含む', supports: ['text'] },
  { value: 'not_contains', label: 'を含まない', supports: ['text'] },
  { value: 'starts_with', label: 'で始まる', supports: ['text'] },
  { value: 'ends_with', label: 'で終わる', supports: ['text'] },
  { value: 'gt', label: '>', supports: ['number', 'date', 'datetime'] },
  { value: 'gte', label: '>=', supports: ['number', 'date', 'datetime'] },
  { value: 'lt', label: '<', supports: ['number', 'date', 'datetime'] },
  { value: 'lte', label: '<=', supports: ['number', 'date', 'datetime'] },
  { value: 'this_month', label: '今月', supports: ['date', 'datetime'] },
  { value: 'this_year', label: '今年', supports: ['date', 'datetime'] },
  { value: 'last_n_days', label: '過去N日間', supports: ['date', 'datetime'] },
  {
    value: 'is_null',
    label: 'NULL',
    supports: ['text', 'number', 'date', 'datetime', 'enum', 'jsonb'],
  },
  {
    value: 'is_not_null',
    label: '非NULL',
    supports: ['text', 'number', 'date', 'datetime', 'enum', 'jsonb'],
  },
  { value: 'is_true', label: 'TRUE', supports: ['boolean'] },
  { value: 'is_false', label: 'FALSE', supports: ['boolean'] },
];

const AGG_LABEL: Record<AggregateFunction, string> = {
  sum: '合計',
  avg: '平均',
  count: '件数',
  count_distinct: 'ユニーク件数',
  min: '最小',
  max: '最大',
};

type LeftTab = 'outline' | 'filter' | 'chart' | 'summary';

const CHART_TYPE_LABEL: Record<ChartType, string> = {
  bar_vertical: '縦棒',
  bar_horizontal: '横棒',
  pie: '円',
  donut: 'ドーナツ',
  line: '折れ線',
};

const CHART_AGG_LABEL: Record<ChartAggregate, string> = {
  count: 'レコード件数',
  sum: '合計',
  avg: '平均',
  min: '最小',
  max: '最大',
};

interface BuilderProps {
  reportType: ReportTypeId;
  /** 既存レポート編集時に初期値を流し込む */
  initial?: {
    id?: string;
    name?: string;
    description?: string;
    visibility?: 'private' | 'team' | 'public' | 'restricted';
    shared_with?: string[];
    definition?: ReportDefinition;
  };
  /**
   * 主軸オブジェクトの extra jsonb キーを field_definitions から動的取得した一覧。
   * page.tsx (Server Component) で loadExtraColumnsForReportType() を呼んで渡す。
   * UI 上は通常カラムと同じく利用可能フィールドに混在表示される。
   */
  extraColumns?: AllowedColumnDef[];
  /** 「指定ユーザーのみ」を設定できるか(admin のみ true)。 */
  canRestrict?: boolean;
  /** 「指定ユーザーのみ」で選択できるユーザー一覧(有効ユーザー)。canRestrict 時に使用。 */
  assignableUsers?: { id: string; full_name: string | null }[];
}

export function ReportBuilder({
  reportType,
  initial,
  extraColumns = [],
  canRestrict = false,
  assignableUsers = [],
}: BuilderProps) {
  const router = useRouter();
  const baseSchema = REPORT_SCHEMAS[reportType];

  // schema は静的カラム + 動的 extra カラムをマージしたもの。
  // SQL Builder 側のホワイトリスト検証にもこのマージ済み一覧を渡す必要があるが、
  // 現状は extraColumns をプレビュー実行 Action にも別途渡している。
  const schema = useMemo(
    () => ({
      ...baseSchema,
      allowedColumns: [...baseSchema.allowedColumns, ...extraColumns],
    }),
    [baseSchema, extraColumns],
  );

  // ----- レポートメタ -----
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [visibility, setVisibility] = useState<'private' | 'team' | 'public' | 'restricted'>(
    initial?.visibility ?? 'private',
  );
  // 「指定ユーザーのみ」で閲覧許可するユーザーID
  const [sharedWith, setSharedWith] = useState<string[]>(initial?.shared_with ?? []);

  // ----- 列 / グルーピング / ソート -----
  const [columns, setColumns] = useState<ReportColumn[]>(initial?.definition?.columns ?? []);
  const [groupBy, setGroupBy] = useState<string[]>(
    initial?.definition?.group_by?.map((g) => g.field) ?? [],
  );
  const [sort, setSort] = useState<{ field: string; direction: 'asc' | 'desc' } | null>(
    initial?.definition?.sort?.[0]
      ? {
          field: initial.definition.sort[0]!.field,
          direction: initial.definition.sort[0]!.direction,
        }
      : null,
  );

  // ----- フィルタ (全体の AND / OR + 条件グループ。§9.5.2) -----
  // 保存済みの入れ子グループも落とさず読み込む (lib/reports/filter_tree.ts)
  const [filterRoot, setFilterRoot] = useState<ReportFilterGroup>(() =>
    filterGroupFromDefinition(initial?.definition?.filters),
  );

  // ----- グラフ設定(プレビュー SQL には影響させないため definition とは別管理) -----
  const [chart, setChart] = useState<ReportChartConfig | null>(initial?.definition?.chart ?? null);

  // ----- 表示グルーピング / サマリー指標(同じく SQL 非干渉) -----
  const [displayGroupBy, setDisplayGroupBy] = useState<string>(
    initial?.definition?.display?.groupByColumnId ?? '',
  );
  const [summaries, setSummaries] = useState<ReportSummaryField[]>(
    initial?.definition?.display?.summaries ?? [],
  );

  // ----- UI 状態 -----
  const [leftTab, setLeftTab] = useState<LeftTab>('outline');
  const [fieldQuery, setFieldQuery] = useState('');
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [previewColumns, setPreviewColumns] = useState<
    { id: string; label: string; alias: string; source: string; dataType: string }[]
  >([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false); // レポート名等のメタ編集を開閉

  // ----- レポート定義(計算プロパティ) -----
  const definition: ReportDefinition = useMemo(
    () => ({
      columns,
      filters: normalizeFilterGroup(filterRoot),
      group_by:
        groupBy.length > 0
          ? groupBy.map((field, i) => ({ field, level: (i + 1) as 1 | 2 | 3 }))
          : undefined,
      sort: sort ? [{ field: sort.field, direction: sort.direction }] : undefined,
    }),
    [columns, filterRoot, groupBy, sort],
  );

  // ----- 表示設定(グルーピング / サマリー)。存在しない列参照は除外 -----
  const displayConfig: ReportDisplayConfig | null = useMemo(() => {
    const validGroup =
      displayGroupBy && columns.some((c) => c.id === displayGroupBy) ? displayGroupBy : undefined;
    const validSummaries = summaries.filter((s) => columns.some((c) => c.id === s.columnId));
    if (!validGroup && validSummaries.length === 0) return null;
    return {
      groupByColumnId: validGroup,
      summaries: validSummaries.length > 0 ? validSummaries : undefined,
    };
  }, [displayGroupBy, summaries, columns]);

  // ----- プレビュー (debounce 500ms) -----
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (columns.length === 0) {
      setPreviewRows([]);
      setPreviewColumns([]);
      setPreviewError(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      void runPreview();
    }, 500);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition]);

  const runPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await previewReport(reportType, definition);
      if (!res.ok) {
        setPreviewError(res.error);
        setPreviewRows([]);
        setPreviewColumns([]);
      } else {
        setPreviewRows(res.rows);
        setPreviewColumns(res.columns);
      }
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  // ----- フィールド一覧(検索) -----
  const filteredFields = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    return schema.allowedColumns.filter(
      (c) => !q || c.label.toLowerCase().includes(q) || c.source.toLowerCase().includes(q),
    );
  }, [schema, fieldQuery]);

  // ----- 操作 -----
  const addColumn = (def: AllowedColumnDef, aggregate?: AggregateFunction) => {
    // 重複防止: 集計なしで同じ source が既にあればスキップ
    if (!aggregate && columns.some((c) => c.source === def.source && !c.aggregate)) {
      return;
    }
    const id = `c${columns.length + 1}_${Date.now()}`;
    setColumns([
      ...columns,
      {
        id,
        source: def.source,
        label: aggregate ? `${AGG_LABEL[aggregate]}: ${def.label}` : def.label,
        aggregate,
      },
    ]);
  };
  const removeColumn = (id: string) => setColumns(columns.filter((c) => c.id !== id));

  const moveColumn = (id: string, dir: -1 | 1) => {
    const idx = columns.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    const tmp = next[idx] as ReportColumn;
    next[idx] = next[target] as ReportColumn;
    next[target] = tmp;
    setColumns(next);
  };

  // アウトラインの「条件」ボタンからは全体の末尾に追加する (グループへは移動で入れる)
  const addFilter = (def: AllowedColumnDef) => {
    setFilterRoot(addConditionTo(filterRoot, [], newFilterCondition(def)));
    setLeftTab('filter'); // 追加後はフィルタタブに切替
  };
  const filterCount = countFilterConditions(filterRoot);

  const toggleGroupBy = (source: string) => {
    if (groupBy.includes(source)) {
      setGroupBy(groupBy.filter((s) => s !== source));
    } else if (groupBy.length < 3) {
      setGroupBy([...groupBy, source]);
    }
  };

  const onSave = () => {
    setSaveError(null);
    if (!name.trim()) {
      setSaveError('レポート名を入力してください');
      setShowMeta(true);
      return;
    }
    if (columns.length === 0) {
      setSaveError('1つ以上のカラムを選択してください');
      return;
    }
    startSaving(async () => {
      const res = await saveReport({
        id: initial?.id,
        name,
        description: description || undefined,
        report_type: reportType,
        // グラフ・表示設定を保存定義にマージ(存在しない列参照は除外)
        definition: {
          ...definition,
          chart: chart && columns.some((c) => c.id === chart.categoryColumnId) ? chart : undefined,
          display: displayConfig ?? undefined,
        },
        visibility,
        shared_with: visibility === 'restricted' ? sharedWith : undefined,
      });
      if (!res.ok) {
        setSaveError(res.error ?? '保存失敗');
        return;
      }
      router.push(`/reports/${res.id}`);
    });
  };

  // ----- レンダリング -----
  return (
    <div className="space-y-3">
      {/* 上部メタバー: レポート名・保存・公開範囲 */}
      <div className="flex flex-wrap items-center gap-3 rounded border bg-card px-4 py-3 shadow-sm">
        <div className="flex flex-1 min-w-0 items-center gap-2">
          <Input
            placeholder="レポート名 (未入力)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 max-w-md text-sm"
          />
          <button
            type="button"
            onClick={() => setShowMeta((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showMeta ? '詳細を閉じる' : '詳細'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as 'private' | 'team' | 'public' | 'restricted')
            }
            className="h-8 text-xs"
          >
            <option value="private">自分のみ</option>
            <option value="team">チーム</option>
            <option value="public">全社</option>
            {/* 「指定ユーザーのみ」は admin のみ選択可(既存が restricted の場合も表示) */}
            {(canRestrict || visibility === 'restricted') && (
              <option value="restricted">指定ユーザーのみ</option>
            )}
          </Select>
          <Button onClick={onSave} disabled={saving} size="sm">
            {saving ? '保存中…' : initial?.id ? '更新' : '保存'}
          </Button>
        </div>
        {saveError && (
          <p role="alert" className="basis-full text-xs text-destructive">
            {saveError}
          </p>
        )}
      </div>

      {/* 「指定ユーザーのみ」の閲覧許可ユーザー選択(admin のみ・restricted 選択時) */}
      {visibility === 'restricted' && (
        <div className="space-y-2 rounded border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <Label className="text-xs">閲覧できるユーザー</Label>
            <span className="text-[11px] text-muted-foreground">
              選択中 {sharedWith.length} 名 ・ admin は常に閲覧可
            </span>
          </div>
          {assignableUsers.length === 0 ? (
            <p className="text-xs text-muted-foreground">選択できるユーザーがいません</p>
          ) : (
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 md:grid-cols-3">
              {assignableUsers.map((u) => {
                const checked = sharedWith.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSharedWith((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                        )
                      }
                    />
                    <span className="truncate">{u.full_name ?? u.id}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showMeta && (
        <div className="space-y-2 rounded border bg-card p-4 shadow-sm">
          <div>
            <Label className="text-xs">説明</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm"
            />
          </div>
        </div>
      )}

      {/* メインビルダー: 左 1 : 右 4 */}
      <div className="grid gap-3 lg:grid-cols-5">
        {/* ===================== 左ペイン (1/5) ===================== */}
        <aside className="lg:col-span-1">
          <div className="overflow-hidden rounded border bg-card shadow-sm">
            {/* 左ペインタブ */}
            <div className="flex items-stretch border-b bg-slate-100">
              <LeftTabButton active={leftTab === 'outline'} onClick={() => setLeftTab('outline')}>
                アウトライン
              </LeftTabButton>
              <LeftTabButton active={leftTab === 'filter'} onClick={() => setLeftTab('filter')}>
                フィルタ
                {filterCount > 0 && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                    {filterCount}
                  </Badge>
                )}
              </LeftTabButton>
              <LeftTabButton active={leftTab === 'chart'} onClick={() => setLeftTab('chart')}>
                グラフ
                {chart && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                    ON
                  </Badge>
                )}
              </LeftTabButton>
              <LeftTabButton active={leftTab === 'summary'} onClick={() => setLeftTab('summary')}>
                集計
                {(displayGroupBy || summaries.length > 0) && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px]">
                    ON
                  </Badge>
                )}
              </LeftTabButton>
            </div>

            {leftTab === 'outline' && (
              <OutlinePanel
                fieldQuery={fieldQuery}
                setFieldQuery={setFieldQuery}
                filteredFields={filteredFields}
                columns={columns}
                groupBy={groupBy}
                addColumn={addColumn}
                addFilter={addFilter}
                toggleGroupBy={toggleGroupBy}
                removeColumn={removeColumn}
                moveColumn={moveColumn}
              />
            )}

            {leftTab === 'filter' && (
              <FilterPanel schema={schema} root={filterRoot} setRoot={setFilterRoot} />
            )}

            {leftTab === 'chart' && (
              <ChartPanel columns={columns} chart={chart} setChart={setChart} />
            )}

            {leftTab === 'summary' && (
              <SummaryPanel
                columns={columns}
                displayGroupBy={displayGroupBy}
                setDisplayGroupBy={setDisplayGroupBy}
                summaries={summaries}
                setSummaries={setSummaries}
              />
            )}
          </div>
        </aside>

        {/* ===================== 右ペイン プレビュー (4/5) ===================== */}
        <section className="lg:col-span-4 space-y-3">
          {/* プレビューヘッダー: 列数 / 件数 / ソート / 状態 */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-slate-100 px-4 py-2 text-xs shadow-sm">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-slate-800">プレビュー</span>
              <span className="text-muted-foreground">
                列 {columns.length} ・ 行 {previewRows.length}
                {previewing && ' ・ 更新中…'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[11px]">ソート:</Label>
              <Select
                className="h-7 text-xs"
                value={sort?.field ?? ''}
                onChange={(e) => {
                  if (!e.target.value) {
                    setSort(null);
                    return;
                  }
                  setSort({
                    field: e.target.value,
                    direction: sort?.direction ?? 'desc',
                  });
                }}
              >
                <option value="">(なし)</option>
                {columns.map((c) => (
                  <option key={c.id} value={c.source}>
                    {c.label}
                  </option>
                ))}
              </Select>
              <Select
                className="h-7 w-20 text-xs"
                value={sort?.direction ?? 'desc'}
                onChange={(e) =>
                  sort &&
                  setSort({
                    ...sort,
                    direction: e.target.value as 'asc' | 'desc',
                  })
                }
                disabled={!sort}
              >
                <option value="desc">降順</option>
                <option value="asc">昇順</option>
              </Select>
            </div>
          </div>

          {/* プレビュー本体: 結果ページと同じ ReportResultView を共用 */}
          {previewError ? (
            <p className="rounded border bg-card p-6 text-sm text-destructive shadow-sm">
              {previewError}
            </p>
          ) : previewColumns.length === 0 ? (
            <div className="grid place-items-center rounded border bg-card p-16 text-center shadow-sm">
              <p className="text-sm text-muted-foreground">
                左の「アウトライン」タブから列を追加すると
                <br />
                ここにプレビューが表示されます
              </p>
            </div>
          ) : (
            <ReportResultView
              columns={previewColumns}
              rows={previewRows}
              chart={chart}
              display={displayConfig}
            />
          )}
          <p className="rounded border bg-slate-50 px-4 py-2 text-[10px] text-muted-foreground">
            プレビューは先頭100行。RLS により自分の閲覧可能範囲のみ。
          </p>
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// 左ペインのタブボタン
// ============================================================================
function LeftTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 border-b-[3px] px-3 py-2 text-xs transition-colors',
        active
          ? 'border-primary bg-white font-bold text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// アウトラインパネル (フィールド一覧 + 選択中の列)
// ============================================================================
function OutlinePanel({
  fieldQuery,
  setFieldQuery,
  filteredFields,
  columns,
  groupBy,
  addColumn,
  addFilter,
  toggleGroupBy,
  removeColumn,
  moveColumn,
}: {
  fieldQuery: string;
  setFieldQuery: (v: string) => void;
  filteredFields: AllowedColumnDef[];
  columns: ReportColumn[];
  groupBy: string[];
  addColumn: (def: AllowedColumnDef, aggregate?: AggregateFunction) => void;
  addFilter: (def: AllowedColumnDef) => void;
  toggleGroupBy: (source: string) => void;
  removeColumn: (id: string) => void;
  moveColumn: (id: string, dir: -1 | 1) => void;
}) {
  return (
    <div className="space-y-3 p-3">
      {/* 検索ボックス */}
      <Input
        placeholder="フィールド検索"
        value={fieldQuery}
        onChange={(e) => setFieldQuery(e.target.value)}
        className="h-8 text-xs"
      />

      {/* 利用可能フィールド */}
      <div>
        <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          利用可能 ({filteredFields.length})
        </h4>
        <ul className="max-h-[240px] space-y-1 overflow-y-auto text-xs">
          {filteredFields.map((f) => (
            <li key={f.source} className="group rounded border bg-white p-2">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{f.label}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {f.source}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addColumn(f)}
                  aria-label="列に追加"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                  title="列に追加"
                >
                  +
                </button>
              </div>
              {/* 追加アクション */}
              <div className="mt-1 flex flex-wrap gap-1">
                {f.aggregatable && (
                  <select
                    className="h-5 max-w-full rounded border bg-background px-1 text-[10px]"
                    onChange={(e) => {
                      const v = e.target.value as AggregateFunction;
                      if (v) addColumn(f, v);
                      e.target.value = '';
                    }}
                    defaultValue=""
                    title="集計関数を選んで追加"
                  >
                    <option value="">集計…</option>
                    {(
                      ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as AggregateFunction[]
                    ).map((a) => (
                      <option key={a} value={a}>
                        {AGG_LABEL[a]}
                      </option>
                    ))}
                  </select>
                )}
                {f.filterable && (
                  <button
                    type="button"
                    onClick={() => addFilter(f)}
                    className="rounded border px-1 text-[10px] hover:bg-accent"
                    title="フィルタ条件として追加"
                  >
                    条件
                  </button>
                )}
                {f.groupable && (
                  <button
                    type="button"
                    onClick={() => toggleGroupBy(f.source)}
                    className={cn(
                      'rounded border px-1 text-[10px] hover:bg-accent',
                      groupBy.includes(f.source) && 'bg-primary/10 text-primary',
                    )}
                    title="グルーピング"
                  >
                    {groupBy.includes(f.source) ? '○G' : 'G'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* 選択中の列 */}
      <div>
        <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          選択中の列 ({columns.length})
        </h4>
        {columns.length === 0 ? (
          <p className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
            上のフィールドから「+」で追加
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {columns.map((c, i) => (
              <li key={c.id} className="flex items-start gap-1 rounded border bg-white p-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => moveColumn(c.id, -1)}
                    disabled={i === 0}
                    className="h-3 text-[8px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="上へ"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => moveColumn(c.id, 1)}
                    disabled={i === columns.length - 1}
                    className="h-3 text-[8px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="下へ"
                  >
                    ▼
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{c.label}</div>
                  {c.aggregate && (
                    <Badge variant="outline" className="mt-0.5 text-[9px]">
                      {AGG_LABEL[c.aggregate]}
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeColumn(c.id)}
                  aria-label="削除"
                  className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* グルーピング表示 */}
      {groupBy.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
            グルーピング ({groupBy.length}/3)
          </h4>
          <ol className="ml-4 list-decimal space-y-0.5 text-[11px]">
            {groupBy.map((g) => (
              <li key={g} className="font-mono">
                {g}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// フィルタパネル (全体の AND / OR + 条件グループ。§9.5.2)
//   例: (A OR B) AND C … 全体を AND、グループ1 を OR にして A・B をグループへ
// ============================================================================

/** 値の入力が要らない演算子 */
const VALUELESS_OPS: ReadonlySet<FilterOperator> = new Set<FilterOperator>([
  'is_null',
  'is_not_null',
  'is_true',
  'is_false',
  'this_month',
  'this_year',
]);

/** フィールドに合う最初の演算子で、値が空の条件を作る */
function newFilterCondition(def: AllowedColumnDef): ReportFilterCondition {
  const op = (FILTER_OPS.find((o) => o.supports.includes(def.dataType))?.value ??
    'equals') as FilterOperator;
  return { field: def.source, op, value: '' };
}

const pathKey = (p: FilterPath) => p.join('.');

function FilterPanel({
  schema,
  root,
  setRoot,
}: {
  schema: { allowedColumns: AllowedColumnDef[] };
  root: ReportFilterGroup;
  setRoot: (next: ReportFilterGroup) => void;
}) {
  const targets = moveTargets(root);
  const groupLabels = new Map(targets.map((t) => [pathKey(t.path), t.label]));
  const colLabel = (field: string) =>
    schema.allowedColumns.find((c) => c.source === field)?.label ?? field;
  const formula = describeFilterGroup(root, (c) => {
    const op = FILTER_OPS.find((o) => o.value === c.op)?.label ?? c.op;
    const value = VALUELESS_OPS.has(c.op) ? '' : ` ${String(c.value ?? '') || '(未入力)'}`;
    return `${colLabel(c.field)} ${op}${value}`;
  });

  return (
    <div className="space-y-3 p-3">
      {/* 全体の AND / OR */}
      <div>
        <Label className="text-[11px]">全体の結合</Label>
        <div className="mt-1">
          <LogicToggle value={root.logic} onChange={(v) => setRoot(setGroupLogic(root, [], v))} />
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {root.logic === 'AND'
            ? 'すべての条件を満たす行を抽出(グループは 1 つの条件として扱う)'
            : 'いずれかの条件を満たす行を抽出(グループは 1 つの条件として扱う)'}
        </p>
      </div>

      {/* 組み立てた条件の式 */}
      {formula && (
        <div className="rounded border bg-slate-50 p-2 text-[11px]">
          <div className="text-[10px] font-bold text-muted-foreground">条件の式</div>
          <div className="mt-0.5 break-all">{formula}</div>
        </div>
      )}

      {/* 条件リスト */}
      <div>
        <Label className="text-[11px]">条件 ({countFilterConditions(root)})</Label>
        {root.conditions.length === 0 ? (
          <p className="mt-1 rounded border border-dashed p-2 text-[11px] text-muted-foreground">
            下の「条件を追加」か、「アウトライン」タブの利用可能フィールドの「条件」ボタンで追加
          </p>
        ) : (
          <FilterItemList
            schema={schema}
            root={root}
            setRoot={setRoot}
            group={root}
            path={[]}
            targets={targets}
            groupLabels={groupLabels}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AddConditionSelect
          schema={schema}
          onAdd={(def) => setRoot(addConditionTo(root, [], newFilterCondition(def)))}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setRoot(addGroupTo(root, []))}
        >
          ＋ 条件グループを追加
        </Button>
      </div>
    </div>
  );
}

/** グループの中身を並べる (要素の間に結合の AND / OR を挟む) */
function FilterItemList({
  schema,
  root,
  setRoot,
  group,
  path,
  targets,
  groupLabels,
}: {
  schema: { allowedColumns: AllowedColumnDef[] };
  root: ReportFilterGroup;
  setRoot: (next: ReportFilterGroup) => void;
  group: ReportFilterGroup;
  path: number[];
  targets: { path: number[]; label: string }[];
  groupLabels: Map<string, string>;
}) {
  return (
    <ul className="mt-1 space-y-1 text-xs">
      {group.conditions.map((item, i) => {
        const itemPath = [...path, i];
        return (
          <li key={pathKey(itemPath)} className="space-y-1">
            {i > 0 && (
              <div className="px-1 text-[10px] font-bold text-muted-foreground">{group.logic}</div>
            )}
            {isFilterGroupItem(item) ? (
              <div className="space-y-2 rounded border-2 border-primary/30 bg-primary/5 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-bold">
                    {groupLabels.get(pathKey(itemPath)) ?? 'グループ'}
                  </span>
                  <div className="flex items-center gap-1">
                    <LogicToggle
                      value={item.group.logic}
                      onChange={(v) => setRoot(setGroupLogic(root, itemPath, v))}
                    />
                    <RemoveButton
                      label="グループを削除"
                      onClick={() => setRoot(removeItemAt(root, itemPath))}
                    />
                  </div>
                </div>
                {item.group.conditions.length === 0 ? (
                  <p className="rounded border border-dashed bg-white p-2 text-[11px] text-muted-foreground">
                    下の「条件を追加」か、各条件の「移動先」でこのグループに入れる
                  </p>
                ) : (
                  <FilterItemList
                    schema={schema}
                    root={root}
                    setRoot={setRoot}
                    group={item.group}
                    path={itemPath}
                    targets={targets}
                    groupLabels={groupLabels}
                  />
                )}
                <AddConditionSelect
                  schema={schema}
                  onAdd={(def) => setRoot(addConditionTo(root, itemPath, newFilterCondition(def)))}
                />
              </div>
            ) : (
              <FilterConditionRow
                schema={schema}
                condition={item}
                parentPath={path}
                targets={targets}
                onChange={(patch) => setRoot(updateConditionAt(root, itemPath, patch))}
                onRemove={() => setRoot(removeItemAt(root, itemPath))}
                onMove={(target) => setRoot(moveConditionTo(root, itemPath, target))}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FilterConditionRow({
  schema,
  condition,
  parentPath,
  targets,
  onChange,
  onRemove,
  onMove,
}: {
  schema: { allowedColumns: AllowedColumnDef[] };
  condition: ReportFilterCondition;
  parentPath: number[];
  targets: { path: number[]; label: string }[];
  onChange: (patch: { op?: FilterOperator; value?: unknown }) => void;
  onRemove: () => void;
  onMove: (target: number[]) => void;
}) {
  const colDef = schema.allowedColumns.find((c) => c.source === condition.field);
  const ops = FILTER_OPS.filter((o) => o.supports.includes(colDef?.dataType ?? 'text'));
  const current = pathKey(parentPath);
  // 移動先は「全体」と全体の直下のグループだけ。深い入れ子の中の条件は移動の対象外
  const canMove = targets.length > 1 && targets.some((t) => pathKey(t.path) === current);
  return (
    <div className="space-y-1 rounded border bg-white p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-bold">{colDef?.label ?? condition.field}</span>
        <RemoveButton label="削除" onClick={onRemove} />
      </div>
      <Select
        className="h-7 w-full text-xs"
        value={condition.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOperator })}
      >
        {ops.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {!VALUELESS_OPS.has(condition.op) && (
        <Input
          className="h-7 w-full text-xs"
          value={String(condition.value ?? '')}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="値"
        />
      )}
      {canMove && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span aria-hidden="true">移動先</span>
          <Select
            aria-label="条件の移動先"
            className="h-6 flex-1 text-[11px]"
            value={current}
            onChange={(e) => {
              const t = targets.find((x) => pathKey(x.path) === e.target.value);
              if (t) onMove(t.path);
            }}
          >
            {targets.map((t) => (
              <option key={pathKey(t.path)} value={pathKey(t.path)}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

/** 選んだフィールドの条件を追加するセレクト (選ぶとすぐ追加して「条件を追加…」に戻る) */
function AddConditionSelect({
  schema,
  onAdd,
}: {
  schema: { allowedColumns: AllowedColumnDef[] };
  onAdd: (def: AllowedColumnDef) => void;
}) {
  return (
    <Select
      aria-label="条件を追加"
      className="h-7 w-full max-w-[14rem] text-xs"
      value=""
      onChange={(e) => {
        const def = schema.allowedColumns.find((c) => c.source === e.target.value);
        if (def) onAdd(def);
      }}
    >
      <option value="">＋ 条件を追加…</option>
      {schema.allowedColumns.map((c) => (
        <option key={c.source} value={c.source}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}

function LogicToggle({
  value,
  onChange,
}: {
  value: FilterLogic;
  onChange: (v: FilterLogic) => void;
}) {
  return (
    <div className="inline-flex rounded border bg-white">
      {(['AND', 'OR'] as const).map((v, i) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'px-3 py-1 text-xs',
            i > 0 && 'border-l',
            value === v
              ? 'bg-primary font-bold text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    >
      ×
    </button>
  );
}

// ============================================================================
// グラフパネル (グラフ種類・カテゴリ軸・値・集計の設定)
// ============================================================================
function ChartPanel({
  columns,
  chart,
  setChart,
}: {
  columns: ReportColumn[];
  chart: ReportChartConfig | null;
  setChart: (next: ReportChartConfig | null) => void;
}) {
  const enabled = chart !== null;

  const enable = () => {
    if (columns.length === 0) return;
    // 既定: カテゴリ=先頭の非集計列、値=先頭の集計列(あれば合計)、無ければ件数
    const category = columns.find((c) => !c.aggregate) ?? columns[0]!;
    const valueCol = columns.find((c) => c.aggregate);
    setChart({
      type: 'bar_vertical',
      categoryColumnId: category.id,
      valueColumnId: valueCol?.id,
      valueAggregate: valueCol ? 'sum' : 'count',
    });
  };

  const patch = (p: Partial<ReportChartConfig>) => {
    if (!chart) return;
    setChart({ ...chart, ...p });
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => (e.target.checked ? enable() : setChart(null))}
          disabled={columns.length === 0}
        />
        <span className="font-bold">グラフを表示</span>
      </label>

      {columns.length === 0 && (
        <p className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
          先に「アウトライン」タブで列を追加してください
        </p>
      )}

      {enabled && chart && (
        <div className="space-y-3">
          {/* グラフ種類 */}
          <div className="space-y-1">
            <Label className="text-[11px]">グラフ種類</Label>
            <Select
              className="h-7 text-xs"
              value={chart.type}
              onChange={(e) => patch({ type: e.target.value as ChartType })}
            >
              {(Object.keys(CHART_TYPE_LABEL) as ChartType[]).map((t) => (
                <option key={t} value={t}>
                  {CHART_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>

          {/* カテゴリ軸 */}
          <div className="space-y-1">
            <Label className="text-[11px]">カテゴリ(軸 / スライス)</Label>
            <Select
              className="h-7 text-xs"
              value={chart.categoryColumnId}
              onChange={(e) => patch({ categoryColumnId: e.target.value })}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          {/* 値 */}
          <div className="space-y-1">
            <Label className="text-[11px]">値</Label>
            <Select
              className="h-7 text-xs"
              value={chart.valueColumnId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  patch({ valueColumnId: undefined, valueAggregate: 'count' });
                } else {
                  patch({
                    valueColumnId: v,
                    valueAggregate: chart.valueAggregate === 'count' ? 'sum' : chart.valueAggregate,
                  });
                }
              }}
            >
              <option value="">（レコード件数）</option>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          {/* 集計方法(値=件数のときは固定) */}
          <div className="space-y-1">
            <Label className="text-[11px]">集計方法</Label>
            <Select
              className="h-7 text-xs"
              value={chart.valueColumnId ? chart.valueAggregate : 'count'}
              onChange={(e) => patch({ valueAggregate: e.target.value as ChartAggregate })}
              disabled={!chart.valueColumnId}
            >
              {(Object.keys(CHART_AGG_LABEL) as ChartAggregate[])
                .filter((a) => (chart.valueColumnId ? a !== 'count' : a === 'count'))
                .map((a) => (
                  <option key={a} value={a}>
                    {CHART_AGG_LABEL[a]}
                  </option>
                ))}
            </Select>
          </div>

          {/* タイトル */}
          <div className="space-y-1">
            <Label className="text-[11px]">タイトル(任意)</Label>
            <Input
              className="h-7 text-xs"
              value={chart.title ?? ''}
              onChange={(e) => patch({ title: e.target.value || undefined })}
              placeholder="例: 案件別 入金額"
            />
          </div>

          <p className="text-[10px] text-muted-foreground">
            グラフは表示中の結果行を集計して描画します(RLS 適用後)。
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 集計パネル (表示グルーピング + サマリー指標)
// ============================================================================
function SummaryPanel({
  columns,
  displayGroupBy,
  setDisplayGroupBy,
  summaries,
  setSummaries,
}: {
  columns: ReportColumn[];
  displayGroupBy: string;
  setDisplayGroupBy: (v: string) => void;
  summaries: ReportSummaryField[];
  setSummaries: (next: ReportSummaryField[]) => void;
}) {
  // 「件数」はヘッダーに常時表示されるため、ここでは合計/平均/ユニーク等のみ提供
  const AGGS: SummaryAggregate[] = ['sum', 'avg', 'count_distinct', 'min', 'max'];

  const addSummary = () => {
    if (columns.length === 0) return;
    setSummaries([...summaries, { columnId: columns[0]!.id, aggregate: 'sum' }]);
  };
  const patch = (i: number, p: Partial<ReportSummaryField>) => {
    const n = [...summaries];
    n[i] = { ...n[i]!, ...p };
    setSummaries(n);
  };
  const remove = (i: number) => setSummaries(summaries.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4 p-3 text-xs">
      {columns.length === 0 && (
        <p className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
          先に「アウトライン」タブで列を追加してください
        </p>
      )}

      {/* #2 表示グルーピング */}
      <div className="space-y-1">
        <Label className="text-[11px]">表示グルーピング</Label>
        <Select
          className="h-7 text-xs"
          value={displayGroupBy}
          onChange={(e) => setDisplayGroupBy(e.target.value)}
        >
          <option value="">（グループ化しない）</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <p className="text-[10px] text-muted-foreground">
          指定列でリストを見出し付きにまとめ、グループごとに小計を表示します。
        </p>
      </div>

      {/* #3/#4 サマリー指標 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px]">サマリー指標 ({summaries.length})</Label>
          <button
            type="button"
            onClick={addSummary}
            disabled={columns.length === 0}
            className="rounded border px-2 py-0.5 text-[10px] hover:bg-accent disabled:opacity-40"
          >
            + 追加
          </button>
        </div>
        {summaries.length === 0 ? (
          <p className="rounded border border-dashed p-2 text-[11px] text-muted-foreground">
            「+ 追加」で {'{'}項目{'}'} の合計・平均・ユニーク等を上部・小計・総計に表示できます
          </p>
        ) : (
          <ul className="space-y-2">
            {summaries.map((s, i) => (
              <li key={i} className="space-y-1 rounded border bg-white p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground">指標 {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="削除"
                    className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    ×
                  </button>
                </div>
                <Select
                  className="h-7 text-xs"
                  value={s.aggregate}
                  onChange={(e) => patch(i, { aggregate: e.target.value as SummaryAggregate })}
                >
                  {AGGS.map((a) => (
                    <option key={a} value={a}>
                      {SUMMARY_AGG_LABEL[a]}
                    </option>
                  ))}
                </Select>
                <Select
                  className="h-7 text-xs"
                  value={s.columnId}
                  onChange={(e) => patch(i, { columnId: e.target.value })}
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground">
          合計・平均・最大・最小は数値列を選びます。ユニークは値の種類数を数えます。
        </p>
      </div>
    </div>
  );
}
