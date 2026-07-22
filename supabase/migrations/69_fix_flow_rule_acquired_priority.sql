-- migration 69: 「申込獲得」フロールールの優先順位を最優先に修正
--
-- 背景:
--   migration 68 では既存ルールの sort_order を 10(通電)/20(接触対応) と想定して
--   申込獲得を 5 にしたが、本番では画面(/settings/flows)から 1/2 に変更されており、
--   5 では通電(7日)の方が優先されてしまっていた。
--
-- findMatchingRule (lib/domain/flow_rules.ts) は sort_order 昇順の先頭ルールを採用するため、
-- 「通電 + 申込獲得」を同時にチェックしたときに申込獲得の30日が勝つよう、
-- 既存の最小 sort_order よりさらに小さい値にする。
--
-- 冪等: 既に最小より小さければ何もしない。

DO $$
DECLARE
  v_min_other int;
BEGIN
  SELECT MIN(sort_order) INTO v_min_other
  FROM public.flow_rules
  WHERE trigger_flag <> '申込獲得';

  IF v_min_other IS NOT NULL THEN
    UPDATE public.flow_rules
    SET sort_order = v_min_other - 1
    WHERE trigger_flag = '申込獲得'
      AND sort_order >= v_min_other;
  END IF;
END $$;
