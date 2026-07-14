import { describe, it, expect } from 'vitest'
import { MemoryEntrySchema } from './memory'

// The backend serves GET /memory as { memory: [{ text, kind, hunt_id }] } (app/routers/memory.py +
// MemoryItem). These parse the EXACT server shape so the two sides can't silently drift again.
describe('memory api schema (boundary validation)', () => {
  it('parses a typed lesson the Elder distilled', () => {
    const rows = MemoryEntrySchema.array().parse([
      { text: 'Primary sources beat aggregators.', kind: 'what-worked', hunt_id: 'h1' },
      { text: 'The Packmaster wants a tight brief.', kind: 'preference', hunt_id: null },
    ])
    expect(rows[0].kind).toBe('what-worked')
    expect(rows[1].hunt_id).toBeNull()
  })

  it('degrades a thin/legacy row to defaults instead of rejecting', () => {
    const [row] = MemoryEntrySchema.array().parse([{ text: 'an old untyped note' }])
    expect(row.kind).toBe('takeaway') // legacy rows have no kind → the "takeaway" default
    expect(row.hunt_id).toBeNull()
  })

  it('rejects a mistyped payload so drift fails loudly at the boundary', () => {
    expect(() => MemoryEntrySchema.parse({ text: 5, kind: 'what-worked' })).toThrow()
  })
})
