-- ============================================================================
-- migration 115: タスクのコメントでのメンション(@氏名)と受信トレイ (2026-09-22) / CLAUDE.md §5.20 / §8.1
--
-- 目的:
--   コメントで「@氏名」を書くと相手に届く(Asana のメンションと受信トレイ)。
--
-- 方針:
--   - task_mentions: コメント 1 件 × 呼ばれた人 1 人 = 1 行。read_at で既読管理(受信トレイの未読件数)。
--   - 呼ばれた人の判定はアプリ側の純粋関数(extractMentionUserIds: 本文の「@氏名」を CRM ユーザーの氏名と突き合わせる)。
--     書込みは Server Action がサービスロールで行う(呼ばれた本人以外の行を作るため)。
--   - RLS: 自分宛の行だけ読める・既読にできる(管理者も他人の受信トレイは触らない)。
--   - コメント・タスク・ユーザーが消えたら行も消す(ON DELETE CASCADE)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.task_mentions (
  id          bigserial PRIMARY KEY,
  comment_id  bigint      NOT NULL REFERENCES public.task_comments(id) ON DELETE CASCADE,
  task_id     bigint      NOT NULL REFERENCES public.tasks(id)         ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,  -- 呼ばれた人
  created_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,                  -- 書いた人
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id)
);
COMMENT ON TABLE public.task_mentions IS 'タスクのコメントのメンション(呼ばれた人ごとに 1 行。read_at で既読)。CLAUDE.md §5.20';
CREATE INDEX IF NOT EXISTS idx_task_mentions_user_unread
  ON public.task_mentions(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_mentions_user ON public.task_mentions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_mentions_task ON public.task_mentions(task_id);

ALTER TABLE public.task_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_mentions_select_own ON public.task_mentions;
DROP POLICY IF EXISTS task_mentions_update_own ON public.task_mentions;
CREATE POLICY task_mentions_select_own ON public.task_mentions
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY task_mentions_update_own ON public.task_mentions
  FOR UPDATE USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
-- INSERT / DELETE のポリシーは設けない(Server Action がサービスロールで書く。削除はコメント削除のカスケード)
