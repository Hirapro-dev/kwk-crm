-- migration 26: field_definitions にハイライトパネル表示制御を追加
-- レイアウトエディターから「ハイライト」タブで設定可能にする

ALTER TABLE public.field_definitions
  ADD COLUMN IF NOT EXISTS is_visible_highlight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order_highlight  int     NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.field_definitions.is_visible_highlight IS 'ハイライトパネル(詳細画面ヘッダー下部)に表示するか';
COMMENT ON COLUMN public.field_definitions.sort_order_highlight IS 'ハイライトパネル内の表示順';

-- members のデフォルトハイライト項目をシード
-- (既存行がない場合も ON CONFLICT で安全に実行可能)
UPDATE public.field_definitions
SET is_visible_highlight = true, sort_order_highlight = 10
WHERE object_id = 'members' AND field_name = 'owner_name_raw';

UPDATE public.field_definitions
SET is_visible_highlight = true, sort_order_highlight = 20
WHERE object_id = 'members' AND field_name = 'regular_contact_id';

UPDATE public.field_definitions
SET is_visible_highlight = true, sort_order_highlight = 30
WHERE object_id = 'members' AND field_name = 'phone1';

UPDATE public.field_definitions
SET is_visible_highlight = true, sort_order_highlight = 40
WHERE object_id = 'members' AND field_name = 'do_not_call';
