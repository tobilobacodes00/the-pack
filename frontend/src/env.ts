import { z } from 'zod'

// Both vars accept EITHER a full absolute URL (separate frontend host, e.g. Vercel →
// https://api.example.com/api) OR a same-origin relative path (served from the box's own nginx, which
// reverse-proxies /api and /ws → the build args in deploy/web.Dockerfile pass "/api" and "/ws"). A
// bare relative path is NOT a valid absolute URL, so z.string().url() alone would reject the
// same-origin build; allow a leading-slash path explicitly.
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

// In a production build, a localhost fallback means a required VITE_* var was never injected at
// build time (e.g. a renamed arg) — the live stream would silently point at the user's own machine.
// Fail loud instead of shipping a broken deploy.
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
