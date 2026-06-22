/**
 * Google Drive 取得層 (サービスアカウント方式 / CLAUDE.md §5.10c)
 *
 * 外部依存を増やさないため、Node 標準 crypto で JWT(RS256) を署名し、
 * OAuth2 トークンエンドポイントでアクセストークンに交換 → Drive API でファイル取得する。
 *
 * 設定: 環境変数 GOOGLE_SERVICE_ACCOUNT_JSON にサービスアカウントキー(JSON文字列)を入れ、
 *       取込対象のファイル/フォルダを そのSAのメールアドレスに「閲覧者」で共有する。
 *
 * サーバー専用(Server Action / Route からのみ呼ぶこと)。
 */

import crypto from 'node:crypto';

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!j.client_email || !j.private_key) return null;
    // 環境変数に \n がエスケープされて入っている場合に実改行へ戻す
    return {
      client_email: j.client_email,
      private_key: j.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

/** Service Account が設定済みか */
export function isDriveConfigured(): boolean {
  return loadServiceAccount() !== null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64url(signer.sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google 認証に失敗しました (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('アクセストークンを取得できませんでした');
  return data.access_token;
}

/**
 * Drive URL または生のファイルIDから、ファイルIDを抽出する。
 *   - https://drive.google.com/file/d/<ID>/view
 *   - https://drive.google.com/open?id=<ID>
 *   - https://docs.google.com/spreadsheets/d/<ID>/edit
 *   - <ID> (そのまま)
 */
export function extractDriveFileId(input: string): string {
  const s = input.trim();
  const byPath = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (byPath) return byPath[1]!;
  const byQuery = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (byQuery) return byQuery[1]!;
  return s;
}

/**
 * 指定ファイルの中身を CSV テキストとして取得する。
 * Google スプレッドシートは CSV エクスポート、通常ファイルは media 取得。
 */
export async function fetchDriveFileCsv(fileIdOrUrl: string): Promise<string> {
  const sa = loadServiceAccount();
  if (!sa) {
    throw new Error(
      'Google サービスアカウントが未設定です (環境変数 GOOGLE_SERVICE_ACCOUNT_JSON)',
    );
  }
  const fileId = extractDriveFileId(fileIdOrUrl);
  const token = await getAccessToken(sa);

  // メタ情報で mimeType を判定
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=mimeType,name&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) {
    throw new Error(
      `ファイル情報の取得に失敗しました (${metaRes.status})。ファイルがSAに共有されているか確認してください。`,
    );
  }
  const meta = (await metaRes.json()) as { mimeType?: string };

  const url =
    meta.mimeType === 'application/vnd.google-apps.spreadsheet'
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv&supportsAllDrives=true`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`ファイルのダウンロードに失敗しました (${res.status})`);
  }
  return res.text();
}
