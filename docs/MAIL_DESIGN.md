# メール一元管理(/mail)設計案

> 作成: 2026-09-08 / 状態: **提案(未承認)**。承認後に CLAUDE.md §5 / §8 へ正式仕様として転記し、migration を作成する(§15-2)。

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
1行 = 会社側の公開アドレス1つ。最初は1行でも、`info@` `sales@` と増えたときに画面を変えずに済む。

| カラム | 型 | 内容 |
|---|---|---|
| `id` | serial PK | |
| `address` | text unique | 公開アドレス(`ad@kawaraban.co.jp`)。送信時の From |
| `display_name` | text | 送信時の表示名(「KAWARA版」等) |
| `inbound_address` | text unique | Xserver の転送先に登録したアドレス(R1: `inbox@<id>.resend.app`)。受信 Webhook の宛先判定に使う。R2 へ移行するときはここを書き換えるだけ |
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
| 1 | 開発側 | Vercel Marketplace から Resend を導入(`vercel integration add resend/resend-email`) | API キーは環境変数に自動投入。**Resend アカウントが Vercel チームに紐づく(課金主体)** |
| 2 | 開発側 | Resend で受信を有効化し、受信用アドレス(R1: `inbox@<id>.resend.app`)を控える。Webhook URL **`https://crm.hirapro.com/api/mail/inbound`** を登録(イベント: `email.received` / `email.sent` / `email.delivered` / `email.bounced` / `email.failed`)。署名シークレットを Vercel 環境変数 `RESEND_WEBHOOK_SECRET` に設定 | 本番の安定 URL は `crm.hirapro.com`(確認済み) |
| 3 | **Xserver 管理者** | サーバーパネル > メールアカウント設定 > `ad@kawaraban.co.jp` の転送 > 「転送先アドレス」に **2 の受信用アドレスを1行追加** > 追加する。「メールボックスに残すかどうか」は **残す** のまま | 添付画面の操作そのまま。メールディーラーの2件は当面残す(並行稼働) |
| 4 | 開発側 | テストメールを `ad@kawaraban.co.jp` に送り、CRM に届くこと・**元の From / Message-ID が保持されていること**を確認 | Xserver の転送でヘッダーが書き換わらないかは公式マニュアルに記載がない【要確認: M1 の最初の検証項目】 |
| 5 | 開発側 → Xserver 管理者 | Resend に `kawaraban.co.jp` を送信ドメインとして追加すると DNS レコード(DKIM の TXT 等)が表示されるので、それを **Xserver の DNS 設定**に追加 | 送信用。MX は変えない。Resend は Return-Path 用に `send.` サブドメインを使う設計のため、Xserver が自動設定済みの `kawaraban.co.jp` の SPF とは通常衝突しない【要確認: 実際に表示されたレコードで判断】 |
| 6 | 開発側 | CRM から `ad@kawaraban.co.jp` 差出人でテスト送信し、DKIM 署名が有効で迷惑メール判定されないことを確認 | |
| 7 | 運用側 | 安定後、Xserver の転送先からメールディーラーの2件を削除 | 本システムへ切り替え完了 |

3 と 5 が Xserver 側の作業。**3 は DNS を触らない**(転送先を1行足すだけ)。5 はレコードの追加のみで既存設定の変更はない。

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
6. **Resend 導入の実行許可** — Marketplace 経由の導入は Vercel チームに Resend アカウント(課金主体)を作る操作になるため、**実行前に許可をいただきたい**。Free プランで開始可(送信 3,000通/月。受信は全プラン利用可だが通数上限は【要確認】)

---

## 10. 決めてある前提(異論がなければこのまま)

- 受信は Webhook プッシュのみ。ポーリングは持たない
- 生 MIME は保存しない。テキスト / HTML / 添付のみ
- ユーザー別の既読は持たない(スレッド単位の既読のみ)
- スレッド判定はヘッダのみ。件名では結合しない
- 会員突合は完全一致のみ。あいまい一致はしない
