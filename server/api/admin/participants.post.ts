// Add participants to a project. Codes are made here, never by the user.
import { useDb } from '../../utils/env'
import { clean, newId, newUniqueCode } from '../../utils/guards'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ projectId?: string; names?: string[]; count?: number }>(event)
  const projectId = clean(body?.projectId, 40)

  // Either a list of names, or a number of nameless links. A nameless participant is asked for
  // a name on the start screen.
  const names = Array.isArray(body?.names) ? body.names.map((name) => clean(name, 80)).filter(Boolean) : []
  const list: Array<string | null> = names.length
    ? names.slice(0, 100)
    : Array.from({ length: Math.min(Math.max(Number(body?.count) || 0, 0), 100) }, () => null)

  if (!projectId || list.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Project and participants are required' })
  }

  const database = useDb(event)
  const project = await database
    .prepare('SELECT id, slug FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ id: string; slug: string }>()
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Unknown project' })

  const origin = getRequestURL(event).origin
  const created: Array<{ code: string; name: string | null; link: string }> = []

  for (const name of list) {
    const code = await newUniqueCode(database)
    await database
      .prepare("INSERT INTO participants (id, project_id, code, name, status) VALUES (?, ?, ?, ?, 'open')")
      .bind(newId('par'), project.id, code, name)
      .run()
    created.push({ code, name, link: `${origin}/${project.slug}/${code}` })
  }

  return { created }
})
