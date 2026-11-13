// Make the summary of a finished conversation again. Adds a version, never overwrites one.
import { requireApiKey, useDb } from '../../utils/env'
import { clean } from '../../utils/guards'
import { makeSummary } from '../../utils/summary'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ code?: string }>(event)
  const code = clean(body?.code, 12).toLowerCase()
  const database = useDb(event)

  const participant = await database
    .prepare('SELECT id, status FROM participants WHERE code = ?')
    .bind(code)
    .first<{ id: string; status: string }>()
  if (!participant) throw createError({ statusCode: 404, statusMessage: 'Unknown code' })
  if (participant.status !== 'done') {
    throw createError({ statusCode: 409, statusMessage: 'This conversation is not finished yet' })
  }

  // Inside the request instead of in the background, so there is time for a slow answer.
  const ok = await makeSummary({
    database,
    participantId: participant.id,
    apiKey: requireApiKey(event),
    timeoutMs: 90_000,
  })
  if (!ok) throw createError({ statusCode: 502, statusMessage: 'The summary failed. Try again in a moment.' })
  return { ok }
})
