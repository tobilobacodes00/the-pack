import { useSyncExternalStore } from 'react'

// The Tailwind `sm` breakpoint (640px). Below this we treat the viewport as "mobile" for the handful
// of places that need a JS decision (default-collapsed panels, sheet vs column) rather than a CSS-only
// responsive class. Keep in lockstep with the Tailwind default so JS and CSS agree.
const MOBILE_MAX = 639

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** True when the viewport is at or below the `sm` breakpoint. Reactive to resize/orientation change.
 *  Server snapshot is `false` (desktop-first) so SSR/first paint doesn't assume mobile. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(`(max-width: ${MOBILE_MAX}px)`).matches,
    () => false,
  )
}
