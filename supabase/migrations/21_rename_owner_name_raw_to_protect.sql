-- migration 21: owner_name_raw フィールドのラベルを「プロテクト」に変更
-- owner_name_raw は protect__c 由来の担当プロテクト情報として使用する

UPDATE public.field_definitions
SET
  label       = 'プロテクト',
  description = 'プロテクト状態 (Salesforce protect__c 由来: free / 会社プロテクト / 担当者氏名)',
  updated_at  = now()
WHERE object_id = 'members'
  AND field_name = 'owner_name_raw';
