-- ============================================================================
-- migration 83: 共有アドレスの一括登録と「その他」の一括再振り分け (2026-09-14)
--               CLAUDE.md §5.15
--
-- 背景:
--   過去データ取込(81万通)の結果、宛先アドレスが未登録のため約74万スレッドが
--   「その他」に入っている。届いている自社の共有アドレスをまとめて受信箱に登録し、
--   ドメイン > アドレスのフォルダに振り分ける。
--
-- 登録対象の決め方(コードで決定論的に抽出。顧客・取引先・スタッフ個人の Gmail 等を混ぜない):
--   1. 対象ドメインはユーザー指定の自社ドメイン 43 件(2026-09-14)。送信者側(顧客など
--      スレッドの相手になるアドレス)は対象外
--   2. その配下で、受信メール(direction='in')の宛先(To/Cc)に 3 通以上現れたアドレス
--      (1〜2 通のものは誤記の可能性があるため除外。必要なら /mail/settings から個別に追加)
--   3. 登録済みの受信箱は除外(ON CONFLICT DO NOTHING でも二重登録されない)
--   → 265 件。指定ドメインのうち該当アドレスが無かったもの: kenja-isan.co.jp,
--     sir-project-partners.com, otosen-project-partners.co.jp, miyamoto-denki-inc.com,
--     iwai-kikaku.com, gpp-sg-payment.co.jp, mrtship.jp(info@ は登録済み), hirapro.com,
--     toushi-no-kawaraban.com, decarbonized-market.com, hirayama-production.com
--
-- 再振り分け:
--   migration 78 の reassign_other_mail_threads() と同じ判定(宛先が有効な受信箱に
--   一意に一致するスレッドだけ移す。複数に一致すれば動かさない)。
--   ただし同関数は (a) ログイン中の管理者からしか呼べず、(b) 受信箱ごとに宛先を
--   照合する書き方のため受信箱が数百件になると遅い。そこで判定本体を範囲指定つきの
--   内部関数に切り出し(宛先を一度展開して受信箱とハッシュ結合)、既存 RPC は権限
--   チェックだけ残して内部関数へ委譲する。本ファイルでは内部関数を年ごとに呼んで
--   一括処理する(1回の実行が長くなりすぎないように)。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 再振り分けの本体(範囲指定つき)。権限チェックは持たないため、
--    authenticated からは呼べないようにする(SQL Editor / サービスロール専用)。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_other_mail_threads_range(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_id integer;
  v_moved    integer;
BEGIN
  SELECT id INTO v_other_id FROM public.mail_boxes WHERE address = 'other@unassigned.invalid';
  IF v_other_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH recipients AS (
    -- 「その他」のスレッドの全メッセージの宛先(To/Cc)を1行ずつに展開する
    SELECT m.thread_id, lower(a) AS addr
    FROM public.mail_threads t
    JOIN public.mail_messages m ON m.thread_id = t.id
    CROSS JOIN LATERAL unnest(m.to_addresses || m.cc_addresses) AS a
    WHERE t.mail_box_id = v_other_id
      AND t.deleted_at IS NULL
      AND (p_from IS NULL OR t.last_message_at >= p_from)
      AND (p_to   IS NULL OR t.last_message_at <  p_to)
  ),
  candidates AS (
    SELECT r.thread_id, b.id AS box_id
    FROM recipients r
    JOIN public.mail_boxes b ON lower(b.address) = r.addr
    WHERE b.id <> v_other_id
      AND b.is_active
    GROUP BY r.thread_id, b.id
  ),
  resolved AS (
    -- 一意に決まるスレッドだけ(複数の受信箱に一致するものは動かさない)
    SELECT thread_id, min(box_id) AS box_id
    FROM candidates
    GROUP BY thread_id
    HAVING count(*) = 1
  )
  UPDATE public.mail_threads t
  SET mail_box_id = r.box_id, updated_at = now()
  FROM resolved r
  WHERE t.id = r.thread_id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_other_mail_threads_range(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reassign_other_mail_threads_range(timestamptz, timestamptz) IS
  '「その他」のスレッドを宛先が一意に一致する受信箱へ移す本体(last_message_at の範囲指定可)。
   権限チェック無しのため authenticated からは呼べない。CLAUDE.md §5.15';

-- ---------------------------------------------------------------------------
-- 2) 既存 RPC(受信箱登録時・設定画面の「再振り分けを実行」)は権限チェックだけ残して委譲
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_other_mail_threads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  RETURN public.reassign_other_mail_threads_range(NULL, NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) 共有アドレスの一括登録(既に登録済みのものは何もしない)
-- ---------------------------------------------------------------------------
-- 2026-09-14 時点の受信メール(81万通)の宛先から、指定の自社ドメイン配下で 3 通以上
-- 現れたアドレス 265 件(コードで機械的に抽出。表示名は未設定=アドレスをそのまま表示)。
INSERT INTO public.mail_boxes (address, display_name, is_active)
SELECT v.address, NULL, true
FROM (VALUES
  ('admin@kenja-isan.com'),
  ('aff@kenja-isan.com'),
  ('info@kenja-isan.com'),
  ('kenja@kenja-isan.com'),
  ('mail@kenja-isan.com'),
  ('hiratoshi-cf@hirapro.jp'),
  ('miyamoto@hirapro.jp'),
  ('recruit@hirapro.jp'),
  ('seo-pj@hirapro.jp'),
  ('soumu@hirapro.jp'),
  ('bonds-ad@web-promotion.co.jp'),
  ('info@web-promotion.co.jp'),
  ('kasuya@web-promotion.co.jp'),
  ('ada2@toushi-kawaraban.com'),
  ('agency@toushi-kawaraban.com'),
  ('agree@toushi-kawaraban.com'),
  ('aiba@toushi-kawaraban.com'),
  ('aihara@toushi-kawaraban.com'),
  ('application@toushi-kawaraban.com'),
  ('asec_cp@toushi-kawaraban.com'),
  ('entry@toushi-kawaraban.com'),
  ('furusawa@toushi-kawaraban.com'),
  ('hara@toushi-kawaraban.com'),
  ('ht-cp2@toushi-kawaraban.com'),
  ('imai@toushi-kawaraban.com'),
  ('info@toushi-kawaraban.com'),
  ('kameyama@toushi-kawaraban.com'),
  ('matsuda@toushi-kawaraban.com'),
  ('mishima@toushi-kawaraban.com'),
  ('nagata@toushi-kawaraban.com'),
  ('nine-cp@toushi-kawaraban.com'),
  ('rfd@toushi-kawaraban.com'),
  ('rumor@toushi-kawaraban.com'),
  ('support@toushi-kawaraban.com'),
  ('takamura@toushi-kawaraban.com'),
  ('admin@kawaraban.co.jp'),
  ('aff@kawaraban.co.jp'),
  ('ht-cp-nda@kawaraban.co.jp'),
  ('ht-cp@kawaraban.co.jp'),
  ('quest@kawaraban.co.jp'),
  ('aff@virtual-currency-billionaire.com'),
  ('entry@virtual-currency-billionaire.com'),
  ('info@virtual-currency-billionaire.com'),
  ('rfd@virtual-currency-billionaire.com'),
  ('support@virtual-currency-billionaire.com'),
  ('aff@asec-project-partners.jp'),
  ('agency@asec-project-partners.jp'),
  ('application@asec-project-partners.jp'),
  ('entry@asec-project-partners.jp'),
  ('info@asec-project-partners.jp'),
  ('recruit@asec-project-partners.jp'),
  ('support@asec-project-partners.jp'),
  ('conference_cp@asec-project-partners.co.jp'),
  ('conference@asec-project-partners.co.jp'),
  ('contact@asec-project-partners.co.jp'),
  ('info@asec-project-partners.co.jp'),
  ('mishima@asec-project-partners.co.jp'),
  ('miyamoto@asec-project-partners.co.jp'),
  ('social@asec-project-partners.co.jp'),
  ('info@sir-coin.com'),
  ('info@peace-payment-service.co.jp'),
  ('miyamoto@peace-payment-service.co.jp'),
  ('aff@sir-project-partners.co.jp'),
  ('agency@sir-project-partners.co.jp'),
  ('application@sir-project-partners.co.jp'),
  ('contact@sir-project-partners.co.jp'),
  ('entry@sir-project-partners.co.jp'),
  ('info@sir-project-partners.co.jp'),
  ('recruit@sir-project-partners.co.jp'),
  ('social@sir-project-partners.co.jp'),
  ('support@sir-project-partners.co.jp'),
  ('aff@casino-ir-billionaire.com'),
  ('entry@casino-ir-billionaire.com'),
  ('info@casino-ir-billionaire.com'),
  ('admin@global-project-partners.co.jp'),
  ('apg@global-project-partners.co.jp'),
  ('application@global-project-partners.co.jp'),
  ('asec-project@global-project-partners.co.jp'),
  ('conference_cp@global-project-partners.co.jp'),
  ('db@global-project-partners.co.jp'),
  ('golf@global-project-partners.co.jp'),
  ('imai@global-project-partners.co.jp'),
  ('info@global-project-partners.co.jp'),
  ('isg_cp@global-project-partners.co.jp'),
  ('isg_cp2@global-project-partners.co.jp'),
  ('live_cp@global-project-partners.co.jp'),
  ('live@global-project-partners.co.jp'),
  ('name@global-project-partners.co.jp'),
  ('online-kas@global-project-partners.co.jp'),
  ('qestn@global-project-partners.co.jp'),
  ('social@global-project-partners.co.jp'),
  ('support@global-project-partners.co.jp'),
  ('admin@otosen-project-partners.com'),
  ('application@otosen-project-partners.com'),
  ('conference_cp@otosen-project-partners.com'),
  ('conference_mv@otosen-project-partners.com'),
  ('conference@otosen-project-partners.com'),
  ('doc@otosen-project-partners.com'),
  ('fan-do-doc@otosen-project-partners.com'),
  ('fan-do-start@otosen-project-partners.com'),
  ('fan-do@otosen-project-partners.com'),
  ('fan@otosen-project-partners.com'),
  ('info@otosen-project-partners.com'),
  ('intro-cash@otosen-project-partners.com'),
  ('isg_cp@otosen-project-partners.com'),
  ('isg@otosen-project-partners.com'),
  ('korea-plan-doc@otosen-project-partners.com'),
  ('korea-plan-form@otosen-project-partners.com'),
  ('live_cp@otosen-project-partners.com'),
  ('live@otosen-project-partners.com'),
  ('rate-cash@otosen-project-partners.com'),
  ('recruit@otosen-project-partners.com'),
  ('rede@otosen-project-partners.com'),
  ('sp_live@otosen-project-partners.com'),
  ('tachibana@hirayama-toshihiro.co.jp'),
  ('tig@hirayama-toshihiro.co.jp'),
  ('admin@decarbonization-marketing.co.jp'),
  ('recruit@decarbonization-marketing.co.jp'),
  ('tig@decarbonization-marketing.co.jp'),
  ('admin@sc-project-partners.co.jp'),
  ('bonds-doc@sc-project-partners.co.jp'),
  ('bonds-form@sc-project-partners.co.jp'),
  ('bv-mv@sc-project-partners.co.jp'),
  ('ikeda@sc-project-partners.co.jp'),
  ('miyamoto@sc-project-partners.co.jp'),
  ('recruit@sc-project-partners.co.jp'),
  ('regus@sc-project-partners.co.jp'),
  ('sc-sct-doc@sc-project-partners.co.jp'),
  ('sc-sct@sc-project-partners.co.jp'),
  ('sct-insider-c@sc-project-partners.co.jp'),
  ('sct-rfd@sc-project-partners.co.jp'),
  ('sk@sc-project-partners.co.jp'),
  ('tachibana@sc-project-partners.co.jp'),
  ('temporary0001@sc-project-partners.co.jp'),
  ('xels-rfd@sc-project-partners.co.jp'),
  ('support@creative-a.com'),
  ('miyamoto@scpp.jp'),
  ('tachibana@scpp.jp'),
  ('bvlive-app@mrt.co.jp'),
  ('info@mrt.co.jp'),
  ('kowaki@mrt.co.jp'),
  ('miyamoto@mrt.co.jp'),
  ('recruit@mrt.co.jp'),
  ('seo_pj@mrt.co.jp'),
  ('seo_pj2@mrt.co.jp'),
  ('support@mrt.co.jp'),
  ('info@biovault.co.jp'),
  ('recruit@biovault.co.jp'),
  ('app@biovault.jp'),
  ('info@biovault.jp'),
  ('account@gpp-singapore.com'),
  ('admin@gpp-singapore.com'),
  ('ahi-doc@gpp-singapore.com'),
  ('ahi@gpp-singapore.com'),
  ('altcoin_doc@gpp-singapore.com'),
  ('altcoin@gpp-singapore.com'),
  ('application@gpp-singapore.com'),
  ('asec-bonds_doc@gpp-singapore.com'),
  ('asec-bonds@gpp-singapore.com'),
  ('asec-insider-k@gpp-singapore.com'),
  ('coin-doc@gpp-singapore.com'),
  ('coin-form@gpp-singapore.com'),
  ('confid@gpp-singapore.com'),
  ('contract@gpp-singapore.com'),
  ('db@gpp-singapore.com'),
  ('introd@gpp-singapore.com'),
  ('isg-cp@gpp-singapore.com'),
  ('isg-mv-ps@gpp-singapore.com'),
  ('isg-mv@gpp-singapore.com'),
  ('isg@gpp-singapore.com'),
  ('live@gpp-singapore.com'),
  ('name@gpp-singapore.com'),
  ('prsnt-coin@gpp-singapore.com'),
  ('redemption@gpp-singapore.com'),
  ('sc-sct-doc@gpp-singapore.com'),
  ('sc-sct@gpp-singapore.com'),
  ('sct-insider-c@gpp-singapore.com'),
  ('sct-insider-introd@gpp-singapore.com'),
  ('sct-rfd@gpp-singapore.com'),
  ('sst-doc@gpp-singapore.com'),
  ('sst@gpp-singapore.com'),
  ('support@gpp-singapore.com'),
  ('xels-bonds_doc@gpp-singapore.com'),
  ('xels-bonds@gpp-singapore.com'),
  ('xels-doc@gpp-singapore.com'),
  ('xels-insider-c@gpp-singapore.com'),
  ('xels-insider-k@gpp-singapore.com'),
  ('xels-proxy@gpp-singapore.com'),
  ('xels-rfd@gpp-singapore.com'),
  ('xels-sct-doc@gpp-singapore.com'),
  ('xels-sct@gpp-singapore.com'),
  ('account@shinshi-kyoutei.com'),
  ('admin@shinshi-kyoutei.com'),
  ('aiba@shinshi-kyoutei.com'),
  ('application@shinshi-kyoutei.com'),
  ('btc@shinshi-kyoutei.com'),
  ('cash@shinshi-kyoutei.com'),
  ('cio-doc@shinshi-kyoutei.com'),
  ('cio-info@shinshi-kyoutei.com'),
  ('cio-support@shinshi-kyoutei.com'),
  ('cio@shinshi-kyoutei.com'),
  ('conference_mv@shinshi-kyoutei.com'),
  ('entry@shinshi-kyoutei.com'),
  ('gpp-sg-doc@shinshi-kyoutei.com'),
  ('gpp-sg@shinshi-kyoutei.com'),
  ('gpp-token-doc@shinshi-kyoutei.com'),
  ('gpp-token-form@shinshi-kyoutei.com'),
  ('hamada@shinshi-kyoutei.com'),
  ('imai@shinshi-kyoutei.com'),
  ('info@shinshi-kyoutei.com'),
  ('iwata@shinshi-kyoutei.com'),
  ('matsuda@shinshi-kyoutei.com'),
  ('mdh2.0-doc@shinshi-kyoutei.com'),
  ('members@shinshi-kyoutei.com'),
  ('minami@shinshi-kyoutei.com'),
  ('mishima@shinshi-kyoutei.com'),
  ('pe-tam-doc@shinshi-kyoutei.com'),
  ('pe-tam@shinshi-kyoutei.com'),
  ('pif-doc@shinshi-kyoutei.com'),
  ('pif@shinshi-kyoutei.com'),
  ('support@shinshi-kyoutei.com'),
  ('telomere-doc@shinshi-kyoutei.com'),
  ('telomere@shinshi-kyoutei.com'),
  ('admin@team-jones.net'),
  ('aff@team-jones.net'),
  ('another@team-jones.net'),
  ('furusawa@team-jones.net'),
  ('imai@team-jones.net'),
  ('info@team-jones.net'),
  ('kameyama@team-jones.net'),
  ('mihara@team-jones.net'),
  ('mishima@team-jones.net'),
  ('nagata@team-jones.net'),
  ('nakahara@team-jones.net'),
  ('s-info@team-jones.net'),
  ('takamura@team-jones.net'),
  ('supportk@creative-a.info'),
  ('gp@genesis-project.info'),
  ('info@genesis-project.info'),
  ('support@genesis-project.info'),
  ('info@joker-j.com'),
  ('joker@joker-j.com'),
  ('member@joker-j.com'),
  ('support@joker-j.com'),
  ('kinoshita@hirayama-production.co.jp'),
  ('admin@asec-coin.com'),
  ('info@asec-coin.com'),
  ('support@asec-coin.com'),
  ('admin@carbon-market.com'),
  ('aff@carbon-market.com'),
  ('bonds-doc@carbon-market.com'),
  ('bonds-form@carbon-market.com'),
  ('cbn-rfd@carbon-market.com'),
  ('contract@carbon-market.com'),
  ('doc@carbon-market.com'),
  ('entry@carbon-market.com'),
  ('info@carbon-market.com'),
  ('isg@carbon-market.com'),
  ('live@carbon-market.com'),
  ('matsuda@carbon-market.com'),
  ('mendan@carbon-market.com'),
  ('name@carbon-market.com'),
  ('quest@carbon-market.com'),
  ('rfd-in@carbon-market.com'),
  ('rumor@carbon-market.com')
) AS v(address)
ON CONFLICT (address) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) 「その他」の一括再振り分け(年ごと。各行が独立した処理なので、時間切れになった
--    場合はその行だけ実行し直せばよい)
-- ---------------------------------------------------------------------------
SELECT public.reassign_other_mail_threads_range('2000-01-01', '2016-01-01') AS moved_before_2016;
SELECT public.reassign_other_mail_threads_range('2016-01-01', '2018-01-01') AS moved_2016_2017;
SELECT public.reassign_other_mail_threads_range('2018-01-01', '2019-01-01') AS moved_2018;
SELECT public.reassign_other_mail_threads_range('2019-01-01', '2020-01-01') AS moved_2019;
SELECT public.reassign_other_mail_threads_range('2020-01-01', '2021-01-01') AS moved_2020;
SELECT public.reassign_other_mail_threads_range('2021-01-01', '2022-01-01') AS moved_2021;
SELECT public.reassign_other_mail_threads_range('2022-01-01', '2023-01-01') AS moved_2022;
SELECT public.reassign_other_mail_threads_range('2023-01-01', '2024-01-01') AS moved_2023;
SELECT public.reassign_other_mail_threads_range('2024-01-01', '2025-01-01') AS moved_2024;
SELECT public.reassign_other_mail_threads_range('2025-01-01', '2026-01-01') AS moved_2025;
SELECT public.reassign_other_mail_threads_range('2026-01-01', '2030-01-01') AS moved_2026_;
