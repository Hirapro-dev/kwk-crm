-- migration 29: デフォルトフロールールを投入
-- migration 24 の INSERT が未適用の環境向けに、重複を避けながら再投入する。
-- 仕様: 通電 → 7日後 02:00 JST、接触対応 → 10日後 02:00 JST

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.flow_rules WHERE trigger_flag = '通電') THEN
    INSERT INTO public.flow_rules (name, trigger_flag, duration_type, duration_value, reset_hour, reset_minute, sort_order)
    VALUES ('通電プロテクト', '通電', 'days_at_time', 7, 2, 0, 10);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.flow_rules WHERE trigger_flag = '接触対応') THEN
    INSERT INTO public.flow_rules (name, trigger_flag, duration_type, duration_value, reset_hour, reset_minute, sort_order)
    VALUES ('接触対応プロテクト', '接触対応', 'days_at_time', 10, 2, 0, 20);
  END IF;
END $$;
