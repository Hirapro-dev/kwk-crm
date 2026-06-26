-- ============================================================================
-- 監査ログ(audit_logs) — 誰がいつ何を作成/編集/削除したかを自動記録 (2026-06)
-- CLAUDE.md §5.12  / 不正防止
--
-- 方式: DBトリガーで members / applications / activities / users の
--       INSERT / UPDATE / DELETE を自動記録する。
--   - 実行者は auth.uid() で特定。
--   - auth.uid() が NULL の操作(サービスロール/一括取込)は記録しない(人の操作のみ)。
--   - UPDATE は変更のあったカラムのみ {col: {old, new}} で保持(updated_at は除外)。
--   - 論理削除(deleted_at を立てる UPDATE)もそのまま UPDATE として記録され、
--     画面側で「削除」と判定して表示する。
-- 閲覧は admin のみ(RLS)。INSERT はトリガー(SECURITY DEFINER)経由のみ。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  actor_name  text,
  action      text NOT NULL,          -- 'INSERT' / 'UPDATE' / 'DELETE'
  table_name  text NOT NULL,
  record_id   text,
  changes     jsonb,                  -- UPDATE時の変更カラム差分
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON public.audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_table   ON public.audit_logs(table_name, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- admin のみ閲覧可
DROP POLICY IF EXISTS audit_logs_select_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_admin ON public.audit_logs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
-- INSERT/UPDATE/DELETE ポリシーは作らない = 一般経路からの書込/改変は不可。
-- 記録はトリガー関数(SECURITY DEFINER)のみが行う。

-- ----------------------------------------------------------------------------
-- トリガー関数
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_name    text;
  v_changes jsonb := '{}'::jsonb;
  v_record  text;
  v_old     jsonb;
  v_new     jsonb;
  k         text;
BEGIN
  -- 実行者が特定できない操作(サービスロール/一括取込)は記録しない
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(full_name, email) INTO v_name FROM public.users WHERE id = v_actor;

  IF (TG_OP = 'INSERT') THEN
    v_record := (to_jsonb(NEW) ->> 'id');
    v_changes := NULL;
  ELSIF (TG_OP = 'DELETE') THEN
    v_record := (to_jsonb(OLD) ->> 'id');
    v_changes := NULL;
  ELSE -- UPDATE
    v_record := (to_jsonb(NEW) ->> 'id');
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_old -> k) IS DISTINCT FROM (v_new -> k) AND k <> 'updated_at' THEN
        v_changes := v_changes || jsonb_build_object(
          k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k)
        );
      END IF;
    END LOOP;
    -- 実質変更なし(updated_at のみ)の場合は記録しない
    IF v_changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(actor_id, actor_name, action, table_name, record_id, changes)
  VALUES (v_actor, v_name, TG_OP, TG_TABLE_NAME, v_record, v_changes);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ----------------------------------------------------------------------------
-- 主要テーブルへトリガー設置
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_members      ON public.members;
DROP TRIGGER IF EXISTS audit_applications ON public.applications;
DROP TRIGGER IF EXISTS audit_activities   ON public.activities;
DROP TRIGGER IF EXISTS audit_users        ON public.users;

CREATE TRIGGER audit_members      AFTER INSERT OR UPDATE OR DELETE ON public.members      FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_applications AFTER INSERT OR UPDATE OR DELETE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_activities   AFTER INSERT OR UPDATE OR DELETE ON public.activities   FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
CREATE TRIGGER audit_users        AFTER INSERT OR UPDATE OR DELETE ON public.users        FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
