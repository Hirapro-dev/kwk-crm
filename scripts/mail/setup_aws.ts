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
 *     --bucket hirapro-crm-mail-inbound \
 *     --inbound inbox@mail.crm.hirapro.com \
 *     --endpoint https://crm.hirapro.com/api/mail/inbound \
 *     [--subscribe] [--domain kawaraban.co.jp ...] [--dry-run]
 *
 * 作るもの:
 *   1. S3 バケット(公開ブロック / SES からの書込ポリシー / 30日で自動削除)
 *   2. SNS トピック(SES からの Publish を許可)
 *   3. SES 受信ルールセット + ルール(宛先 = 受信用アドレス → スパム・ウイルス判定 → S3 に保存 → SNS 通知)+ 有効化
 *   4. SES 設定セット hirapro-crm-mail(送信の Send/Delivery/Bounce/Complaint/Reject を同じ SNS トピックへ)
 *   5. --domain を付けたとき: 送信ドメインを SES に ID 登録し、DNS に追加する DKIM の CNAME 3本を表示
 *      (複数指定可。Tier 1 のドメインから順に)
 *   6. --subscribe を付けたとき: SNS トピックに Webhook(HTTPS)を購読登録
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
  DescribeActiveReceiptRuleSetCommand,
  DescribeReceiptRuleSetCommand,
  SESClient,
  SetActiveReceiptRuleSetCommand,
} from '@aws-sdk/client-ses';
import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  CreateEmailIdentityCommand,
  GetConfigurationSetCommand,
  GetEmailIdentityCommand,
  SESv2Client,
} from '@aws-sdk/client-sesv2';
import {
  CreateTopicCommand,
  ListSubscriptionsByTopicCommand,
  SNSClient,
  SetTopicAttributesCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';

const RULE_SET_NAME = 'hirapro-crm-mail';
const RULE_NAME = 'hirapro-crm-inbound';
const TOPIC_NAME = 'hirapro-crm-mail';
const OBJECT_KEY_PREFIX = 'inbound/';
const CONFIGURATION_SET = 'hirapro-crm-mail';
const RETENTION_DAYS = 30;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
/** 同じオプションが複数回指定された値をすべて返す(--domain a --domain b) */
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((v, i) => {
    if (v === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1] as string);
  });
  return out;
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
  const domains = args('domain').map((d) => d.trim().toLowerCase());

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
  const sesv2 = new SESv2Client({ region, credentials });

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
  // SES の受信ルールセットはリージョンに1つしか「有効」にできない。
  // 既に別システムのルールセットが有効なら、それを無効化せず、その中に CRM のルールを追加する。
  // 有効なものが無ければ CRM 用のルールセットを作って有効化する。
  let targetRuleSet = RULE_SET_NAME;
  let activateNeeded = true;
  try {
    const active = await ses.send(new DescribeActiveReceiptRuleSetCommand({}));
    const activeName = active.Metadata?.Name;
    if (activeName) {
      targetRuleSet = activeName;
      activateNeeded = false;
      console.log(
        `[SES] 有効な受信ルールセット「${activeName}」が既にあるため、そこに CRM のルールを追加します(既存ルールは変更しない)`,
      );
    }
  } catch {
    /* 有効なルールセットなし */
  }
  let ruleSetExists = false;
  let ruleExists = false;
  try {
    const rs = await ses.send(new DescribeReceiptRuleSetCommand({ RuleSetName: targetRuleSet }));
    ruleSetExists = true;
    ruleExists = (rs.Rules ?? []).some((r) => r.Name === RULE_NAME);
  } catch {
    ruleSetExists = false;
  }
  console.log(
    `[SES] ルールセット ${targetRuleSet}: ${ruleSetExists ? '既存' : '作成'} / ルール ${RULE_NAME}: ${ruleExists ? '既存(変更しない)' : '作成'}`,
  );
  if (!dryRun) {
    if (!ruleSetExists) {
      await ses.send(new CreateReceiptRuleSetCommand({ RuleSetName: targetRuleSet }));
    }
    if (!ruleExists) {
      await ses.send(
        new CreateReceiptRuleCommand({
          RuleSetName: targetRuleSet,
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
    if (activateNeeded) {
      await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: targetRuleSet }));
    }
  }

  // ---------------------------------------------------------------- 4. SES 設定セット(送信の配信状態 → SNS)
  let csExists = false;
  try {
    await sesv2.send(new GetConfigurationSetCommand({ ConfigurationSetName: CONFIGURATION_SET }));
    csExists = true;
  } catch {
    csExists = false;
  }
  console.log(`[SES] 設定セット ${CONFIGURATION_SET}: ${csExists ? '既存' : '作成'}`);
  if (!dryRun && !csExists) {
    await sesv2.send(
      new CreateConfigurationSetCommand({ ConfigurationSetName: CONFIGURATION_SET }),
    );
    await sesv2.send(
      new CreateConfigurationSetEventDestinationCommand({
        ConfigurationSetName: CONFIGURATION_SET,
        EventDestinationName: 'sns-webhook',
        EventDestination: {
          Enabled: true,
          MatchingEventTypes: [
            'SEND',
            'DELIVERY',
            'BOUNCE',
            'COMPLAINT',
            'REJECT',
            'RENDERING_FAILURE',
          ],
          SnsDestination: { TopicArn: topicArn },
        },
      }),
    );
  }

  // ---------------------------------------------------------------- 5. 送信ドメインの ID 登録(任意)
  const dkimLines: string[] = [];
  for (const domain of domains) {
    let tokens: string[] = [];
    let verified = false;
    try {
      const r = await sesv2.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      tokens = r.DkimAttributes?.Tokens ?? [];
      verified = r.VerifiedForSendingStatus === true;
      console.log(`[SES] ドメイン ${domain}: 登録済み(送信可=${verified ? 'はい' : 'まだ'})`);
    } catch {
      console.log(`[SES] ドメイン ${domain}: ${dryRun ? '登録(dry-run)' : '登録'}`);
      if (!dryRun) {
        const r = await sesv2.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }));
        tokens = r.DkimAttributes?.Tokens ?? [];
      }
    }
    for (const t of tokens) {
      dkimLines.push(`${t}._domainkey.${domain}.  CNAME  ${t}.dkim.amazonses.com.`);
    }
  }

  // ---------------------------------------------------------------- 6. Webhook の購読(任意)
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
  console.log(`MAIL_SES_CONFIGURATION_SET=${CONFIGURATION_SET}`);
  console.log('\n===== DNS(受信用サブドメイン。既存の MX には触らない) =====');
  console.log(`${inboundDomain}.  MX  10  inbound-smtp.${region}.amazonaws.com.`);
  if (dkimLines.length > 0) {
    console.log(
      '\n===== DNS(送信ドメインの DKIM。各ドメインの DNS に CNAME を追加。既存の SPF/MX は変えない) =====',
    );
    for (const l of dkimLines) console.log(l);
  }
  console.log('\n===== 次の手順 =====');
  console.log('1. 上の環境変数を Vercel に設定して再デプロイ');
  console.log('2. 本スクリプトを --subscribe 付きで再実行(Webhook が購読確認を自動で行う)');
  console.log(`3. 各サーバーの転送先に ${inbound} を追加`);
  console.log(`4. ${inbound} 宛にテストメールを送り、/mail に表示されることを確認`);
  console.log(
    '5. 送信: --domain で Tier 1 ドメインを登録 → DKIM CNAME を DNS に追加 → SES の検証完了後に返信可',
  );
  console.log(
    '6. 本番送信にはサンドボックス解除の申請(SES コンソール > Account dashboard > Request production access)',
  );
}

main().catch((e) => {
  console.error('失敗:', e instanceof Error ? e.message : e);
  process.exit(1);
});
