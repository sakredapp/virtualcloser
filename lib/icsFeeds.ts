/**
 * Subscribed calendars (Apple / iCloud public links, any .ics link) for the
 * Calendar page. One row per member per link in cxo_ics_feeds; events are
 * expanded and cached on the row and refreshed about every 15 minutes.
 *
 * Fetching someone else's URL from our server is guarded: https only
 * (webcal:// is rewritten), every DNS answer must be a public address (checked
 * at connect time, so a rebinding DNS cannot slip a private IP in), at most 3
 * redirects (each re-checked), 10 s total, 5 MB cap.
 */
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import type { IncomingMessage } from 'node:http'
import { supabase } from '@/lib/supabase'
import { parseIcs, type IcsEvent } from '@/lib/ics'

export const ICS_MAX_BYTES = 5 * 1024 * 1024
export const ICS_TIMEOUT_MS = 10_000
export const ICS_REFRESH_MS = 15 * 60_000
export const ICS_MAX_FEEDS = 10
const WINDOW_BACK_DAYS = 90
const WINDOW_AHEAD_DAYS = 400

export class IcsUrlError extends Error {}

/** webcal:// → https://; anything but https is refused. */
export function normalizeIcsUrl(raw: string): string {
  const v = (raw || '').trim()
  if (!v) throw new IcsUrlError('Paste the calendar link.')
  if (v.length > 2000) throw new IcsUrlError('That link is too long.')
  const fixed = v.replace(/^webcals?:\/\//i, 'https://')
  let u: URL
  try {
    u = new URL(fixed)
  } catch {
    throw new IcsUrlError('That does not look like a link. It should start with webcal:// or https://')
  }
  if (u.protocol !== 'https:') throw new IcsUrlError('Use a webcal:// or https:// link.')
  if (u.username || u.password) throw new IcsUrlError('Links with a username or password are not supported.')
  if (u.port && u.port !== '443') throw new IcsUrlError('That link uses an unusual port. Use the standard calendar link.')
  u.hash = ''
  return u.toString()
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and mapped-private addresses. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (v === '::' || v === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mapped) return isPrivateIp(mapped[1])
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(v)) return true // hex-mapped v4: refuse rather than decode
    const head = parseInt(v.split(':')[0] || '0', 16)
    if ((head & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
    if ((head & 0xffc0) === 0xfe80) return true // fe80::/10 link local
    if ((head & 0xff00) === 0xff00) return true // multicast
    if (v.startsWith('64:ff9b:') || v.startsWith('2001:db8:') || v.startsWith('100::')) return true
    return false
  }
  return true // not an IP at all: refuse
}

/** dns.lookup that refuses private answers; used as the socket's lookup so the checked IP is the one connected to. */
function guardedLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '')
    const list = (addrs as dns.LookupAddress[]) ?? []
    if (!list.length || list.some((a) => isPrivateIp(a.address))) {
      const e = new Error('That link points to a private address.') as NodeJS.ErrnoException
      e.code = 'EPRIVATE'
      return cb(e, '')
    }
    if (options.all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

function getOnce(url: URL, deadline: number): Promise<{ res: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateIp(url.hostname.replace(/^\[|\]$/g, ''))) {
      reject(new IcsUrlError('That link points to a private address.'))
      return
    }
    const req = https.get(
      url,
      {
        lookup: guardedLookup as unknown as typeof dns.lookup,
        headers: { 'user-agent': 'SuiteCXO-Calendar/1.0', accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1', 'accept-encoding': 'gzip, deflate' },
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => resolve({ res }),
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/** Fetch an .ics body with the guards above. Throws IcsUrlError with a plain message. */
export async function fetchIcs(rawUrl: string): Promise<string> {
  const deadline = Date.now() + ICS_TIMEOUT_MS
  let url = new URL(normalizeIcsUrl(rawUrl))
  for (let hop = 0; hop <= 3; hop++) {
    let res: IncomingMessage
    try {
      ;({ res } = await getOnce(url, deadline))
    } catch (err) {
      if (err instanceof IcsUrlError) throw err
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'EPRIVATE') throw new IcsUrlError('That link points to a private address.')
      if (code === 'ENOTFOUND') throw new IcsUrlError('That address could not be found. Check the link.')
      if ((err as Error)?.message === 'timeout') throw new IcsUrlError('The calendar took too long to answer.')
      throw new IcsUrlError('Could not reach that calendar.')
    }
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      if (hop === 3) throw new IcsUrlError('That link redirects too many times.')
      url = new URL(normalizeIcsUrl(new URL(res.headers.location, url).toString()))
      continue
    }
    if (status === 404 || status === 410) {
      res.resume()
      throw new IcsUrlError('That calendar was not found. It may no longer be shared.')
    }
    if (status === 401 || status === 403) {
      res.resume()
      throw new IcsUrlError('That calendar is private. Turn on Public Calendar and copy the link again.')
    }
    if (status < 200 || status >= 300) {
      res.resume()
      throw new IcsUrlError(`The calendar answered with an error (${status}).`)
    }
    const declared = Number(res.headers['content-length'] || 0)
    if (declared > ICS_MAX_BYTES) {
      res.destroy()
      throw new IcsUrlError('That calendar is too large (over 5 MB).')
    }
    const enc = String(res.headers['content-encoding'] || '').toLowerCase()
    const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      const timer = setTimeout(() => {
        res.destroy()
        reject(new IcsUrlError('The calendar took too long to answer.'))
      }, Math.max(1, deadline - Date.now()))
      stream.on('data', (c: Buffer) => {
        size += c.length
        if (size > ICS_MAX_BYTES) {
          clearTimeout(timer)
          res.destroy()
          reject(new IcsUrlError('That calendar is too large (over 5 MB).'))
          return
        }
        chunks.push(c)
      })
      stream.on('end', () => {
        clearTimeout(timer)
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      stream.on('error', () => {
        clearTimeout(timer)
        reject(new IcsUrlError('Could not read that calendar.'))
      })
    })
  }
  throw new IcsUrlError('That link redirects too many times.')
}

/** Fetch + parse + expand. Throws IcsUrlError when the body is not a calendar. */
export async function loadIcs(url: string, now = new Date()): Promise<{ name: string | null; events: IcsEvent[] }> {
  const text = await fetchIcs(url)
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 4096))) throw new IcsUrlError('That link is not a calendar (.ics). Copy the Share Link from the Calendar app.')
  const cal = parseIcs(text, { from: new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000), to: new Date(now.getTime() + WINDOW_AHEAD_DAYS * 86_400_000) })
  return { name: cal.name, events: cal.events }
}

// ── Storage ───────────────────────────────────────────────────────────────

export type IcsFeed = { id: string; url: string; label: string; events: IcsEvent[]; fetched_at: string | null; last_error: string | null }

export function icsMissing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

export async function listFeeds(repId: string, memberId: string): Promise<IcsFeed[]> {
  const { data, error } = await supabase
    .from('cxo_ics_feeds')
    .select('id, url, label, events, fetched_at, last_error')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .order('created_at', { ascending: true })
  if (error) {
    if (icsMissing(error)) return []
    throw error
  }
  return ((data ?? []) as IcsFeed[]).map((f) => ({ ...f, events: Array.isArray(f.events) ? f.events : [] }))
}

/** Hide the secret part of a share link when we show it back. */
export function maskIcsUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}/…`
  } catch {
    return 'calendar link'
  }
}

export async function addFeed(repId: string, memberId: string, rawUrl: string, label?: string | null): Promise<IcsFeed> {
  const url = normalizeIcsUrl(rawUrl)
  const { count } = await supabase.from('cxo_ics_feeds').select('id', { count: 'exact', head: true }).eq('member_id', memberId)
  if ((count ?? 0) >= ICS_MAX_FEEDS) throw new IcsUrlError(`You can add up to ${ICS_MAX_FEEDS} calendar links.`)
  const cal = await loadIcs(url)
  const name = (label ?? '').trim().slice(0, 60) || cal.name?.slice(0, 60) || 'Apple calendar'
  const { data, error } = await supabase
    .from('cxo_ics_feeds')
    .upsert({ rep_id: repId, member_id: memberId, url, label: name, events: cal.events, fetched_at: new Date().toISOString(), last_error: null }, { onConflict: 'member_id,url' })
    .select('id, url, label, events, fetched_at, last_error')
    .single()
  if (error) throw error
  return data as IcsFeed
}

export async function removeFeed(repId: string, memberId: string, id: string): Promise<void> {
  const { error } = await supabase.from('cxo_ics_feeds').delete().eq('rep_id', repId).eq('member_id', memberId).eq('id', id)
  if (error) throw error
}

/** Re-fetch one feed. Keeps the old events when the fetch fails and notes why. */
export async function refreshFeed(feed: Pick<IcsFeed, 'id' | 'url'>): Promise<void> {
  try {
    const cal = await loadIcs(feed.url)
    await supabase.from('cxo_ics_feeds').update({ events: cal.events, fetched_at: new Date().toISOString(), last_error: null }).eq('id', feed.id)
  } catch (err) {
    const msg = err instanceof IcsUrlError ? err.message : 'Could not refresh this calendar.'
    await supabase.from('cxo_ics_feeds').update({ fetched_at: new Date().toISOString(), last_error: msg }).eq('id', feed.id)
  }
}

export const isStale = (f: Pick<IcsFeed, 'fetched_at'>, now = Date.now()) => !f.fetched_at || now - Date.parse(f.fetched_at) > ICS_REFRESH_MS
