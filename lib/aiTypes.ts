/**
 * The message shapes every AI call site in Suite CXO speaks.
 *
 * Owner 2026-10-10: no direct Anthropic calls and no Anthropic SDK. All AI
 * runs through OpenRouter (lib/aiProvider.ts). These are our own types, kept
 * in the content-block shape the call sites were written against, so the
 * provider layer can translate them to OpenRouter's chat format.
 *
 * There is deliberately no PDF ("document") block: a PDF is turned into text
 * on the server first (lib/extractText.ts) and the text is sent.
 */

export type CacheControl = { type: 'ephemeral' }

export type TextBlockParam = { type: 'text'; text: string; cache_control?: CacheControl | null }

export type ImageBlockParam = {
  type: 'image'
  source:
    | { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string }
    | { type: 'url'; url: string }
  cache_control?: CacheControl | null
}

export type ToolUseBlockParam = { type: 'tool_use'; id: string; name: string; input: unknown; cache_control?: CacheControl | null }

export type ToolResultBlockParam = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<TextBlockParam | ImageBlockParam>
  is_error?: boolean
  cache_control?: CacheControl | null
}

export type ContentBlockParam = TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam

export type TextBlock = { type: 'text'; text: string; citations?: unknown }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }
export type ContentBlock = TextBlock | ToolUseBlock

export type MessageParam = {
  role: 'user' | 'assistant'
  content: string | Array<ContentBlockParam | ContentBlock>
}

export type Tool = {
  name: string
  description?: string
  input_schema: { type: 'object'; properties?: unknown; required?: string[] | readonly string[]; [k: string]: unknown }
  cache_control?: CacheControl | null
}

export type ToolChoice = { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string } | { type: 'none' }

export type MessageCreateParams = {
  /** Ignored: text runs on the GLM model chosen in lib/aiProvider.ts. Kept so call sites can label logs. */
  model?: string
  max_tokens: number
  system?: string | TextBlockParam[]
  messages: MessageParam[]
  tools?: Tool[]
  tool_choice?: ToolChoice
  temperature?: number
  stop_sequences?: string[]
  stream?: boolean
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use'

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export type Message = {
  id: string
  type: 'message'
  role: 'assistant'
  /** The model that ran, e.g. "openrouter:z-ai/glm-5.3". */
  model: string
  content: ContentBlock[]
  stop_reason: StopReason | null
  stop_sequence: string | null
  usage: Usage
}

export type MessageStreamEvent =
  | { type: 'message_start'; message: Message }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: StopReason | null; stop_sequence: string | null }; usage: { output_tokens: number } }
  | { type: 'message_stop' }

export interface MessagesApi {
  create(params: MessageCreateParams & { stream: true }): Promise<AsyncIterable<MessageStreamEvent>>
  create(params: MessageCreateParams & { stream?: false }): Promise<Message>
}

/** The AI client every call site uses (lib/ai.ts getAI()). */
export interface AIClient {
  messages: MessagesApi
}
