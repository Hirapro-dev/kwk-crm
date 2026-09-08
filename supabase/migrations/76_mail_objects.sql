-- ============================================================================
-- migration 76: メール一元管理 (mail_boxes / mail_threads / mail_messages /
--               mail_attachments) を追加 (2026-09) / CLAUDE.md §5.15
--
-- 目的:
--   各サーバーの共有アドレス(ad@kawaraban.co.jp 等)宛メールを AWS SES(受信ルール→S3→SNS)
--   経由の Webhook で受け取り、受信箱(/mail)で担当・ステータス・会員紐付けを管理する。
--   送信(返信・新規)も同アドレスを差出人として行う。設計は docs/MAIL_DESIGN.md。
--
-- 方針(既存テーブル共通):
--   - created_at/updated_at + set_updated_at トリガー。
--   - 論理削除は対応単位である mail_threads のみ(deleted_at)。メッセージ・添付は
--     スレッドに従属するため個別の削除フラグは持たない。
--   - RLS は migration 33 と同方針: SELECT 全ロール / INSERT・UPDATE は viewer 以外 /
--     DELETE は admin。受信 Webhook の書込はサービスロールで行う(RLS 対象外)。
--   - 生 MIME は保存しない。テキスト/HTML/添付のみ。
-- ============================================================================

-- 1) 共有アドレス(受信箱)。1行 = 会社側の公開アドレス1つ(数百件を想定)。まず ad@kawaraban.co.jp の1行。
CREATE TABLE IF NOT EXISTS public.mail_boxes (
  id               serial PRIMARY KEY,
  address          text NOT NULL UNIQUE,   -- 公開アドレス(= 送信時の From)
  display_name     text,                   -- 送信時の表示名
  -- 受信用アドレス(各サーバーの転送先に登録する、受信用サブドメインのアドレス)は受信箱ごとには持たない。
  -- 全体で1つを環境変数 MAIL_INBOUND_ADDRESS で持ち、どの受信箱かは元の宛先と address の一致で判定する。
  signature        text,                   -- 返信時に付ける署名
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mail_boxes IS '共有メールアドレス(受信箱)。CLAUDE.md §5.15';

-- 2) スレッド = 対応単位(受信箱の1行)
CREATE TABLE IF NOT EXISTS public.mail_threads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mail_box_id      int NOT NULL REFERENCES public.mail_boxes(id),
  subject          text,                                        -- 先頭メールの件名(Re: 除去済み)
  member_id        text REFERENCES public.members(id),          -- 会員突合結果。未一致は NULL
  status           text NOT NULL DEFAULT '未対応'
                   CHECK (status IN ('未対応', '対応中', '完了')),
  -- 受信時にヘッダで自動分類。既定表示は「通常」のみ。削除はしない(誤判定を後から見つけられるように)
  category         text NOT NULL DEFAULT '通常'
                   CHECK (category IN ('通常', 'メルマガ', '自動応答', '迷惑メール')),
  assignee_id      uuid REFERENCES public.users(id),            -- 担当
  last_message_at  timestamptz,                                 -- 一覧の並び順
  last_direction   text CHECK (last_direction IN ('in', 'out')),-- 最後が受信か送信か
  is_read          boolean NOT NULL DEFAULT false,              -- スレッド単位の既読
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

COMMENT ON TABLE public.mail_threads IS 'メールスレッド(対応単位)。CLAUDE.md §5.15';

-- 3) メッセージ(1通)
CREATE TABLE IF NOT EXISTS public.mail_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.mail_threads(id),
  direction           text NOT NULL CHECK (direction IN ('in', 'out')),
  -- RFC 5322 Message-ID。Webhook 再送の二重登録防止(冪等キー)。無い受信メールには
  -- 取込側で <uuid@crm.local> 形式を生成して必ず埋める。
  message_id          text NOT NULL UNIQUE,
  in_reply_to         text,
  -- References ヘッダ。"references" は SQL の予約語のため列名を変えている
  references_header   text,
  from_address        text NOT NULL,
  from_name           text,
  to_addresses        text[] NOT NULL DEFAULT '{}',
  cc_addresses        text[] NOT NULL DEFAULT '{}',
  subject             text,
  text_body           text,
  html_body           text,
  sent_at             timestamptz,                -- 受信: ヘッダの Date / 送信: 送信時刻
  provider_message_id text,                       -- SES 側の MessageId(受信は S3 キー、送信は SendEmail の戻り値)
  delivery_status     text CHECK (delivery_status IN ('queued', 'sent', 'delivered', 'bounced', 'failed')),
  sender_user_id      uuid REFERENCES public.users(id), -- 送信のみ: 誰が送ったか
  -- 来源。将来の過去データ取込(M4)で入れたものを区別し、やり直しを安全にする
  source              text NOT NULL DEFAULT 'ses'
                      CHECK (source IN ('ses', 'import_maildealer', 'import_server')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mail_messages IS 'メール1通。生 MIME は保存しない。CLAUDE.md §5.15';

-- 4) 添付(実体は Supabase Storage の非公開バケット mail-attachments)
CREATE TABLE IF NOT EXISTS public.mail_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid NOT NULL REFERENCES public.mail_messages(id),
  filename      text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  storage_path  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_mail_threads_box_last
  ON public.mail_threads(mail_box_id, last_message_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_threads_member
  ON public.mail_threads(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_threads_status
  ON public.mail_threads(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_threads_category
  ON public.mail_threads(category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_threads_assignee
  ON public.mail_threads(assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread
  ON public.mail_messages(thread_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_mail_messages_in_reply_to
  ON public.mail_messages(in_reply_to);
CREATE INDEX IF NOT EXISTS idx_mail_messages_provider
  ON public.mail_messages(provider_message_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_message
  ON public.mail_attachments(message_id);

-- updated_at 自動更新
DROP TRIGGER IF EXISTS trg_mail_boxes_updated_at ON public.mail_boxes;
CREATE TRIGGER trg_mail_boxes_updated_at
  BEFORE UPDATE ON public.mail_boxes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_mail_threads_updated_at ON public.mail_threads;
CREATE TRIGGER trg_mail_threads_updated_at
  BEFORE UPDATE ON public.mail_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_mail_messages_updated_at ON public.mail_messages;
CREATE TRIGGER trg_mail_messages_updated_at
  BEFORE UPDATE ON public.mail_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- RLS (migration 33 と同方針)
-- ============================================================================
ALTER TABLE public.mail_boxes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_threads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_attachments ENABLE ROW LEVEL SECURITY;

-- mail_boxes: 全員閲覧 / 変更は admin のみ(設定画面は admin 限定)
DROP POLICY IF EXISTS mail_boxes_select ON public.mail_boxes;
DROP POLICY IF EXISTS mail_boxes_write  ON public.mail_boxes;
CREATE POLICY mail_boxes_select ON public.mail_boxes FOR SELECT USING (true);
CREATE POLICY mail_boxes_write  ON public.mail_boxes FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- mail_threads: 全員閲覧(削除済み除く) / 担当・ステータス等の更新は viewer 以外 / 削除は admin
DROP POLICY IF EXISTS mail_threads_select ON public.mail_threads;
DROP POLICY IF EXISTS mail_threads_insert ON public.mail_threads;
DROP POLICY IF EXISTS mail_threads_update ON public.mail_threads;
DROP POLICY IF EXISTS mail_threads_delete ON public.mail_threads;
CREATE POLICY mail_threads_select ON public.mail_threads
  FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY mail_threads_insert ON public.mail_threads
  FOR INSERT WITH CHECK (public.can_write());
CREATE POLICY mail_threads_update ON public.mail_threads
  FOR UPDATE USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY mail_threads_delete ON public.mail_threads
  FOR DELETE USING (public.is_admin());

-- mail_messages: 全員閲覧 / 送信(INSERT)は viewer 以外 / 更新(配信状態)はサービスロール想定だが
-- 画面からの再送等に備え viewer 以外に許可 / 削除は admin
DROP POLICY IF EXISTS mail_messages_select ON public.mail_messages;
DROP POLICY IF EXISTS mail_messages_insert ON public.mail_messages;
DROP POLICY IF EXISTS mail_messages_update ON public.mail_messages;
DROP POLICY IF EXISTS mail_messages_delete ON public.mail_messages;
CREATE POLICY mail_messages_select ON public.mail_messages FOR SELECT USING (true);
CREATE POLICY mail_messages_insert ON public.mail_messages
  FOR INSERT WITH CHECK (public.can_write());
CREATE POLICY mail_messages_update ON public.mail_messages
  FOR UPDATE USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY mail_messages_delete ON public.mail_messages
  FOR DELETE USING (public.is_admin());

-- mail_attachments: 全員閲覧(実体の閲覧はサーバー側で発行する署名 URL 経由) / 書込は viewer 以外
DROP POLICY IF EXISTS mail_attachments_select ON public.mail_attachments;
DROP POLICY IF EXISTS mail_attachments_insert ON public.mail_attachments;
DROP POLICY IF EXISTS mail_attachments_delete ON public.mail_attachments;
CREATE POLICY mail_attachments_select ON public.mail_attachments FOR SELECT USING (true);
CREATE POLICY mail_attachments_insert ON public.mail_attachments
  FOR INSERT WITH CHECK (public.can_write());
CREATE POLICY mail_attachments_delete ON public.mail_attachments
  FOR DELETE USING (public.is_admin());

-- ============================================================================
-- Storage: 添付用の非公開バケット。
-- 書込(受信時)・署名 URL の発行はサーバー側のサービスロールで行うため、
-- storage.objects にユーザー向けポリシーは作らない(= ブラウザから直接は触れない)。
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('mail-attachments', 'mail-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 初期データ
-- ============================================================================
-- 共有アドレス。受信用アドレス(転送先)は環境変数 MAIL_INBOUND_ADDRESS で設定する。
INSERT INTO public.mail_boxes (address, display_name)
VALUES ('ad@kawaraban.co.jp', 'KAWARA版')
ON CONFLICT (address) DO NOTHING;

-- メニュー: 対応歴(45)と記事反応リスト(47)の間に置く。表示順・表示ロールは /settings/navigation で調整可。
INSERT INTO public.nav_items (id, label, href, match_prefix, sort_order, is_visible)
VALUES ('mail', 'メール', '/mail', true, 46, true)
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href,
      match_prefix = excluded.match_prefix, sort_order = excluded.sort_order,
      is_visible = excluded.is_visible;
