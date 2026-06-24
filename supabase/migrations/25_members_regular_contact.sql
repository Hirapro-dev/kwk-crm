-- migration 25: 定期連絡者カラムを members に追加
-- CSV の teiki__c (Salesforce User ID) → users.legacy_sf_id で解決して格納

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS regular_contact_id uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.members.regular_contact_id IS '定期連絡担当者 (Salesforce teiki__c 由来)';

CREATE INDEX IF NOT EXISTS idx_members_regular_contact
  ON public.members(regular_contact_id)
  WHERE regular_contact_id IS NOT NULL AND deleted_at IS NULL;

-- field_definitions に追加
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail, csv_column_name, is_in_db)
VALUES
  ('members', 'regular_contact_id', '定期連絡者', 'text', false, true, true, 200, 55, 'teiki__c', true)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label = EXCLUDED.label, updated_at = now();
