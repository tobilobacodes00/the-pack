import { z } from 'zod'

const EnvSchema = z.object({
  VITE_ENGINE_URL: z.string().url().default('http://localhost:8000'),
  VITE_GATEWAY_URL: z.string().default('ws://localhost:8080'),
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
