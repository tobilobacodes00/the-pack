// Reusable scroll-parallax primitive for A Pack's window-scrolled landing.
// framer-motion v11. Compositor-only: translateY / opacity / scale — no layout/paint per frame.
// PURE PASS-THROUGH NO-OP when useReducedMotion() is true: no motion values attach, so every layer
// renders at its natural CSS resting position (translate 0, class opacity).
import { useRef, type ReactNode, type RefObject } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useReducedMotion,
  type MotionValue,
  type MotionStyle,
  type UseScrollOptions,
  type SpringOptions,
} from 'framer-motion'

/** Tight tracking: a hair of lag, never seasick. One config across layers = one coherent scene. */
export const PARALLAX_SPRING: SpringOptions = { stiffness: 220, damping: 40, mass: 0.35, restDelta: 0.0005 }
/** Softer float, reserved for heavily-blurred decorative layers (glows, the drifting mark). */
export const GLOW_SPRING: SpringOptions = { stiffness: 70, damping: 20, mass: 0.6, restDelta: 0.0005 }

type Offset = UseScrollOptions['offset']

export interface ParallaxOptions {
  /** Vertical travel (px) across the element's pass; centered on 0 so it sits at CSS position mid-pass.
   *  Negative = drifts UP as you scroll down (deeper/lagging); positive = drifts down (nearer/leading). */
  speed?: number
  /** Where progress 0 and 1 pin. Default: element fully enters -> fully exits. */
  offset?: Offset
  /** false = zero-lag, hard-linked to scroll (use for tight content like headings). */
  smooth?: boolean
  /** Override the spring (e.g. GLOW_SPRING for decorative floats). */
  spring?: SpringOptions
}

export interface ParallaxHandle {
  ref: RefObject<HTMLDivElement>
  /** 0..1 across this element's pass. Drive your OWN cues (opacity/scale/asymmetric y) off this. */
  progress: MotionValue<number>
  /** Ready-to-bind, symmetric, spring-smoothed translateY (0 when reduced). */
  y: MotionValue<number>
  /** True when the user asked for reduced motion — collapse custom ranges to a resting constant. */
  reduce: boolean
}

/** Headless. useScroll is called HERE so the ref it targets is hydrated in the same component. */
export function useParallax({
  speed = -60,
  offset = ['start end', 'end start'],
  smooth = true,
  spring = PARALLAX_SPRING,
}: ParallaxOptions = {}): ParallaxHandle {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion() ?? false
  const { scrollYProgress } = useScroll({ target: ref, offset })

  // Hooks must run unconditionally; when reduced, the range is a no-op ([0,0]).
  const d = reduce ? 0 : speed
  const yRaw = useTransform(scrollYProgress, [0, 1], [-d / 2, d / 2])
  const ySpring = useSpring(yRaw, spring)

  return { ref, progress: scrollYProgress, y: smooth && !reduce ? ySpring : yRaw, reduce }
}

export interface ParallaxProps extends ParallaxOptions {
  children: ReactNode
  className?: string
  style?: MotionStyle
  fade?: boolean // fade in then settle across the pass
  scaleFrom?: number // e.g. 1.08 -> settles to 1
}

/** Drop-in layer for symmetric travel. Each <Parallax> tracks its OWN pass at its own depth. */
export function Parallax({ children, className, style, fade = false, scaleFrom, ...opts }: ParallaxProps) {
  const { ref, progress, y, reduce } = useParallax(opts)
  const opacity = useTransform(progress, [0, 0.2, 0.8, 1], [0, 1, 1, 0.65])
  const scale = useTransform(progress, [0, 1], [scaleFrom ?? 1, 1])

  const motionStyle: MotionStyle = reduce
    ? { willChange: 'auto', ...style }
    : {
        y,
        ...(fade ? { opacity } : null),
        ...(scaleFrom != null ? { scale } : null),
        // framer does NOT auto-set will-change for scroll-linked values, and y===0 emits
        // `transform:none` which would drop/recreate the GPU layer mid-scroll — pin it ourselves.
        willChange: 'transform',
        ...style,
      }

  return (
    <motion.div ref={ref} data-parallax className={className} style={motionStyle}>
      {children}
    </motion.div>
  )
}
