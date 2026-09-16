/**
 * メール取込の実行(取込候補のメール → 問合せ)。CLAUDE.md §5.16 段階③。
 *
 * 受信 Webhook(サービスロール)、/mail/settings の一括実行(admin → サービスロール)、
 * 過去分の一括スクリプトの3か所から同じ関数を使う。判定・切り出し・照合の判断は
 * 純粋関数(mail_import_rules.ts / mail_import_match.ts)に置き、ここは DB とのやり取りだけ。
 *
 * 1通の処理の流れ:
 *   1. ルール判定(無ければ pending「ルール未一致」)
 *   2. 項目の切り出し(フォーム名が取れなければ error)
 *   3. 同じメールから作成済みなら何もしない(冪等)
 *   4. フォームを名前で非破壊解決(無ければ追加)
 *   5. Salesforce 併用期間の重複防止: 同じフォーム・メール・登録日(日本時間)の問合せが
 *      既にあれば作らず紐付ける
 *   6. 会員の自動照合(4点中3点以上で自動紐付け)
 *   7. 問合せを作成(TA- 採番)し、メールに処理結果を記録
 *
 * 取込先が LP のルール(migration 99)は 3 の後で分岐し、フォームの解決・重複防止・会員照合をせずに
 * lp_entries を1件作る(§5.17。会員の紐付けはしない: メールだけの照合は誤紐付けの恐れがあるため)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { decideMemberMatch, jstDateKey, normalizeMatchInput } from './mail_import_match';
import {
  IMPORT_TARGET_LABELS,
  type MailImportRule,
  applyRule,
  findMatchingRule,
} from './mail_import_rules';

export interface ImportableMessage {
  /** mail_messages.id */
  id: string;
  message_id: string;
  thread_id: string;
  mail_box_id: number | null;
  from_address: string;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  sent_at: string | null;
}

export type ImportStatus = 'pending' | 'done' | 'error';

export interface ImportOutcome {
  status: ImportStatus;
  note: string;
  inquiryId: string | null;
  /** 取込先が LP のとき作成した lp_entries.id(migration 99) */
  lpEntryId?: string | null;
}

const NOTE_MAX = 300;

/** ルール一覧(判定順)。呼び出し元のクライアント(RLS は全員 SELECT 可)で読む */
export async function fetchMailImportRules(supabase: SupabaseClient): Promise<MailImportRule[]> {
  const { data, error } = await supabase
    .from('mail_import_rules')
    .select(
      'id, name, is_active, sort_order, mail_box_id, from_address, subject_contains, body_contains, form_name_contains, target, form_name_source, form_name_param, field_map',
    )
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`取込ルールの取得に失敗: ${error.message}`);
  return (data ?? []) as unknown as MailImportRule[];
}

/** フォームを名前で解決(無ければ非破壊で追加。CSV 取込 import_inquiries.ts と同方式) */
async function resolveFormId(supabase: SupabaseClient, name: string): Promise<number> {
  const found = await supabase.from('forms').select('id').eq('name', name).maybeSingle();
  if (found.error) throw new Error(`フォームの取得に失敗: ${found.error.message}`);
  if (found.data) return (found.data as { id: number }).id;

  // forms.id は serial だが過去の明示ID投入で sequence がずれているため max+1 で採番する
  const { data: maxRow } = await supabase
    .from('forms')
    .select('id')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextId = ((maxRow as { id?: number } | null)?.id ?? 0) + 1;
  const ins = await supabase
    .from('forms')
    .upsert({ id: nextId, name, is_active: true }, { onConflict: 'name', ignoreDuplicates: true });
  if (ins.error) throw new Error(`フォームの追加に失敗: ${ins.error.message}`);
  const again = await supabase.from('forms').select('id').eq('name', name).maybeSingle();
  if (again.error || !again.data) throw new Error('フォームの解決に失敗しました');
  return (again.data as { id: number }).id;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function recordOutcome(
  supabase: SupabaseClient,
  msg: ImportableMessage,
  outcome: ImportOutcome,
): Promise<ImportOutcome> {
  await supabase
    .from('mail_messages')
    .update({
      import_status: outcome.status,
      import_note: outcome.note.slice(0, NOTE_MAX),
      inquiry_id: outcome.inquiryId,
      lp_entry_id: outcome.lpEntryId ?? null,
    })
    .eq('id', msg.id);
  return outcome;
}

const MATCH_LABEL: Record<string, string> = {
  auto: '自動紐付け',
  candidates: '候補あり(要確認)',
  none: '該当なし',
};

/** メール1通を取り込む。結果は mail_messages に記録して返す(例外は投げない) */
export async function importMailMessage(
  supabase: SupabaseClient,
  msg: ImportableMessage,
  rules: readonly MailImportRule[],
): Promise<ImportOutcome> {
  const rule = findMatchingRule(rules, {
    mailBoxId: msg.mail_box_id,
    fromAddress: msg.from_address,
    subject: msg.subject,
    textBody: msg.text_body,
    htmlBody: msg.html_body,
  });
  if (!rule) {
    return recordOutcome(supabase, msg, {
      status: 'pending',
      note: 'ルール未一致',
      inquiryId: null,
    });
  }

  const applied = applyRule(rule, {
    subject: msg.subject ?? '',
    textBody: msg.text_body,
    htmlBody: msg.html_body,
  });
  if (!applied.formName) {
    return recordOutcome(supabase, msg, {
      status: 'error',
      note: `${rule.name}: ${applied.errors.join(' / ')}`,
      inquiryId: null,
    });
  }

  if (rule.target === 'lp') return importAsLpEntry(supabase, msg, rule, applied);

  try {
    // 3) 同じメールから作成済み(冪等)
    const existing = await supabase
      .from('inquiries')
      .select('id')
      .eq('source_mail_message_id', msg.message_id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      const id = (existing.data as { id: string }).id;
      return recordOutcome(supabase, msg, {
        status: 'done',
        note: `${id}(作成済み)`,
        inquiryId: id,
      });
    }

    // 4) フォーム
    const formId = await resolveFormId(supabase, applied.formName);
    const registeredAt = applied.registeredAt ?? msg.sent_at ?? new Date().toISOString();

    // 5) Salesforce 併用期間の重複防止(同じフォーム・メール・登録日)
    const email = applied.fields.email ?? null;
    if (email) {
      const day = jstDateKey(registeredAt);
      const dup = await supabase
        .from('inquiries')
        .select('id, source_mail_message_id')
        .eq('form_id', formId)
        .ilike('email', escapeLike(email))
        .gte('registered_at', `${day}T00:00:00+09:00`)
        .lte('registered_at', `${day}T23:59:59.999+09:00`)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (dup.error) throw new Error(dup.error.message);
      if (dup.data) {
        const d = dup.data as { id: string; source_mail_message_id: string | null };
        if (!d.source_mail_message_id) {
          await supabase
            .from('inquiries')
            .update({ source_mail_message_id: msg.message_id })
            .eq('id', d.id);
        }
        return recordOutcome(supabase, msg, {
          status: 'done',
          note: `既存 ${d.id} に紐付け(同じフォーム・メール・登録日)`,
          inquiryId: d.id,
        });
      }
    }

    // 6) 会員の自動照合
    const norm = normalizeMatchInput({
      name: applied.fields.name,
      phone: applied.fields.phone,
      email: applied.fields.email,
      address: applied.fields.address,
    });
    let match = decideMemberMatch([]);
    if (norm.name || norm.phone || norm.email || norm.address) {
      const { data: rows, error } = await supabase.rpc('match_members_for_inquiry', {
        p_name: norm.name,
        p_phone: norm.phone,
        p_email: norm.email,
        p_address: norm.address,
      });
      if (error) throw new Error(`会員照合に失敗: ${error.message}`);
      match = decideMemberMatch((rows ?? []) as Array<{ member_id: string; points: number }>);
    }

    // 7) 問合せの作成
    const { data: idData, error: idErr } = await supabase.rpc('gen_inquiry_id');
    if (idErr || typeof idData !== 'string') {
      throw new Error(`問合せIDの採番に失敗: ${idErr?.message ?? '不明'}`);
    }
    const inquiryId = idData;
    const { error: insErr } = await supabase.from('inquiries').insert({
      id: inquiryId,
      form_id: formId,
      member_id: match.memberId,
      name: applied.fields.name ?? null,
      name_kana: applied.fields.name_kana ?? null,
      email: applied.fields.email ?? null,
      phone: applied.fields.phone ?? null,
      postal_code: applied.fields.postal_code ?? null,
      address: applied.fields.address ?? null,
      ad_id: applied.fields.ad_id ?? null,
      extra: applied.extra,
      registered_at: registeredAt,
      source_mail_message_id: msg.message_id,
      member_match: {
        status: match.status,
        points: match.points,
        candidates: match.candidates,
        checked_at: new Date().toISOString(),
      },
    });
    if (insErr) throw new Error(`問合せの作成に失敗: ${insErr.message}`);

    // 自動紐付けできた会員は、未紐付けのスレッドにも反映する(§5.15 の会員突合と同じ扱い)
    if (match.memberId) {
      await supabase
        .from('mail_threads')
        .update({ member_id: match.memberId })
        .eq('id', msg.thread_id)
        .is('member_id', null);
    }

    const matchNote = match.memberId
      ? `${MATCH_LABEL.auto} ${match.memberId}`
      : `${MATCH_LABEL[match.status] ?? match.status}`;
    return recordOutcome(supabase, msg, {
      status: 'done',
      note: `${inquiryId} を作成(会員照合: ${matchNote})`,
      inquiryId,
    });
  } catch (e) {
    return recordOutcome(supabase, msg, {
      status: 'error',
      note: `${rule.name}: ${e instanceof Error ? e.message : String(e)}`,
      inquiryId: null,
    });
  }
}

/** 登録月「YYYY/MM」(日本時間。CSV 取込の lp_entries.registered_month と同じ形) */
function jstMonthKey(iso: string): string {
  const t = new Date(iso).getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(t).toISOString();
  return `${d.slice(0, 4)}/${d.slice(5, 7)}`;
}

/**
 * 取込先が LP のルール: lp_entries を1件作る(§5.17 / migration 99)。
 * フォームは forms に登録せず名称のまま持つ。重複防止は元メール(source_mail_message_id)だけ。
 * 会員の紐付けはしない(member_id = NULL)。
 */
async function importAsLpEntry(
  supabase: SupabaseClient,
  msg: ImportableMessage,
  rule: MailImportRule,
  applied: ReturnType<typeof applyRule>,
): Promise<ImportOutcome> {
  try {
    const existing = await supabase
      .from('lp_entries')
      .select('id')
      .eq('source_mail_message_id', msg.message_id)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) {
      const id = (existing.data as { id: string }).id;
      return recordOutcome(supabase, msg, {
        status: 'done',
        note: `${IMPORT_TARGET_LABELS.lp} ${id}(作成済み)`,
        inquiryId: null,
        lpEntryId: id,
      });
    }
    const registeredAt = applied.registeredAt ?? msg.sent_at ?? new Date().toISOString();
    const { data: idData, error: idErr } = await supabase.rpc('gen_inquiry_id');
    if (idErr || typeof idData !== 'string') {
      throw new Error(`LP の ID の採番に失敗: ${idErr?.message ?? '不明'}`);
    }
    const lpId = idData;
    const { error: insErr } = await supabase.from('lp_entries').insert({
      id: lpId,
      member_id: null,
      registered_month: jstMonthKey(registeredAt),
      form_name: applied.formName,
      ad_id: applied.fields.ad_id ?? null,
      email: applied.fields.email ?? null,
      name: applied.fields.name ?? null,
      name_kana: applied.fields.name_kana ?? null,
      registered_at: registeredAt,
      source_mail_message_id: msg.message_id,
    });
    if (insErr) throw new Error(`LP の作成に失敗: ${insErr.message}`);
    return recordOutcome(supabase, msg, {
      status: 'done',
      note: `${IMPORT_TARGET_LABELS.lp} ${lpId} を作成(会員の紐付けなし)`,
      inquiryId: null,
      lpEntryId: lpId,
    });
  } catch (e) {
    return recordOutcome(supabase, msg, {
      status: 'error',
      note: `${rule.name}: ${e instanceof Error ? e.message : String(e)}`,
      inquiryId: null,
    });
  }
}

export interface BacklogSummary {
  processed: number;
  done: number;
  pending: number;
  error: number;
  /** limit で打ち切った(まだ未処理が残っている可能性がある) */
  truncated: boolean;
}

/**
 * 取込候補のスレッドを新しい順にたどり、処理結果が未記録(import_status IS NULL)の
 * 受信メッセージを取り込む。limit 件処理したら打ち切る(画面のボタンから少しずつ回せる)。
 */
export async function processCandidateBacklog(
  supabase: SupabaseClient,
  rules: readonly MailImportRule[],
  options: { limit: number; pageSize?: number; onProgress?: (s: BacklogSummary) => void } = {
    limit: 300,
  },
): Promise<BacklogSummary> {
  const pageSize = options.pageSize ?? 200;
  const summary: BacklogSummary = { processed: 0, done: 0, pending: 0, error: 0, truncated: false };
  for (let offset = 0; ; offset += pageSize) {
    const { data: threads, error: tErr } = await supabase
      .from('mail_threads')
      .select('id')
      .eq('is_import_candidate', true)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (tErr) throw new Error(`取込候補の取得に失敗: ${tErr.message}`);
    const ids = ((threads ?? []) as Array<{ id: string }>).map((t) => t.id);
    if (ids.length === 0) break;

    const { data: msgs, error: mErr } = await supabase
      .from('mail_messages')
      .select('id, message_id, thread_id, from_address, subject, text_body, html_body, sent_at')
      .in('thread_id', ids)
      .eq('direction', 'in')
      .is('import_status', null)
      .order('sent_at', { ascending: true });
    if (mErr) throw new Error(`メッセージの取得に失敗: ${mErr.message}`);

    // スレッドの受信箱(ルールの受信箱条件に使う)
    const { data: boxes } = await supabase
      .from('mail_threads')
      .select('id, mail_box_id')
      .in('id', ids);
    const boxByThread = new Map(
      ((boxes ?? []) as Array<{ id: string; mail_box_id: number }>).map((t) => [
        t.id,
        t.mail_box_id,
      ]),
    );

    for (const raw of (msgs ?? []) as Array<Omit<ImportableMessage, 'mail_box_id'>>) {
      const outcome = await importMailMessage(
        supabase,
        { ...raw, mail_box_id: boxByThread.get(raw.thread_id) ?? null },
        rules,
      );
      summary.processed++;
      summary[outcome.status]++;
      options.onProgress?.(summary);
      if (summary.processed >= options.limit) {
        summary.truncated = true;
        return summary;
      }
    }
    if (ids.length < pageSize) break;
  }
  return summary;
}
