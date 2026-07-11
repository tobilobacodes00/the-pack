import { useRef } from 'react'
import { motion, useScroll, useTransform, useSpring, useReducedMotion, useMotionValueEvent } from 'framer-motion'
import { AlphaWolf } from './alpha-wolf'
import { GLOW_SPRING } from '@/ui/parallax'

/**
 * The Pack emblem on its scroll journey: a fixed, pointer-events-none stage behind the landing holding
 * the reactive wolf (rendered in the logo's faceted-wireframe style, so head-on it reads as the mark).
 * Window scroll (a) parallaxes the stage — big & faint behind the hero, drifting down and shrinking —
 * and (b) feeds `stageRef` so the emblem shifts mood per section, then dissolves into the crisp CTA
 * wolf-logo at the close. Static wolf-logo under prefers-reduced-motion.
 */
export function HeroWolf() {
  const reduce = useReducedMotion() ?? false
  const { scrollYProgress } = useScroll()
  const stageRef = useRef(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    stageRef.current = v
  })

  const scale = useSpring(useTransform(scrollYProgress, [0, 0.5, 0.88, 1], [1, 0.7, 0.34, 0.3]), GLOW_SPRING)
  const y = useSpring(useTransform(scrollYProgress, [0, 0.9, 1], [0, 150, 150]), GLOW_SPRING)
  // Faint emblem behind the hero chat, present as it performs, then dissolves into the crisp CTA logo.
  const opacity = useTransform(
    scrollYProgress,
    [0, 0.05, 0.16, 0.6, 0.78, 0.9, 1],
    [0.22, 0.3, 0.4, 0.4, 0.32, 0, 0],
  )
  // Once fully faded, drop the stage from layout entirely — AlphaWolf sees itself leave the
  // viewport (IntersectionObserver) and parks its render loop, so the CTA/footer cost nothing.
  const display = useTransform(opacity, (v) => (v < 0.015 ? 'none' : 'block'))

  if (reduce) {
    return (
      <div className="pointer-events-none fixed inset-0 z-0 flex justify-center overflow-hidden" aria-hidden>
        <img src="/pack-logo.svg" alt="" className="mt-[15vh] h-auto w-[min(52vw,420px)] opacity-[0.16]" />
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-0 flex justify-center overflow-hidden" aria-hidden>
      <motion.div
        className="mt-[4vh] h-[80vh] w-[min(92vw,940px)]"
        style={{ y, scale, opacity, display, willChange: 'transform' }}
      >
        <AlphaWolf furColor="#1A1A1A" edgeColor="#FAFAFA" eyeColor="#FFFFFF" scale={1} headFollow={1} fidget={0.9} stageRef={stageRef} />
      </motion.div>
    </div>
  )
}
