// Bindings and secrets from the Cloudflare environment. In `nuxt dev` they come from .dev.vars.
import type { H3Event } from 'h3'
import type { D1Database } from '@cloudflare/workers-types'

export type Env = {
  DB?: D1Database
  ANTHROPIC_API_KEY?: string
  ADMIN_USER?: string
  ADMIN_PASS?: string
}

export function readEnv(event: H3Event): Env {
  const cloudflare = (event.context.cloudflare?.env ?? {}) as Env
  // process.env is the fallback for running without the wrangler proxy.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  return {
    DB: cloudflare.DB,
    ANTHROPIC_API_KEY: cloudflare.ANTHROPIC_API_KEY ?? proc.ANTHROPIC_API_KEY,
    ADMIN_USER: cloudflare.ADMIN_USER ?? proc.ADMIN_USER,
    ADMIN_PASS: cloudflare.ADMIN_PASS ?? proc.ADMIN_PASS,
  }
}

export function useDb(event: H3Event): D1Database {
  const database = readEnv(event).DB
  if (!database) throw createError({ statusCode: 500, statusMessage: 'D1 binding DB is missing' })
  return database
}

export function requireApiKey(event: H3Event): string {
  const key = readEnv(event).ANTHROPIC_API_KEY
  if (!key) throw createError({ statusCode: 500, statusMessage: 'ANTHROPIC_API_KEY is missing' })
  return key
}

/** Basic Auth on /admin and the admin API. Nothing opens until both values are set. */
export function requireAdmin(event: H3Event): void {
  const { ADMIN_USER, ADMIN_PASS } = readEnv(event)
  if (!ADMIN_USER || !ADMIN_PASS) {
    throw createError({ statusCode: 500, statusMessage: 'ADMIN_USER and ADMIN_PASS are missing' })
  }
  const [scheme, value] = (getRequestHeader(event, 'authorization') ?? '').split(' ')
  if (scheme === 'Basic' && value) {
    let decoded = ''
    try {
      decoded = atob(value)
    } catch {
      decoded = ''
    }
    // A password may contain a colon, a user name may not.
    const split = decoded.indexOf(':')
    if (split > 0 && decoded.slice(0, split) === ADMIN_USER && decoded.slice(split + 1) === ADMIN_PASS) return
  }
  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="hearout"')
  throw createError({ statusCode: 401, statusMessage: 'Login required' })
}
