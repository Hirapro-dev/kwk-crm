-- field_definitions の data_type を修正
-- DB物理カラムの金額系フィールドと、ラベルが「額」で終わる全フィールドを number に統一

-- 1. 既知の金額系 DB物理カラムを number に修正
UPDATE field_definitions
SET data_type = 'number'
WHERE field_name IN (
  -- members
  'total_amount', 'total_paid_amount', 'total_used_amount',
  -- applications
  'scheduled_amount', 'payment_amount', 'crypto_excluded_amount',
  'yen_interest', 'withdrawal_amount', 'transfer_amount',
  -- activities
  'duration_minutes', 'todo_time'
)
AND data_type != 'number';

-- 2. label が「額」「金利」「料率」「レート」で終わるフィールドを number に修正
--    (extra系フィールド: ASEC利用額, iPS事業借入利用額 など)
UPDATE field_definitions
SET data_type = 'number'
WHERE label ~ '(額|金利|料率|レート|ﾚｰﾄ)$'
  AND data_type = 'text';

-- 3. label が「枚数」「件数」「ポイント」で終わるフィールドも number に修正
UPDATE field_definitions
SET data_type = 'number'
WHERE label ~ '(枚数|件数|ポイント|ﾎﾟｲﾝﾄ)$'
  AND data_type = 'text';
