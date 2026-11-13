// Conversations in a readable form: the transcript of one participant, and a markdown document
// with the summary plus the whole conversation. Shared by the admin view and the download.
import type { D1Database } from '@cloudflare/workers-types'

export type ConversationLine = {
  turn: number
  role: 'interviewer' | 'participant'
  text: string
  source: 'typed' | 'suggestion' | null
  created_at: number
}

export async function fetchConversation(database: D1Database, participantId: string): Promise<ConversationLine[]> {
  const rows = await database
    .prepare(
      `SELECT turn, role, text, source, created_at FROM messages WHERE participant_id = ?
        ORDER BY turn ASC, CASE role WHEN 'interviewer' THEN 0 ELSE 1 END`,
    )
    .bind(participantId)
    .all<ConversationLine>()
  return rows.results ?? []
}

const END_REASON: Record<string, string> = {
  model: 'the interviewer wrapped up',
  max_turns: 'the turn limit was reached',
}

/** One participant as markdown: heading, summary, and the full conversation below it. */
export async function participantMarkdown(
  database: D1Database,
  participant: {
    id: string
    name: string | null
    code: string
    status: string
    end_reason: string | null
    finished_at: number | null
    summary: string | null
  },
): Promise<string> {
  const parts = [`## ${participant.name ?? `Participant ${participant.code}`}`, '']

  if (participant.status === 'done') {
    const when = participant.finished_at ? ` on ${new Date(participant.finished_at).toISOString().slice(0, 10)}` : ''
    const how = participant.end_reason ? `, ${END_REASON[participant.end_reason] ?? participant.end_reason}` : ''
    parts.push(`_Finished${when}${how}. Code ${participant.code}._`, '')
  } else {
    parts.push(`_Status: ${participant.status}. Code ${participant.code}._`, '')
  }

  parts.push('### Summary', '', participant.summary ?? '_No summary yet._', '', '### Conversation', '')

  const conversation = await fetchConversation(database, participant.id)
  if (!conversation.length) parts.push('_Nothing said yet._', '')
  for (const line of conversation) {
    if (line.role === 'interviewer') {
      parts.push(`**Interviewer, question ${line.turn}:** ${line.text}`, '')
    } else {
      const clicked = line.source === 'suggestion' ? ' _(clicked a suggestion)_' : ''
      // Line breaks in an answer stay; markdown needs two trailing spaces for them.
      parts.push(`**${participant.name ?? 'Participant'}:**${clicked} ${line.text.replace(/\n/g, '  \n')}`, '')
    }
  }

  return parts.join('\n')
}
