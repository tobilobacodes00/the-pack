import { useEffect, useRef, type ReactNode } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  useMotionValue,
  type MotionValue,
} from 'framer-motion'
import { IdleGlyph } from '@/features/territory/agent-glyph'
import { ROLE_DESC } from '@/features/territory/roles'
import { PackCanvas, type PackDrive } from './pack-canvas'
import { PACK_SLOTS, PACK_ACCENT, BASE_SCALE, PHASE, slotScreen, spreadAt, lerp, smoothstep } from './pack-formation'

/**
 * PackReveal — ONE wolf's journey, a fixed full-viewport scene driven by continuous scroll.
 *
 * Hero: a big faint lone wolf behind the chat. Scroll in and the same wolf fans out into the whole
 * pack (a triangle, each role's icon + note over its head), then collides back into one. That lone
 * wolf slides to the LEFT while clean use-case one-liners rise on the RIGHT, then it travels down
 * and shrinks, coming to rest as the logo at the bottom (the static mark in door-landing fades in
 * as it lands). Fixed, so it never clips. Static, legible fallback under prefers-reduced-motion.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

// Concrete jobs people hand the Pack — specific deliverables, plain English.
const USE_CASES = [
  'Map a market: the players, the sizing, the real risks.',
  'Run due diligence on a company before you sign.',
  'Compare two tools and back the pick with evidence.',
  'Fact-check a report against the live web, line by line.',
  'Turn a folder of PDFs into one cited brief.',
]

/** Floating role icon + one-line note, pinned over its wolf; fades in only while the pack holds. */
function Caption({ role, capOpacity }: { role: string; capOpacity: MotionValue<number> }) {
  const slot = PACK_SLOTS.find((s) => s.role === role)!
  const { leftPct, topPct } = slotScreen(slot)
  const accent = PACK_ACCENT[role]
  const headVh = slot.scale * BASE_SCALE * 0.76 * 100
  // Clear breathing room above the head (icon) and below it (note) — never crowding the face.
  const badgeTop = topPct - (headVh / 2 + 4.5)
  const noteTop = topPct + (headVh / 2 + 3)
  const badgeSize = Math.round(34 + slot.scale * 18)

  return (
    <>
      <motion.div
        className="pointer-events-none absolute -translate-x-1/2"
        style={{ left: `${leftPct}%`, top: `${badgeTop}vh`, opacity: capOpacity }}
      >
        <IdleGlyph role={role} tone="active" size={badgeSize} accent={accent?.ring} outline />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute w-[190px] -translate-x-1/2 text-center"
        style={{ left: `${leftPct}%`, top: `${noteTop}vh`, opacity: capOpacity }}
      >
        <p className="text-[13px] font-bold capitalize tracking-wide font-display" style={{ color: accent?.ink }}>
          {role}
        </p>
        <p className="mx-auto mt-1.5 inline-block rounded-lg px-2 py-1 text-[11.5px] leading-snug text-ink-700" style={{ backgroundColor: accent?.wash }}>
          {ROLE_DESC[role]}
        </p>
      </motion.div>
    </>
  )
}

/** One use-case line — rises in, staggered, as the value phase engages (driven by valueMv 0..1). */
function UseCase({ text, valueMv, i }: { text: string; valueMv: MotionValue<number>; i: number }) {
  const from = i * 0.1
  const opacity = useTransform(valueMv, [from, from + 0.4], [0, 1])
  const y = useTransform(valueMv, [from, from + 0.4], [26, 0])
  return (
    <motion.p
      className="text-3xl font-bold leading-[1.1] tracking-tight text-ink-900 font-display md:text-[2.7rem]"
      style={{ opacity, y, willChange: 'transform, opacity' }}
    >
      {text}
    </motion.p>
  )
}

function StageInner({
  progress,
  valueMv,
  driveRef,
  observeRef,
}: {
  progress: MotionValue<number>
  valueMv: MotionValue<number>
  driveRef: React.MutableRefObject<PackDrive>
  observeRef: React.RefObject<Element | null>
}) {
  const capOpacity = useTransform(progress, [PHASE.expandEnd * 0.62, PHASE.expandEnd, PHASE.holdEnd, PHASE.holdEnd + 0.06], [0, 1, 1, 0])
  // Intro headline — the compact formation sits below it, so it stays through the hold.
  const kickerOpacity = useTransform(progress, [0.02, 0.07, PHASE.holdEnd, PHASE.holdEnd + 0.08], [0, 1, 1, 0])
  const valueKickerOpacity = useTransform(valueMv, [0, 0.4], [0, 1])

  return (
    <div className="relative h-full w-full">
      <PackCanvas driveRef={driveRef} observeRef={observeRef} />

      {/* Section kicker — introduces the pack while it's on show. */}
      <motion.div className="absolute left-1/2 top-[3vh] z-20 -translate-x-1/2 px-6 text-center" style={{ opacity: kickerOpacity }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-500">Meet the pack</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight font-display text-ink-900 md:text-4xl">One request. A whole team on it.</h2>
      </motion.div>

      {/* Floating role icons + notes, over each wolf. */}
      {PACK_SLOTS.map((s) => (
        <Caption key={s.role} role={s.role} capOpacity={capOpacity} />
      ))}

      {/* Value phase — the wolf sits on the LEFT; use-cases rise on the RIGHT. */}
      <div className="absolute inset-y-0 right-0 flex w-full items-center justify-end pr-6 md:w-[52%] md:pr-16">
        <div className="max-w-xl">
          <motion.p
            className="mb-8 text-[11px] font-semibold uppercase tracking-[0.28em] text-brand-600"
            style={{ opacity: valueKickerOpacity }}
          >
            What you can use it for
          </motion.p>
          <div className="flex flex-col gap-5">
            {USE_CASES.map((t, i) => (
              <UseCase key={t} text={t} valueMv={valueMv} i={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Static, fully-legible layout for reduced-motion: the triangle + the use-cases, in flow. */
function StaticFallback() {
  const Head = ({ role, size = 96 }: { role: string; size?: number }) => {
    const accent = PACK_ACCENT[role]
    return (
      <div className="flex w-[200px] flex-col items-center">
        <IdleGlyph role={role} tone="active" size={size} accent={accent?.ring} outline />
        <p className="mt-3 text-[13px] font-bold capitalize font-display" style={{ color: accent?.ink }}>{role}</p>
        <p className="mt-1.5 rounded-lg px-2 py-1 text-center text-[11.5px] leading-snug text-ink-700" style={{ backgroundColor: accent?.wash }}>
          {ROLE_DESC[role]}
        </p>
      </div>
    )
  }
  const rows: string[][] = [['alpha'], ['beta', 'elder'], ['scout', 'tracker', 'sentinel', 'howler']]
  return (
    <div className="mx-auto max-w-6xl px-6 py-24">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-500">The pack</p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink-900 font-display md:text-4xl">One request. A whole team on it.</h2>
      <div className="mt-14 flex flex-col items-center gap-12">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap justify-center gap-x-8 gap-y-10">
            {row.map((r) => (
              <Head key={r} role={r} size={i === 0 ? 108 : 84} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-brand-600">What you can use it for</p>
        <div className="mt-6 flex flex-col gap-4">
          {USE_CASES.map((t) => (
            <p key={t} className="text-3xl font-bold leading-tight tracking-tight text-ink-900 font-display md:text-4xl">
              {t}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

export function PackReveal(): ReactNode {
  const reduce = useReducedMotion() ?? false
  const trackRef = useRef<HTMLDivElement>(null)
  const driveRef = useRef<PackDrive>({ spread: 0, presence: 0.34, alphaX: 0, alphaY: 0, alphaScaleMul: 1, warm: 1 })
  const valueMv = useMotionValue(0)
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] })

  useEffect(() => {
    if (reduce) return undefined
    const spacer = trackRef.current
    if (!spacer) return undefined
    let raf = 0
    let ticking = false
    const compute = () => {
      ticking = false
      const vh = window.innerHeight
      const pin = Math.max(spacer.offsetHeight - vh, 1)
      const past = -spacer.getBoundingClientRect().top
      let spread: number
      let presence: number
      let alphaX = 0
      let alphaY = 0
      let alphaScaleMul = 1
      let value = 0
      // The whole door is cream now, so every wolf renders as a forest-ink emblem (warm = 1).
      if (past <= 0) {
        // Hero: a big, faint lone wolf, centred.
        spread = 0
        presence = 0.34
      } else if (past <= pin) {
        // Pack: fan out, hold, collide — then slide left as the use-cases rise (value).
        const pp = past / pin
        spread = spreadAt(pp)
        presence = lerp(0.34, 0.95, smoothstep(0, 0.1, pp))
        value = smoothstep(PHASE.collideEnd, PHASE.valueIn, pp)
        alphaX = lerp(0, -0.42, value) // slide to the left half
        alphaScaleMul = lerp(1, 0.8, value)
      } else {
        // Past the pin: the lone wolf travels down + shrinks to rest as the bottom logo, fading out
        // as door-landing's static mark takes over. Use-cases clear away first.
        const rt = clamp01((past - pin) / vh)
        spread = 0
        value = 1 - smoothstep(0, 0.35, rt)
        alphaX = lerp(-0.42, 0, smoothstep(0, 0.5, rt))
        alphaY = lerp(0, -0.62, rt) // descend toward the bottom
        alphaScaleMul = lerp(0.8, 0.22, rt) // shrink to logo size
        presence = 0.95 * (1 - smoothstep(0.45, 1, rt))
      }
      driveRef.current = { spread, presence: clamp01(presence), alphaX, alphaY, alphaScaleMul, warm: 1 }
      valueMv.set(clamp01(value))
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        raf = requestAnimationFrame(compute)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    compute()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [reduce, valueMv])

  if (reduce) {
    // No scroll driver: a static cream section (the page itself is cream via door-page).
    return (
      <section className="cv-auto border-t border-ink-900/10 bg-cream-50">
        <StaticFallback />
      </section>
    )
  }

  return (
    <>
      <section ref={trackRef} data-pack-reveal aria-hidden className="relative border-t border-ink-900/10" style={{ height: '440vh' }} />
      <div className="pointer-events-none fixed inset-0 z-0">
        <StageInner progress={scrollYProgress} valueMv={valueMv} driveRef={driveRef} observeRef={trackRef} />
      </div>
    </>
  )
}
