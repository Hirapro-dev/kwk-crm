import { ChevronDown, Pin } from 'lucide-react';
import { type ReactNode } from 'react';

/**
 * Salesforce Lightning 風 リストビューヘッダー。
 *
 * 構成:
 *  - 左: オブジェクトアイコンチップ + オブジェクト名 + 「最近参照したデータ ▼」+ ピン留め
 *  - 右: アクションボタン群 (新規/インポート/...)
 *
 * 検索バー・件数表示はこの下に置く想定。
 */
interface Props {
  /** 例: "会員" */
  objectLabel: string;
  /** 例: "MEM" - アイコンチップの中の3文字 */
  iconLabel: string;
  /** アイコンチップ背景色。SLDS のオブジェクトカラーから選ぶ */
  iconColor?: string;
  /** リストビュー名(SF の「最近参照したデータ」相当) */
  viewName?: string;
  /** 件数 */
  totalCount?: number;
  /** 右側のアクションボタン群 */
  actions?: ReactNode;
}

export function ListViewHeader({
  objectLabel,
  iconLabel,
  iconColor = '#1589ee',
  viewName = '最近参照したデータ',
  totalCount,
  actions,
}: Props) {
  return (
    <div className="rounded border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
        {/* 左側: タイトル群 */}
        <div className="flex items-center gap-3">
          <span
            className="sf-icon-chip"
            style={{ backgroundColor: iconColor }}
            aria-hidden="true"
          >
            {iconLabel}
          </span>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{objectLabel}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-base font-bold text-foreground hover:text-primary"
              >
                {viewName}
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="このリストをピン留め"
                className="text-muted-foreground hover:text-primary"
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            </div>
            {totalCount !== undefined && (
              <span className="text-xs text-muted-foreground">
                {totalCount.toLocaleString()} 件 ・ 数秒前に更新
              </span>
            )}
          </div>
        </div>

        {/* 右側: アクション群 */}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
