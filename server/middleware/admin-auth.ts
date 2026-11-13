// Basic Auth on the admin page and the admin API, in one place. Once the browser has logged in
// on /admin, it sends the credentials along with every fetch to /api/admin.
import { requireAdmin } from '../utils/env'

export default defineEventHandler((event) => {
  const path = event.path.split('?')[0] ?? ''
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')) requireAdmin(event)
})
