// The full conversation of one participant, for reading in the admin.
import { useDb } from '../../utils/env'
import { clean } from '../../utils/guards'
import { fetchConversation } from '../../utils/export'

export default defineEventHandler(async (event) => {
  const code = clean(getQuery(event).code, 12).toLowerCase()
  const database = useDb(event)

  const participant = await database
    .prepare('SELECT id FROM participants WHERE code = ?')
    .bind(code)
    .first<{ id: string }>()
  if (!participant) throw createError({ statusCode: 404, statusMessage: 'Unknown code' })

  return { lines: await fetchConversation(database, participant.id) }
})
