import { z } from 'zod'

// Both vars accept an absolute URL or a same-origin relative path (nginx reverse-proxies /api and
// /ws). A bare relative path isn't a valid absolute URL, so z.string().url() alone would reject
// the same-origin build — allow a leading-slash path explicitly.
const urlOrPath = z
  .string()
  .refine((v) => v.startsWith('/') || z.string().url().safeParse(v).success, {
    message: 'must be an absolute URL (https://…) or a same-origin path starting with "/"',
  })

const EnvSchema = z.object({
  VITE_ENGINE_URL: urlOrPath.default('http://localhost:8000'),
  VITE_GATEWAY_URL: urlOrPath.default('ws://localhost:8080'),
})

export const env = EnvSchema.parse(import.meta.env)

// A localhost fallback in prod means a required VITE_* var was never injected at build time — fail
// loud instead of silently pointing the live stream at the user's own machine.
if (import.meta.env.PROD) {
  const localhostFallback = [env.VITE_ENGINE_URL, env.VITE_GATEWAY_URL].some((u) =>
    u.includes('localhost'),
  )
  if (localhostFallback) {
    throw new Error(
      'Production build is missing VITE_ENGINE_URL / VITE_GATEWAY_URL (resolved to a localhost ' +
        'default). Set them as build args (see deploy/web.Dockerfile).',
    )
  }
}
