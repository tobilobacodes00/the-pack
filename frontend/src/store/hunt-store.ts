import { createContext, useContext } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { huntReducer, initialHuntState } from '@/events/reducer'
import type { HuntEvent, HuntState } from '@/events/schema'

export type TeamEntry = { role: string; count: number }
export type PendingEdits = { team: TeamEntry[]; notes: Record<string, string> }

export interface HuntStore {
  state: HuntState
  /** Formation edits saved in the Edit panel, held until Start Hunt sends them as `edits`. */
  pendingEdits: PendingEdits | null
  dispatch: (event: HuntEvent) => void
  applyLocalEdits: (edits: PendingEdits) => void
  reset: () => void
}

/** A single hunt's store instance. Created per hunt (see the registry below) — never a global
 *  singleton, so one hunt's state can't bleed into another's view. */
export function createHuntStore() {
  return createStore<HuntStore>((set) => ({
    state: initialHuntState,
    pendingEdits: null,
    dispatch: (event) =>
      set((store) => ({
        state: huntReducer(store.state, event),
        // A fresh plan or an approval supersedes any locally-held edit.
        pendingEdits:
          event.type === 'plan_proposed' || event.type === 'plan_approved'
            ? null
            : store.pendingEdits,
      })),
    applyLocalEdits: (edits) =>
      set((store) => {
        if (!store.state.plan) return {}
        const wolves = edits.team.flatMap(
          (t) => Array(Math.max(1, t.count)).fill(t.role) as string[],
        )
        return {
          pendingEdits: edits,
          state: { ...store.state, plan: { ...store.state.plan, team: edits.team, wolves } },
        }
      }),
    reset: () => set({ state: initialHuntState, pendingEdits: null }),
  }))
}

export type HuntStoreApi = ReturnType<typeof createHuntStore>

// One store per key (hunt id, or 'intake' for the pre-hunt door session). Cached so returning to a
// hunt reuses its state — no replay flash — while different hunts stay fully isolated.
const registry = new Map<string, HuntStoreApi>()

export function getHuntStore(key: string): HuntStoreApi {
  let store = registry.get(key)
  if (!store) {
    store = createHuntStore()
    registry.set(key, store)
  }
  return store
}

export const HuntStoreContext = createContext<HuntStoreApi | null>(null)

/** The store instance for the current hunt scope — for imperative reads in effects (`.getState()`). */
export function useHuntStoreApi(): HuntStoreApi {
  const store = useContext(HuntStoreContext)
  if (!store) throw new Error('useHuntStore must be used within a <HuntStoreProvider>')
  return store
}

/** Reactive selector into the current hunt's store — same call shape as before, now context-scoped. */
export function useHuntStore<T>(selector: (s: HuntStore) => T): T {
  return useStore(useHuntStoreApi(), selector)
}
