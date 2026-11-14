// The admin overview: projects with their participants, status, summary and token usage.
import { useDb } from '../../utils/env'

const STALE_AFTER_MS = 2 * 60 * 1000

export default defineEventHandler(async (event) => {
  const database = useDb(event)
  const origin = getRequestURL(event).origin

  const projects = await database
    .prepare(
      'SELECT id, slug, name, organisation, brief_md, topics, max_turns, created_at FROM projects ORDER BY created_at DESC',
    )
    .all<{
      id: string
      slug: string
      name: string
      organisation: string
      brief_md: string
      topics: string | null
      max_turns: number
      created_at: number
    }>()

  // Tokens count the conversation and every summary version, otherwise the most expensive call
  // per interview stays out of the cost.
  const participants = await database
    .prepare(
      `SELECT p.id, p.project_id, p.code, p.name, p.status, p.end_reason, p.summary_status, p.summary_error,
              p.finished_at, s.markdown AS summary,
              (SELECT COUNT(*) FROM messages m WHERE m.participant_id = p.id AND m.role = 'participant') AS answers,
              (SELECT COALESCE(SUM(m.input_tokens), 0) FROM messages m WHERE m.participant_id = p.id)
                + (SELECT COALESCE(SUM(x.input_tokens), 0) FROM summaries x WHERE x.participant_id = p.id) AS input_tokens,
              (SELECT COALESCE(SUM(m.cache_write_tokens), 0) FROM messages m WHERE m.participant_id = p.id)
                + (SELECT COALESCE(SUM(x.cache_write_tokens), 0) FROM summaries x WHERE x.participant_id = p.id) AS cache_write_tokens,
              (SELECT COALESCE(SUM(m.cache_read_tokens), 0) FROM messages m WHERE m.participant_id = p.id)
                + (SELECT COALESCE(SUM(x.cache_read_tokens), 0) FROM summaries x WHERE x.participant_id = p.id) AS cache_read_tokens,
              (SELECT COALESCE(SUM(m.output_tokens), 0) FROM messages m WHERE m.participant_id = p.id)
                + (SELECT COALESCE(SUM(x.output_tokens), 0) FROM summaries x WHERE x.participant_id = p.id) AS output_tokens
         FROM participants p
         LEFT JOIN latest_summary s ON s.participant_id = p.id
        ORDER BY p.rowid ASC`,
    )
    .all<{
      id: string
      project_id: string
      code: string
      name: string | null
      status: 'open' | 'active' | 'done'
      end_reason: string | null
      summary_status: 'pending' | 'done' | 'failed' | null
      summary_error: string | null
      finished_at: number | null
      summary: string | null
      answers: number
      input_tokens: number
      cache_write_tokens: number
      cache_read_tokens: number
      output_tokens: number
    }>()

  // If the Worker is stopped before the background summary can record its outcome, the status
  // stays 'pending' forever. Past two minutes it is reported as failed, so the button appears.
  const now = Date.now()
  const rows = (participants.results ?? []).map((row) =>
    row.summary_status === 'pending' && row.finished_at && now - row.finished_at > STALE_AFTER_MS
      ? { ...row, summary_status: 'failed' as const, summary_error: 'The summary did not finish in time. Make it again.' }
      : row,
  )

  return {
    projects: (projects.results ?? []).map((project) => ({
      ...project,
      participants: rows
        .filter((row) => row.project_id === project.id)
        .map((row) => ({ ...row, link: `${origin}/${project.slug}/${row.code}` })),
    })),
  }
})
