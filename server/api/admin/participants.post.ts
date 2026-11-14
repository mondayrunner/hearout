// Add participants to a project. Codes are made here, never by the user.
import { useDb } from '../../utils/env'
import { clean, newCode, newId } from '../../utils/guards'

const MAX_AT_ONCE = 100

export default defineEventHandler(async (event) => {
  const body = await readBody<{ projectId?: string; names?: string[]; count?: number }>(event)
  const projectId = clean(body?.projectId, 40)

  // Either a list of names, or a number of nameless links. A nameless participant is asked for
  // a name on the start screen.
  const names = Array.isArray(body?.names) ? body.names.map((name) => clean(name, 80)).filter(Boolean) : []
  const count = Math.max(Math.floor(Number(body?.count) || 0), 0)
  const list: Array<string | null> = names.length ? names : Array.from({ length: Math.min(count, MAX_AT_ONCE + 1) }, () => null)

  if (!projectId || list.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Project and participants are required' })
  }
  // Refuse instead of cutting the list: a name that is dropped silently is a person without a link.
  if (list.length > MAX_AT_ONCE) {
    throw createError({ statusCode: 400, statusMessage: `Add at most ${MAX_AT_ONCE} participants at a time` })
  }

  const database = useDb(event)
  const project = await database
    .prepare('SELECT id, slug FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string; slug: string }>()
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })

  const origin = getRequestURL(event).origin

  for (let attempt = 0; ; attempt++) {
    const codes = new Set<string>()
    while (codes.size < list.length) codes.add(newCode())
    const rows = [...codes].map((code, index) => ({ code, name: list[index] ?? null }))

    try {
      // One batch is one transaction. If a code turns out to exist already, nothing is stored,
      // so trying again cannot make the same person twice.
      await database.batch(
        rows.map((row) =>
          database
            .prepare("INSERT INTO participants (id, project_id, code, name, status) VALUES (?, ?, ?, ?, 'open')")
            .bind(newId('par'), project.id, row.code, row.name),
        ),
      )
      return { created: rows.map((row) => ({ ...row, link: `${origin}/${project.slug}/${row.code}` })) }
    } catch (error) {
      if (attempt < 2 && String(error).includes('UNIQUE')) continue
      throw error
    }
  }
})
