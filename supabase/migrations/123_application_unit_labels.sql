-- 123: 申込の「利息」「契約期間」の表示名を元に戻す(2026-10-02)
-- migration 122 で表示名に単位を入れた(「利息（%）」「契約期間（ヶ月）」)が、ユーザー指定で
-- 単位は項目名ではなく一覧・詳細のセルの値に付ける形に変更した(「0.01%」「4ヶ月」。アプリ側 formatApplicationUnitValue)。
-- 本番へはサービスロールで適用済み(このファイルは記録用。再実行しても結果は同じ)。
UPDATE public.field_definitions SET label = '利息', updated_at = now()
 WHERE object_id = 'applications' AND field_name = 'interest';
UPDATE public.field_definitions SET label = '契約期間', updated_at = now()
 WHERE object_id = 'applications' AND field_name = 'contract_period';
