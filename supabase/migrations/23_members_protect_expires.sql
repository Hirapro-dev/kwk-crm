-- migration 23: 時限プロテクト用カラムを members に追加
-- 対応歴（通電7日/接触対応10日）で自動設定され、期限切れで自動解除される

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS protect_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS protect_by_user_id  uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.members.protect_expires_at  IS '時限プロテクトの有効期限。NULL = 期限なし(手動プロテクト or free)';
COMMENT ON COLUMN public.members.protect_by_user_id  IS '時限プロテクトを設定した担当者 (activities.owner_id 由来)';

-- 期限切れ検索用インデックス
CREATE INDEX IF NOT EXISTS idx_members_protect_expires
  ON public.members(protect_expires_at)
  WHERE protect_expires_at IS NOT NULL AND deleted_at IS NULL;
