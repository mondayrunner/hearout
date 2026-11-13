// Download as markdown: per participant the summary and the full conversation.
// With ?project= the whole project in one file, with &code= only that one participant.
import { useDb } from '../../utils/env'
import { clean } from '../../utils/guards'
import { participantMarkdown } from '../../utils/export'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const slug = clean(query.project, 60).toLowerCase()
  const code = clean(query.code, 12).toLowerCase()
  const database = useDb(event)

  const project = await database
    .prepare('SELECT id, name, organisation FROM projects WHERE slug = ?')
    .bind(slug)
    .first<{ id: string; name: string; organisation: string }>()
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })

  const rows = await database
    .prepare(
      `SELECT p.id, p.name, p.code, p.status, p.end_reason, p.finished_at, s.markdown AS summary
         FROM participants p LEFT JOIN latest_summary s ON s.participant_id = p.id
        WHERE p.project_id = ? ${code ? 'AND p.code = ?' : ''} ORDER BY p.rowid ASC`,
    )
    .bind(...(code ? [project.id, code] : [project.id]))
    .all<{
      id: string
      name: string | null
      code: string
      status: string
      end_reason: string | null
      finished_at: number | null
      summary: string | null
    }>()

  const participants = rows.results ?? []
  if (code && !participants.length) throw createError({ statusCode: 404, statusMessage: 'Unknown code' })

  const today = new Date().toISOString().slice(0, 10)
  const finished = participants.filter((participant) => participant.status === 'done').length
  const parts = [
    `# ${project.organisation}: ${project.name}`,
    '',
    code
      ? `Intake interview, exported on ${today}.`
      : `Intake interviews, exported on ${today}. ${finished} of ${participants.length} finished.`,
    '',
  ]
  for (const participant of participants) {
    parts.push(await participantMarkdown(database, participant), '---', '')
  }

  const filename = code ? `${slug}-${code}.md` : `${slug}-interviews.md`
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setResponseHeader(event, 'content-disposition', `attachment; filename="${filename}"`)
  return parts.join('\n')
})
