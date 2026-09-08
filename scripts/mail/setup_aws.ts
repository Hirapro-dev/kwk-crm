/**
 * SES 受信基盤の一括構築スクリプト(CLAUDE.md §5.15)
 *
 * AWS の認証情報を持つ人が手元で実行する(秘密情報をチャットや設定画面に貼らずに済む)。
 * 冪等: 既にあるものは再利用し、何度実行しても同じ状態になる。
 *
 * 使い方:
 *   MAIL_AWS_REGION=ap-northeast-1 \
 *   MAIL_AWS_ACCESS_KEY_ID=... MAIL_AWS_SECRET_ACCESS_KEY=... \
 *   npx tsx scripts/mail/setup_aws.ts \
 *     --bucket kwk-crm-mail-inbound \
 *     --inbound inbox@crm-mail.kawaraban.co.jp \
 *     --endpoint https://crm.hirapro.com/api/mail/inbound \
 *     [--subscribe] [--dry-run]
 *
 * 作るもの:
 *   1. S3 バケット(公開ブロック / SES からの書込ポリシー / 30日で自動削除)
 *   2. SNS トピック(SES からの Publish を許可)
 *   3. SES 受信ルールセット + ルール(宛先 = 受信用アドレス → スパム・ウイルス判定 → S3 に保存 → SNS 通知)+ 有効化
 *   4. --subscribe を付けたとき: SNS トピックに Webhook(HTTPS)を購読登録
 *      ※ Webhook 側で MAIL_SNS_TOPIC_ARN が設定済みでないと購読確認を拒否するため、
 *        先に 1〜3 を実行して出力された環境変数を Vercel に設定し、再デプロイしてから --subscribe を付けて再実行する
 *
 * 実行に必要な IAM 権限: s3:*(対象バケット) / sns:*(対象トピック) / ses:*ReceiptRule* / sts:GetCallerIdentity
 * Webhook 用の IAM ユーザーには s3:GetObject(対象バケット)と ses:SendEmail だけを付ける(別ユーザー推奨)。
 */

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketPolicyCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CreateReceiptRuleCommand,
  CreateReceiptRuleSetCommand,
  DescribeReceiptRuleSetCommand,
  SESClient,
  SetActiveReceiptRuleSetCommand,
} from '@aws-sdk/client-ses';
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SetTopicAttributesCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

const RULE_SET_NAME = 'kwk-crm-mail';
const RULE_NAME = 'kwk-crm-inbound';
const TOPIC_NAME = 'kwk-crm-mail';
const OBJECT_KEY_PREFIX = 'inbound/';
const RETENTION_DAYS = 30;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const region = process.env.MAIL_AWS_REGION ?? 'ap-northeast-1';
  const accessKeyId = process.env.MAIL_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MAIL_AWS_SECRET_ACCESS_KEY;
  const bucket = arg('bucket');
  const inbound = arg('inbound')?.toLowerCase();
  const endpoint = arg('endpoint');
  const dryRun = flag('dry-run');
  const doSubscribe = flag('subscribe');

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'MAIL_AWS_ACCESS_KEY_ID / MAIL_AWS_SECRET_ACCESS_KEY を環境変数で指定してください',
    );
  }
  if (!bucket || !inbound || !endpoint) {
    throw new Error('--bucket / --inbound / --endpoint は必須です');
  }
  if (!/^[a-z0-9.-]{3,63}$/.test(bucket)) {
    throw new Error('--bucket は小文字英数字・ハイフン・ドットのみ(3〜63文字)');
  }
  if (!endpoint.startsWith('https://')) {
    throw new Error('--endpoint は https:// で始まる必要があります');
  }

  const credentials = { accessKeyId, secretAccessKey };
  const sts = new STSClient({ region, credentials });
  const s3 = new S3Client({ region, credentials });
  const sns = new SNSClient({ region, credentials });
  const ses = new SESClient({ region, credentials });

  const { Account: accountId } = await sts.send(new GetCallerIdentityCommand({}));
  if (!accountId) throw new Error('AWS アカウント ID を取得できませんでした');
  console.log(`アカウント: ${accountId} / リージョン: ${region}${dryRun ? ' (dry-run)' : ''}`);

  // ---------------------------------------------------------------- 1. S3
  let bucketExists = true;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    bucketExists = false;
  }
  console.log(`[S3] バケット ${bucket}: ${bucketExists ? '既存を再利用' : '作成'}`);
  if (!dryRun) {
    if (!bucketExists) {
      await s3.send(
        new CreateBucketCommand({
          Bucket: bucket,
          // us-east-1 以外は LocationConstraint が必須
          ...(region === 'us-east-1'
            ? {}
            : { CreateBucketConfiguration: { LocationConstraint: region as never } }),
        }),
      );
    }
    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucket,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    );
    // SES(受信ルール)からの書込だけを許可
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowSESPuts',
              Effect: 'Allow',
              Principal: { Service: 'ses.amazonaws.com' },
              Action: 's3:PutObject',
              Resource: `arn:aws:s3:::${bucket}/*`,
              Condition: {
                StringEquals: { 'AWS:SourceAccount': accountId },
                StringLike: {
                  'AWS:SourceArn': `arn:aws:ses:${region}:${accountId}:receipt-rule-set/*`,
                },
              },
            },
          ],
        }),
      }),
    );
    // 生 MIME は CRM 取り込み後は不要。30日で自動削除(CRM が正本)
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: 'expire-inbound',
              Status: 'Enabled',
              Filter: { Prefix: OBJECT_KEY_PREFIX },
              Expiration: { Days: RETENTION_DAYS },
            },
          ],
        },
      }),
    );
  }

  // ---------------------------------------------------------------- 2. SNS
  let topicArn = `arn:aws:sns:${region}:${accountId}:${TOPIC_NAME}`;
  if (!dryRun) {
    const t = await sns.send(new CreateTopicCommand({ Name: TOPIC_NAME })); // 冪等
    topicArn = t.TopicArn ?? topicArn;
    // SES からの Publish を許可
    await sns.send(
      new SetTopicAttributesCommand({
        TopicArn: topicArn,
        AttributeName: 'Policy',
        AttributeValue: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowSESPublish',
              Effect: 'Allow',
              Principal: { Service: 'ses.amazonaws.com' },
              Action: 'sns:Publish',
              Resource: topicArn,
              Condition: { StringEquals: { 'AWS:SourceAccount': accountId } },
            },
          ],
        }),
      }),
    );
  }
  console.log(`[SNS] トピック: ${topicArn}`);

  // ---------------------------------------------------------------- 3. SES 受信ルール
  let ruleSetExists = false;
  let ruleExists = false;
  try {
    const rs = await ses.send(new DescribeReceiptRuleSetCommand({ RuleSetName: RULE_SET_NAME }));
    ruleSetExists = true;
    ruleExists = (rs.Rules ?? []).some((r) => r.Name === RULE_NAME);
  } catch {
    ruleSetExists = false;
  }
  console.log(
    `[SES] ルールセット ${RULE_SET_NAME}: ${ruleSetExists ? '既存' : '作成'} / ルール ${RULE_NAME}: ${ruleExists ? '既存(変更しない)' : '作成'}`,
  );
  if (!dryRun) {
    if (!ruleSetExists) {
      await ses.send(new CreateReceiptRuleSetCommand({ RuleSetName: RULE_SET_NAME }));
    }
    if (!ruleExists) {
      await ses.send(
        new CreateReceiptRuleCommand({
          RuleSetName: RULE_SET_NAME,
          Rule: {
            Name: RULE_NAME,
            Enabled: true,
            ScanEnabled: true, // スパム・ウイルス判定(spamVerdict / virusVerdict)
            TlsPolicy: 'Optional',
            Recipients: [inbound],
            // S3 に保存し、その完了通知を同じアクションから SNS へ出す(通知に bucketName / objectKey が入る)
            Actions: [
              {
                S3Action: {
                  BucketName: bucket,
                  ObjectKeyPrefix: OBJECT_KEY_PREFIX,
                  TopicArn: topicArn,
                },
              },
            ],
          },
        }),
      );
    }
    await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: RULE_SET_NAME }));
  }

  // ---------------------------------------------------------------- 4. Webhook の購読(任意)
  if (doSubscribe && !dryRun) {
    const subs = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }));
    const already = (subs.Subscriptions ?? []).find((s) => s.Endpoint === endpoint);
    if (already) {
      console.log(`[SNS] 購読: 既存 (${already.SubscriptionArn})`);
    } else {
      const r = await sns.send(
        new SubscribeCommand({
          TopicArn: topicArn,
          Protocol: 'https',
          Endpoint: endpoint,
          // 通知本文を生の JSON で送る(SNS の封筒のまま)。Webhook は封筒の署名を検証する
          Attributes: {
            DeliveryPolicy: JSON.stringify({
              healthyRetryPolicy: { numRetries: 5, minDelayTarget: 20, maxDelayTarget: 600 },
            }),
          },
        }),
      );
      console.log(
        `[SNS] 購読を登録: ${r.SubscriptionArn ?? '(確認待ち)'} — Webhook が自動で確認します`,
      );
    }
  }

  // ---------------------------------------------------------------- 出力
  const inboundDomain = inbound.split('@')[1];
  console.log('\n===== Vercel に設定する環境変数(Production / Preview) =====');
  console.log(`MAIL_AWS_REGION=${region}`);
  console.log('MAIL_AWS_ACCESS_KEY_ID=<Webhook 用 IAM ユーザーのキー>');
  console.log('MAIL_AWS_SECRET_ACCESS_KEY=<同シークレット>');
  console.log(`MAIL_INBOUND_BUCKET=${bucket}`);
  console.log(`MAIL_SNS_TOPIC_ARN=${topicArn}`);
  console.log(`MAIL_INBOUND_ADDRESS=${inbound}`);
  console.log('\n===== DNS(受信用サブドメイン。既存の MX には触らない) =====');
  console.log(`${inboundDomain}.  MX  10  inbound-smtp.${region}.amazonaws.com.`);
  console.log('\n===== 次の手順 =====');
  console.log('1. 上の環境変数を Vercel に設定して再デプロイ');
  console.log(`2. 本スクリプトを --subscribe 付きで再実行(Webhook が購読確認を自動で行う)`);
  console.log(`3. 各サーバーの転送先に ${inbound} を追加`);
  console.log(`4. ${inbound} 宛にテストメールを送り、/mail に表示されることを確認`);
}

main().catch((e) => {
  console.error('失敗:', e instanceof Error ? e.message : e);
  process.exit(1);
});
