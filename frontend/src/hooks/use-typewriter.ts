import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

export interface TypewriterOptions {
  /** ms per character while typing (default 55). */
  typeMs?: number
  /** ms per character while deleting — usually faster than typing (default 28). */
  deleteMs?: number
  /** ms to hold a fully-typed phrase before deleting it (default 1600). */
  holdMs?: number
  /** ms to pause on empty before typing the next phrase (default 320). */
  gapMs?: number
  /** Loop back to the first phrase after the last (default true). */
  loop?: boolean
}

/**
 * A type → hold → backspace → next-phrase typewriter, driven by chained timeouts (no interval drift,
 * and every timer is cleared on unmount / phrase-list change). Returns the currently-visible slice of
 * the active phrase plus a `done` flag (true once the last phrase is fully typed when loop=false).
 *
 * Honours prefers-reduced-motion: no animation, just the first phrase shown in full and settled. This
 * is the accessible fallback AND what a screen reader gets — the caret and motion are decoration.
 */
export function useTypewriter(phrases: string[], opts: TypewriterOptions = {}) {
  const { typeMs = 55, deleteMs = 28, holdMs = 1600, gapMs = 320, loop = true } = opts
  const reduce = useReducedMotion() ?? false

  const [text, setText] = useState(() => (phrases[0] ?? ''))
  const [done, setDone] = useState(reduce)
  // Keep the latest phrases/opts in a ref so the effect that owns the timer chain doesn't tear down
  // and restart on every parent re-render (which would restart the animation mid-phrase).
  const stateRef = useRef({ phrases, typeMs, deleteMs, holdMs, gapMs, loop })
  stateRef.current = { phrases, typeMs, deleteMs, holdMs, gapMs, loop }

  useEffect(() => {
    if (reduce) {
      setText(phrases[0] ?? '')
      setDone(true)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    let phraseIdx = 0
    let charIdx = 0
    let deleting = false

    const tick = () => {
      const s = stateRef.current
      const list = s.phrases.length ? s.phrases : ['']
      const current = list[phraseIdx % list.length]

      if (!deleting) {
        // Typing forward.
        charIdx += 1
        setText(current.slice(0, charIdx))
        if (charIdx >= current.length) {
          const isLast = phraseIdx === list.length - 1
          if (!s.loop && isLast) {
            setDone(true)
            return // settle on the last phrase; no more timers
          }
          deleting = true
          timer = setTimeout(tick, s.holdMs) // hold the full phrase
          return
        }
        timer = setTimeout(tick, s.typeMs)
        return
      }

      // Deleting backward.
      charIdx -= 1
      setText(current.slice(0, Math.max(0, charIdx)))
      if (charIdx <= 0) {
        deleting = false
        phraseIdx = (phraseIdx + 1) % list.length
        charIdx = 0
        timer = setTimeout(tick, s.gapMs) // brief pause on empty, then the next phrase
        return
      }
      timer = setTimeout(tick, s.deleteMs)
    }

    // Start from the first phrase already partly on screen — begin by holding it, then deleting.
    setText(phrases[0] ?? '')
    setDone(false)
    charIdx = (phrases[0] ?? '').length
    deleting = true
    timer = setTimeout(tick, stateRef.current.holdMs)

    return () => clearTimeout(timer)
    // Restart only when the animation is enabled/disabled or the phrase SET changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, phrases])

  return { text, done, reduced: reduce }
}
