// Guardrails on what participants send in.
//
// The promise to a participant is that the conversation is about the work, not about people.
// So the filter looks for what identifies a person, instead of locking the input down.
import type { D1Database } from '@cloudflare/workers-types'

export const MAX_INPUT = 500

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
const PHONE_LIKE = /\+?\d[\d\s().-]{7,}\d/g

/** A starting point, not a full PII filter: email addresses and phone-like runs of nine or more digits. */
export function containsPersonalData(text: string): boolean {
  if (EMAIL.test(text)) return true
  return (text.match(PHONE_LIKE) ?? []).some((run) => run.replace(/\D/g, '').length >= 9)
}

/** For short fields such as a code or a name: all whitespace becomes one space. */
export function clean(value: unknown, max = MAX_INPUT): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** For answers. Line breaks stay, because a list of steps is also what someone said. */
export function cleanMessage(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_INPUT)
}

export function slugify(text: string, max: number): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
}

/** No 0, o, 1 or l: codes get read aloud and typed over. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

export function newCode(length = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/** Codes are unique across all projects, because the code alone identifies the conversation. */
export async function newUniqueCode(database: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = newCode(attempt < 8 ? 4 : 6)
    const exists = await database.prepare('SELECT 1 FROM participants WHERE code = ?').bind(code).first()
    if (!exists) return code
  }
  throw createError({ statusCode: 500, statusMessage: 'No free code found' })
}

/** A JSON list of strings from the database; anything else becomes an empty list. */
export function readList(json: string | null): string[] {
  if (!json) return []
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}
