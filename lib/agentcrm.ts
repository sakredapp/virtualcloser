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

  // ── Tags ────────────────────────────────────────────────────────────
  // Reps build their own GHL workflows keyed off these tags. The dialer
  // stamps `vc-confirmed` / `vc-reschedule-requested` / `vc-no-answer`
  // outcomes so the rep's existing automations can fire SMS sequences
  // without us writing any SMS code.

  /** Add tags to a contact (idempotent — GHL dedups). */
  async addTag(contactId: string, tags: string[]): Promise<void> {
    if (!tags.length) return
    await this.request('POST', `/contacts/${contactId}/tags/`, { tags })
  }

  /** Remove tags from a contact. */
  async removeTag(contactId: string, tags: string[]): Promise<void> {
    if (!tags.length) return
    await this.request('DELETE', `/contacts/${contactId}/tags/`, { tags })
  }

  // ── Workflows ───────────────────────────────────────────────────────

  /** Enroll a contact in a GHL workflow (e.g. SMS nurture). */
  async addToWorkflow(contactId: string, workflowId: string): Promise<void> {
    await this.request('POST', `/contacts/${contactId}/workflow/${workflowId}`)
  }

  /** Remove a contact from a GHL workflow. */
  async removeFromWorkflow(contactId: string, workflowId: string): Promise<void> {
    await this.request('DELETE', `/contacts/${contactId}/workflow/${workflowId}`)
  }

  // ── Conversations / SMS ─────────────────────────────────────────────
  // Sends an outbound SMS through GHL's messaging infrastructure. The
  // message appears in the contact's GHL conversation inbox and fires
  // any GHL workflows the rep has built on that conversation (e.g. "SMS
  // sent" triggers). This is the right path when the rep is GHL-primary —
  // the message is fully tracked inside GHL with no extra setup.

  /** Send an outbound SMS to a contact via GHL's conversations API.
   *  Returns the GHL message ID on success. */
  async sendConversationMessage(
    contactId: string,
    message: string,
  ): Promise<{ id?: string; messageId?: string }> {
    return this.request<{ id?: string; messageId?: string }>(
      'POST',
      '/conversations/messages',
      { type: 'SMS', contactId, message },
    )
  }

  /** Look up a contact by phone number. Returns the GHL contact ID if found. */
  async findContactByPhone(phone: string): Promise<string | null> {
    const digits = phone.replace(/[^\d]/g, '')
    const queries = [
      phone,
      digits.length === 10 ? `+1${digits}` : null,
      digits.length === 11 && digits.startsWith('1') ? `+${digits}` : null,
    ].filter(Boolean) as string[]

    for (const q of queries) {
      const matches = await this.searchContacts(q).catch(() => [])
      if (matches.length > 0 && matches[0].id) return matches[0].id
    }
    return null
  }

  // ── Appointments ────────────────────────────────────────────────────
  // Many GHL tenants book inside GHL's calendar instead of Google. The
  // dialer treats GHL appointments as another `meetings` source.

  /** List appointments on a GHL calendar in a window. */
  async getAppointments(
    calendarId: string,
    opts: { startMs: number; endMs: number; userId?: string },
  ): Promise<GHLAppointment[]> {
    const params = new URLSearchParams({
      calendarId,
      startDate: String(opts.startMs),
      endDate: String(opts.endMs),
      includeAll: 'true',
    })
    if (opts.userId) params.set('userId', opts.userId)
    const res = await this.request<{ appointments?: GHLAppointment[] }>(
      'GET',
      `/appointments/?${params}`,
    )
    return res.appointments ?? []
  }

  /** List calendars on the location. */
  async listCalendars(): Promise<GHLCalendar[]> {
    const res = await this.request<{ calendars?: GHLCalendar[] }>(
      'GET',
      `/calendars/?locationId=${encodeURIComponent(this.locationId)}`,
    )
    return res.calendars ?? []
  }
}

export type GHLAppointment = {
  id?: string
  calendarId?: string
  contactId?: string
  title?: string
  status?: string
  appoinmentStatus?: string  // GHL legacy spelling — kept for parity
  startTime?: string
  endTime?: string
  address?: string
  notes?: string
  [key: string]: unknown
}

export type GHLCalendar = {
  id: string
  name?: string
  description?: string
  isActive?: boolean
  [key: string]: unknown
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
