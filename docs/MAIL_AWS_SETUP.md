# メール一元管理 — AWS 構築手順(ステップバイステップ)

> 対象: CLAUDE.md §5.15 / 設計: docs/MAIL_DESIGN.md / 最終更新: 2026-09-08
> 所要時間の目安: Step 1〜6 で 1〜2 時間(DNS の反映待ちを除く)。Step 7 は SES の承認待ちが 1〜2 日。

前提として決まっていること:

| 項目 | 値 |
|---|---|
| リージョン | **東京 `ap-northeast-1`**(コンソール右上で必ず切り替える) |
| 受信用サブドメイン / アドレス | **`mail.crm.hirapro.com`** / **`inbox@mail.crm.hirapro.com`**(DNS は Xserver の `hirapro.com`) |
| S3 バケット名 | `kwk-crm-mail-inbound` |
| SNS トピック / SES 設定セット | `kwk-crm-mail` |
| Webhook URL | `https://crm.hirapro.com/api/mail/inbound` |
| 送信を先に有効化するドメイン(Tier 1) | CSV で〇の 17 ドメイン(Step 7 に一覧) |

---

## Step 1. IAM ユーザーを2つ作る(AWS コンソール)

秘密情報をチャットや画面に貼らずに済むよう、**構築用**と **Webhook 用**を分けます。

1. AWS コンソールにログイン → 検索窓に `IAM` → **IAM** を開く(IAM はリージョン非依存)
2. 左メニュー **ユーザー** → **ユーザーの作成**
3. ユーザー名 `kwk-crm-mail-setup` → 「AWS マネジメントコンソールへのユーザーアクセスを提供する」は**チェックしない** → 次へ
4. 許可の設定は何も付けずに **次へ** → **ユーザーの作成**
5. 作成したユーザーを開く → **許可** タブ → **許可を追加 ▾** → **インラインポリシーを作成**
6. **JSON** タブに切り替え、リポジトリの `scripts/mail/iam/setup-user-policy.json` の内容を貼り付け → 次へ → ポリシー名 `kwk-crm-mail-setup` → **ポリシーの作成**
7. **セキュリティ認証情報** タブ → **アクセスキーを作成** → ユースケース「**コマンドラインインターフェイス (CLI)**」→ 確認のチェック → 次へ → 作成
8. 表示された **アクセスキー** と **シークレットアクセスキー** を保存(シークレットはこの画面でしか見られない。閉じたら作り直し)
9. 同じ手順で `kwk-crm-mail-webhook` を作成。ポリシーは `scripts/mail/iam/webhook-user-policy.json`、アクセスキーも同様に作成

> ポリシー内のバケット名(`kwk-crm-mail-inbound`)やリージョンを変える場合は JSON 内の ARN も直す。

---

## Step 2. 構築スクリプトで S3 / SNS / SES 受信ルールを作る(手元の PC)

リポジトリの最新 `main`(PR #18 マージ後)で、**Step 1 の setup ユーザーのキー**を使って実行します。

```bash
cd <リポジトリ>
git checkout main && git pull

# 2-1) 内容確認(何も作らない)
MAIL_AWS_REGION=ap-northeast-1 \
MAIL_AWS_ACCESS_KEY_ID=<setup のアクセスキー> \
MAIL_AWS_SECRET_ACCESS_KEY=<setup のシークレット> \
npx tsx scripts/mail/setup_aws.ts \
  --bucket kwk-crm-mail-inbound \
  --inbound inbox@mail.crm.hirapro.com \
  --endpoint https://crm.hirapro.com/api/mail/inbound \
  --domain mail.crm.hirapro.com \
  --dry-run
```

`アカウント: 1234…` に続いて `[S3] 作成` `[SNS] トピック` `[SES] ルールセット 作成` と表示されれば OK。

```bash
# 2-2) 本実行(--dry-run を外すだけ)
MAIL_AWS_REGION=ap-northeast-1 \
MAIL_AWS_ACCESS_KEY_ID=<setup のアクセスキー> \
MAIL_AWS_SECRET_ACCESS_KEY=<setup のシークレット> \
npx tsx scripts/mail/setup_aws.ts \
  --bucket kwk-crm-mail-inbound \
  --inbound inbox@mail.crm.hirapro.com \
  --endpoint https://crm.hirapro.com/api/mail/inbound \
  --domain mail.crm.hirapro.com
```

最後に次の3ブロックが表示されます。**このターミナル出力は Step 3〜5 で使うので残しておく**。

- `===== Vercel に設定する環境変数 =====`(`MAIL_*` 7行)
- `===== DNS(受信用サブドメイン) =====`(MX レコード 1行)
- `===== DNS(送信ドメインの DKIM) =====`(`mail.crm.hirapro.com` の CNAME 3行)

> `--domain mail.crm.hirapro.com` を付けるのは、SES が受信ドメインを「検証済み ID」として要求するため。
> 何度実行しても同じ結果になる(冪等)ので、失敗したら原因を直して再実行してよい。

---

## Step 3. Vercel に環境変数を設定して再デプロイ

1. https://vercel.com → チーム `hirapro-devs-projects` → プロジェクト **kwk-crm** → **Settings** → **Environment Variables**
2. Step 2 の出力の 7 行を1つずつ追加。**Environment は Production と Preview の両方にチェック**

| Key | Value |
|---|---|
| `MAIL_AWS_REGION` | `ap-northeast-1` |
| `MAIL_AWS_ACCESS_KEY_ID` | **Step 1 の webhook ユーザー**のアクセスキー(setup のキーは入れない) |
| `MAIL_AWS_SECRET_ACCESS_KEY` | 同シークレット |
| `MAIL_INBOUND_BUCKET` | `kwk-crm-mail-inbound` |
| `MAIL_SNS_TOPIC_ARN` | 出力の `arn:aws:sns:ap-northeast-1:<アカウントID>:kwk-crm-mail` |
| `MAIL_INBOUND_ADDRESS` | `inbox@mail.crm.hirapro.com` |
| `MAIL_SES_CONFIGURATION_SET` | `kwk-crm-mail` |

3. **Deployments** → 最新の Production デプロイの **…** → **Redeploy**(環境変数は再デプロイで反映される)
4. 反映確認: `https://crm.hirapro.com/api/mail/inbound` に GET でアクセス → `405` なら OK(POST 専用のため)。**503** が出る場合は環境変数のどれかが欠けている

---

## Step 4. SNS の購読を登録(Webhook が自動で承認)

Step 3 の再デプロイが終わってから、**Step 2 と同じコマンドに `--subscribe` を足して再実行**します。

```bash
MAIL_AWS_REGION=ap-northeast-1 \
MAIL_AWS_ACCESS_KEY_ID=<setup のアクセスキー> \
MAIL_AWS_SECRET_ACCESS_KEY=<setup のシークレット> \
npx tsx scripts/mail/setup_aws.ts \
  --bucket kwk-crm-mail-inbound \
  --inbound inbox@mail.crm.hirapro.com \
  --endpoint https://crm.hirapro.com/api/mail/inbound \
  --subscribe
```

確認: AWS コンソール → **Amazon SNS** → **サブスクリプション** → エンドポイントが `https://crm.hirapro.com/api/mail/inbound` の行の **ステータスが「確認済み」**になっていること。

| ステータスが「保留中の確認」のまま | 原因 |
|---|---|
| Webhook が 503 を返した | Step 3 の環境変数が欠けている / 再デプロイ前に実行した |
| Webhook が 403 を返した | `MAIL_SNS_TOPIC_ARN` が出力と違う |
| 数分待っても変わらない | SNS コンソールでそのサブスクリプションを選び **確認をリクエスト** で再送 |

---

## Step 5. DNS を追加(Xserver: hirapro.com)

Xserver サーバーパネル → **DNSレコード設定** → ドメイン `hirapro.com` を選択 → **DNSレコード追加** タブ。Step 2 の出力どおりに **4 レコード**追加します。

| ホスト名 | 種別 | 内容 | 優先度 |
|---|---|---|---|
| `mail.crm` | **MX** | `inbound-smtp.ap-northeast-1.amazonaws.com` | `10` |
| `<token1>._domainkey.mail.crm` | CNAME | `<token1>.dkim.amazonses.com` | — |
| `<token2>._domainkey.mail.crm` | CNAME | `<token2>.dkim.amazonses.com` | — |
| `<token3>._domainkey.mail.crm` | CNAME | `<token3>.dkim.amazonses.com` | — |

- ホスト名は **`hirapro.com` を除いた部分**を入力する(Xserver の画面は末尾に `.hirapro.com` が自動で付く)
- `<tokenN>` は Step 2 の出力の英数字の文字列(3つとも異なる)
- `hirapro.com` 本体の MX / SPF / 既存レコードは**触らない**

反映確認(10 分〜数時間。手元のターミナルで):

```bash
dig +short MX mail.crm.hirapro.com
# → 10 inbound-smtp.ap-northeast-1.amazonaws.com. と出れば OK
```

SES 側の確認: コンソール → **Amazon SES** → **ID** → `mail.crm.hirapro.com` の **ID ステータスが「検証済み」**(DKIM の反映後、最長 72 時間だが通常は数十分)。

---

## Step 6. 転送を1件追加して受信テスト

1. Xserver サーバーパネル → **メールアカウント設定** → `kawaraban.co.jp` → `ad@kawaraban.co.jp` の **転送** → 転送先アドレスに `inbox@mail.crm.hirapro.com` を追加 → **追加する**。「メールボックスに残すかどうか」は **残す** のまま。メールディーラー宛の2件はそのまま(併用)
2. 自分の Gmail 等から `ad@kawaraban.co.jp` に件名「CRM受信テスト」でメールを送る
3. 1〜2 分後に **https://crm.hirapro.com/mail** を開き、受信箱に表示されることを確認
4. 表示された場合: 差出人・件名・本文・添付・(会員のアドレスなら)会員紐付けが正しいかを確認

| 表示されない場合の切り分け | 見る場所 |
|---|---|
| S3 にファイルが無い | AWS → S3 → `kwk-crm-mail-inbound` → `inbound/` に新しいオブジェクトがあるか。無ければ MX 未反映 or 転送設定の不備 |
| S3 にはあるが CRM に出ない | Vercel → kwk-crm → **Logs** で `/api/mail/inbound` の応答。`ignored: no matching mail box…` なら CRM の `mail_boxes` に宛先アドレスが未登録 |
| 「迷惑メール」等に分類された | 受信箱の「分類」を「すべて」にして探す(削除はされない) |

受信が確認できたら、他の共有アドレスにも同じ転送先を追加していく(CRM 側は `mail_boxes` に同じアドレスを登録)。

---

## Step 7. 送信の準備(Tier 1 ドメインの DKIM + サンドボックス解除)

### 7-1. 送信ドメインを SES に登録(Tier 1 の 17 ドメイン)

> **2026-09-08 確認**: 東京リージョンの SES に、Tier 1 のうち **4 ドメインが既に検証済み(DKIM 設定済み)**でした:
> `mrt.co.jp` / `kawaraban.co.jp` / `sc-project-partners.co.jp` / `biovault.jp`。
> この4つは **7-2 の DNS 作業が不要**です(コマンドには含めても実害なし。「登録済み(送信可=はい)」と表示されるだけ)。
> 残り **13 ドメイン**だけ DKIM の CNAME 追加が必要です。

CSV で〇の 17 ドメインを一括登録し、各ドメインに追加する DKIM の CNAME を出力します。

```bash
MAIL_AWS_REGION=ap-northeast-1 \
MAIL_AWS_ACCESS_KEY_ID=<setup のアクセスキー> \
MAIL_AWS_SECRET_ACCESS_KEY=<setup のシークレット> \
npx tsx scripts/mail/setup_aws.ts \
  --bucket kwk-crm-mail-inbound \
  --inbound inbox@mail.crm.hirapro.com \
  --endpoint https://crm.hirapro.com/api/mail/inbound \
  --domain toushi-kawaraban.com \
  --domain kawaraban.co.jp \
  --domain asec-project-partners.jp \
  --domain sir-project-partners.co.jp \
  --domain global-project-partners.co.jp \
  --domain otosen-project-partners.com \
  --domain hirayama-toshihiro.co.jp \
  --domain gpp-sg-payment.co.jp \
  --domain sc-project-partners.co.jp \
  --domain hirapro.com \
  --domain scpp.jp \
  --domain toushi-no-kawaraban.com \
  --domain mrt.co.jp \
  --domain biovault.co.jp \
  --domain biovault.jp \
  --domain gpp-singapore.com \
  --domain carbon-market.com
```

### 7-2. 各ドメインの DNS に DKIM の CNAME を 3 本ずつ追加

出力された `===== DNS(送信ドメインの DKIM) =====` の行を、ドメインごとにその DNS へ追加します。**既存の SPF / MX / メールディーラー用の設定は触らない**(DKIM の CNAME は別名で追加するだけ)。

| DNS の管理場所 | ドメイン | 追加方法 |
|---|---|---|
| Xserver(14) | 上記のうち `biovault.jp` `gpp-singapore.com` `carbon-market.com` 以外 | Step 5 と同じ画面で、ドメインを切り替えて CNAME を追加 |
| ムームードメイン | `biovault.jp` | ムームー DNS のカスタム設定で CNAME |
| Z.com | `gpp-singapore.com` | Z.com の DNS 設定で CNAME |
| お名前.com | `carbon-market.com` | お名前.com Navi の DNS レコード設定で CNAME |

SES コンソール → **ID** で各ドメインが「検証済み」になった時点で、CRM 側は自動で「送信可」になります(5 分以内に反映。設定変更は不要)。

### 7-3. サンドボックス解除を申請(本番送信に必須)

> **2026-09-08 確認: このアカウントは東京リージョンで既に本番状態(50,000通/日)のため、この項は不要。** 別アカウント・別リージョンで構築する場合のみ実施する。

SES は初期状態(サンドボックス)では**検証済みアドレスにしか送れず、1日 200 通**です。

1. AWS コンソール → **Amazon SES** → **アカウントダッシュボード** → 「本番アクセスのリクエスト」(Request production access)
2. 入力例:
   - **メールタイプ**: トランザクション(Transactional)
   - **ウェブサイト URL**: `https://crm.hirapro.com`
   - **ユースケースの説明**(英語推奨):
     > We use SES to reply to customer inquiries received at our company mailboxes (e.g. ad@kawaraban.co.jp) from our internal CRM. Volume is under 1,000 emails/month, all one-to-one transactional replies to customers who contacted us first. Bounces and complaints are received via SNS and reflected in the CRM so that invalid addresses are not contacted again. No marketing or bulk sending.
   - **配信停止の処理 / バウンスの処理**: 「SNS 通知を CRM に取り込み、不達アドレスには再送しない」
3. 送信 → 通常 1〜2 営業日で承認メールが届く(追加質問が来たら答える)

### 7-4. 送信テスト

1. PR #18 がマージ・デプロイ済みであることを確認
2. `https://crm.hirapro.com/mail` → Step 6 で受信したスレッドを開く → 下部の返信フォームに本文を入れて **返信を送信**
3. 自分の Gmail 側で受信できること、**同じスレッドにぶら下がる**こと、差出人が `KAWARA版 <ad@kawaraban.co.jp>` になっていること、迷惑メールに入らないことを確認
4. CRM 側でそのメッセージの「配信: delivered」が数十秒〜数分で付くことを確認(付かなければ Step 4 の購読 or 設定セットを確認)

> サンドボックス解除前は、宛先が SES で「検証済み ID」のアドレス(SES → ID → E メールアドレスを作成 で自分のアドレスを登録)なら送れるので、承認待ちの間にテストできます。

---

## 完了後の運用

- 各共有アドレスの転送先に `inbox@mail.crm.hirapro.com` を追加していく。CRM の `mail_boxes` に同じアドレスを登録する(登録が無い宛先は取り込まれず、Vercel のログに `no matching mail box` と出る)
- Tier 1 以外のドメインは受信専用。返信が必要になったら 7-1 / 7-2 と同じ手順でそのドメインだけ追加する
- 安定後、各サーバーの転送先からメールディーラーのアドレスを外す
- setup ユーザーのアクセスキーは、構築が終わったら IAM で無効化してよい
