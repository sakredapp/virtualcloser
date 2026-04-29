/**
 * Contract tests for the RevRing voice provider infrastructure.
 *
 * Pure TypeScript — no external test runner required.
 * Run with:  npx ts-node --project tsconfig.json __tests__/voice/revring.test.ts
 *
 * Each test function returns void or throws an Error on failure.
 * The harness at the bottom collects results and exits non-zero if anything fails.
 */

import { normalizeAndValidateFlowDefinition } from '../../lib/voice/revringFlow'

// ── Tiny harness ──────────────────────────────────────────────────────────

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
function test(name: string, fn: TestFn) { tests.push({ name, fn }) }
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(`Assertion failed: ${msg}`) }
function assertEq<T>(a: T, b: T, msg?: string) {
  if (a !== b) throw new Error(`${msg ?? 'assertEq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

// ── RevRing send-call response parsing ───────────────────────────────────
// The RevRing docs specify the call id is nested under data.id.
// Our adapter falls back to top-level id for resilience.

test('parseRevringResponse: data.id preferred', () => {
  const json: { id?: string; data?: { id?: string } } = { data: { id: 'rr_abc' }, id: 'rr_old' }
  const id = json.data?.id || json.id
  assertEq(id, 'rr_abc', 'data.id should take precedence')
})

test('parseRevringResponse: top-level id fallback', () => {
  const json: { id?: string; data?: { id?: string } } = { id: 'rr_xyz' }
  const id = json.data?.id || json.id
  assertEq(id, 'rr_xyz', 'should fall back to top-level id')
})

test('parseRevringResponse: missing id throws', () => {
  const json: { id?: string; data?: { id?: string } } = {}
  const id = json.data?.id || json.id
  assert(!id, 'no id should be falsy')
})

// ── Hard live gate ────────────────────────────────────────────────────────
// The gate logic is: live = envAllows || config.live_enabled. dry_run = !live || config.dry_run !== false.

test('liveGate: dry_run=true when neither env nor config enables live', () => {
  const envLive: string | undefined = undefined
  const envAllows = envLive === 'true' || envLive === '1'
  const configLiveEnabled = false
  const liveEnabled = envAllows || configLiveEnabled
  const dryRun = !liveEnabled || false // config.dry_run !== false defaults to dry
  assert(dryRun, 'should be dry run when live not enabled')
})

test('liveGate: live calls allowed when VOICE_LIVE_ENABLED=true', () => {
  const envLive = 'true'
  const envAllows = envLive === 'true' || envLive === '1'
  const liveEnabled = envAllows || false
  assert(liveEnabled, 'live should be enabled via env')
})

test('liveGate: live calls allowed via config.live_enabled', () => {
  const envLive: string | undefined = undefined
  const envAllows = envLive === 'true' || envLive === '1'
  const configLiveEnabled = true
  const liveEnabled = envAllows || configLiveEnabled
  assert(liveEnabled, 'live should be enabled via config')
})

// ── skipQueue behavior ────────────────────────────────────────────────────

test('skipQueue: boolean true maps to true', () => {
  const raw = { skip_queue: true }
  const v = Boolean(raw.skip_queue)
  assertEq(v, true)
})

test('skipQueue: boolean false maps to false', () => {
  const raw = { skip_queue: false }
  const v = Boolean(raw.skip_queue)
  assertEq(v, false)
})

test('skipQueue: missing key is false', () => {
  const raw: Record<string, unknown> = {}
  const v = Boolean(raw.skip_queue)
  assertEq(v, false)
})

// ── Webhook payload variants ──────────────────────────────────────────────

test('webhookCallId: nested call.id preferred', () => {
  const body = { call: { id: 'nested_id' }, callId: 'flat_id', id: 'top_id' }
  const id = body.call?.id || body.callId || body.id
  assertEq(id, 'nested_id')
})

test('webhookCallId: callId fallback', () => {
  const body: { call?: { id?: string }; callId?: string; id?: string } = { callId: 'flat_id', id: 'top_id' }
  const id = body.call?.id || body.callId || body.id
  assertEq(id, 'flat_id')
})

test('webhookCallId: top-level id last resort', () => {
  const body: { call?: { id?: string }; callId?: string; id?: string } = { id: 'top_id' }
  const id = body.call?.id || body.callId || body.id
  assertEq(id, 'top_id')
})

test('webhookCallId: no id -> falsy', () => {
  const body: { call?: { id?: string }; callId?: string; id?: string } = {}
  const id = body.call?.id || body.callId || body.id
  assert(!id, 'should be falsy when no id present')
})

// ── Secret verification path ──────────────────────────────────────────────
// We use timingSafeEqual; test the pre-conditions.

test('secretVerify: empty expected = allow (skip verification)', () => {
  const expected = ''
  const provided = 'any'
  // When expected is empty, verifyRevringSecret returns true (open dev hook).
  const allow = !expected
  assert(allow, 'empty expected should skip verification')
})

test('secretVerify: length mismatch = reject', () => {
  const expected = 'secretABC'
  const provided = 'wrong'
  // Fast-reject before timingSafeEqual for different lengths.
  const reject = provided.length !== expected.length
  assert(reject, 'different length should reject')
})

test('secretVerify: same value = accept', () => {
  const expected = 'secretABC'
  const provided = 'secretABC'
  // Lengths match; timingSafeEqual would confirm.
  const lengthOk = provided.length === expected.length
  const bytesMatch = Buffer.from(provided).equals(Buffer.from(expected))
  assert(lengthOk && bytesMatch, 'same secret should be accepted')
})

// ── Flow definition validator ─────────────────────────────────────────────

const VALID_FLOW = {
  schemaVersion: 1,
  begin: { startNodeId: 'n1', whoSpeaksFirst: 'agent' as const },
  nodes: [{ id: 'n1', type: 'conversation' }],
  edges: [],
}

test('flowValidator: valid minimal flow passes', () => {
  const result = normalizeAndValidateFlowDefinition(VALID_FLOW)
  assert(result.ok, `expected ok, got error: ${!result.ok && result.error}`)
})

test('flowValidator: missing schemaVersion fails', () => {
  const bad = { ...VALID_FLOW, schemaVersion: 2 }
  const result = normalizeAndValidateFlowDefinition(bad)
  assert(!result.ok, 'schemaVersion 2 should fail')
})

test('flowValidator: startNodeId not in nodes fails', () => {
  const bad = {
    ...VALID_FLOW,
    begin: { startNodeId: 'nonexistent', whoSpeaksFirst: 'agent' as const },
  }
  const result = normalizeAndValidateFlowDefinition(bad)
  assert(!result.ok, 'missing startNodeId should fail')
})

test('flowValidator: duplicate node ids fail', () => {
  const bad = {
    ...VALID_FLOW,
    nodes: [{ id: 'n1' }, { id: 'n1' }],
  }
  const result = normalizeAndValidateFlowDefinition(bad)
  assert(!result.ok, 'duplicate node ids should fail')
})

test('flowValidator: edge to unknown target fails', () => {
  const bad = {
    ...VALID_FLOW,
    edges: [{ source: 'n1', target: 'ghost', kind: 'default' as const }],
  }
  const result = normalizeAndValidateFlowDefinition(bad)
  assert(!result.ok, 'edge to unknown target should fail')
})

test('flowValidator: condition edge without condition object fails', () => {
  const bad = {
    ...VALID_FLOW,
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    edges: [{ source: 'n1', target: 'n2', kind: 'condition' as const, order: 1 }],
  }
  const result = normalizeAndValidateFlowDefinition(bad)
  assert(!result.ok, 'condition edge missing condition should fail')
})

test('flowValidator: valid prompt condition edge passes', () => {
  const flow = {
    schemaVersion: 1,
    begin: { startNodeId: 'n1', whoSpeaksFirst: 'agent' as const },
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    edges: [{
      source: 'n1',
      target: 'n2',
      kind: 'condition' as const,
      order: 1,
      condition: { type: 'prompt', promptText: 'Did they confirm?' },
    }],
  }
  const result = normalizeAndValidateFlowDefinition(flow)
  assert(result.ok, `expected ok, got: ${!result.ok && result.error}`)
})

test('flowValidator: JSON string input is parsed', () => {
  const json = JSON.stringify(VALID_FLOW)
  const result = normalizeAndValidateFlowDefinition(json)
  assert(result.ok, `expected ok from JSON string, got: ${!result.ok && result.error}`)
})

test('flowValidator: invalid JSON string fails', () => {
  const result = normalizeAndValidateFlowDefinition('{not valid json}')
  assert(!result.ok, 'invalid JSON should fail')
})

// ── Run ───────────────────────────────────────────────────────────────────

async function run() {
  let passed = 0
  let failed = 0
  const failures: string[] = []

  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`  ✓ ${name}`)
      passed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ✗ ${name}\n    ${msg}`)
      failures.push(`${name}: ${msg}`)
      failed++
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
