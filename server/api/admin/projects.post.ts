// Create a project: name, organisation, the brief as markdown, and optional fixed topics.
import { useDb } from '../../utils/env'
import { clean, newId, slugify } from '../../utils/guards'
import type { Topic } from '../../utils/claude'

/**
 * One topic per line. The key is derived from the label, so you only type readable headings.
 * Duplicate keys get a number.
 */
function readTopicLines(text: unknown): Topic[] {
  if (typeof text !== 'string') return []
  const seen = new Set<string>()
  const topics: Topic[] = []
  for (const line of text.split('\n')) {
    // Strips a list marker: a dash, a star, a bullet, or a number followed by a dot or bracket.
    // A number that belongs to the topic, as in "3D printing" or "24/7 support", stays.
    const label = clean(line.replace(/^\s*(?:[-*•]\s*|\d+[.)]\s+)/, ''), 120)
    if (!label) continue
    // Cut long labels on a word boundary, so a key never ends halfway through a word.
    const full = slugify(label, 80)
    const short = full.length <= 30 ? full : full.slice(0, 31).replace(/-[^-]*$/, '')
    const base = (short || full.slice(0, 30)).replace(/-/g, '_') || 'topic'
    let key = base
    for (let n = 2; seen.has(key); n++) key = `${base}_${n}`
    seen.add(key)
    topics.push({ key, label })
  }
  return topics.slice(0, 20)
}

const RESERVED_SLUGS = new Set(['admin', 'api'])

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    name?: string
    organisation?: string
    brief?: string
    topics?: string
    maxTurns?: number
  }>(event)

  const name = clean(body?.name, 120)
  const organisation = clean(body?.organisation, 120)
  // The brief may be long, so it is not cut at the participant input limit.
  const brief = typeof body?.brief === 'string' ? body.brief.trim().slice(0, 20_000) : ''
  const topics = readTopicLines(body?.topics)
  const maxTurns = Math.min(Math.max(Number(body?.maxTurns) || 12, 4), 30)

  if (!name || !organisation || !brief) {
    throw createError({ statusCode: 400, statusMessage: 'Name, organisation and brief are required' })
  }

  const database = useDb(event)
  // A slug that equals a route of the app would put the participant links behind that route.
  const plain = slugify(`${organisation}-${name}`, 40) || 'project'
  const base = RESERVED_SLUGS.has(plain) ? `project-${plain}` : plain
  let slug = base
  for (let n = 2; n < 50; n++) {
    const exists = await database.prepare('SELECT 1 FROM projects WHERE slug = ?').bind(slug).first()
    if (!exists) break
    slug = `${base}-${n}`
  }

  const id = newId('prj')
  await database
    .prepare(
      `INSERT INTO projects (id, slug, name, organisation, brief_md, topics, max_turns, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, slug, name, organisation, brief, topics.length ? JSON.stringify(topics) : null, maxTurns, Date.now())
    .run()

  return { id, slug, topics }
})
