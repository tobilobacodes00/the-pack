import { describe, it, expect } from 'vitest'
import { createHuntStore, getHuntStore } from './hunt-store'

describe('per-hunt store', () => {
  it('isolates state per key and reuses one instance per key', () => {
    const a1 = getHuntStore('hunt-a')
    const a2 = getHuntStore('hunt-a')
    const b = getHuntStore('hunt-b')
    expect(a1).toBe(a2) // returning to a hunt reuses its store (no replay flash)
    expect(a1).not.toBe(b) // different hunts stay fully isolated (no cross-hunt bleed)
  })

  it('starts idle and reset returns to the initial state', () => {
    const store = createHuntStore()
    expect(store.getState().state.status).toBe('idle')
    expect(store.getState().pendingEdits).toBeNull()
    store.getState().reset()
    expect(store.getState().state.status).toBe('idle')
  })
})
