import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import type { ReactNode } from 'react';
import { CollapsibleFieldGroup } from './CollapsibleFieldGroup';

/**
 * field_definitions に基づいて、レコードの詳細フィールドを動的に並べる。
 *
 * 仕様 (Phase 2.5):
 *   - sort_order_detail 順にフィールドを処理
 *   - 連続する同じ section_name のフィールドを1つのセクションにまとめ、セクションタイトル表示
 *   - section_name=null は「その他」セクションに集約 (タイトルなし)
 *   - 各フィールドはラベル + 値 (型別フォーマット)
 *   - 2カラムグリッド表示
 *
 * 想定使用: 会員詳細 / 申込詳細 / 問合せ詳細 等の「基本情報」セクション
 */
interface Props {
  /** 表示対象レコード (DB 取得結果) */
  record: Record<string, unknown>;
  /** field_definitions (is_visible_detail=true のもの)、sort_order_detail 順で渡す */
  fields: FieldDefinition[];
  /**
   * 特定の field_name について値の描画をカスタマイズしたい場合に渡す。
   * 例: `member_id` を会員氏名のリンクに置き換える、`project_id` を案件名で表示する、など。
   * キーが対応する field の値レンダラを完全に置き換える。返り値が null の場合は通常描画にフォールバック。
   */
  fieldOverrides?: Record<string, ReactNode | null>;
  /**
   * 指定された field_name のフィールドは表示自体をスキップする。
   * (フィールド管理画面で「詳細」を OFF にしないまま、特定ページだけで隠したいときに使う)
   */
  hideFields?: string[];
  /**
   * グリッドの列数。デフォルトは 2。
   * 1 / 2 / 3 / 4 のいずれかを指定可能(Tailwind の Just-in-Time が静的に解析できるよう
   * クラス文字列はマップで持つ)。
   */
  columns?: 1 | 2 | 3 | 4;
}

/**
 * `_id` 末尾のフィールドに対して、対応するJOINオブジェクトの full_name を返す。
 * 例: protect_by_user_id → record.protect_by_user?.full_name
 *     owner_id           → record.owner?.full_name
 *     created_by_id      → record.created_by?.full_name
 * 解決できない場合は null を返し、呼び出し元は通常の formatFieldValue にフォールバックする。
 */
function resolveUserName(
  record: Record<string, unknown>,
  fieldName: string,
  rawValue: unknown,
): string | null {
  if (!fieldName.endsWith('_id') || rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }
  const joinKey = fieldName.replace(/_id$/, '');
  const joined = record[joinKey];
  if (joined && typeof joined === 'object') {
    const name = (joined as Record<string, unknown>).full_name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return null;
}

/** セクション単位のグルーピング結果 */
interface GroupedSection {
  name: string | null;
  fields: FieldDefinition[];
}

/** sort_order_detail 順のフィールド配列を、section_name 別にグループ化する */
function groupBySection(fields: FieldDefinition[]): GroupedSection[] {
  const groups: GroupedSection[] = [];
  for (const f of fields) {
    const name = f.section_name ?? null;
    const last = groups[groups.length - 1];
    if (last && last.name === name) {
      last.fields.push(f);
    } else {
      groups.push({ name, fields: [f] });
    }
  }
  return groups;
}

// Tailwind JIT が解析できるよう完全なクラス文字列をマップで持つ。
// (動的な文字列補間は PurgeCSS で削られるため使わない)
const COLUMN_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid grid-cols-1 gap-x-6 gap-y-3',
  2: 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2',
  3: 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4',
};

export function DynamicDetailFields({
  record,
  fields,
  fieldOverrides,
  hideFields,
  columns = 2,
}: Props) {
  // hideFields に含まれるフィールドは描画スキップ
  if (hideFields && hideFields.length > 0) {
    const hideSet = new Set(hideFields);
    fields = fields.filter((f) => !hideSet.has(f.field_name));
  }

  if (fields.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        表示するフィールドが選択されていません。
        <br />
        オブジェクト管理画面で「詳細」表示をオンにしてください。
      </p>
    );
  }

  const groups = groupBySection(fields);

  return (
    <div className="space-y-5">
      {groups.map((group, gi) => {
        const body = (
          <dl className={COLUMN_CLASSES[columns]}>
            {group.fields.map((f) => {
              // 空白セル: ラベルも値も表示せず、グリッドの1マスだけ確保
              if (f.is_placeholder) {
                return <div key={f.id} aria-hidden="true" className="pb-2" />;
              }
              const label = f.label ?? f.field_name;
              // 上書き描画があればそれを優先
              const override = fieldOverrides?.[f.field_name];
              let valueNode: ReactNode;
              if (override !== undefined && override !== null) {
                valueNode = override;
              } else {
                const raw = getFieldValue(record, f.field_name, f.is_in_db);
                // _id 末尾のフィールドは、対応するJOINオブジェクト(full_name)で名前解決を試みる
                // 例: protect_by_user_id → record.protect_by_user?.full_name
                //     owner_id           → record.owner?.full_name
                const resolvedName = resolveUserName(record, f.field_name, raw);
                valueNode = resolvedName ?? formatFieldValue(raw, f.data_type);
              }
              return (
                <div key={f.id} className="flex flex-col border-b pb-2 last:border-b-0">
                  <dt className="text-xs font-semibold tracking-wide text-slate-600">{label}</dt>
                  <dd className="text-[15px] text-slate-900">{valueNode}</dd>
                </div>
              );
            })}
          </dl>
        );
        // 名前付きセクションは見出しクリックで開閉。無名(その他)は常に表示。
        return group.name ? (
          <CollapsibleFieldGroup key={gi} title={group.name} defaultOpen={gi === 0}>
            {body}
          </CollapsibleFieldGroup>
        ) : (
          <section key={gi}>{body}</section>
        );
      })}
    </div>
  );
}
