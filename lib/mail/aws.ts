/**
 * メール一元管理で使う AWS クライアント(CLAUDE.md §5.15 / §13)。
 *
 * Vercel では AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY が予約名のため、
 * MAIL_ 接頭辞の環境変数から読み、SDK クライアントに明示的に渡す。
 * サーバー専用(認証情報をクライアントに出さない §12.4)。
 */

import { S3Client } from '@aws-sdk/client-s3';
import { SESv2Client } from '@aws-sdk/client-sesv2';

export interface MailAwsConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  inboundBucket: string;
  snsTopicArn: string;
  inboundAddress: string;
}

/** 必要な環境変数が揃っていれば設定を返す。1つでも欠けていれば null(呼び出し側で 503 等にする) */
export function getMailAwsConfig(): MailAwsConfig | null {
  const region = process.env.MAIL_AWS_REGION;
  const accessKeyId = process.env.MAIL_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MAIL_AWS_SECRET_ACCESS_KEY;
  const inboundBucket = process.env.MAIL_INBOUND_BUCKET;
  const snsTopicArn = process.env.MAIL_SNS_TOPIC_ARN;
  const inboundAddress = process.env.MAIL_INBOUND_ADDRESS;
  if (
    !region ||
    !accessKeyId ||
    !secretAccessKey ||
    !inboundBucket ||
    !snsTopicArn ||
    !inboundAddress
  ) {
    return null;
  }
  return { region, accessKeyId, secretAccessKey, inboundBucket, snsTopicArn, inboundAddress };
}

export function createS3Client(cfg: MailAwsConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

export function createSesClient(cfg: MailAwsConfig): SESv2Client {
  return new SESv2Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}
