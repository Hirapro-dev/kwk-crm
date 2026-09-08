# メール一元管理(/mail)設計案

> 作成: 2026-09-08 / 状態: **承認済み・実装中**(正式仕様は CLAUDE.md §5.15。本書は経緯と比較の記録)。
>
> **2026-09-08 決定事項(最終)**
> - 基盤は **AWS SES(東京)** に変更(§1 の Resend 案は不採用)。理由: 送信ドメイン約20(主要5〜6)・送信月1,000通未満という
>   条件では、ドメイン数課金の無い SES が年額数千円で済み、Resend(Pro $240 / Scale $1,080)より明確に安い。
>   代償は受信の配管(S3 / SNS / MIME 解析)を自前で持つこと、受信用サブドメインの MX 設定、サンドボックス解除申請。
> - 受信は全共有アドレスを1つの受信用アドレスへ転送し、元の宛先で受信箱を判定する(実メールのヘッダで裏付け済み)。
> - 自動分類(`mail_threads.category`: 通常 / メルマガ / 自動応答 / 迷惑メール)と来源(`mail_messages.source`)を M1 に含める。
> - メールディーラーとは併用。返信はどちらから行うか受信箱ごとに決める(送信控えの相互送付 B 案は不採用)。
> - 過去データ取込は M4 として後回し(元データはメールディーラーのエクスポートが本命)。

---

## 0. ゴールと前提

| 項目 | 内容 |
|---|---|
| やりたいこと | 共有アドレス `ad@kawaraban.co.jp` 宛のメールを CRM の受信箱で一元管理し、担当割当・ステータス管理・会員との紐付けを行う。CRM から `ad@kawaraban.co.jp` を差出人として返信・新規送信もできる |
| 現行環境(確認済み) | メールサーバーは **Xserver**。`ad@kawaraban.co.jp` は現在メールディーラー(`maildealer-3@…maildealer.jp` 2件)へ転送中。本システムはこの転送先に**追加**して並行稼働 → 安定後にメールディーラーの転送を外す |
| Xserver の転送機能(確認済み) | サーバーパネル > メールアカウント設定 > 転送。転送先は最大1,000件。「メールボックスに残す」を選べば Xserver 側にもコピーが残る |
| 既存メール運用への影響 | **ゼロにする**。Xserver 側は「転送先アドレスを1行追加する」だけ。既存の MX・メーラーはそのまま |
| 避けたいもの | 常駐プロセス、IMAP 同期ジョブ、独自メールサーバー、複数ベンダーの組み合わせ |
| 参考にする製品 | ラクス メールディーラー(受信箱 / 担当 / ステータス / 返信 / 対応履歴) |

---

## 1. 推奨案: Resend 1社で送受信(Webhook 受信 + API 送信)

```
顧客
 │ メール送信
 ▼
ad@kawaraban.co.jp ・・・ Xserver(既存)
 │ ★Xserver の「転送先アドレス」に1行追加(「メールボックスに残す」のまま)
 ▼
受信用アドレス(下記 R1 or R2)・・・ Resend が受信
 │ Webhook: email.received(署名付き POST。中身はメタデータのみ)
 ▼
POST /api/mail/inbound(Route Handler)
 │ 署名検証 → Resend API で本文・添付を取得 → スレッド判定 → 会員突合 → DB保存
 ▼
mail_threads / mail_messages / mail_attachments(Supabase Storage)
 │
 ▼
/mail 受信箱 UI(担当・ステータス・会員紐付け・返信)
 │ 返信 / 新規送信
 ▼
Resend 送信 API ── From: ad@kawaraban.co.jp(kawaraban.co.jp の DKIM で署名)
 │ Webhook: email.delivered / bounced
 ▼
配信状態を mail_messages に反映
```

### 受信用アドレスの2案(Xserver の転送先に入れるアドレス)

| 案 | 転送先アドレス | 必要な DNS 作業 | 判定 |
|---|---|---|---|
| **R1. Resend 提供ドメイン(推奨・まずこれで開始)** | `inbox@<id>.resend.app`(Resend がアカウントごとに発行) | **なし** | ◎ 最短。顧客の目には触れないアドレスなので見た目は問題にならない |
| R2. 自社サブドメイン | `inbox@crm-mail.kawaraban.co.jp` | Xserver の DNS 設定で `crm-mail` サブドメインの **MX** を Resend に向ける | ○ 見た目が自社ドメインになる。R1 で運用開始後、`mail_boxes.inbound_address` を書き換えるだけで移行可能 |

どちらも `kawaraban.co.jp` 本体の MX には触らない。R1 なら受信側の DNS 作業がゼロになるため、**送信用の DNS(DKIM)だけ**を Xserver の DNS 設定に追加すれば済む。

### 実メールのヘッダーで確認したこと(2026-09-08、メールディーラーが受信した2通)

| | Xserver(`info@hirapro.jp`) | 海外サーバー(`info@shinshi-kyoutei.com`) |
|---|---|---|
| 仕組み | `sv101.xserver.jp` で受信 → サーバー側転送で `maildealer-3@mds3191.maildealer.jp` へ | mgfhosting(qmail)で受信 → 同様に転送 |
| 元の `From` / `To` / `Message-ID` / `Date` | **保持される** | **保持される** |
| 元の宛先の痕跡 | `Delivered-To` / `XSRV-Filter` に元アドレス | `Delivered-To` に元アドレス |
| `Return-Path` | `<>`(Xserver が空に書き換える) | 元の送信者のまま |

- メールディーラーの受信は本設計と同じ「各サーバーから、ベンダー提供の受信アドレスへ転送」方式。
  Xserver 以外のサーバーも同様に転送で動いている
- `From` と `Message-ID` が保持されるため、会員突合とスレッド判定は設計どおり動く(M1 の懸念は解消)
- **数百の共有アドレスを1つの受信用アドレスに集約できる**。どの受信箱かは元の宛先(`To` / `Cc` /
  `Delivered-To` / `X-Original-To` / `XSRV-Filter`)と `mail_boxes.address` の一致で判定する
- Xserver の転送は `Return-Path` が空(`<>`)になる。Resend の受信がこれを受け付けることは M1 のテスト送信で確認する【要確認】

### DNS から分かったこと(送信側)

`kawaraban.co.jp` の SPF に `include:mdharima.maildealer.jp` / `include:mdharimagw.maildealer.jp` が入っている
(`toushi-kawaraban.com` も同様)。つまり**メールディーラーはベンダーのサーバーから送信しており、そのための DNS(SPF)は
導入時に設定済み**だった。「DNS 設定なしで送れている」わけではない。

副産物: `kawaraban.co.jp` は SPF レコードが3つ(`toushi-kawaraban.com` / `carbon-market.com` は2つ)あり、
RFC 7208 違反で SPF が事実上無効(permerror)になっている。DMARC が `p=none` のため拒否はされていないが、
ツールの選定と無関係に**1つに統合すべき**。

### Resend の受信機能(公式情報で確認済み)

- 受信(Inbound)は **全プランで利用可**(2025-11 提供開始)。送信は Free 3,000通/月、Pro $20/月で50,000通
- Webhook `email.received` の中身は**メタデータのみ**(差出人・宛先・件名・添付一覧)。**本文は API(`emails.receiving.get`)で別途取得**する
- 添付は**一時的なダウンロード URL** が渡されるので、受信時に取得して Supabase Storage に保存する(URL は期限切れになるため、後回しにしない)
- 受信通数の上限・単価・1通のサイズ上限・保存期間は**公式ページに記載なし**【要確認: 契約前に Resend サポートへ確認】

### なぜこの構成か

1. **メールサーバーを持たない・ポーリングしない**
   受信は Webhook でプッシュされるので、cron で IMAP を覗きに行く仕組みが不要。取りこぼし・重複・認証情報の管理が消える。
2. **送信・受信を同じベンダーで完結**
   ドメイン検証・API キー・Webhook・ログが1箇所。Vercel Marketplace(`resend/resend-email`)から導入でき、API キーは環境変数に自動投入される。
3. **既存ドメインの MX を触らない**
   受信は Resend 提供アドレス(R1)か、サブドメイン(R2)で受ける。どちらも `kawaraban.co.jp` 宛の既存メールには一切影響しない。Xserver の転送設定を外せば元に戻る。
4. **既存の実装パターンに乗る**
   外部からの POST 受信は `app/api/cron/*` と同じ Route Handler + シークレット検証。一覧は `InfiniteTable`、分割ビューは `ResizableSplit`、メニューは `nav_items` と、すべて既存部品で組める。

### Resend Marketplace 確認結果

`vercel integration discover --category messaging` の結果は Resend 1件のみ(「Send and receive mails」)。送受信の両対応を確認済み。

---

## 2. 代替案との比較

| 案 | 仕組み | 長所 | 短所 | 判定 |
|---|---|---|---|---|
| **A. Resend(推奨)** | サブドメインの MX → Resend → Webhook / 送信は API | 送受信1社・サーバー不要・Marketplace 導入・既存 MX 不変 | 有料(受信の料金体系は【要確認】)/ 受信ドメインがサブドメインになる | ◎ |
| B. IMAP ポーリング | 転送先メールボックスを cron で定期取得 | DNS 変更不要 | 常駐/定期ジョブ・メールボックス認証情報の保管・MIME 解析・重複管理が全部自前。Vercel cron は最短1分で遅延あり。送信は別途 SMTP が必要 | △ |
| C. Cloudflare Email Routing + Worker | Cloudflare で受信 → Worker が MIME 解析して CRM に POST | 無料・Cloudflare 利用中なら親和性 | 別プラットフォームの運用が増える。MIME 解析(postal-mime 等)・添付の中継・再送制御を自前実装。送信は別サービス | △ |
| D. Gmail / Graph API 直結 | Google Workspace / M365 の API で共有メールボックスを直接操作 | 転送すら不要 | OAuth 同意・トークン更新・Pub/Sub(push)の設定が重い。テナント依存で移植性なし | × |

「煩雑さを避ける」を最優先すると A。B/C は動くが**自前で持つ部品が増える**。

---

## 3. データモデル(CLAUDE.md §5 追記案)

既存規約どおり: 論理削除(`deleted_at`)、`created_at`/`updated_at`、RLS 必須、可変項目は jsonb。

### 3.1 mail_boxes(共有アドレス)
1行 = 会社側の公開アドレス1つ(数百件を想定)。受信用アドレス(転送先)は受信箱ごとには持たず、全体で1つを環境変数 `MAIL_INBOUND_ADDRESS` で持つ。どの受信箱かは元の宛先と `address` の一致で判定する。

| カラム | 型 | 内容 |
|---|---|---|
| `id` | serial PK | |
| `address` | text unique | 公開アドレス(`ad@kawaraban.co.jp`)。送信時の From |
| `display_name` | text | 送信時の表示名(「KAWARA版」等) |
| `signature` | text | 返信時に付ける署名 |
| `is_active` | boolean | |

### 3.2 mail_threads(スレッド = 対応単位)
メールディーラーの「案件」に相当。受信箱の1行はこれ。

| カラム | 型 | 内容 |
|---|---|---|
| `id` | uuid PK | |
| `mail_box_id` | int FK → mail_boxes | |
| `subject` | text | 先頭メールの件名(`Re:` 除去済み) |
| `member_id` | text FK → members (nullable) | 会員突合結果。未一致は NULL、手動紐付け可 |
| `status` | text check (`未対応`, `対応中`, `完了`) | 受信で `未対応`、返信で `対応中`、手動で `完了` |
| `assignee_id` | uuid FK → users (nullable) | 担当 |
| `last_message_at` | timestamptz | 一覧の並び順 |
| `last_direction` | text (`in` / `out`) | 一覧で「顧客から返信が来た」を目立たせる |
| `is_read` | boolean | スレッド単位の既読(ユーザー別既読は持たない: 共有受信箱の運用に合わせて簡素化) |
| `created_at` / `updated_at` / `deleted_at` | | |

### 3.3 mail_messages(メール1通)

| カラム | 型 | 内容 |
|---|---|---|
| `id` | uuid PK | |
| `thread_id` | uuid FK → mail_threads | |
| `direction` | text check (`in` / `out`) | |
| `message_id` | text **unique** | RFC 5322 Message-ID。Webhook 再送時の**二重登録防止**(冪等キー) |
| `in_reply_to` / `references` | text | スレッド判定に使う |
| `from_address` / `from_name` | text | |
| `to_addresses` / `cc_addresses` | text[] | |
| `subject` | text | |
| `text_body` | text | プレーンテキスト |
| `html_body` | text | HTML(表示時にサニタイズ) |
| `sent_at` | timestamptz | 受信メールはヘッダの Date、送信は送信時刻 |
| `provider_message_id` | text | Resend 側の ID(配信状態 Webhook との突合) |
| `delivery_status` | text | 送信のみ: `queued` / `sent` / `delivered` / `bounced` / `failed` |
| `sender_user_id` | uuid FK → users | 送信のみ: 誰が送ったか |
| `created_at` | | |

**保存しないもの**: 生の MIME 全文。容量と個人情報の観点から、テキスト/HTML/添付だけを保持する。

### 3.4 mail_attachments

| カラム | 型 | 内容 |
|---|---|---|
| `id` | uuid PK | |
| `message_id` | uuid FK → mail_messages | |
| `filename` / `content_type` / `size_bytes` | | |
| `storage_path` | text | Supabase Storage(非公開バケット `mail-attachments`)のパス。閲覧は署名付き URL |

### 3.5 スレッド判定と会員突合(決定論的にコードで行う / R6)

- **スレッド判定**: 受信メールの `In-Reply-To` / `References` に含まれる Message-ID が `mail_messages.message_id` に存在すれば同じスレッド。無ければ新規スレッド。
  件名の `Re:` 突合は**使わない**(別件が結合される誤りの温床)。誤って分かれた場合は画面の「スレッドを結合」で手動対応(M3)。
- **会員突合**: 差出人アドレスを小文字化し、`members.email1 / email2 / email3` と完全一致で検索。
  1件一致 → `member_id` セット。複数一致 → 先頭をセットし `要確認` 表示。0件 → NULL(画面で「会員を紐付け」/「問合せとして登録」)。

---

## 4. 画面(CLAUDE.md §8.1 追記案)

| URL | 画面 | 内容 |
|---|---|---|
| `/mail` | 受信箱 | スレッド一覧(`InfiniteTable` 再利用)。列: 状態 / 件名 / 差出人 / 会員 / 担当 / 最終受信。フィルタ: 状態・担当・受信箱・未読。既存と同じ分割ビュー(左: 一覧 / 右: スレッド) |
| `/mail/[threadId]` | スレッド | メッセージを時系列で表示、返信フォーム(引用付き・署名自動)、担当変更、ステータス変更、会員紐付け |
| `/mail/new` | 新規作成 | 宛先(会員検索 or 直接入力)、件名、本文 |
| `/members/[id]` | 会員詳細 | 「メール」タブに関連スレッドを表示(M3) |
| `/settings/mail` | 設定 | 受信箱(mail_boxes)の管理。admin のみ(M2) |

メニューは `nav_items` に「メール」を追加(migration 1本。既存の `/settings/navigation` で表示順・表示ロールを調整可)。

---

## 5. 送信の仕様

### 5.0 ドメイン構成と段階的な送信対応(2026-09-08 提案)

前提(ヒアリング): 共有アドレスは **約20ドメイン**に分かれ、**主要で稼働中なのは5〜6ドメイン**。
DNS の作業はアドレス単位ではなく**ドメイン単位**なので、規模はこの「ドメイン数」で決まる。

Resend のプラン別上限(公式ページ、2026-09 確認):

| プラン | 月額 | 登録ドメイン数 | 送信数 |
|---|---|---|---|
| Free | $0 | 1〜3(公式ページ内で表記が食い違う。**1 と見なす**) | 3,000通/月・**100通/日** |
| **Pro** | **$20** | **10** | 50,000通/月 |
| Scale | $90〜 | 1,000 | 100,000通/月〜 |

方針:

| 区分 | 対象 | 受信 | 送信 | 必要な作業 |
|---|---|---|---|---|
| **Tier 1** | 主要 5〜6 ドメインの全アドレス | 共通の受信用アドレスへ転送(DNS 不要) | Resend から **From そのまま**で送信 | ドメインごとに Resend の DNS レコード(DKIM 等)を追加 × 5〜6回 |
| **Tier 2** | 残り約 15 ドメイン | 同上(DNS 不要) | **当面は受信専用**(画面に送信ボタンを出さない)。返信が必要になったドメインから順に DKIM を追加して送信可に切り替える | 必要になった時点でドメインごとに追加 |

- 送信可否は **Resend のドメイン検証状態**(API で取得、数分キャッシュ)から決定論的に判定し、
  `mail_boxes` に手動フラグは持たない。未検証ドメインのアドレスには「受信専用(送信ドメイン未検証)」と表示する
- Tier 2 の救済として「検証済みドメインからの代理送信(From を別ドメインにし Reply-To に元アドレス)」も
  実装は可能だが、顧客から見て差出人が変わるため**既定では使わない**(要望があれば個別に有効化)
- プランは **Pro($20/月)から開始**。Tier 1 の 5〜6 ドメインが 10 枠に収まり、Tier 2 も 4 ドメインまでは追加できる。
  10 を超えた時点で Scale への切替か、代理送信への切替を判断する
- M1(受信のみ)の検証は Free で行い、Tier 1 の DNS 設定に入る段階で Pro に上げる
- Resend の DNS レコードは `resend._domainkey.<domain>` や `send.<domain>` などサブドメイン側に置く設計のため、
  既存の SPF レコード(現状は重複で壊れている)を触らずに済む見込み【要確認: ダッシュボード表示値で判断】

- Resend API で送信。**From は `mail_boxes.address` = `ad@kawaraban.co.jp`**。Resend に `kawaraban.co.jp` を送信ドメインとして登録し、Resend が指示する DNS レコード(DKIM 等)を Xserver の DNS 設定に追加する。Reply-To も同じにして、顧客の返信が Xserver → 転送 → 受信箱に戻る循環を作る。
- **転送の往復による二重登録の防止**: CRM から送ったメールは Xserver のメールボックスには残らない(Xserver を経由しないため)。もし「送信控えも Xserver に残したい」場合は BCC で `ad@kawaraban.co.jp` に送る運用にできるが、その控えは転送で CRM にも戻ってくる。`mail_messages.message_id` が UNIQUE なので同じ Message-ID の受信は捨てられ、二重登録にはならない(M2 で要動作確認)。既定では BCC しない。
- 返信時は `In-Reply-To` / `References` ヘッダを付ける。顧客側のメーラーでも同じスレッドにぶら下がる。
- 送信後、`mail_messages`(`direction=out`)を保存し、スレッドの `status` を `対応中`、`last_direction` を `out` に更新。
- 配信結果(`email.delivered` / `email.bounced`)は Webhook で受けて `delivery_status` を更新。バウンスは受信箱で警告表示。
- 添付付き送信は M3。

---

## 6. セキュリティ・信頼性

| 観点 | 方針 |
|---|---|
| Webhook の真正性 | Resend の署名(Svix 形式)を検証。不一致は 401。`app/api/cron/*` の `CRON_SECRET` 検証と同じ位置づけ |
| 冪等性 | `mail_messages.message_id` UNIQUE。Webhook が再送されても二重登録しない(`ON CONFLICT DO NOTHING`) |
| 宛先の検証 | Webhook の宛先が `mail_boxes.inbound_address` に一致しないものは無視(他所からの流入防止) |
| RLS | migration 33 の方針に揃える: SELECT 全ロール / INSERT・UPDATE は viewer 以外 / DELETE は admin。**メールは個人情報が濃いため、閲覧を admin・manager・support に限定するかは要判断**(§8 の決定事項) |
| 添付 | 非公開バケット。閲覧は短期署名 URL。実行形式など危険な拡張子は保存時に拒否 |
| HTML 表示 | サニタイズして描画。**画像の自動読み込みはブロック**(開封トラッキング対策)。リンクは `rel="noopener"` |
| 監査 | 送信は `sender_user_id` で追跡可能。スレッドの担当・ステータス変更は監査ログトリガー(migration 41)の対象に追加するか要判断 |
| ログ | 本文・アドレスをサーバーログに出さない(§12.4) |

---

## 7. 導入時に必要な設定作業(開発と並行して依頼)

| 順 | 誰が | 作業 | 備考 |
|---|---|---|---|
| 1 | AWS 管理者 | AWS アカウント(東京)で IAM ユーザーを2つ用意: 構築用(S3/SNS/SES 受信ルール/STS)と **Webhook 用**(`s3:GetObject` 対象バケットのみ + `ses:SendEmail`) | 最小権限。Webhook 用のキーだけを Vercel に置く |
| 2 | AWS 管理者 | `scripts/mail/setup_aws.ts` を手元で実行(S3 バケット・SNS トピック・SES 受信ルールセットを冪等に作成) | 認証情報をチャットや画面に貼らずに済む。`--dry-run` で内容確認可 |
| 3 | 開発側 | スクリプトが出力した環境変数(`MAIL_*`)を Vercel に設定して再デプロイ | `AWS_*` は Vercel の予約名のため `MAIL_` 接頭辞 |
| 4 | AWS 管理者 | スクリプトを `--subscribe` 付きで再実行(SNS → `https://crm.hirapro.com/api/mail/inbound` の購読。Webhook が署名検証のうえ自動確認) | 3 の後でないと購読確認を拒否する |
| 5 | **DNS 管理者(Xserver)** | 受信用サブドメイン(例 `crm-mail.kawaraban.co.jp`)の **MX** を `inbound-smtp.ap-northeast-1.amazonaws.com` に向ける | サブドメインのみ。`kawaraban.co.jp` 本体の MX・SPF には触らない |
| 6 | **各サーバーの管理者** | 取り込みたい共有アドレスごとに、転送先へ **受信用アドレス(全アドレス共通)を1行追加**。「メールボックスに残す」のまま | 数百アドレスでも貼るアドレスは同じ1つ。メールディーラーの転送は残す(併用)。CRM 側は `mail_boxes` に同じアドレスを登録 |
| 7 | 開発側 | テストメールで受信を確認(Xserver 転送の `Return-Path: <>` を SES が受け付けるか、会員突合・分類が想定どおりか) | |
| 8 | AWS 管理者 | **送信(M2)の準備**: SES の**サンドボックス解除**を申請(用途: 顧客対応メールの返信、月1,000通未満)。Tier 1 のドメインを SES に ID 登録し、表示された **Easy DKIM の CNAME 3本**を各ドメインの DNS に追加 | 承認は通常1〜2日。既存の SPF・MX は変えない |
| 9 | 運用側 | 安定後、各サーバーの転送先からメールディーラーのアドレスを削除 | 本システムへ切り替え完了 |

受信側で DNS を触るのは 5 の**サブドメイン1つ**だけ。送信側(8)はドメインごとに DKIM の CNAME 追加(Tier 1 の 5〜6 ドメインから)。

---

## 8. 段階的な進め方

| 段階 | 内容 | 目安 |
|---|---|---|
| **M1 受信箱** | migration(4テーブル + nav)、Webhook 受信、スレッド判定、会員突合、`/mail` 一覧・スレッド表示、担当・ステータス変更 | 2〜3日 |
| **M2 送信** | 返信・新規送信、配信状態反映、署名、`/settings/mail` | 2日 |
| **M3 CRM 連携** | 受信/送信を**対応歴に自動記録**(`d_bunrui=メール`)、会員詳細の「メール」タブ、テンプレ(定型文)、添付付き送信、スレッド結合 | 2〜3日 |

M3 の「対応歴への自動記録」が、この CRM にメールを載せる一番の価値(§1.2 の中核機能に乗る)。ただし M1/M2 が安定してから。

---

## 9. 決めていただきたいこと

1. ~~メールサーバーの種類と転送可否~~ → **確定: Xserver、転送可(コピー保持可)**
2. **受信用アドレス** — R1(Resend 提供アドレス、DNS 作業なし)で開始してよいか。既定: **R1**
3. **共有アドレスの数** — まず `ad@kawaraban.co.jp` の1つで開始(データモデルは複数対応済みなので後から追加可)。既定: **1つ**
4. **閲覧権限** — 全ロールに見せるか、admin / manager / support に限定するか。既定: **既存テーブルと同じ「全ロール閲覧可・書込は viewer 以外」**
5. **対応歴への自動記録(M3)** — 必要か。必要なら「受信も記録するか / 送信だけか」。既定: **M1/M2 では行わず、M3 で判断**
6. **共有アドレスが分かれているドメイン数** — DNS(送信用 DKIM)の作業はアドレス単位ではなくドメイン単位。数百アドレスが何ドメインかで送信方式の現実解が決まる【回答待ち】
7. **Resend 導入の実行許可** — Marketplace 経由の導入は Vercel チームに Resend アカウント(課金主体)を作る操作になるため、**実行前に許可をいただきたい**。Free プランで開始可(送信 3,000通/月。受信は全プラン利用可だが通数上限は【要確認】)

---

## 10. 決めてある前提(異論がなければこのまま)

- 受信は Webhook プッシュのみ。ポーリングは持たない
- 生 MIME は保存しない。テキスト / HTML / 添付のみ
- ユーザー別の既読は持たない(スレッド単位の既読のみ)
- スレッド判定はヘッダのみ。件名では結合しない
- 会員突合は完全一致のみ。あいまい一致はしない
