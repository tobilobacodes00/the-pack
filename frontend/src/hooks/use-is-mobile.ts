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

// Match a custom max-width query reactively. For sections (like the scroll-jacked pack reveal) that
// only make sense on a large desktop and should fall back to a simple layout on phones AND tablets.
function subscribeMax(max: number, cb: () => void): () => void {
  const mq = window.matchMedia(`(max-width: ${max}px)`)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

const TABLET_MAX = 1023 // below Tailwind `lg` — phones and tablets

/** True on phones and tablets (below the `lg` breakpoint). */
export function useIsBelowLg(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeMax(TABLET_MAX, cb),
    () => window.matchMedia(`(max-width: ${TABLET_MAX}px)`).matches,
    () => false,
  )
}
