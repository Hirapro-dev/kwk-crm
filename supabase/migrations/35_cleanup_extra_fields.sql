-- field_definitions の旧 extra_NNN エントリと重複エントリを削除
-- 削除後に npm run seed:fields を実行すること
-- → CSV列名 = field_name = label の形式で再作成される

-- 旧 extra_NNN 形式 (例: extra_001, extra_125) を全オブジェクト分削除
DELETE FROM field_definitions
WHERE field_name ~ '^extra_[0-9]+$';

-- sort_order が 100000 以上の重複エントリを削除 (以前の二重シードで生成)
-- __placeholder__ は保持
DELETE FROM field_definitions
WHERE is_in_db = false
  AND sort_order_detail >= 100000
  AND field_name NOT LIKE '\_%';
