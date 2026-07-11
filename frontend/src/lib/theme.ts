/**
 * The Pack design tokens as JS constants — for inline-`style` call sites (canvas nodes, framer-motion,
 * SVG) that can't use Tailwind utilities. Mirror of the `@theme` block in `index.css`; keep in sync.
 * Prefer the Tailwind utilities (`bg-surface`, `text-dim`, `border-border`…) in JSX className.
 */
export const color = {
  canvas: '#0F0F0F',
  surface: '#1A1A1A',
  raised: '#272727',
  border: '#404040',
  borderSubtle: '#1C1C1C',
  line: 'rgba(255,255,255,0.08)',
  text: '#FAFAFA',
  dim: '#A3A3A3',
  faint: '#6B6B6B',
  muted: '#8A8A8A',
  accent: '#8B5CF6',
  accentDim: '#6D28D9',
  warn: '#EAB308',
  danger: '#EF4444',
  success: '#22C55E',
} as const

export const radius = { sm: 4, md: 8, lg: 12, xl: 16, panel: 16, pill: 20 } as const
