// Guardrails on what participants send in.
//
// The promise to a participant is that the conversation is about the work, not about people.
// So the filter looks for what identifies a person, instead of locking the input down.
export const MAX_INPUT = 500

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
// Dates are taken out first, so "01-02-2026 12 people" is not read as a number to call.
const DATE = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/g
// A number that starts with + or 0, written with at most two separators between digits. Amounts,
// ranges ("10.000 - 20.000") and order numbers do not start that way, and an interviewer who asks
// for numbers must be able to get them.
const PHONE_PREFIXED = /(?<![\d.,])(?:\+\d|\(?0)(?:[ ().-]{0,2}\d){7,14}(?!\d)/g
// The North American way of writing: 555-123-4567 or (555) 123 4567.
const PHONE_GROUPED = /(?<![\d.,])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/

/**
 * A starting point, not a full PII filter: email addresses and numbers written like a phone
 * number. It leans towards letting a number through, so it will miss some.
 */
export function containsPersonalData(text: string): boolean {
  if (EMAIL.test(text)) return true
  const withoutDates = text.replace(DATE, ' ')
  if (PHONE_GROUPED.test(withoutDates)) return true
  return (withoutDates.match(PHONE_PREFIXED) ?? []).some((run) => run.replace(/\D/g, '').length >= 9)
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

/**
 * The code is the only key to a conversation, so it has to be too long to guess: eight characters
 * from 32 gives about a trillion possibilities. The alphabet has 32 letters, so a byte modulo 32
 * is evenly spread.
 */
export function newCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
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
