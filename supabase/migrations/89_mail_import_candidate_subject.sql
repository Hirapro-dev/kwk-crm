-- ============================================================================
-- migration 89: 取込候補の判定に件名キーワードを追加 (2026-09-15) / CLAUDE.md §5.15
--
-- 目的:
--   エキスパのフォーム登録通知は旧「メール to リード」用アドレス宛には来ないため、
--   宛先(To/Cc)だけの判定(migration 82)では取込候補に入らなかった。
--   件名に「[エキスパ]フォーム登録通知」を含むメールも候補にする。
--
-- 方針:
--   - スキーマ変更なし。受信時の判定はアプリ側の純粋関数 isImportCandidate()
--     (lib/domain/mail_import_candidates.ts)に件名キーワードを足した。
--   - 判定キーワードはアプリ側の定数 MAIL_IMPORT_CANDIDATE_SUBJECT_KEYWORDS
--     (lib/domain/mail_types.ts)が正。下の再集計 SQL は同じ文字列を直書きしているので、
--     定数を変えたら合わせて直して再実行する。
--   - 受信箱・分類・状態は変えない(migration 82 と同じ)。true → false には戻さない。
--
-- 注意: mail_messages(約81万件)の件名を走査する。SQL Editor でタイムアウト表示
--   ("Failed to fetch")になってもサーバー側では完了していることがあるので、下の確認 SQL で
--   件数を見てから再実行を判断する。
-- ============================================================================

UPDATE public.mail_threads AS t
SET is_import_candidate = true
FROM (
  SELECT DISTINCT m.thread_id
  FROM public.mail_messages m
  WHERE m.direction = 'in'
    AND m.subject ILIKE '%[エキスパ]フォーム登録通知%'
) AS c
WHERE t.id = c.thread_id
  AND NOT t.is_import_candidate;

-- 確認: 件名キーワードを持つスレッドのうち、候補になっていないものが 0 件であること
-- SELECT count(*)
-- FROM public.mail_threads t
-- WHERE NOT t.is_import_candidate
--   AND EXISTS (
--     SELECT 1 FROM public.mail_messages m
--     WHERE m.thread_id = t.id AND m.direction = 'in'
--       AND m.subject ILIKE '%[エキスパ]フォーム登録通知%'
--   );
