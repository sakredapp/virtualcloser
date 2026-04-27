// GoHighLevel CRM — v1 REST client
// Credentials stored in reps.integrations: { ghl_api_key, ghl_location_id }

const BASE = 'https://public-api.gohighlevel.com/v1'

export type GHLContact = {
  id?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  companyName?: string
  tags?: string[]
  locationId?: string
  [key: string]: unknown
}

export type GHLOpportunity = {
  id?: string
  title: string
  status?: string
  pipelineId: string
  stageId: string
  contactId: string
  monetaryValue?: number
  [key: string]: unknown
}

export type GHLNote = {
  id?: string
  body: string
  contactId?: string
  userId?: string
}

export class AgentCRM {
  constructor(
    private readonly apiKey: string,
    private readonly locationId: string,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`GHL API ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  /** Search contacts by email or phone */
  async searchContacts(query: string): Promise<GHLContact[]> {
    const params = new URLSearchParams({ locationId: this.locationId })
    if (query.includes('@')) {
      params.set('email', query)
    } else {
      params.set('phone', query)
    }
    const res = await this.request<{ contacts?: GHLContact[] }>(
      'GET',
      `/contacts/search/duplicate?${params}`,
    )
    return res.contacts ?? []
  }

  /** Create a new contact */
  async createContact(data: Omit<GHLContact, 'id' | 'locationId'>): Promise<GHLContact> {
    return this.request<GHLContact>('POST', '/contacts/', {
      ...data,
      locationId: this.locationId,
    })
  }

  /** Update an existing contact */
  async updateContact(contactId: string, data: Partial<GHLContact>): Promise<GHLContact> {
    return this.request<GHLContact>('PUT', `/contacts/${contactId}`, data)
  }

  /** Get a contact by ID */
  async getContact(contactId: string): Promise<GHLContact> {
    return this.request<GHLContact>('GET', `/contacts/${contactId}`)
  }

  /** Add a note to a contact */
  async addNote(contactId: string, body: string): Promise<GHLNote> {
    return this.request<GHLNote>('POST', `/contacts/${contactId}/notes`, {
      body,
      userId: '',
    })
  }

  /** Search opportunities for a contact */
  async getOpportunities(contactId: string): Promise<GHLOpportunity[]> {
    const params = new URLSearchParams({
      location_id: this.locationId,
      contact_id: contactId,
    })
    const res = await this.request<{ opportunities?: GHLOpportunity[] }>(
      'GET',
      `/opportunities/search?${params}`,
    )
    return res.opportunities ?? []
  }

  /** Move an opportunity to a different pipeline stage */
  async moveOpportunityStage(opportunityId: string, stageId: string): Promise<void> {
    await this.request('PUT', `/opportunities/${opportunityId}`, { stageId })
  }

  /** Create an opportunity */
  async createOpportunity(
    data: Omit<GHLOpportunity, 'id'>,
  ): Promise<GHLOpportunity> {
    return this.request<GHLOpportunity>('POST', '/opportunities/', {
      ...data,
      locationId: this.locationId,
    })
  }
}

/** Build an AgentCRM instance from a rep's integrations JSONB.
 *  Returns null if credentials are not configured.
 *  @deprecated Prefer makeAgentCRMForRep(repId) which checks client_integrations first. */
export function makeAgentCRM(
  rep: { integrations?: Record<string, unknown> | null },
): AgentCRM | null {
  const i = (rep.integrations ?? {}) as Record<string, string>
  if (!i.ghl_api_key || !i.ghl_location_id) return null
  return new AgentCRM(i.ghl_api_key, i.ghl_location_id)
}

/** Async factory: looks up client_integrations table first, falls back to reps.integrations JSONB.
 *  Use this everywhere — it transparently handles both old and new credential storage. */
export async function makeAgentCRMForRep(repId: string): Promise<AgentCRM | null> {
  const { getIntegrationConfig } = await import('./client-integrations')
  const config = await getIntegrationConfig(repId, 'ghl')
  const apiKey = config?.api_key as string | undefined
  const locationId = config?.location_id as string | undefined
  if (!apiKey || !locationId) return null
  return new AgentCRM(apiKey, locationId)
}
