/**
 * The Ciao screen's list tools (owner 2026-10-20): folders, pin, rename and
 * delete for a person's own chats. Server-only; every read and write is
 * scoped to the signed-in member, so someone else's chat or folder is simply
 * "not found".
 *
 * Tables: ciao_conversations (title, pinned_at, folder_id, deleted_at) and
 * ciao_chat_folders, from supabase/cxo_ciao_chat_folders.sql. Before that
 * migration runs every action answers 503 not_ready and the list still loads
 * (lib/agent/chatSessions.ts reads the new columns only when they exist).
 *
 * Delete is soft: the chat leaves the list, its turns stay in agent_history.
 * Deleting a folder never deletes a chat; its chats go back to Recent.
 */
import { supabase } from '@/lib/supabase'
import { missing } from '@/lib/agent/chatSessions'

export const FOLDER_NAME_MAX = 40
export const CHAT_TITLE_MAX = 80

export type Folder = { id: string; name: string; created_at: string }

export type OrganizeAction =
  | { action: 'rename_chat'; id: string; title: string }
  | { action: 'pin_chat'; id: string; pinned: boolean }
  | { action: 'move_chat'; id: string; folder_id: string | null }
  | { action: 'delete_chat'; id: string }
  | { action: 'create_folder'; name: string }
  | { action: 'rename_folder'; id: string; name: string }
  | { action: 'delete_folder'; id: string }

export type OrganizeResult =
  | { ok: true; folder?: Folder; deleted_chat?: string }
  | { ok: false; status: 400 | 404 | 503 | 500; error: 'bad_request' | 'not_found' | 'not_ready' | 'failed'; message: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const bad = (message: string): OrganizeResult => ({ ok: false, status: 400, error: 'bad_request', message })
const notFound = (what: 'chat' | 'folder'): OrganizeResult => ({ ok: false, status: 404, error: 'not_found', message: `That ${what} was not found.` })
const NOT_READY: OrganizeResult = { ok: false, status: 503, error: 'not_ready', message: 'Folders and pins are not switched on yet. Your chats are safe; try again later.' }
const FAILED: OrganizeResult = { ok: false, status: 500, error: 'failed', message: 'That did not save. Try again in a moment.' }

/** One space-collapsed line, at most `max` characters, or '' when blank. */
export function cleanName(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** Read and check a request body. Returns the action or a 400. */
export function parseOrganize(body: unknown): OrganizeAction | OrganizeResult {
  if (!body || typeof body !== 'object') return bad('Missing body.')
  const b = body as Record<string, unknown>
  const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null
  switch (b.action) {
    case 'rename_chat': {
      if (!id) return bad('Missing chat.')
      // Blank goes back to the first question as the name.
      return { action: 'rename_chat', id, title: cleanName(b.title, CHAT_TITLE_MAX) }
    }
    case 'pin_chat':
      if (!id) return bad('Missing chat.')
      return { action: 'pin_chat', id, pinned: b.pinned !== false }
    case 'move_chat': {
      if (!id) return bad('Missing chat.')
      if (b.folder_id === null || b.folder_id === undefined || b.folder_id === '') return { action: 'move_chat', id, folder_id: null }
      if (typeof b.folder_id !== 'string' || !UUID.test(b.folder_id)) return bad('Unknown folder.')
      return { action: 'move_chat', id, folder_id: b.folder_id }
    }
    case 'delete_chat':
      if (!id) return bad('Missing chat.')
      return { action: 'delete_chat', id }
    case 'create_folder': {
      const name = cleanName(b.name, FOLDER_NAME_MAX)
      if (!name) return bad('Give the folder a name.')
      return { action: 'create_folder', name }
    }
    case 'rename_folder': {
      if (!id) return bad('Missing folder.')
      const name = cleanName(b.name, FOLDER_NAME_MAX)
      if (!name) return bad('Give the folder a name.')
      return { action: 'rename_folder', id, name }
    }
    case 'delete_folder':
      if (!id) return bad('Missing folder.')
      return { action: 'delete_folder', id }
    default:
      return bad('Unknown action.')
  }
}

type DbError = { code?: string; message?: string } | null

function failure(error: DbError, where: string): OrganizeResult {
  if (missing(error)) return NOT_READY
  console.error(`[chatOrganize] ${where}`, error?.message)
  return FAILED
}

/** Update one of the member's own (not deleted) chats; not_found when nothing matched. */
async function updateChat(memberId: string, id: string, patch: Record<string, unknown>, where: string): Promise<OrganizeResult> {
  const { data, error } = await supabase
    .from('ciao_conversations')
    .update(patch)
    .eq('member_id', memberId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
  if (error) return failure(error, where)
  return (data ?? []).length > 0 ? { ok: true } : notFound('chat')
}

/** Is this folder the member's own? null = the folders table is not there yet. */
async function ownFolder(memberId: string, id: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('ciao_chat_folders').select('id').eq('member_id', memberId).eq('id', id).limit(1)
  if (error) {
    if (!missing(error)) console.error('[chatOrganize] own folder', error.message)
    return null
  }
  return (data ?? []).length > 0
}

/** The member's folders, oldest first. null before the migration ran. */
export async function listFolders(memberId: string): Promise<Folder[] | null> {
  const { data, error } = await supabase.from('ciao_chat_folders').select('id, name, created_at').eq('member_id', memberId).order('created_at', { ascending: true }).limit(100)
  if (error) {
    if (!missing(error)) console.error('[chatOrganize] folders', error.message)
    return null
  }
  return (data ?? []) as Folder[]
}

/** Run one list action for the signed-in member. */
export async function organize(repId: string, memberId: string, a: OrganizeAction): Promise<OrganizeResult> {
  switch (a.action) {
    case 'rename_chat':
      return updateChat(memberId, a.id, { title: a.title || null }, 'rename chat')
    case 'pin_chat':
      return updateChat(memberId, a.id, { pinned_at: a.pinned ? new Date().toISOString() : null }, 'pin chat')
    case 'move_chat': {
      if (a.folder_id) {
        const own = await ownFolder(memberId, a.folder_id)
        if (own === null) return NOT_READY
        if (!own) return notFound('folder')
      }
      return updateChat(memberId, a.id, { folder_id: a.folder_id }, 'move chat')
    }
    case 'delete_chat': {
      const r = await updateChat(memberId, a.id, { deleted_at: new Date().toISOString(), pinned_at: null, folder_id: null }, 'delete chat')
      return r.ok ? { ok: true, deleted_chat: a.id } : r
    }
    case 'create_folder': {
      const { data, error } = await supabase
        .from('ciao_chat_folders')
        .insert({ rep_id: repId, member_id: memberId, name: a.name })
        .select('id, name, created_at')
        .limit(1)
      if (error) return failure(error, 'create folder')
      const folder = ((data ?? [])[0] as Folder | undefined) ?? null
      return folder ? { ok: true, folder } : FAILED
    }
    case 'rename_folder': {
      const { data, error } = await supabase.from('ciao_chat_folders').update({ name: a.name }).eq('member_id', memberId).eq('id', a.id).select('id, name, created_at')
      if (error) return failure(error, 'rename folder')
      const folder = ((data ?? [])[0] as Folder | undefined) ?? null
      return folder ? { ok: true, folder } : notFound('folder')
    }
    case 'delete_folder': {
      const own = await ownFolder(memberId, a.id)
      if (own === null) return NOT_READY
      if (!own) return notFound('folder')
      // Its chats go back to Recent first; a chat is never deleted with its folder.
      const { error: e1 } = await supabase.from('ciao_conversations').update({ folder_id: null }).eq('member_id', memberId).eq('folder_id', a.id)
      if (e1) return failure(e1, 'empty folder')
      const { error: e2 } = await supabase.from('ciao_chat_folders').delete().eq('member_id', memberId).eq('id', a.id)
      if (e2) return failure(e2, 'delete folder')
      return { ok: true }
    }
  }
}
