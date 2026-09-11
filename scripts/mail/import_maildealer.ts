/**
 * メールディーラーの CSV エクスポートを CRM のメール一元管理へ取り込む(過去データ取込。
 * CLAUDE.md §5.15)。
 *
 * 決定事項(2026-09-11 ユーザー確認済み):
 *   1. スレッドの状態(未対応/対応中/完了)は CSV の「メール状態」をそのまま反映する
 *      (lib/domain/mail_maildealer_import.ts の mapMaildealerThreadStatus)。
 *      ただし、対象スレッドの現在の最終メール日時より過去の行では状態・最終メール日時・
 *      最終方向を巻き戻さない(このスクリプトを何度動かしても、既に進んでいる状態を
 *      壊さないようにするため)。
 *   2. 「担当者名」は ASSIGNEE_TOKEN_TO_EMAIL の対応表で users と紐付ける。
 *      一意に決められない担当者名(例: "kowaki" は複数の候補に一致しうる)は
 *      あいまい一致としてあえて割り当てない(§5.15 の会員突合と同じ方針)。
 *      スレッド新規作成時のみ設定し、既存スレッドの担当は上書きしない。
 *   3. 一度きりのスクリプトとして実行する(--dry-run で内容を確認 → 本実行)。
 *
 * 対応していないこと:
 *   - 添付ファイル(このエクスポートに実体が含まれないため)
 *   - 分類１/２/３・ラベル・コメント列(CRM 側に対応する項目が無いため)
 *   - まだ mail_boxes に登録していないアドレス宛のメールは「その他」に入れる
 *     (migration 78。後からそのアドレスを登録すれば自動で正しい受信箱へ移る)
 *
 * 使い方:
 *   npx tsx scripts/mail/import_maildealer.ts --file <CSVパス> --dry-run
 *   npx tsx scripts/mail/import_maildealer.ts --dir <CSVが並ぶディレクトリ> --dry-run
 *   (--dir はディレクトリ直下の *.csv をファイル名の昇順ですべて処理する。
 *    メールディーラーのエクスポートが年/月ごとに複数ファイルへ分かれる場合を想定)
 *
 * 冪等性: message_id(RFC 5322 Message-ID)で重複判定するため、同じファイル・
 * 同じディレクトリを何度実行しても増えない。ファイルごとに、その時点の DB を
 * 見て既に取り込み済み(SES 経由 or 前回実行分)のものは丸ごとスキップするため、
 * 複数ファイルを跨ぐ返信(In-Reply-To が別ファイルの1通を指す等)も、
 * ファイル名の昇順(=時系列の想定)で処理すれば解決できる。
 *
 * 文字コード: エクスポートは Shift-JIS。Node の TextDecoder でデコードしてから
 * 汎用 CSV パーサ(scripts/migrate/lib/csv.ts)に渡す(追加ライブラリ不要)。
 *
 * メモリ: 1ファイルぶんを一度に読み込む(--dir でも同時に持つのは1ファイルぶんだけ)。
 * 大きなファイルでは `NODE_OPTIONS="--max-old-space-size=6144"` を付けて実行すること。
 *
 * 注意: エクスポート中のファイルを読むと内容が壊れる(読込行数が実際より大きく減る)。
 * 対象ディレクトリのファイルサイズがしばらく変化しなくなってから実行すること。
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  classifyInbound,
  ensureMessageId,
  extractReferencedMessageIds,
  matchMailBox,
  normalizeSubject,
  parseAddress,
  parseRawHeaders,
} from '../../lib/domain/mail_inbound';
import {
  looksLikeHtmlBody,
  maildealerAssigneeToken,
  mapMaildealerThreadStatus,
} from '../../lib/domain/mail_maildealer_import';
import { OTHER_MAILBOX_ADDRESS } from '../../lib/domain/mail_types';
import { parseArgs } from '../migrate/lib/args';
import { parseCsvString } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

const CHUNK_SIZE = 500;
// message_id/thread_id の事前照会は RPC(POST body)経由にしたため URL 長の制約は無いが、
// 1回のクエリが大きくなりすぎないよう分割する(migration 80。詳細は下記コメント参照)。
const RPC_LOOKUP_CHUNK_SIZE = 5000;

/**
 * 「担当者名」→ users.email。一意に確定できるものだけ列挙する(あいまいなものは含めない)。
 * 2026-09-11 時点の users テーブルを基に作成。
 *   - "kowaki" は本人(小脇拓哉。takuyakowaki0412@gmail.com)のほか、元スタッフの Gmail
 *     エイリアス(kowaki1111+xxx@gmail.com、いずれも退職済み)や代表窓口アカウント
 *     (kowaki1111@gmail.com、full_name が「代表者／法人 リスト」で個人ではない)が
 *     同じ Gmail アドレス由来で混在しており、どれを指すか一意に決められないため、
 *     あえて対応表に含めない(未紐付けのまま。必要なら手動で紐付け直す)。
 *   - "Nagano" "namimatsu" は該当する CRM ユーザーが見つからなかった(退職者と推測)。
 */
const ASSIGNEE_TOKEN_TO_EMAIL: Record<string, string> = {
  miyamoto: 'miyamoto@sc-project-partners.co.jp',
  kikuchi: 'kikuchi.hirapro@gmail.com',
  tachibana: 'tachibanahirapro@gmail.com',
  hayakawa: 'hayakawa.hirapro@gmail.com',
};

interface MailBoxRow {
  id: number;
  address: string;
  is_active: boolean;
}

interface PreparedRow {
  mailKind: string;
  direction: 'in' | 'out';
  headers: Record<string, string>;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  refIds: string[];
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subjectRaw: string;
  isHtml: boolean;
  bodyRaw: string;
  sentAtMs: number;
  sentAtIso: string;
  assigneeToken: string;
  mappedStatus: ReturnType<typeof mapMaildealerThreadStatus>;
}

interface ThreadPlan {
  id: string;
  isNew: boolean;
  mailBoxId: number;
  subject: string | null;
  memberId: string | null;
  memberIdLocked: boolean; // 既に会員紐付けが分かっている(新規メッセージで上書きしない)
  status: ReturnType<typeof mapMaildealerThreadStatus>;
  category: '通常' | 'メルマガ' | '自動応答' | '迷惑メール';
  assigneeId: string | null;
  lastMessageAt: string;
  lastDirection: 'in' | 'out';
  latestSentAtMs: number;
}

interface FileStats {
  total: number;
  skippedExisting: number;
  skippedDuplicateInFile: number;
  inserted: number;
  otherBoxed: number;
  byBox: Map<number, number>;
  byCategory: Map<string, number>;
  assigneeMatched: number;
  assigneeUnmatched: Map<string, number>;
  newThreads: number;
  updatedThreads: number;
  memberMatched: number;
  memberAmbiguousOrNone: number;
}

interface Ctx {
  // biome-ignore lint/suspicious/noExplicitAny: createMigrateClient の戻り値は Supabase の生成型に依存する
  supabase: any;
  otherBox: MailBoxRow;
  realBoxes: MailBoxRow[];
  emailToUserId: Map<string, string>;
  emailToMemberId: Map<string, string | null>;
}

function emptyStats(): FileStats {
  return {
    total: 0,
    skippedExisting: 0,
    skippedDuplicateInFile: 0,
    inserted: 0,
    otherBoxed: 0,
    byBox: new Map(),
    byCategory: new Map(),
    assigneeMatched: 0,
    assigneeUnmatched: new Map(),
    newThreads: 0,
    updatedThreads: 0,
    memberMatched: 0,
    memberAmbiguousOrNone: 0,
  };
}

function addToMap(target: Map<string | number, number>, key: string | number, n = 1): void {
  target.set(key, (target.get(key) ?? 0) + n);
}

function mergeStatsInto(target: FileStats, src: FileStats): void {
  target.total += src.total;
  target.skippedExisting += src.skippedExisting;
  target.skippedDuplicateInFile += src.skippedDuplicateInFile;
  target.inserted += src.inserted;
  target.otherBoxed += src.otherBoxed;
  target.assigneeMatched += src.assigneeMatched;
  target.newThreads += src.newThreads;
  target.updatedThreads += src.updatedThreads;
  target.memberMatched += src.memberMatched;
  target.memberAmbiguousOrNone += src.memberAmbiguousOrNone;
  for (const [k, v] of src.byBox) addToMap(target.byBox, k, v);
  for (const [k, v] of src.byCategory) addToMap(target.byCategory, k, v);
  for (const [k, v] of src.assigneeUnmatched) addToMap(target.assigneeUnmatched, k, v);
}

function printReport(label: string, s: FileStats): void {
  logger.info(`=== ${label} ===`);
  logger.info(`対象行数: ${s.total}`);
  logger.info(`取込済み(スキップ): ${s.skippedExisting}`);
  logger.info(`ファイル内重複(スキップ): ${s.skippedDuplicateInFile}`);
  logger.info(`新規に取り込むメッセージ: ${s.inserted}`);
  logger.info(`  うち新規スレッド: ${s.newThreads} / 既存スレッドへの追加: ${s.updatedThreads}`);
  logger.info(`  うち「その他」行き: ${s.otherBoxed}`);
  logger.info(`会員突合: 一致 ${s.memberMatched} / 不明・あいまい ${s.memberAmbiguousOrNone}`);
  logger.info(`担当者紐付け: 一致 ${s.assigneeMatched}`);
  if (s.assigneeUnmatched.size > 0) {
    logger.info(
      `担当者紐付け: 未対応の担当者名(要確認) ${[...s.assigneeUnmatched.entries()].map(([k, v]) => `${k}=${v}件`).join(', ')}`,
    );
  }
  logger.info(`分類内訳: ${[...s.byCategory.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  logger.info(
    `受信箱内訳(上位10): ${[...s.byBox.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, n]) => `box#${id}=${n}`)
      .join(', ')}`,
  );
}

function parseSentAt(raw: string): number {
  // "2026/06/01 00:06:22" 形式。日本時間(JST, UTC+9)として扱う
  const m = raw.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return Date.now();
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y as number, (mo as number) - 1, d as number, (h as number) - 9, mi, s);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 対象ファイルの一覧を決める。--dir はディレクトリ直下の *.csv をファイル名昇順で(時系列想定) */
function resolveFiles(args: { file?: string; dir?: string }): string[] {
  if (args.dir) {
    const dir = resolve(args.dir);
    if (!existsSync(dir)) throw new Error(`ディレクトリが見つかりません: ${dir}`);
    return readdirSync(dir)
      .filter((f) => extname(f).toLowerCase() === '.csv')
      .sort()
      .map((f) => join(dir, f));
  }
  if (args.file) {
    const filepath = resolve(args.file);
    if (!existsSync(filepath)) throw new Error(`ファイルが見つかりません: ${filepath}`);
    return [filepath];
  }
  throw new Error('--file <CSVパス> または --dir <ディレクトリ> を指定してください');
}

/**
 * 直近に更新されたファイルほど、エクスポート処理がまだ書込み中の可能性がある。
 * ファイルサイズを2回測って変化していないか簡易チェックする(完全な保証ではないが、
 * 進行中のエクスポートを誤って読む事故を減らす)。
 */
function looksStillWriting(filepath: string): boolean {
  const before = statSync(filepath).size;
  const start = Date.now();
  while (Date.now() - start < 300) {
    /* 300ms 待つ(同期。スクリプト全体の実行時間に対しては無視できる) */
  }
  const after = existsSync(filepath) ? statSync(filepath).size : -1;
  return before !== after;
}

async function processFile(filepath: string, ctx: Ctx, dryRun: boolean): Promise<FileStats> {
  logger.info(`--- ファイル: ${filepath} ---`);
  if (looksStillWriting(filepath)) {
    throw new Error(
      `書込み中の可能性があります(サイズが変化中): ${filepath}。時間を置いて再実行してください。`,
    );
  }

  const buf = readFileSync(filepath);
  const text = new TextDecoder('shift-jis').decode(buf);
  const rawRows = parseCsvString(text);
  logger.info(`読込完了: ${rawRows.length} 行`);

  const { supabase, otherBox, realBoxes, emailToUserId, emailToMemberId } = ctx;

  const prepared: PreparedRow[] = rawRows.map((row) => {
    const mailKind = row.メール種別 ?? '';
    const direction: 'in' | 'out' = mailKind === '送信メール' ? 'out' : 'in';
    const headers = parseRawHeaders(row.メールヘッダ全体 ?? '');
    const messageId = ensureMessageId(headers['message-id'] ?? null);
    const inReplyTo = headers['in-reply-to'] ?? null;
    const references = headers.references ?? null;
    const toRaw = (row.Toアドレス ?? '').trim();
    const ccRaw = headers.cc ?? '';
    const fromAddress =
      parseAddress(row.Fromアドレス ?? '').address || (row.Fromアドレス ?? '').toLowerCase();
    return {
      mailKind,
      direction,
      headers,
      messageId,
      inReplyTo,
      references,
      refIds: extractReferencedMessageIds(inReplyTo, references),
      fromAddress,
      fromName: (row.From名前 ?? '').trim() || null,
      toAddresses: toRaw ? [toRaw.toLowerCase()] : [],
      ccAddresses: ccRaw
        ? ccRaw
            .split(',')
            .map((s) => parseAddress(s).address)
            .filter((a): a is string => !!a)
        : [],
      subjectRaw: row.件名 ?? '',
      isHtml: looksLikeHtmlBody(row.本文),
      bodyRaw: row.本文 ?? '',
      sentAtMs: parseSentAt(row.受送信時刻 ?? ''),
      sentAtIso: new Date(parseSentAt(row.受送信時刻 ?? '')).toISOString(),
      assigneeToken: maildealerAssigneeToken(row.担当者名),
      mappedStatus: mapMaildealerThreadStatus(mailKind, row.メール状態 ?? ''),
    };
  });
  prepared.sort((a, b) => a.sentAtMs - b.sentAtMs);

  // ---- 既存の message_id → thread_id を一括照会(自分自身の重複判定 + 参照先の解決) ----
  const idSet = new Set<string>();
  for (const p of prepared) {
    idSet.add(p.messageId);
    for (const r of p.refIds) idSet.add(r);
  }
  // PostgREST の .in() は値を GET リクエストの URL に埋め込むため、message_id
  // (数千〜数万件、実データは1件あたり40〜70文字程度)を渡すと URL/ヘッダー長の上限
  // (通常16KB)を超えて失敗する(実測: 200件は成功、300件で HeadersOverflowError、
  // 500件で 400 Bad Request)。POST body で配列を渡せる RPC (migration 80) に置き換える。
  const messageIdToThreadId = new Map<string, string>();
  for (const c of chunk([...idSet], RPC_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase.rpc('lookup_mail_message_thread_ids', {
      p_message_ids: c,
    });
    if (error) throw new Error(`mail_messages の事前照会に失敗: ${error.message}`);
    for (const row of (data ?? []) as Array<{ message_id: string; thread_id: string }>) {
      messageIdToThreadId.set(row.message_id, row.thread_id);
    }
  }
  logger.info(`既存メッセージ ${messageIdToThreadId.size} 件を事前照会`);

  // 上記で見つかった既存スレッドの現在の last_message_at(巻き戻し防止の基準値)
  // こちらも同じ理由で RPC (migration 80) を使う。
  const existingThreadIds = [...new Set(messageIdToThreadId.values())];
  const threadPlans = new Map<string, ThreadPlan>();
  for (const c of chunk(existingThreadIds, RPC_LOOKUP_CHUNK_SIZE)) {
    const { data, error } = await supabase.rpc('lookup_mail_thread_states', {
      p_thread_ids: c,
    });
    if (error) throw new Error(`mail_threads の事前照会に失敗: ${error.message}`);
    for (const t of (data ?? []) as Array<{
      id: string;
      mail_box_id: number;
      status: ThreadPlan['status'];
      category: ThreadPlan['category'];
      member_id: string | null;
      assignee_id: string | null;
      last_message_at: string | null;
      last_direction: ThreadPlan['lastDirection'] | null;
    }>) {
      threadPlans.set(t.id, {
        id: t.id,
        isNew: false,
        mailBoxId: t.mail_box_id,
        subject: null, // 既存スレッドの件名は変更しない(更新時は使わない)
        memberId: t.member_id,
        memberIdLocked: t.member_id !== null,
        status: t.status,
        category: t.category,
        assigneeId: t.assignee_id,
        lastMessageAt: t.last_message_at ?? new Date(0).toISOString(),
        lastDirection: t.last_direction ?? 'in',
        latestSentAtMs: t.last_message_at ? new Date(t.last_message_at).getTime() : 0,
      });
    }
  }

  // ---- 本組み立て(すべて in-memory。DB 書込はまだしない) ----
  const messageInserts: Array<Record<string, unknown>> = [];
  const seenMessageIds = new Set<string>();
  const stats = emptyStats();
  stats.total = prepared.length;

  for (const p of prepared) {
    if (messageIdToThreadId.has(p.messageId)) {
      stats.skippedExisting++;
      continue;
    }
    if (seenMessageIds.has(p.messageId)) {
      stats.skippedDuplicateInFile++;
      continue;
    }
    seenMessageIds.add(p.messageId);

    const box =
      matchMailBox(realBoxes, [
        ...p.toAddresses,
        ...p.ccAddresses,
        p.headers['delivered-to'],
        p.headers['x-original-to'],
        p.headers['xsrv-filter'],
      ]) ?? otherBox;
    if (box.id === otherBox.id) stats.otherBoxed++;
    else addToMap(stats.byBox, box.id);

    let threadId: string | null = null;
    for (const id of p.refIds) {
      const found = messageIdToThreadId.get(id);
      if (found) {
        threadId = found;
        break;
      }
    }

    const isKnownMember =
      p.direction === 'in' ? (emailToMemberId.get(p.fromAddress) ?? null) !== null : false;
    const category =
      p.direction === 'in'
        ? classifyInbound({
            headers: p.headers,
            fromAddress: p.fromAddress,
            subject: p.subjectRaw,
            sesSpamFail: false,
            isKnownMember,
          })
        : '通常';

    if (!threadId) {
      threadId = randomUUID();
      const primaryAddress = p.direction === 'in' ? p.fromAddress : (p.toAddresses[0] ?? '');
      const memberId = emailToMemberId.get(primaryAddress) ?? null;
      if (memberId !== null) stats.memberMatched++;
      else stats.memberAmbiguousOrNone++;

      const assigneeId = p.assigneeToken
        ? (emailToUserId.get(ASSIGNEE_TOKEN_TO_EMAIL[p.assigneeToken] ?? '') ?? null)
        : null;
      if (p.assigneeToken) {
        if (assigneeId) stats.assigneeMatched++;
        else addToMap(stats.assigneeUnmatched, p.assigneeToken);
      }

      threadPlans.set(threadId, {
        id: threadId,
        isNew: true,
        mailBoxId: box.id,
        subject: normalizeSubject(p.subjectRaw) || null,
        memberId,
        memberIdLocked: memberId !== null,
        status: p.mappedStatus ?? (p.direction === 'out' ? '対応中' : '未対応'),
        category,
        assigneeId,
        lastMessageAt: p.sentAtIso,
        lastDirection: p.direction,
        latestSentAtMs: p.sentAtMs,
      });
      stats.newThreads++;
    } else {
      const plan = threadPlans.get(threadId);
      if (plan) {
        if (p.sentAtMs >= plan.latestSentAtMs) {
          plan.latestSentAtMs = p.sentAtMs;
          plan.lastMessageAt = p.sentAtIso;
          plan.lastDirection = p.direction;
          if (p.mappedStatus) plan.status = p.mappedStatus;
        }
        if (!plan.memberIdLocked && p.direction === 'in') {
          const mid = emailToMemberId.get(p.fromAddress) ?? null;
          if (mid) {
            plan.memberId = mid;
            plan.memberIdLocked = true;
          }
        }
      }
      stats.updatedThreads++;
    }
    addToMap(stats.byCategory, category);
    messageIdToThreadId.set(p.messageId, threadId);

    messageInserts.push({
      thread_id: threadId,
      direction: p.direction,
      message_id: p.messageId,
      in_reply_to: p.inReplyTo,
      references_header: p.references,
      from_address: p.fromAddress || (p.headers.from ?? ''),
      from_name: p.fromName,
      to_addresses: p.toAddresses,
      cc_addresses: p.ccAddresses,
      subject: p.subjectRaw || null,
      text_body: p.isHtml ? null : p.bodyRaw || null,
      html_body: p.isHtml ? p.bodyRaw || null : null,
      sent_at: p.sentAtIso,
      provider_message_id: null,
      delivery_status: null,
      sender_user_id: null,
      source: 'import_maildealer',
    });
    stats.inserted++;
  }

  printReport(`ファイルレポート: ${filepath}`, stats);

  if (dryRun) return stats;

  const newThreadRows = [...threadPlans.values()]
    .filter((t) => t.isNew)
    .map((t) => ({
      id: t.id,
      mail_box_id: t.mailBoxId,
      subject: t.subject,
      member_id: t.memberId,
      status: t.status,
      category: t.category,
      assignee_id: t.assigneeId,
      last_message_at: t.lastMessageAt,
      last_direction: t.lastDirection,
      is_read: true, // 過去データは既読扱い(未読の山にしない)
    }));
  logger.info(`新規スレッドを書込み中(${newThreadRows.length}件)...`);
  for (const c of chunk(newThreadRows, CHUNK_SIZE)) {
    const { error } = await supabase.from('mail_threads').insert(c);
    if (error) throw new Error(`mail_threads の挿入に失敗: ${error.message}`);
  }

  const existingThreadUpdates = [...threadPlans.values()].filter((t) => !t.isNew);
  logger.info(`既存スレッドを更新中(${existingThreadUpdates.length}件)...`);
  for (const t of existingThreadUpdates) {
    const { error } = await supabase
      .from('mail_threads')
      .update({
        status: t.status,
        member_id: t.memberId,
        last_message_at: t.lastMessageAt,
        last_direction: t.lastDirection,
      })
      .eq('id', t.id);
    if (error) logger.warn(`スレッド更新に失敗: ${t.id}`, { error: error.message });
  }

  logger.info(`メッセージを書込み中(${messageInserts.length}件)...`);
  let actuallyInserted = 0;
  for (const c of chunk(messageInserts, CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('mail_messages')
      .upsert(c, { onConflict: 'message_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`mail_messages の挿入に失敗: ${error.message}`);
    actuallyInserted += (data ?? []).length;
  }
  logger.info(`ファイル完了。実際に書き込んだメッセージ: ${actuallyInserted} 件`);

  return stats;
}

async function main() {
  const args = parseArgs();
  const files = resolveFiles(args);
  logger.info(`対象ファイル: ${files.length} 件`);

  const supabase = createMigrateClient();

  // ---- 受信箱(全ファイル共通) ----
  const { data: boxData, error: boxErr } = await supabase
    .from('mail_boxes')
    .select('id, address, is_active');
  if (boxErr) throw new Error(`mail_boxes の取得に失敗: ${boxErr.message}`);
  const boxes = (boxData ?? []) as MailBoxRow[];
  const otherBox = boxes.find((b) => b.address === OTHER_MAILBOX_ADDRESS);
  if (!otherBox) {
    logger.error('「その他」の受信箱が見つかりません(migration 78 未適用)。先に適用してください。');
    process.exit(1);
  }
  const realBoxes = boxes.filter((b) => b.is_active && b.address !== OTHER_MAILBOX_ADDRESS);

  // ---- 担当者の対応表 → users.id(全ファイル共通) ----
  const assigneeEmails = Object.values(ASSIGNEE_TOKEN_TO_EMAIL);
  const { data: assigneeUsers } = await supabase
    .from('users')
    .select('id, email')
    .in('email', assigneeEmails);
  const emailToUserId = new Map(
    ((assigneeUsers ?? []) as Array<{ id: string; email: string }>).map((u) => [
      u.email.toLowerCase(),
      u.id,
    ]),
  );

  // ---- 会員突合用(全ファイル共通): members.email1/2/3 を全件読み込む ----
  logger.info('会員一覧を読込中(会員突合用)...');
  const emailToMemberId = new Map<string, string | null>();
  {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('members')
        .select('id, email1, email2, email3')
        .is('deleted_at', null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`members の取得に失敗: ${error.message}`);
      const page = (data ?? []) as Array<{
        id: string;
        email1: string | null;
        email2: string | null;
        email3: string | null;
      }>;
      for (const m of page) {
        for (const raw of [m.email1, m.email2, m.email3]) {
          const e = raw?.trim().toLowerCase();
          if (!e) continue;
          if (emailToMemberId.has(e) && emailToMemberId.get(e) !== m.id) {
            emailToMemberId.set(e, null); // 複数会員に一致 = あいまい
          } else {
            emailToMemberId.set(e, m.id);
          }
        }
      }
      if (page.length < pageSize) break;
    }
  }
  logger.info(`会員メールアドレス ${emailToMemberId.size} 件を読込`);

  const ctx: Ctx = { supabase, otherBox, realBoxes, emailToUserId, emailToMemberId };
  const combined = emptyStats();

  for (const filepath of files) {
    const stats = await processFile(filepath, ctx, args.dryRun);
    mergeStatsInto(combined, stats);
  }

  printReport(`全体レポート(${files.length}ファイル)`, combined);
  if (args.dryRun) {
    logger.info('--dry-run のため書込みは行いません。');
  } else {
    logger.info('すべてのファイルの取込が完了しました。');
  }
}

main().catch((e) => {
  logger.error('取込に失敗しました', { error: (e as Error).message });
  process.exit(1);
});
