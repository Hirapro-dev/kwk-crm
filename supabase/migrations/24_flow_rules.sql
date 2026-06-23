-- migration 24: フロー自動化ルールテーブル
-- 対応歴の状態フラグに応じてプロテクトを設定するルールを管理する

CREATE TABLE IF NOT EXISTS public.flow_rules (
  id             serial PRIMARY KEY,
  name           text    NOT NULL,                  -- 表示名  例: "通電プロテクト"
  trigger_flag   text    NOT NULL,                  -- s_bunrui に含まれる値 例: "通電"
  duration_type  text    NOT NULL
                   CHECK (duration_type IN ('days_at_time', 'hours')),
                                                    -- days_at_time: X日後のHH:MM
                                                    -- hours: X時間後
  duration_value int     NOT NULL CHECK (duration_value > 0),
                                                    -- 日数 or 時間数
  reset_hour     int     NOT NULL DEFAULT 2
                   CHECK (reset_hour BETWEEN 0 AND 23),
                                                    -- days_at_time 時のリセット時刻(時)
  reset_minute   int     NOT NULL DEFAULT 0
                   CHECK (reset_minute BETWEEN 0 AND 59),
                                                    -- days_at_time 時のリセット時刻(分)
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int     NOT NULL DEFAULT 100,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.flow_rules IS '対応歴の状態フラグ→プロテクト自動設定ルール';
COMMENT ON COLUMN public.flow_rules.trigger_flag   IS 's_bunrui パイプ区切り内の値';
COMMENT ON COLUMN public.flow_rules.duration_type  IS 'days_at_time=X日後のHH:MM / hours=X時間後';
COMMENT ON COLUMN public.flow_rules.duration_value IS 'days_at_time なら日数、hours なら時間数';

-- 初期シード: 通電7日・接触対応10日 (既存ハードコード値と同じ)
INSERT INTO public.flow_rules (name, trigger_flag, duration_type, duration_value, reset_hour, sort_order)
VALUES
  ('通電プロテクト',    '通電',    'days_at_time', 7,  2, 10),
  ('接触対応プロテクト', '接触対応', 'days_at_time', 10, 2, 20)
ON CONFLICT DO NOTHING;

-- RLS: 全ロールが SELECT 可、admin のみ変更可
ALTER TABLE public.flow_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flow_rules_read_all"  ON public.flow_rules FOR SELECT USING (true);
CREATE POLICY "flow_rules_admin_all" ON public.flow_rules FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- updated_at 自動更新
CREATE TRIGGER trg_flow_rules_updated_at
  BEFORE UPDATE ON public.flow_rules
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
