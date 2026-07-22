-- migration 68: 「申込獲得」フロールールを投入
--
-- 対応歴の状態チェック「申込獲得」が付いた対応歴を登録すると、
-- 対応歴の作成ユーザーに 30日間のプロテクトが発生する。
--
-- 期限の切り方は既存ルール(通電=7日後02:00 / 接触対応=10日後02:00)に合わせて
-- days_at_time 方式とし、30日後の 02:00 JST に失効させる。
--
-- sort_order は通電(10)・接触対応(20)より小さい 5 にする。
-- findMatchingRule (lib/domain/flow_rules.ts) は sort_order 昇順の先頭ルールを
-- 採用するため、「通電 + 申込獲得」を同時にチェックした場合は
-- 申込獲得の30日が優先される。
--
-- 他ユーザーが有効にプロテクト中の会員は上書きしない(既存の
-- apply_member_protect 関数の挙動をそのまま踏襲する)。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.flow_rules WHERE trigger_flag = '申込獲得') THEN
    INSERT INTO public.flow_rules
      (name, trigger_flag, duration_type, duration_value, reset_hour, reset_minute, sort_order)
    VALUES
      ('申込獲得プロテクト', '申込獲得', 'days_at_time', 30, 2, 0, 5);
  END IF;
END $$;
