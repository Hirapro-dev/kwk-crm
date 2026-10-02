-- ============================================================================
-- migration 122: 申込のステータスの選択肢を変え、区分(flow_type)を項目から外す (2026-10-02)
--                CLAUDE.md §5.4 / §5.6 / §8.1 /applications
--
-- 背景(ユーザー要望):
--   ステータスの選択肢を 対応中 / 入金 / 出金 / 資金移動 にする(「完了」→「入金」に改名、「未購入」「失効」は選択肢から削除)。
--   過去の申込の値はそのまま残す(完了 43,089 件・未購入 2,349 件・失効 15 件は変えない)。
--   「区分」(flow_type)は項目ごと削除してよい。
--
-- 方針:
--   1) ステータスの CHECK に「入金」を足す(過去の値を残すため 完了・未購入・失効 も許したまま。選択肢の制限は画面側)。
--   2) 会員の利用額の自動計算(migration 119)で「入金」を「完了」と同じく入金済みとして数える
--      (新しく登録する申込は「入金」になるため。純粋関数 computeMemberAmounts も同じ)。現時点で「入金」の申込は 0 件なので計算し直しは不要。
--   3) 区分: 項目管理の定義を削除し、画面・編集・レポートの項目から外す(アプリ側)。
--      DB の列と既存の値(約 1.2 万件)は消さずに残す(取り返しがつかないため。不要と決まれば別途 DROP COLUMN する)。
--   4) 利息・契約期間の表示名に単位を付ける(「利息（%）」「契約期間（ヶ月）」。一覧・詳細・編集の見出しは項目管理の表示名)。
--      契約期間の値は数字だけにそろえる(既存 1,393 件は数字だけ。新規登録フォームから入った「8ヶ月」1 件だけを直す)。
-- ============================================================================

-- 1) ステータス
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IN ('対応中', '入金', '出金', '資金移動', '完了', '未購入', '失効'));

-- 2) 利用額の計算(「入金」と旧名「完了」を入金済みとして数える。それ以外は migration 119 と同じ)
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
           sum(CASE WHEN a.status IN ('入金', '完了') THEN coalesce(a.payment_amount, 0) + coalesce(a.transfer_amount, 0) ELSE 0 END) AS usage,
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
                      + CASE WHEN status IN ('入金', '完了') THEN coalesce(transfer_amount, 0) ELSE 0 END), 0)
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

-- 3) 区分を項目管理から削除(列と値は残す)
DELETE FROM public.field_definitions WHERE object_id = 'applications' AND field_name = 'flow_type';
COMMENT ON COLUMN public.applications.flow_type IS
  '区分(入金/出金/資金移動/W)。2026-10-02 に項目から削除(画面・編集・レポートでは使わない)。既存の値は残している。migration 122';

-- 4) 利息・契約期間の表示名に単位を付け、契約期間の値を数字だけにそろえる
UPDATE public.field_definitions SET label = '利息（%）', updated_at = now()
 WHERE object_id = 'applications' AND field_name = 'interest';
UPDATE public.field_definitions SET label = '契約期間（ヶ月）', updated_at = now()
 WHERE object_id = 'applications' AND field_name = 'contract_period';
UPDATE public.applications
   SET contract_period = substring(contract_period FROM '^([0-9]+(?:\.[0-9]+)?)')
 WHERE contract_period ~ '^[0-9]+(\.[0-9]+)?\s*(ヶ月|か月|カ月|ケ月|ヵ月|月)$';
