/**
 * Voice memos: pitch → manager → feedback nucleus.
 *
 * Reps record pitches over Telegram. We store the audio in Supabase Storage
 * (private bucket `voice-memos`), transcribe, then forward the original
 * Telegram voice file_id to every manager in scope. The bot's outgoing
 * message_id is saved on the memo so manager voice replies can be matched
 * back to the original pitch and relayed to the rep.
 */

import { supabase } from '@/lib/supabase'
import { sendTelegramMessage, sendTelegramVoice } from '@/lib/telegram'

const BUCKET = 'voice-memos'
const TG_API = 'https://api.telegram.org'

export type VoiceMemoStatus = 'pending' | 'in_review' | 'ready' | 'needs_work' | 'archived'
export type VoiceMemoKind = 'pitch' | 'feedback' | 'note'

export type VoiceMemo = {
  id: string
  rep_id: string
  sender_member_id: string
  recipient_member_id: string | null
  team_id: string | null
  lead_id: string | null
  parent_memo_id: string | null
  kind: VoiceMemoKind
  status: VoiceMemoStatus
  telegram_file_id: string | null
  storage_path: string | null
  duration_seconds: number | null
  transcript: string | null
  tg_relay_chat_id: string | null
  tg_relay_message_id: number | null
  reviewed_by_member_id: string | null
  reviewed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Download a Telegram voice file and re-upload it to Supabase Storage. */
export async function archiveTelegramVoiceToStorage(
  fileId: string,
  repId: string,
  memoId: string,
): Promise<string | null> {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN
  if (!tgToken) return null
  try {
    const fileRes = await fetch(`${TG_API}/bot${tgToken}/getFile?file_id=${encodeURIComponent(fileId)}`)
    if (!fileRes.ok) return null
    const fileJson = (await fileRes.json()) as { result?: { file_path?: string } }
    const filePath = fileJson?.result?.file_path
    if (!filePath) return null
    const audioRes = await fetch(`${TG_API}/file/bot${tgToken}/${filePath}`)
    if (!audioRes.ok) return null
    const buf = new Uint8Array(await audioRes.arrayBuffer())
    const ext = filePath.split('.').pop()?.toLowerCase() || 'ogg'
    const storagePath = `${repId}/${memoId}.${ext}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buf, { contentType: 'audio/ogg', upsert: true })
    if (error) {
      console.error('[voice-memos] storage upload failed', error.message)
      return null
    }
    return storagePath
  } catch (err) {
    console.error('[voice-memos] archive failed', err)
    return null
  }
}

/** Get a short-lived signed URL for in-dashboard playback. */
export async function getMemoSignedUrl(storagePath: string, expiresIn = 60 * 60): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresIn)
  if (error) return null
  return data?.signedUrl ?? null
}

/** Insert a fresh memo row. */
export async function createMemo(input: {
  repId: string
  senderMemberId: string
  recipientMemberId?: string | null
  teamId?: string | null
  leadId?: string | null
  parentMemoId?: string | null
  kind: VoiceMemoKind
  telegramFileId?: string | null
  durationSeconds?: number | null
  transcript?: string | null
}): Promise<VoiceMemo> {
  const { data, error } = await supabase
    .from('voice_memos')
    .insert({
      rep_id: input.repId,
      sender_member_id: input.senderMemberId,
      recipient_member_id: input.recipientMemberId ?? null,
      team_id: input.teamId ?? null,
      lead_id: input.leadId ?? null,
      parent_memo_id: input.parentMemoId ?? null,
      kind: input.kind,
      telegram_file_id: input.telegramFileId ?? null,
      duration_seconds: input.durationSeconds ?? null,
      transcript: input.transcript ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as VoiceMemo
}

export async function setMemoStatus(
  memoId: string,
  status: VoiceMemoStatus,
  reviewerMemberId: string | null,
  notes?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (reviewerMemberId) {
    patch.reviewed_by_member_id = reviewerMemberId
    patch.reviewed_at = new Date().toISOString()
  }
  if (notes !== undefined) patch.notes = notes
  const { error } = await supabase.from('voice_memos').update(patch).eq('id', memoId)
  if (error) throw error
}

export async function setMemoRelay(
  memoId: string,
  chatId: string,
  messageId: number,
): Promise<void> {
  const { error } = await supabase
    .from('voice_memos')
    .update({ tg_relay_chat_id: chatId, tg_relay_message_id: messageId })
    .eq('id', memoId)
  if (error) throw error
}

/** Find the pitch memo whose relay message a manager is replying to. */
export async function findMemoByRelay(
  chatId: string,
  messageId: number,
): Promise<VoiceMemo | null> {
  const { data } = await supabase
    .from('voice_memos')
    .select('*')
    .eq('tg_relay_chat_id', chatId)
    .eq('tg_relay_message_id', messageId)
    .maybeSingle()
  return (data as VoiceMemo | null) ?? null
}

export async function getMemo(memoId: string): Promise<VoiceMemo | null> {
  const { data } = await supabase.from('voice_memos').select('*').eq('id', memoId).maybeSingle()
  return (data as VoiceMemo | null) ?? null
}

/** List memos awaiting review for a manager. */
export async function listPendingForManager(
  repId: string,
  managerMemberId: string,
  managedTeamIds: string[] | null,
): Promise<VoiceMemo[]> {
  let q = supabase
    .from('voice_memos')
    .select('*')
    .eq('rep_id', repId)
    .eq('kind', 'pitch')
    .in('status', ['pending', 'in_review'])
    .order('created_at', { ascending: false })
  // Admin (managedTeamIds === null) sees all pending; managers see their teams + memos addressed to them.
  if (managedTeamIds !== null) {
    if (managedTeamIds.length > 0) {
      q = q.or(
        `recipient_member_id.eq.${managerMemberId},team_id.in.(${managedTeamIds.join(',')})`,
      )
    } else {
      q = q.eq('recipient_member_id', managerMemberId)
    }
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VoiceMemo[]
}

/** All memos a rep has sent + every feedback memo sent to them. */
export async function listForRep(
  repId: string,
  memberId: string,
  search?: string | null,
): Promise<VoiceMemo[]> {
  let q = supabase
    .from('voice_memos')
    .select('*')
    .eq('rep_id', repId)
    .or(`sender_member_id.eq.${memberId},recipient_member_id.eq.${memberId}`)
    .order('created_at', { ascending: false })
    .limit(200)
  if (search && search.trim()) {
    q = q.ilike('transcript', `%${search.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VoiceMemo[]
}

/** All memos visible to a manager (queue + archive across managed teams). */
export async function listForManager(
  repId: string,
  managerMemberId: string,
  managedTeamIds: string[] | null,
  search?: string | null,
): Promise<VoiceMemo[]> {
  let q = supabase
    .from('voice_memos')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (managedTeamIds !== null) {
    if (managedTeamIds.length > 0) {
      q = q.or(
        `recipient_member_id.eq.${managerMemberId},team_id.in.(${managedTeamIds.join(',')}),sender_member_id.eq.${managerMemberId}`,
      )
    } else {
      q = q.or(`recipient_member_id.eq.${managerMemberId},sender_member_id.eq.${managerMemberId}`)
    }
  }
  if (search && search.trim()) {
    q = q.ilike('transcript', `%${search.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as VoiceMemo[]
}

/**
 * Forward a pitch to every manager of the sender's team(s). Falls back to
 * the account owner if the sender isn't on a team yet.
 */
export async function broadcastPitchToManagers(
  memo: VoiceMemo,
  senderName: string,
  leadName: string | null,
): Promise<{ pinged: number }> {
  // Resolve managers in scope.
  const { data: teamRows } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('member_id', memo.sender_member_id)
  const teamIds = (teamRows ?? []).map((r) => (r as { team_id: string }).team_id)

  const managerIds = new Set<string>()
  if (teamIds.length > 0) {
    const { data: teams } = await supabase
      .from('teams')
      .select('manager_member_id')
      .in('id', teamIds)
    for (const t of (teams ?? []) as Array<{ manager_member_id: string | null }>) {
      if (t.manager_member_id) managerIds.add(t.manager_member_id)
    }
  }
  // Always include account admins/owners as a backstop.
  const { data: admins } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', memo.rep_id)
    .in('role', ['owner', 'admin'])
    .eq('is_active', true)
  for (const a of (admins ?? []) as Array<{ id: string }>) managerIds.add(a.id)

  // Don't ping the sender themselves.
  managerIds.delete(memo.sender_member_id)

  const { data: recipients } = await supabase
    .from('members')
    .select('*')
    .in('id', Array.from(managerIds))
    .eq('is_active', true)

  const caption = [
    `🎙 *Pitch from ${senderName}*${leadName ? ` · ${leadName}` : ''}`,
    memo.transcript ? `\n_${memo.transcript.length > 200 ? memo.transcript.slice(0, 200) + '…' : memo.transcript}_` : '',
    '',
    'Reply with a *voice message* to send feedback, or text `ready` / `needs work`.',
  ]
    .filter(Boolean)
    .join('\n')

  let pinged = 0
  let firstRelay: { chatId: string; messageId: number } | null = null
  for (const r of (recipients ?? []) as Array<{ id: string; telegram_chat_id: string | null }>) {
    if (!r.telegram_chat_id) continue
    if (!memo.telegram_file_id) continue
    const res = await sendTelegramVoice(r.telegram_chat_id, memo.telegram_file_id, caption)
    if (res.ok) {
      pinged++
      if (!firstRelay && res.message_id) {
        firstRelay = { chatId: r.telegram_chat_id, messageId: res.message_id }
      }
    }
  }
  // We can only key the memo to one relay message_id; pick the first delivered.
  // Manager replies that target this same message_id are matched in webhook.
  if (firstRelay) {
    await setMemoRelay(memo.id, firstRelay.chatId, firstRelay.messageId)
  }
  return { pinged }
}

/** Send a manager's feedback (voice or text) back to the original rep. */
export async function relayFeedbackToSender(
  pitch: VoiceMemo,
  feedback: VoiceMemo,
  managerName: string,
): Promise<void> {
  const { data: senderRow } = await supabase
    .from('members')
    .select('telegram_chat_id, display_name')
    .eq('id', pitch.sender_member_id)
    .maybeSingle()
  const sender = senderRow as { telegram_chat_id: string | null; display_name: string } | null
  if (!sender?.telegram_chat_id) return

  const caption = `📨 *Feedback from ${managerName}* on your pitch${
    feedback.transcript ? `\n_${feedback.transcript.length > 240 ? feedback.transcript.slice(0, 240) + '…' : feedback.transcript}_` : ''
  }`
  if (feedback.telegram_file_id) {
    await sendTelegramVoice(sender.telegram_chat_id, feedback.telegram_file_id, caption)
  } else if (feedback.transcript) {
    await sendTelegramMessage(sender.telegram_chat_id, `${caption}\n\n${feedback.transcript}`)
  }
}

/** Cron helper: nudge managers with pending pitches older than `hours`. */
export async function nudgeStalePendingPitches(hours: number): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString()
  const { data: stale } = await supabase
    .from('voice_memos')
    .select('*')
    .eq('kind', 'pitch')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
  const memos = (stale ?? []) as VoiceMemo[]
  let nudged = 0
  for (const m of memos) {
    if (!m.tg_relay_chat_id) continue
    const { data: senderRow } = await supabase
      .from('members')
      .select('display_name')
      .eq('id', m.sender_member_id)
      .maybeSingle()
    const senderName = (senderRow as { display_name: string } | null)?.display_name ?? 'a rep'
    const res = await sendTelegramMessage(
      m.tg_relay_chat_id,
      `⏰ Reminder: ${senderName}\u2019s pitch is still waiting on your feedback.`,
      { replyToMessageId: m.tg_relay_message_id ?? undefined },
    )
    if (res.ok) nudged++
  }
  return nudged
}
