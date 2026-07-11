import { defineConfig, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Vitest augments the config with `test`. Assign through a typed variable so the extra key clears the
// object-literal excess-property check while keeping vite's plugin typings.
const config: UserConfig & { test?: Record<string, unknown> } = {
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, './src') } },
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      // Config, entrypoints, generated types, vendored visual effects (WebGL/animation, not logic),
      // and tests themselves aren't unit-under-test.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test-setup.ts',
        'src/vite-env.d.ts',
        'src/main.tsx',
        'src/ui/splash-cursor.tsx', // ~1.3k lines of vendored WebGL fluid simulation
        'src/ui/star-border.tsx', // vendored animated-border effect
      ],
      // A regression floor (a ratchet), NOT the target — raise as coverage grows. The pure-logic +
      // hook + gate/decision surface is now well-covered (branches ~65%); the remaining line gap is
      // the presentational component layer. Raise these as component tests land.
      thresholds: { lines: 17, functions: 40, statements: 17, branches: 60 },
    },
  },
}

export default defineConfig(config)
