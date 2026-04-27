// BlueBubbles HTTP API client — iMessage via macOS bridge
// Credentials stored in reps.integrations: { bluebubbles_url, bluebubbles_password }
//
// NOTE: BlueBubbles uses password as a query param — this is their API design.
// Only called server-side; credentials are never sent to the browser.

export type BBMessage = {
  guid: string
  text: string
  handle?: { address: string }
  isFromMe: boolean
  dateCreated?: number
  attachments?: Array<{ transferName: string; mimeType?: string }>
}

export type BBChat = {
  guid: string
  displayName?: string
  participants?: Array<{ address: string }>
  lastMessage?: BBMessage
}

export class BlueBubbles {
  private readonly base: string

  constructor(
    baseUrl: string,
    private readonly password: string,
  ) {
    // Normalise: strip trailing slash
    this.base = baseUrl.replace(/\/$/, '')
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.base}${path}`)
    url.searchParams.set('password', this.password)

    const res = await fetch(url.toString(), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`BlueBubbles ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  /** Send a text iMessage to a phone number or Apple ID email */
  async sendMessage(
    to: string,
    text: string,
    subject?: string,
  ): Promise<{ guid: string }> {
    return this.request<{ guid: string }>('POST', '/api/v1/message/text', {
      chatGuid: `iMessage;-;${to}`,
      message: text,
      subject: subject ?? null,
      method: 'apple-script',
      effectId: null,
    })
  }

  /** Fetch recent messages in a conversation */
  async getMessages(
    handle: string,
    limit = 25,
    offset = 0,
  ): Promise<BBMessage[]> {
    const res = await this.request<{ data: BBMessage[] }>(
      'GET',
      `/api/v1/chat/iMessage;-;${encodeURIComponent(handle)}/message?limit=${limit}&offset=${offset}&with=handle,attachment`,
    )
    return res.data ?? []
  }

  /** Get a list of chats (conversations) */
  async getChats(limit = 25, offset = 0): Promise<BBChat[]> {
    const res = await this.request<{ data: BBChat[] }>(
      'GET',
      `/api/v1/chat?limit=${limit}&offset=${offset}&with=lastMessage,participants`,
    )
    return res.data ?? []
  }

  /** Ping the server to verify connectivity */
  async pingServer(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/api/v1/server/info')
      return true
    } catch {
      return false
    }
  }

  /** Get server info (version, macOS version, etc.) */
  async getServerInfo(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/api/v1/server/info')
  }
}

/** Build a BlueBubbles instance from a rep's integrations JSONB.
 *  Returns null if credentials are not configured. */
export function makeBlueBubbles(
  rep: { integrations?: Record<string, unknown> | null },
): BlueBubbles | null {
  const i = (rep.integrations ?? {}) as Record<string, string>
  if (!i.bluebubbles_url || !i.bluebubbles_password) return null
  return new BlueBubbles(i.bluebubbles_url, i.bluebubbles_password)
}
