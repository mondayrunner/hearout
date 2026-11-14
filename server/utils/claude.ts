// The one place that calls Claude, so time-outs, schemas and error handling stay the same everywhere.
//
// Guiding principle: freedom in the conversation, no freedom in the outcome. The model decides
// how to follow up, but the shape of its answer is fixed by a schema, and the server decides
// how many turns there are.
//
// Every answer comes back as a call to one strict tool. That is fast, and the API keeps the
// fields to the schema. The model picks the tool itself (`tool_choice: auto`, the current models
// reject a forced tool call), so a turn without a tool call counts as unusable and is retried.
import Anthropic from '@anthropic-ai/sdk'

export const MODEL = 'claude-opus-5-5'

const TOOL_NAME = 'respond'
const EXTRA_ATTEMPTS = 2

export type Turn = { role: 'user' | 'assistant'; content: string }

export type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number }

export type Result<T> = { ok: true; data: T; usage: Usage; model: string } | { ok: false; error: string }

export type Topic = { key: string; label: string }

export type ConversationAnswer = { reply: string; done: boolean; suggestions: string[] }

export type SummaryAnswer = {
  in_one_sentence: string
  points: Array<{ key: string; topic: string; answer: string; discussed: boolean }>
  watch_out: string
}

type JsonSchema = {
  type?: string
  description?: string
  enum?: unknown[]
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
}

/** One turn of the interviewer. The server turns `done` into a finished conversation. */
export const conversationSchema: JsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Your question or your closing words, two or three sentences.' },
    done: { type: 'boolean', description: 'true as soon as you know enough.' },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'At most three short example answers to click. Empty if they add nothing.',
    },
  },
  required: ['reply', 'done', 'suggestions'],
  additionalProperties: false,
}

/**
 * The summary. With fixed topics on the project, `key` can only be one of those keys, so you can
 * group by topic later instead of hoping the model invents the same heading every time.
 */
export function summarySchema(topics: Topic[] | null): JsonSchema {
  const key: JsonSchema = topics?.length
    ? { type: 'string', enum: topics.map((topic) => topic.key) }
    : { type: 'string', description: 'Short lowercase key for the topic, one or two words.' }

  return {
    type: 'object',
    properties: {
      in_one_sentence: { type: 'string', description: 'What needs to be built or tackled here, in one sentence.' },
      points: {
        type: 'array',
        description: 'One point per topic from the brief, in the same order.',
        items: {
          type: 'object',
          properties: {
            key,
            topic: { type: 'string', description: 'The topic as a short heading.' },
            answer: {
              type: 'string',
              description: 'What was said, as close to their words as possible, or "not discussed".',
            },
            discussed: { type: 'boolean', description: 'false if this topic never came up.' },
          },
          required: ['key', 'topic', 'answer', 'discussed'],
          additionalProperties: false,
        },
      },
      watch_out: { type: 'string', description: 'The risk or open question that could hold up the follow-up.' },
    },
    required: ['in_one_sentence', 'points', 'watch_out'],
    additionalProperties: false,
  }
}

/** An answer that arrived but cannot be used: no tool call, cut off, or the wrong shape. */
class UnusableAnswer extends Error {}

export async function askClaude<T>(options: {
  apiKey: string
  /** The same for every turn of one participant, so it is cached. */
  system: string
  /** What changes per turn, such as the turn number. Sent after the history so the cache stays valid. */
  turnNote?: string
  messages: Turn[]
  schema: JsonSchema
  effort: 'low' | 'medium' | 'high'
  maxTokens: number
  timeoutMs?: number
  /** No retries of any kind, so the call never takes longer than `timeoutMs`. For work with a hard deadline. */
  singleAttempt?: boolean
}): Promise<Result<T>> {
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs ?? 30_000,
    maxRetries: options.singleAttempt ? 0 : 1,
  })
  const extraAttempts = options.singleAttempt ? 0 : EXTRA_ATTEMPTS

  // Two cache breakpoints: the system prompt, and the last message of the history. The turn note
  // goes in as a system message at the very end. Putting it in the system prompt instead would
  // change the prefix every turn, and nothing would ever be read from the cache.
  const last = options.messages.length - 1
  const messages = [
    ...options.messages.map((turn, index) =>
      index === last
        ? {
            role: turn.role,
            content: [{ type: 'text' as const, text: turn.content, cache_control: { type: 'ephemeral' as const } }],
          }
        : turn,
    ),
    ...(options.turnNote ? [{ role: 'system' as const, content: options.turnNote }] : []),
  ]

  for (let attempt = 0; ; attempt++) {
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: options.maxTokens,
        // If a safety classifier declines the request, the API reruns it on a fallback model
        // inside the same call. Remove these two lines to turn that off.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Thinking is always on for this model. Effort is the control for depth and speed.
        thinking: { type: 'adaptive' },
        output_config: { effort: options.effort },
        system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
        messages,
        tools: [
          {
            name: TOOL_NAME,
            description:
              'Delivers your turn. The fields are the whole response: plain text outside this tool is ' +
              'never shown to anyone, so every turn goes through this tool exactly once.',
            input_schema: options.schema as Anthropic.Beta.BetaTool.InputSchema,
            strict: true,
          },
        ],
        tool_choice: { type: 'auto' },
      } as Anthropic.Beta.MessageCreateParamsNonStreaming)

      // Repeating a refusal gets the same refusal.
      if (response.stop_reason === 'refusal') return { ok: false, error: `refused (${response.id})` }

      const call = response.content.find((block) => block.type === 'tool_use')
      const data = call && 'input' in call ? call.input : null
      if (!data || !matchesSchema(data, options.schema)) {
        throw new UnusableAnswer(`unusable answer (${response.stop_reason ?? 'unknown'}, ${response.id})`)
      }

      return {
        ok: true,
        data: data as T,
        usage: {
          input: response.usage.input_tokens ?? 0,
          cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
          output: response.usage.output_tokens ?? 0,
        },
        model: response.model ?? MODEL,
      }
    } catch (error: unknown) {
      if (error instanceof UnusableAnswer && attempt < extraAttempts) {
        console.warn('[claude] retrying:', error.message)
        continue
      }
      return { ok: false, error: describeError(error) }
    }
  }
}

/** Typed errors, from specific to general, so the log stays useful. */
function describeError(error: unknown): string {
  if (error instanceof UnusableAnswer) return error.message
  if (error instanceof Anthropic.AuthenticationError) return 'API key rejected'
  if (error instanceof Anthropic.RateLimitError) return 'rate limit'
  if (error instanceof Anthropic.BadRequestError) return `invalid request: ${error.message}`
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'time-out'
  if (error instanceof Anthropic.APIConnectionError) return 'network error'
  if (error instanceof Anthropic.APIError) return `api ${error.status ?? '?'}`
  return error instanceof Error ? error.message : 'unknown error'
}

/**
 * Checks an answer against the schema: types, required fields, no extra fields and enum values.
 * Enough for the two schemas above, not a full JSON Schema validator.
 */
export function matchesSchema(value: unknown, schema: JsonSchema): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false
  switch (schema.type) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value) && (!schema.items || value.every((item) => matchesSchema(item, schema.items!)))
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const object = value as Record<string, unknown>
      const fields = schema.properties ?? {}
      if ((schema.required ?? []).some((field) => !(field in object))) return false
      if (schema.additionalProperties === false && Object.keys(object).some((field) => !(field in fields))) return false
      return Object.entries(fields).every(([field, part]) => !(field in object) || matchesSchema(object[field], part))
    }
    default:
      return true
  }
}
