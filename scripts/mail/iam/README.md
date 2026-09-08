# メール一元管理用 IAM ユーザー(CLAUDE.md §5.15)

AWS コンソール > IAM > ユーザー > 「ユーザーを作成」で2つ作り、それぞれ下のポリシー JSON を
「インラインポリシー」として貼り付ける。コンソールへのアクセス権は不要(アクセスキーのみ)。

| ユーザー名(例) | ポリシー | 用途 | キーの置き場所 |
|---|---|---|---|
| `kwk-crm-mail-setup` | `setup-user-policy.json` | `scripts/mail/setup_aws.ts` の実行(S3 / SNS / SES 受信ルール等の**作成**) | 実行する人の手元のみ。Vercel には置かない |
| `kwk-crm-mail-webhook` | `webhook-user-policy.json` | 本番の Webhook(受信 MIME の読取)と送信(`ses:SendEmail`) | Vercel の環境変数 `MAIL_AWS_ACCESS_KEY_ID` / `MAIL_AWS_SECRET_ACCESS_KEY` |

- バケット名(`kwk-crm-mail-inbound`)やリージョン(`ap-northeast-1`)を変える場合は JSON 内の ARN も合わせて変更する。
- `setup` ユーザーのキーは構築が終わったら削除してよい(再実行が必要になったら作り直す)。
- `webhook` ユーザーはバケットの `inbound/` 配下の読取と送信だけ。受信ルールや他のバケットには触れない。

## 実行手順(setup ユーザーのキーで)

```bash
# 1) 内容確認(何も作らない)
MAIL_AWS_REGION=ap-northeast-1 \
MAIL_AWS_ACCESS_KEY_ID=<setup のキー> MAIL_AWS_SECRET_ACCESS_KEY=<setup のシークレット> \
npx tsx scripts/mail/setup_aws.ts \
  --bucket kwk-crm-mail-inbound \
  --inbound inbox@crm-mail.kawaraban.co.jp \
  --endpoint https://crm.hirapro.com/api/mail/inbound \
  --dry-run

# 2) 作成(--dry-run を外す)。出力される MAIL_* を Vercel(Production / Preview)に設定して再デプロイ
#    ※ MAIL_AWS_ACCESS_KEY_ID / SECRET は webhook ユーザーのキーに差し替える

# 3) Vercel 再デプロイ後、購読を登録(Webhook が署名検証のうえ自動で確認する)
#    上と同じコマンドに --subscribe を付けて再実行
```

出力される MX レコード(受信用サブドメイン)を Xserver の DNS 設定に追加する。
`kawaraban.co.jp` 本体の MX・SPF は変更しない。
