/**
 * A Pack design tokens as JS constants — for inline-`style` call sites (canvas nodes, framer-motion,
 * SVG) that can't use Tailwind utilities. Mirror of the `@theme` block in `index.css`; keep in sync.
 * Prefer the Tailwind utilities (`bg-surface`, `text-dim`, `border-border`…) in JSX className.
 */
export const color = {
  canvas: '#F5F5F5', // neutral grey paper
  surface: '#FFFFFF', // cards / panels
  raised: '#F2F2F0', // raised / hover fill
  border: '#DCDCD8', // neutral hairline
  borderSubtle: '#EBEBE7',
  line: 'rgba(26,26,26,0.08)', // charcoal-ink hairline
  text: '#1A1A1A', // logo charcoal ink
  dim: '#4A4A4A',
  faint: '#6B6B6B',
  muted: '#6B6B6B',
  accent: '#1A1A1A', // charcoal (mono — no brand hue)
  accentDim: '#262626',
  warn: '#EAB308',
  danger: '#EF4444',
  success: '#1A1A1A', // charcoal (mono)
} as const

export const radius = { sm: 4, md: 8, lg: 12, xl: 16, panel: 16, pill: 20 } as const

/**
 * Warm-brutalist palette (blue-led, no green) — for inline-`style`/JS call sites the Tailwind
 * utilities can't reach: the WebGL wolf recolor, glows, canvas nodes. Mirror of the warm `@theme`
 * tokens in `index.css`; keep in sync.
 */
export const warm = {
  cream: '#F5F5F5',
  cream100: '#F6F5F1',
  cream200: '#EBEAE6',
  brand: '#262626', // brand-500 (charcoal — mono, no hue)
  brandDim: '#1A1A1A', // brand-600
  ink: '#1A1A1A', // ink-900 — the logo charcoal: headings, outlines, wolf edges
  ink700: '#3A3A3A',
  ink500: '#6B6B6B',
  // Monochrome — neutral greys (role distinction is by icon + label, not colour).
  ochre: '#9A9A9A',
  peach: '#9A9A9A',
  rose: '#9A9A9A',
  amber: '#6B6B6B',
  butter: '#9A9A9A',
  stone: '#9A9A9A',
  plum: '#6B6B6B',
  terracotta: '#6B6B6B',
} as const

/** The signature chunky offset shadow, for inline `style={{ boxShadow: chunkShadow }}`. */
export const chunkShadow = '4px 6px 0 0 #1A1A1A'
export const chunkShadowSm = '3px 4px 0 0 #1A1A1A'
