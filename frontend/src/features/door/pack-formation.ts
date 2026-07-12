// Shared choreography for the "meet the pack" scene: the slot layout + the scroll-phase math,
// used by BOTH the WebGL renderer (pack-canvas, draws the wolves) and the DOM overlay
// (pack-reveal, floats each role's icon + note over its wolf). One source so they never drift.

export interface PackSlot {
  role: string
  /** Target spot in the spread triangle, in clip space: sx ∈ [-1,1] right, sy ∈ [-1,1] up. */
  sx: number
  sy: number
  scale: number
  /** Paint order (higher = nearer / drawn last). Alpha on top. */
  z: number
}

// Apex-first. Alpha front & largest (bottom); the open top row (Scout/Tracker/Sentinel/Howler)
// is the widest — a downward-pointing triangle with no base.
// Columns are INTERLEAVED between rows (mid wolves sit in the gaps of the top row) so no
// caption ever falls straight onto the head below it.
export const PACK_SLOTS: PackSlot[] = [
  { role: 'alpha', sx: 0.0, sy: -0.42, scale: 1.0, z: 7 },
  { role: 'beta', sx: -0.4, sy: -0.02, scale: 0.8, z: 6 },
  { role: 'elder', sx: 0.4, sy: -0.02, scale: 0.8, z: 5 },
  { role: 'scout', sx: -0.62, sy: 0.36, scale: 0.6, z: 4 },
  { role: 'tracker', sx: -0.2, sy: 0.36, scale: 0.6, z: 3 },
  { role: 'sentinel', sx: 0.2, sy: 0.36, scale: 0.6, z: 2 },
  { role: 'howler', sx: 0.62, sy: 0.36, scale: 0.6, z: 1 },
]

// Clip-space → model scale. Kept compact so the whole triangle sits with clear margin on every
// side (never edge-to-edge). Alpha at its slot (scale 1) → ~26vh tall; back row ~15vh.
export const BASE_SCALE = 0.34

// Alpha's size as a lone wolf (hero + rest) — matches the hero emblem so the journey reads as
// ONE wolf: big on the hero, shrinks to the triangle apex as the pack fans out, then grows back
// to this size when it collides into one on the closing section.
export const HERO_SCALE = 0.62

// Scroll-phase boundaries within the pack pin (0..1): expand → hold → collide → value.
// After the collide the lone wolf slides left and the use-cases rise on the right (value),
// held until the end of the pin; the descent to the resting logo happens past the pin.
export const PHASE = { expandEnd: 0.14, holdEnd: 0.32, collideEnd: 0.46, valueIn: 0.58 }

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

/** 0 = one wolf (converged), 1 = full triangle. Ramps up (expand), holds, ramps down (collide). */
export function spreadAt(p: number): number {
  if (p < PHASE.expandEnd) return smoothstep(0, PHASE.expandEnd, p)
  if (p < PHASE.holdEnd) return 1
  if (p < PHASE.collideEnd) return 1 - smoothstep(PHASE.holdEnd, PHASE.collideEnd, p)
  return 0
}

/** Screen position (%) of a slot's centre — for placing the DOM icon/note over its wolf. */
export function slotScreen(slot: PackSlot): { leftPct: number; topPct: number } {
  return { leftPct: 50 + slot.sx * 50, topPct: 50 - slot.sy * 50 }
}
