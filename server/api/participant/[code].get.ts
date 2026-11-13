// What the interview page needs to start: who you are, what it is about, and what was said so far.
import { useDb } from '../../utils/env'
import { clean, readList } from '../../utils/guards'

export default defineEventHandler(async (event) => {
  const code = clean(getRouterParam(event, 'code'), 12).toLowerCase()
  if (!code) throw createError({ statusCode: 400, statusMessage: 'No code' })

  const database = useDb(event)
  const participant = await database
    .prepare(
      `SELECT p.id, p.name, p.status, p.max_turns_at_start, j.name AS project_name, j.organisation, j.max_turns
         FROM participants p JOIN projects j ON j.id = p.project_id
        WHERE p.code = ?`,
    )
    .bind(code)
    .first<{
      id: string
      name: string | null
      status: string
      max_turns_at_start: number | null
      project_name: string
      organisation: string
      max_turns: number
    }>()
  if (!participant) throw createError({ statusCode: 404, statusMessage: 'Unknown code' })

  // A finished conversation is closed: anyone the link was forwarded to could read it otherwise.
  // The transcript lives in the admin.
  const done = participant.status === 'done'
  const rows = done
    ? []
    : ((
        await database
          .prepare(
            `SELECT role, text, suggestions FROM messages WHERE participant_id = ?
              ORDER BY turn ASC, CASE role WHEN 'interviewer' THEN 0 ELSE 1 END`,
          )
          .bind(participant.id)
          .all<{ role: 'interviewer' | 'participant'; text: string; suggestions: string | null }>()
      ).results ?? [])

  // If the last question is still open, its suggestions belong on screen after a reload too.
  const last = rows.at(-1)

  return {
    name: participant.name,
    done,
    projectName: participant.project_name,
    organisation: participant.organisation,
    maxTurns: participant.max_turns_at_start ?? participant.max_turns,
    turn: rows.filter((row) => row.role === 'interviewer').length,
    messages: rows.map(({ role, text }) => ({ role, text })),
    suggestions: last?.role === 'interviewer' ? readList(last.suggestions) : [],
  }
})
