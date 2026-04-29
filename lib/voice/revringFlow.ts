type FlowNode = {
  id: string
  isGlobal?: boolean
  data?: Record<string, unknown>
}

type FlowEdge = {
  source: string
  target: string
  kind: 'default' | 'condition' | 'else' | 'skip'
  order?: number
  condition?: Record<string, unknown>
}

type FlowDefinition = {
  schemaVersion: number
  begin: {
    startNodeId: string
    whoSpeaksFirst: 'agent' | 'user'
  }
  nodes: FlowNode[]
  edges: FlowEdge[]
}

const GLOBAL_SOURCE = '__global__'

export function normalizeAndValidateFlowDefinition(
  raw: unknown,
): { ok: true; value: FlowDefinition } | { ok: false; error: string } {
  const parsed = parseInput(raw)
  if (!parsed.ok) return parsed

  const flow = parsed.value

  if (flow.schemaVersion !== 1) {
    return { ok: false, error: 'flow_definition.schemaVersion must be 1' }
  }
  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    return { ok: false, error: 'flow_definition.nodes must contain at least one node' }
  }
  if (!Array.isArray(flow.edges)) {
    return { ok: false, error: 'flow_definition.edges must be an array' }
  }

  const nodeIds = new Set<string>()
  for (const node of flow.nodes) {
    if (!node.id || typeof node.id !== 'string') {
      return { ok: false, error: 'Each flow node must have a string id' }
    }
    if (nodeIds.has(node.id)) {
      return { ok: false, error: `Duplicate node id: ${node.id}` }
    }
    nodeIds.add(node.id)
  }

  if (!flow.begin?.startNodeId || !nodeIds.has(flow.begin.startNodeId)) {
    return { ok: false, error: 'flow_definition.begin.startNodeId must reference an existing node id' }
  }
  if (flow.begin.whoSpeaksFirst !== 'agent' && flow.begin.whoSpeaksFirst !== 'user') {
    return { ok: false, error: 'flow_definition.begin.whoSpeaksFirst must be "agent" or "user"' }
  }

  const nodeById = new Map(flow.nodes.map((n) => [n.id, n]))
  const outgoingBySource = new Map<string, FlowEdge[]>()

  for (const edge of flow.edges) {
    if (!edge.source || !edge.target || !edge.kind) {
      return { ok: false, error: 'Each flow edge must include source, target, and kind' }
    }
    if (edge.source !== GLOBAL_SOURCE && !nodeIds.has(edge.source)) {
      return { ok: false, error: `Edge source does not exist: ${edge.source}` }
    }
    if (!nodeIds.has(edge.target)) {
      return { ok: false, error: `Edge target does not exist: ${edge.target}` }
    }

    const arr = outgoingBySource.get(edge.source) ?? []
    arr.push(edge)
    outgoingBySource.set(edge.source, arr)

    if (edge.kind === 'condition') {
      if (!Number.isInteger(edge.order)) {
        return { ok: false, error: `Condition edge ${edge.source} -> ${edge.target} must include integer order` }
      }
      const c = edge.condition
      if (!c || typeof c !== 'object') {
        return { ok: false, error: `Condition edge ${edge.source} -> ${edge.target} missing condition` }
      }
      const ct = String((c as Record<string, unknown>).type ?? '')
      if (ct === 'prompt') {
        const p = String((c as Record<string, unknown>).promptText ?? '').trim()
        if (!p) return { ok: false, error: 'Prompt condition requires non-empty promptText' }
      } else if (ct === 'equation') {
        const eq = (c as Record<string, unknown>).equations
        if (!Array.isArray(eq) || eq.length === 0) {
          return { ok: false, error: 'Equation condition requires at least one equation' }
        }
      } else {
        return { ok: false, error: 'Condition type must be "prompt" or "equation"' }
      }
    }

    if (edge.source === GLOBAL_SOURCE) {
      if (edge.kind !== 'condition') {
        return { ok: false, error: '__global__ edges must use kind="condition"' }
      }
      const target = nodeById.get(edge.target)
      if (!target?.isGlobal) {
        return { ok: false, error: '__global__ edges must target nodes with isGlobal=true' }
      }
    }
  }

  for (const node of flow.nodes) {
    const outgoing = outgoingBySource.get(node.id) ?? []
    const byKind = countKinds(outgoing)

    const isLogicSplit = (node as Record<string, unknown>).type === 'logic_split'
    if (isLogicSplit && byKind.else !== 1) {
      return { ok: false, error: `logic_split node ${node.id} must have exactly one else edge` }
    }

    const isConversation = (node as Record<string, unknown>).type === 'conversation'
    const skipResponse = Boolean((node.data ?? {}).skipResponse)
    if (isConversation && skipResponse) {
      if (byKind.skip !== 1 || outgoing.length !== 1) {
        return { ok: false, error: `skipResponse node ${node.id} must have exactly one skip edge and no others` }
      }
    }

    if (node.isGlobal) {
      const globalIncoming = (outgoingBySource.get(GLOBAL_SOURCE) ?? []).filter((e) => e.target === node.id)
      if (!globalIncoming.length) {
        return { ok: false, error: `Global node ${node.id} must be targeted by at least one __global__ edge` }
      }
    }

    const orders = outgoing
      .filter((e) => e.kind === 'condition')
      .map((e) => Number(e.order))
    const uniqueOrders = new Set(orders)
    if (orders.length !== uniqueOrders.size) {
      return { ok: false, error: `Condition edges from node ${node.id} must have unique order values` }
    }
  }

  const approxSize = Buffer.byteLength(JSON.stringify(flow), 'utf8')
  if (approxSize > 48 * 1024) {
    return { ok: false, error: 'flow_definition exceeds 48KB limit' }
  }

  return { ok: true, value: flow }
}

function parseInput(
  raw: unknown,
): { ok: true; value: FlowDefinition } | { ok: false; error: string } {
  let value = raw
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return { ok: false, error: 'flow_definition cannot be empty string' }
    try {
      value = JSON.parse(trimmed)
    } catch {
      return { ok: false, error: 'flow_definition must be valid JSON' }
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'flow_definition must be an object' }
  }

  return { ok: true, value: value as FlowDefinition }
}

function countKinds(edges: FlowEdge[]): Record<FlowEdge['kind'], number> {
  return edges.reduce<Record<FlowEdge['kind'], number>>(
    (acc, e) => {
      acc[e.kind] += 1
      return acc
    },
    { default: 0, condition: 0, else: 0, skip: 0 },
  )
}