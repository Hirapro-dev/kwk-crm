-- ============================================================================
-- 会員の案件別 利用額・出金額と累計入金額を、申込から自動計算する (2026-10-01)
-- CLAUDE.md §5.4 / §5.5
--
-- 会員 CSV の取込をやめる方針のため、会員の extra にある
--   「<キー>利用額」 = ステータス「完了」の 入金額 + 資金移動額
--   「<キー>出金額」 = ステータス「出金」の 出金額
--   「累計入金額」   = 全申込の 入金額 + 出金額 + 「完了」の資金移動額
-- を申込から計算する(<キー> は projects.member_amount_key、無ければ案件名)。
-- 同じ式の純粋関数 computeMemberAmounts(lib/domain/member_amounts.ts)で結果を照合する。
--
-- 1) projects.member_amount_key を追加し、Salesforce の項目名が案件名と違う 8 案件に設定
-- 2) recompute_member_amounts(member_id): 1 会員を計算し直す(値が変わらなければ書かない)
-- 3) recompute_member_amounts_for(ids[]): まとめて計算し直す(サービスロール専用。初回の一括計算に使う)
-- 4) 申込の INSERT / UPDATE / DELETE で元と先の会員を計算し直すトリガー
-- 5) 項目の定義が無かった 9 案件の「利用額」「出金額」を項目管理に追加
-- ※ 初回の一括計算はこの migration では行わない(保留中の 7 名を外してスクリプトで実行する)
-- ============================================================================

-- 1) 案件 → 会員の項目名
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS member_amount_key text;
COMMENT ON COLUMN public.projects.member_amount_key IS '会員の「<キー>利用額 / <キー>出金額」の <キー>。NULL なら案件名';
UPDATE public.projects SET member_amount_key = v.k
  FROM (VALUES
    ('ASECコイン', 'ASEC'), ('SIRコイン', 'SIR'), ('OTOSENプロジェクト', 'OTOSEN'), ('PIFコイン', 'PIF'),
    ('テロメアオーナーズクラブ', 'テロメアOC'), ('OTOSEN M＆A', 'OTOSEN M&A'), ('G.P.P SG FUND', 'GPP SG FUND'),
    ('WEBプロ_借入', 'WEBプロ借入')
  ) AS v(name, k)
 WHERE projects.name = v.name;

-- 2) 1 会員を計算し直す
CREATE OR REPLACE FUNCTION public.recompute_member_amounts(p_member_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_extra jsonb;
  v_new   jsonb;
  v_zero  jsonb;
  v_calc  jsonb;
  v_total numeric;
BEGIN
  IF p_member_id IS NULL THEN
    RETURN;
  END IF;
  SELECT coalesce(extra, '{}'::jsonb) INTO v_extra FROM members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 案件ごとの合計(0 以外だけキーにする)
  WITH s AS (
    SELECT coalesce(p.member_amount_key, p.name) AS k,
           sum(CASE WHEN a.status = '完了' THEN coalesce(a.payment_amount, 0) + coalesce(a.transfer_amount, 0) ELSE 0 END) AS usage,
           sum(CASE WHEN a.status = '出金' THEN coalesce(a.withdrawal_amount, 0) ELSE 0 END) AS wd
      FROM applications a
      JOIN projects p ON p.id = a.project_id
     WHERE a.member_id = p_member_id AND a.deleted_at IS NULL
     GROUP BY 1
  )
  SELECT coalesce(jsonb_object_agg(k || '利用額', trim_scale(usage)::text) FILTER (WHERE usage <> 0), '{}'::jsonb)
      || coalesce(jsonb_object_agg(k || '出金額', trim_scale(wd)::text) FILTER (WHERE wd <> 0), '{}'::jsonb)
    INTO v_calc
    FROM s;

  SELECT coalesce(sum(coalesce(payment_amount, 0) + coalesce(withdrawal_amount, 0)
                      + CASE WHEN status = '完了' THEN coalesce(transfer_amount, 0) ELSE 0 END), 0)
    INTO v_total
    FROM applications
   WHERE member_id = p_member_id AND deleted_at IS NULL;

  -- 既にある 利用額 / 出金額 キー(合計系を除く)はいったん "0"
  SELECT coalesce(jsonb_object_agg(key, '0'), '{}'::jsonb) INTO v_zero
    FROM jsonb_object_keys(v_extra) AS key
   WHERE (key LIKE '%利用額' OR key LIKE '%出金額') AND key NOT LIKE '%合計%';

  v_new := v_extra || v_zero || v_calc;
  IF v_total <> 0 OR v_extra ? '累計入金額' THEN
    v_new := v_new || jsonb_build_object('累計入金額', trim_scale(v_total)::text);
  END IF;

  IF v_new IS DISTINCT FROM v_extra THEN
    UPDATE members SET extra = v_new WHERE id = p_member_id;
  END IF;
END;
$$;

-- 3) まとめて計算し直す(サービスロール専用)
CREATE OR REPLACE FUNCTION public.recompute_member_amounts_for(p_member_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
  v_n  integer := 0;
BEGIN
  FOREACH v_id IN ARRAY coalesce(p_member_ids, ARRAY[]::text[]) LOOP
    PERFORM public.recompute_member_amounts(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_member_amounts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_member_amounts_for(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_member_amounts(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_member_amounts_for(text[]) TO service_role;

-- 4) 申込が変わったら元と先の会員を計算し直す
CREATE OR REPLACE FUNCTION public.trg_applications_member_amounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_member_amounts(NEW.member_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_member_amounts(OLD.member_id);
  ELSIF (NEW.member_id, NEW.project_id, NEW.status, NEW.payment_amount, NEW.withdrawal_amount, NEW.transfer_amount, NEW.deleted_at)
        IS DISTINCT FROM
        (OLD.member_id, OLD.project_id, OLD.status, OLD.payment_amount, OLD.withdrawal_amount, OLD.transfer_amount, OLD.deleted_at) THEN
    PERFORM public.recompute_member_amounts(NEW.member_id);
    IF OLD.member_id IS DISTINCT FROM NEW.member_id THEN
      PERFORM public.recompute_member_amounts(OLD.member_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_member_amounts ON public.applications;
CREATE TRIGGER trg_applications_member_amounts
  AFTER INSERT OR UPDATE OR DELETE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_applications_member_amounts();

-- 5) 項目の定義が無かった 9 案件の「利用額」「出金額」(他の利用額と同じく 一覧は非表示・詳細は表示、数値)
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, is_custom, is_in_db, section_name, sort_order_list, sort_order_detail)
SELECT 'members', v.k || s.suffix, v.k || s.suffix, 'number', false, true, false, false, false, '直近案件利用状況',
       100600 + v.ord * 2 + s.o, 490 + v.ord * 2 + s.o
  FROM (VALUES
    ('MRT_0.01%借入', 1), ('SCPP｜SCT担保付借入（XELS）', 2), ('SCPP3号少人数私募債', 3), ('SCPP4号少人数私募債', 4),
    ('脱炭素マーケ少人数私募債', 5), ('APPカンファレンス事業投資', 6), ('OTOSEN先行事業投資', 7),
    ('C.I.O V.I.P INSIDER福利厚生案件', 8), ('Korea Plan', 9)
  ) AS v(k, ord)
  CROSS JOIN (VALUES ('利用額', 0), ('出金額', 1)) AS s(suffix, o)
ON CONFLICT (object_id, field_name) DO NOTHING;
