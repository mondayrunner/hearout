// Making and storing the summary of a finished conversation.
//
// Two places call this: the last turn of a conversation (in the background) and the admin button
// that makes a summary again. Every attempt records its outcome on the participant, so a failed
// summary never disappears silently.
import type { D1Database } from '@cloudflare/workers-types'
import { askClaude, summarySchema, type SummaryAnswer, type Topic } from './claude'
import { summaryPrompt, summaryToMarkdown } from './prompts'
import { newId } from './guards'

export async function makeSummary(options: {
  database: D1Database
  participantId: string
  apiKey: string
  timeoutMs?: number
  /** One attempt only, for the background run that has to finish inside a fixed window. */
  singleAttempt?: boolean
}): Promise<boolean> {
  const { database, participantId, apiKey } = options

  const participant = await database
    .prepare(
      `SELECT p.id, p.name, p.brief_at_start, j.organisation, j.brief_md, j.topics
         FROM participants p JOIN projects j ON j.id = p.project_id
        WHERE p.id = ?`,
    )
    .bind(participantId)
    .first<{
      id: string
      name: string | null
      brief_at_start: string | null
      organisation: string
      brief_md: string
      topics: string | null
    }>()
  if (!participant) return false

  try {
    const rows = await database
      .prepare(
        `SELECT role, text, source FROM messages WHERE participant_id = ?
          ORDER BY turn ASC, CASE role WHEN 'interviewer' THEN 0 ELSE 1 END`,
      )
      .bind(participant.id)
      .all<{ role: 'interviewer' | 'participant'; text: string; source: string | null }>()

    // A clicked suggestion was written by the model, not by the participant. The transcript says
    // so, otherwise the model summarises its own words as "what the participant said".
    const transcript = (rows.results ?? [])
      .map((row) =>
        row.role === 'interviewer'
          ? `Interviewer: ${row.text}`
          : `Participant${row.source === 'suggestion' ? ' [clicked a suggestion]' : ''}: ${row.text}`,
      )
      .join('\n\n')

    // The brief the conversation started under, not the current one: that may have changed since.
    const topics = readTopics(participant.topics)
    const result = await askClaude<SummaryAnswer>({
      apiKey,
      system: summaryPrompt({
        brief: participant.brief_at_start ?? participant.brief_md,
        organisation: participant.organisation,
        participant: participant.name,
        topics,
      }),
      messages: [{ role: 'user', content: `Here is the interview:\n\n${transcript}` }],
      schema: summarySchema(topics),
      effort: 'medium',
      maxTokens: 16000,
      timeoutMs: options.timeoutMs,
      singleAttempt: options.singleAttempt,
    })

    if (!result.ok) {
      await markFailed(database, participant.id, result.error)
      return false
    }

    const { data, usage, model } = result
    const summaryId = newId('sum')

    await database.batch([
      database
        .prepare(
          `INSERT INTO summaries (id, participant_id, version, in_one_sentence, watch_out, json, markdown, model,
             input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, created_at)
           VALUES (?1, ?2, (SELECT COALESCE(MAX(version), 0) + 1 FROM summaries WHERE participant_id = ?2),
                   ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        // The version is worked out inside the insert, so two runs at the same time (the
        // background one and the admin button) get two versions instead of one collision.
        .bind(
          summaryId,
          participant.id,
          data.in_one_sentence,
          data.watch_out,
          JSON.stringify(data),
          summaryToMarkdown(data),
          model,
          usage.input,
          usage.cacheWrite,
          usage.cacheRead,
          usage.output,
          Date.now(),
        ),
      ...data.points.map((point, position) =>
        database
          .prepare(
            'INSERT INTO summary_points (summary_id, position, key, topic, answer, discussed) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(summaryId, position, point.key, point.topic, point.answer, point.discussed ? 1 : 0),
      ),
      database
        .prepare("UPDATE participants SET summary_status = 'done', summary_error = NULL WHERE id = ?")
        .bind(participant.id),
    ])
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[summary] failed', participant.id, message)
    await markFailed(database, participant.id, message)
    return false
  }
}

async function markFailed(database: D1Database, participantId: string, error: string): Promise<void> {
  try {
    // A failed attempt does not undo an earlier summary: the status only becomes 'failed' while
    // there is nothing to read. The error is recorded either way.
    await database
      .prepare(
        `UPDATE participants
            SET summary_status = CASE WHEN EXISTS (SELECT 1 FROM summaries WHERE participant_id = ?2)
                                      THEN 'done' ELSE 'failed' END,
                summary_error = ?1
          WHERE id = ?2`,
      )
      .bind(error.slice(0, 500), participantId)
      .run()
  } catch (logError) {
    console.error('[summary] could not record the failure', logError)
  }
}

/** Topics from the database. A broken or empty list means: no fixed keys. */
export function readTopics(json: string | null): Topic[] | null {
  if (!json) return null
  try {
    const list = JSON.parse(json) as Topic[]
    return Array.isArray(list) && list.length && list.every((topic) => topic?.key && topic?.label) ? list : null
  } catch {
    return null
  }
}
