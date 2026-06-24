import type { ReactNode } from 'react';

/**
 * Salesforce Lightning 風 リストビュー統合パネルのヘッダー部品。
 *
 * 使い方:
 *   <Card className="overflow-hidden p-0 shadow-sm">
 *     <PanelHeader iconLabel="MEM" iconColor="#00C896" objectLabel="顧客情報"
 *                  viewName="全顧客" totalCount={result.total}
 *                  actions={<Button>新規</Button>} />
 *     <PanelFilterBar><YourFilterBar /></PanelFilterBar>
 *     <Table>...</Table>
 *   </Card>
 */
interface Props {
  /** 例: "MEM", "INQ", "APP", "PRJ", "USR", "SUM" */
  iconLabel: string;
  /** 例: "#00C896" (青) */
  iconColor?: string;
  /**
   * 上に薄く出るオブジェクト名 例: "顧客情報"
   * 省略すると表示しない (タイトル + 件数のみのコンパクトヘッダーになる)
   */
  objectLabel?: string;
  /** メインタイトル 例: "顧客情報一覧" */
  viewName?: string;
  /** 件数 (任意) */
  totalCount?: number;
  /** 右側のアクションボタン群 */
  actions?: ReactNode;
}

export function PanelHeader({
  iconLabel,
  iconColor = '#00C896',
  objectLabel,
  viewName,
  totalCount,
  actions,
}: Props) {
  return (
    <div className="flex items-start justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className="sf-icon-chip"
          style={{ backgroundColor: iconColor }}
          aria-hidden="true"
        >
          {iconLabel}
        </span>
        <div className="flex flex-col">
          {objectLabel && (
            <span className="text-xs text-muted-foreground">{objectLabel}</span>
          )}
          {viewName && (
            <h1 className="text-base font-bold text-foreground">{viewName}</h1>
          )}
          {totalCount !== undefined && (
            <span className="text-xs text-muted-foreground">
              {totalCount.toLocaleString()} 件
            </span>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * パネル内のフィルター帯ラッパー。
 * 薄グレー背景 (#f9f9f9) + 下境界線で、ヘッダーとテーブルの間に挟む。
 */
export function PanelFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="border-b px-4 py-2" style={{ backgroundColor: '#f9f9f9' }}>
      {children}
    </div>
  );
}
