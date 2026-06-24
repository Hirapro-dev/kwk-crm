import type { ReactNode } from 'react';

/**
 * Salesforce Lightning Record Page の上部にある「Highlight Panel」。
 *
 * 構成:
 *  - 左: オブジェクトアイコン + オブジェクト名 + レコード名 (例: 会員: 田中 太郎 K-0001234)
 *  - 中央: 主要フィールドのキー/値ペア(横並び)
 *  - 右: アクションボタン群 (フォロー / 編集 / 削除 / ...)
 */
interface Props {
  iconLabel: string;
  iconColor?: string;
  objectLabel: string;
  recordName: string;
  recordSubName?: string;
  /** 主要フィールド(横並び表示) */
  facts?: { label: string; value: ReactNode }[];
  /** 右側のアクションボタン群 */
  actions?: ReactNode;
}

export function HighlightPanel({
  iconLabel,
  iconColor = '#00C896',
  objectLabel,
  recordName,
  recordSubName,
  facts = [],
  actions,
}: Props) {
  return (
    <div className="rounded border bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        {/* 左: アイコン + 名前 */}
        <div className="flex items-center gap-3">
          <span
            className="sf-icon-chip h-9 w-9 text-xs"
            style={{ backgroundColor: iconColor }}
            aria-hidden="true"
          >
            {iconLabel}
          </span>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{objectLabel}</span>
            <h1 className="text-lg font-bold leading-tight text-foreground">
              {recordName}
            </h1>
            {recordSubName && (
              <span className="text-xs text-muted-foreground">{recordSubName}</span>
            )}
          </div>
        </div>

        {/* 右: アクション */}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {/* 主要フィールド帯 */}
      {facts.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-t bg-secondary/30 px-4 py-3 md:grid-cols-4">
          {facts.map((f, i) => (
            <div key={i} className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {f.label}
              </span>
              <span className="text-sm font-medium text-foreground">{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
