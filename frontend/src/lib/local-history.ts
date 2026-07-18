/**
 * Per-browser hunt ownership — local-first, no auth.
 *
 * The app has no accounts, and the Postgres DB is the ENGINE's shared working store (every hunt any
 * visitor launches lives there so the engine can run it). Without scoping, every browser sees every
 * other visitor's history + spend. This module keeps a small localStorage index of the hunt ids THIS
 * browser created, so the UI can show only *your* hunts and *your* spend while the DB stays global for
 * the engine. History is therefore per-device (not portable across browsers) — the intended trade-off.
 *
 * Storage is defensive: a private-mode / disabled-storage browser degrades to an in-memory set for the
 * session rather than throwing. The index holds ids only — titles/cost/date are read live from the API
 * and filtered against this set, so nothing here goes stale.
 */

const KEY = 'pack.ownedHunts.v1'

// Session fallback when localStorage is unavailable (Safari private mode, etc.) — never throw.
let memoryFallback: string[] | null = null

function read(): string[] {
  if (memoryFallback) return memoryFallback
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return memoryFallback ?? []
  }
}

function write(ids: string[]): void {
  const unique = Array.from(new Set(ids))
  try {
    localStorage.setItem(KEY, JSON.stringify(unique))
    memoryFallback = null
  } catch {
    // Storage blocked/full — keep it for this session at least so the just-created hunt still shows.
    memoryFallback = unique
  }
}

/** The set of hunt ids this browser owns. */
export function getOwnedHuntIds(): Set<string> {
  return new Set(read())
}

/** Record a hunt this browser just created so it shows up in *this* browser's history. */
export function rememberHunt(huntId: string): void {
  if (!huntId) return
  const ids = read()
  if (ids.includes(huntId)) return
  write([...ids, huntId])
}

/** Drop one hunt from local ownership (e.g. deleted from the Past-Hunts list). */
export function forgetHunt(huntId: string): void {
  write(read().filter((id) => id !== huntId))
}

/** Forget every locally-owned hunt (Clear hunt history / Reset Data — local scope only). */
export function clearOwnedHunts(): void {
  write([])
}

/** Keep only rows this browser owns. Generic over any object carrying a `hunt_id`. */
export function filterOwned<T extends { hunt_id: string }>(rows: T[] | undefined): T[] {
  if (!rows) return []
  const owned = getOwnedHuntIds()
  return rows.filter((r) => owned.has(r.hunt_id))
}
