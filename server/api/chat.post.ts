// One turn of the conversation: check the input, load the history, ask Claude, store everything.
//
// The server decides when it is over. The model may set `done`, but on the last turn the server
// sets it regardless: freedom in the conversation, no freedom in the outcome.
import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { askClaude, conversationSchema, type ConversationAnswer, type Turn } from '../utils/claude'
import { conversationPrompt, START_LINE } from '../utils/prompts'
import { clean, cleanMessage, containsPersonalData, newId, readList } from '../utils/guards'
import { makeSummary } from '../utils/summary'
import { requireApiKey, useDb } from '../utils/env'

// Medium follows up more sharply than low and is about as fast. Measure before you change it.
const EFFORT = 'medium'

type ParticipantRow = {
  id: string
  name: string | null
  status: string
  organisation: string
  brief_md: string
  max_turns: number
  brief_at_start: string | null
  max_turns_at_start: number | null
}

type HistoryRow = { role: 'interviewer' | 'participant'; text: string; turn: number; suggestions: string | null }

export default defineEventHandler(async (event) => {
  const body = await readBody<{ code?: string; message?: string; name?: string; source?: string }>(event)
  const code = clean(body?.code, 12).toLowerCase()
  const message = cleanMessage(body?.message)
  const name = clean(body?.name, 80) || null
  const source = body?.source === 'suggestion' ? 'suggestion' : 'typed'

  if (!code) throw createError({ statusCode: 400, statusMessage: 'No code' })
  const database = useDb(event)
  const apiKey = requireApiKey(event)

  const participant = await database
    .prepare(
      `SELECT p.id, p.name, p.status, p.brief_at_start, p.max_turns_at_start,
              j.organisation, j.brief_md, j.max_turns
         FROM participants p JOIN projects j ON j.id = p.project_id
        WHERE p.code = ?`,
    )
    .bind(code)
    .first<ParticipantRow>()
  if (!participant) throw createError({ statusCode: 404, statusMessage: 'Unknown code' })

  if (participant.status === 'done') {
    return { reply: 'This interview is already finished. Thank you.', done: true, suggestions: [] }
  }
  if (message && containsPersonalData(message)) {
    throw createError({
      statusCode: 422,
      statusMessage:
        'Please leave out email addresses and phone numbers. This conversation is about the work, not about people.',
    })
  }

  const now = Date.now()

  // A participant added without a name gets the name they typed on the start screen.
  if (name && !participant.name) {
    await database.prepare('UPDATE participants SET name = ? WHERE id = ?').bind(name, participant.id).run()
    participant.name = name
  }

  const history = await database
    .prepare(
      `SELECT role, text, turn, suggestions FROM messages WHERE participant_id = ?
        ORDER BY turn ASC, CASE role WHEN 'interviewer' THEN 0 ELSE 1 END`,
    )
    .bind(participant.id)
    .all<HistoryRow>()
  const earlier = history.results ?? []
  const questions = earlier.filter((row) => row.role === 'interviewer')
  const asked = questions.length

  // An opening without a message while a question is waiting comes from a reload or a second
  // tab. Return the open question instead of generating a new one.
  if (!message && asked > 0) {
    const open = questions[asked - 1]!
    return {
      reply: open.text,
      done: false,
      suggestions: readList(open.suggestions),
      turn: asked,
      maxTurns: participant.max_turns_at_start ?? participant.max_turns,
    }
  }

  // On the first question, record the brief and the limit this conversation runs under.
  if (!participant.brief_at_start) {
    await database
      .prepare('UPDATE participants SET brief_at_start = ?, max_turns_at_start = ? WHERE id = ?')
      .bind(participant.brief_md, participant.max_turns, participant.id)
      .run()
    participant.brief_at_start = participant.brief_md
    participant.max_turns_at_start = participant.max_turns
  }
  const maxTurns = participant.max_turns_at_start ?? participant.max_turns

  const turns: Turn[] = [{ role: 'user', content: START_LINE }]
  for (const row of earlier) {
    turns.push({ role: row.role === 'interviewer' ? 'assistant' : 'user', content: row.text })
  }
  if (message) turns.push({ role: 'user', content: message })

  const turn = asked + 1
  const lastTurn = turn >= maxTurns
  const prompt = conversationPrompt({
    brief: participant.brief_at_start,
    organisation: participant.organisation,
    participant: participant.name,
    turn,
    maxTurns,
  })

  const answer = await askClaude<ConversationAnswer>({
    apiKey,
    system: prompt.stable,
    turnNote: prompt.turnNote,
    messages: turns,
    schema: conversationSchema,
    effort: EFFORT,
    // Thinking counts towards this limit. Only tokens that are used cost money.
    maxTokens: 8000,
  })

  if (!answer.ok) {
    console.error('[chat] no answer from the model:', answer.error, 'code', code)
    throw createError({
      statusCode: 503,
      statusMessage: 'The conversation is stalling. Please try again in half a minute.',
    })
  }

  const done = lastTurn || answer.data.done === true
  const suggestions = done ? [] : answer.data.suggestions.slice(0, 3)
  const { usage, model } = answer

  const statements: D1PreparedStatement[] = []
  if (message) {
    statements.push(
      database
        .prepare(
          `INSERT INTO messages (id, participant_id, turn, role, text, source, created_at)
           VALUES (?, ?, ?, 'participant', ?, ?, ?)`,
        )
        .bind(newId('msg'), participant.id, asked, message, source, now),
    )
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO messages (id, participant_id, turn, role, text, suggestions, model,
           input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, 'interviewer', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId('msg'),
        participant.id,
        turn,
        answer.data.reply,
        JSON.stringify(suggestions),
        model,
        usage.input,
        usage.cacheWrite,
        usage.cacheRead,
        usage.output,
        // After the model call, so this minus the participant's timestamp is the wait per turn.
        Date.now(),
      ),
    done
      ? database
          .prepare(
            `UPDATE participants SET status = 'done', finished_at = ?2, started_at = COALESCE(started_at, ?2),
               end_reason = ?3, summary_status = 'pending'
             WHERE id = ?1`,
          )
          .bind(participant.id, now, lastTurn ? 'max_turns' : 'model')
      : database
          .prepare("UPDATE participants SET status = 'active', started_at = COALESCE(started_at, ?2) WHERE id = ?1")
          .bind(participant.id, now),
  )

  try {
    await database.batch(statements)
  } catch (error) {
    // The unique index on (participant, turn, role) makes the second of two simultaneous turns
    // fail as a whole. A message beats a conversation that splits in two.
    if (String(error).includes('UNIQUE')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Someone just answered on this link at the same time. Reload the page to continue.',
      })
    }
    throw error
  }

  if (done) {
    // In the background, so the participant does not wait for the summary. If it fails, the
    // participant row says so and the admin can make it again.
    event.waitUntil(makeSummary({ database, participantId: participant.id, apiKey }))
  }

  return { reply: answer.data.reply, done, suggestions, turn, maxTurns }
})
