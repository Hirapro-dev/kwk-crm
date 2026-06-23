-- migration 22: members.owner_id のラベルを「担当」→「永久担当」に変更

UPDATE public.field_definitions
SET
  label      = '永久担当',
  updated_at = now()
WHERE object_id = 'members'
  AND field_name = 'owner_id';
