// RevRing Knowledge Base sync.
//
// Each client gets one KB in RevRing (all their training docs pooled).
// The KB ID is stored in client_integrations key='revring' under
// config.knowledge_base_id. On every sync we:
//   1. Create the KB if it doesn't exist yet.
//   2. Clear any previously-synced files (tracked by config.kb_file_ids[]).
//   3. Upload every active training doc that has text content (body column)
//      or a downloadable storage path.
//   4. Link the KB to every agent ID configured for this client.
//
// TODO: confirm the exact RevRing endpoint shapes with your rep.
//       The API surface matches standard patterns (Vapi, ElevenLabs, etc.)
//       so these should be correct, but endpoint paths may differ slightly.

import { supabase } from '@/lib/supabase'
import { getIntegrationConfig, upsertClientIntegration } from '@/lib/client-integrations'

const BASE = 'https://api.revring.ai/v1'

type RevRingApiKey = string

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

function rrHeaders(apiKey: RevRingApiKey) {
  return { 'x-api-key': apiKey, 'content-type': 'application/json' }
}

async function rrFetch(apiKey: RevRingApiKey, path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey,
      ...(init?.headers ?? {}),
    },
  })
  return res
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve which API key to use for this client
// ─────────────────────────────────────────────────────────────────────────────

export async function resolveRevringApiKey(repId: string): Promise<string | null> {
  const cfg = await getIntegrationConfig(repId, 'revring')
  const model = (cfg?.voice_billing_model as string) || 'shared'
  if (model === 'own_trunk') {
    return (cfg?.api_key as string) || null
  }
  // shared or platform_trunk — use platform key
  return process.env.REVRING_MASTER_API_KEY || process.env.REVRING_API_KEY || null
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Base CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function createKnowledgeBase(apiKey: RevRingApiKey, name: string): Promise<string> {
  // TODO: confirm endpoint + body shape with RevRing rep
  const res = await rrFetch(apiKey, '/knowledge-bases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`revring_create_kb_failed:${res.status}:${text}`)
  }
  const json = (await res.json()) as { id?: string; data?: { id?: string } }
  const id = json.data?.id ?? json.id
  if (!id) throw new Error('revring_create_kb_missing_id')
  return id
}

async function listKBFiles(apiKey: RevRingApiKey, kbId: string): Promise<string[]> {
  // TODO: confirm endpoint with RevRing rep
  const res = await rrFetch(apiKey, `/knowledge-bases/${kbId}/files`)
  if (!res.ok) return []
  const json = (await res.json()) as { data?: { id: string }[]; files?: { id: string }[] }
  const files = json.data ?? json.files ?? []
  return files.map((f) => f.id)
}

async function deleteKBFile(apiKey: RevRingApiKey, kbId: string, fileId: string): Promise<void> {
  // TODO: confirm endpoint with RevRing rep
  await rrFetch(apiKey, `/knowledge-bases/${kbId}/files/${fileId}`, { method: 'DELETE' })
}

async function uploadTextToKB(
  apiKey: RevRingApiKey,
  kbId: string,
  title: string,
  content: string,
): Promise<string | null> {
  // Upload text content as a .txt file via multipart form.
  // TODO: confirm endpoint + field names with RevRing rep.
  // Alternative if RevRing prefers JSON: POST /knowledge-bases/{id}/documents { title, content }
  const form = new FormData()
  const blob = new Blob([content], { type: 'text/plain' })
  form.append('file', blob, `${title.replace(/[^a-z0-9]/gi, '_').slice(0, 80)}.txt`)
  form.append('title', title)

  const res = await rrFetch(apiKey, `/knowledge-bases/${kbId}/files`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    console.warn(`[revring-kb] uploadText failed for "${title}": ${res.status} ${text}`)
    return null
  }
  const json = (await res.json()) as { id?: string; data?: { id?: string } }
  return json.data?.id ?? json.id ?? null
}

async function uploadBlobToKB(
  apiKey: RevRingApiKey,
  kbId: string,
  title: string,
  blob: Blob,
  filename: string,
): Promise<string | null> {
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('title', title)
  const res = await rrFetch(apiKey, `/knowledge-bases/${kbId}/files`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    console.warn(`[revring-kb] uploadBlob failed for "${filename}": ${res.status} ${text}`)
    return null
  }
  const json = (await res.json()) as { id?: string; data?: { id?: string } }
  return json.data?.id ?? json.id ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Link KB to agents
// ─────────────────────────────────────────────────────────────────────────────

async function linkKBToAgent(apiKey: RevRingApiKey, agentId: string, kbId: string): Promise<void> {
  // TODO: confirm endpoint + body with RevRing rep.
  // Common patterns: PATCH /v1/agents/{id} { knowledgeBaseIds: [...] }
  //                  POST  /v1/agents/{id}/knowledge-bases { knowledge_base_id: id }
  const res = await rrFetch(apiKey, `/agents/${agentId}/knowledge-bases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ knowledge_base_id: kbId }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    console.warn(`[revring-kb] linkKBToAgent ${agentId} failed: ${res.status} ${text}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sync — called after every training doc change
// ─────────────────────────────────────────────────────────────────────────────

export type KBSyncResult = {
  ok: boolean
  knowledge_base_id: string | null
  docs_uploaded: number
  agents_linked: string[]
  skipped_no_content: number
  error?: string
}

export async function syncTrainingDocsToRevRing(repId: string): Promise<KBSyncResult> {
  const apiKey = await resolveRevringApiKey(repId)
  if (!apiKey) {
    return { ok: false, knowledge_base_id: null, docs_uploaded: 0, agents_linked: [], skipped_no_content: 0, error: 'no_api_key' }
  }

  const cfg = await getIntegrationConfig(repId, 'revring')

  // ── 1. Ensure KB exists ──────────────────────────────────────────────────
  let kbId: string = (cfg?.knowledge_base_id as string) || ''
  if (!kbId) {
    const { data: repRow } = await supabase
      .from('reps')
      .select('slug, display_name')
      .eq('id', repId)
      .maybeSingle()
    const kbName = `VirtualCloser — ${repRow?.display_name ?? repRow?.slug ?? repId}`
    try {
      kbId = await createKnowledgeBase(apiKey, kbName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[revring-kb] createKnowledgeBase failed', { repId, msg })
      return { ok: false, knowledge_base_id: null, docs_uploaded: 0, agents_linked: [], skipped_no_content: 0, error: msg }
    }
  }

  // ── 2. Clear existing files ───────────────────────────────────────────────
  const existingFileIds = await listKBFiles(apiKey, kbId)
  await Promise.all(existingFileIds.map((fid) => deleteKBFile(apiKey, kbId, fid)))

  // ── 3. Fetch active training docs ────────────────────────────────────────
  const { data: docs } = await supabase
    .from('roleplay_training_docs')
    .select('id, title, body, storage_path, doc_kind')
    .eq('rep_id', repId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  const activeDocs = (docs ?? []) as {
    id: string
    title: string
    body: string | null
    storage_path: string | null
    doc_kind: string
  }[]

  // ── 4. Upload each doc ───────────────────────────────────────────────────
  const uploadedFileIds: string[] = []
  let skippedNoContent = 0

  for (const doc of activeDocs) {
    const label = `[${doc.doc_kind}] ${doc.title}`

    if (doc.body) {
      // Inline text — upload directly.
      const fid = await uploadTextToKB(apiKey, kbId, label, doc.body)
      if (fid) uploadedFileIds.push(fid)
    } else if (doc.storage_path) {
      // File in Supabase storage — download and re-upload to RevRing.
      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from('roleplay-training')
          .download(doc.storage_path)
        if (dlErr || !fileData) {
          console.warn(`[revring-kb] storage download failed for doc ${doc.id}:`, dlErr?.message)
          skippedNoContent++
          continue
        }
        const ext = doc.storage_path.split('.').pop() ?? 'bin'
        const safeTitle = doc.title.replace(/[^a-z0-9]/gi, '_').slice(0, 80)
        const fid = await uploadBlobToKB(apiKey, kbId, label, fileData, `${safeTitle}.${ext}`)
        if (fid) uploadedFileIds.push(fid)
      } catch (err) {
        console.warn(`[revring-kb] upload failed for doc ${doc.id}:`, err)
        skippedNoContent++
      }
    } else {
      skippedNoContent++
    }
  }

  // ── 5. Link KB to all configured agent IDs ───────────────────────────────
  const agentIds = [
    cfg?.confirm_agent_id,
    cfg?.reschedule_agent_id,
    cfg?.appointment_setter_agent_id,
    cfg?.pipeline_agent_id,
    cfg?.live_transfer_agent_id,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0)

  await Promise.all(agentIds.map((aid) => linkKBToAgent(apiKey, aid, kbId)))

  // ── 6. Persist KB ID + sync timestamp back to integration config ──────────
  const updatedConfig = {
    ...(cfg ?? {}),
    knowledge_base_id: kbId,
    kb_synced_at: new Date().toISOString(),
    kb_doc_count: uploadedFileIds.length,
  }
  await upsertClientIntegration(repId, 'revring', {
    label: (cfg as Record<string, unknown> | null)?.label as string ?? 'AI Voice',
    kind: 'api',
    config: updatedConfig,
  })

  console.info('[revring-kb] sync complete', {
    repId,
    kbId,
    uploaded: uploadedFileIds.length,
    agents: agentIds.length,
    skipped: skippedNoContent,
  })

  return {
    ok: true,
    knowledge_base_id: kbId,
    docs_uploaded: uploadedFileIds.length,
    agents_linked: agentIds,
    skipped_no_content: skippedNoContent,
  }
}
