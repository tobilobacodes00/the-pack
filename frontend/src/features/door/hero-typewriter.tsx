import { memo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTypewriter } from '@/hooks/use-typewriter'

// The door asks the Packmaster what they want. Rotating verb phrase after "What should the pack".
// The "?" is part of each line so it types with the phrase and the caret always trails it.
const MOAT_LINES = [
  'hunt down for you?',
  'research for you?',
  'summarise for you?',
  'fact-check for you?',
  'dig into today?',
]

/**
 * The hero headline as a live typewriter. Fixed lead-in "What should the pack", a rotating verb phrase,
 * a fixed "?". The clause types, holds, backspaces, rewrites, with a blinking caret. Reduced motion
 * settles on the first line in full.
 */
export const HeroTypewriter = memo(function HeroTypewriter() {
  const reduce = useReducedMotion() ?? false
  // Deliberately slow + steady so the phrase reads as it types. Longer hold before it rewrites.
  const { text } = useTypewriter(MOAT_LINES, { typeMs: 90, deleteMs: 45, holdMs: 2200, gapMs: 380 })

  return (
    <h1
      // `whitespace-nowrap` keeps the whole headline on ONE line as the clause grows — it must never
      // wrap mid-typing. The clamp shrinks the type on narrow screens so the longest phrase still fits.
      className="font-display font-extrabold text-ink-900 text-center leading-tight tracking-tight whitespace-nowrap"
      style={{ fontSize: 'clamp(1.125rem, 4.5vw, 2.375rem)' }}
    >
      What should the pack{' '}
      {/* Rotating clause. aria-live lets a screen reader hear each phrase settle. */}
      <span className="relative inline-block text-brand-600 whitespace-nowrap" aria-live="polite">
        {text}
        {/* Blinking caret. Decoration only, skipped under reduced motion. */}
        {!reduce && (
          <motion.span
            aria-hidden
            className="ml-0.5 inline-block w-[3px] -translate-y-[2px] rounded-full bg-brand-500 align-middle"
            style={{ height: '0.95em' }}
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear', times: [0, 0.5, 0.5, 1] }}
          />
        )}
      </span>
    </h1>
  )
})
