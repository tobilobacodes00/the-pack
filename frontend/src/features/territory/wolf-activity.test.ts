import { describe, it, expect } from 'vitest'
import type { WolfState } from '@/events/schema'
import { wolfActivity, wolfActivityLine } from './wolf-activity'

const wolf = (over: Partial<WolfState>): WolfState =>
  ({ wolf_id: 'scout-2', status: 'active', phase: null, ...over }) as WolfState

describe('wolfActivity', () => {
  it('lets status override phase', () => {
    expect(wolfActivity(wolf({ status: 'done', phase: 'searching' }))).toBe('has finished')
    expect(wolfActivity(wolf({ status: 'strayed' }))).toBe('went off-track — recovering')
    expect(wolfActivity(wolf({ status: 'error' }))).toBe('went off-track — recovering')
    expect(wolfActivity(wolf({ status: 'healing' }))).toBe('is being patched up')
  })

  it('maps phase verbs including tool phases', () => {
    expect(wolfActivity(wolf({ phase: 'searching' }))).toBe('is searching the web')
    expect(wolfActivity(wolf({ phase: 'web_fetch' }))).toBe('is reading a page')
    expect(wolfActivity(wolf({ phase: 'writing' }))).toBe('is drafting the briefing')
  })

  it('falls back when there is no known phase', () => {
    expect(wolfActivity(wolf({ status: 'active', phase: null }))).toBe('is on the move')
  })
})

describe('wolfActivityLine', () => {
  it('composes the wolf label with its activity', () => {
    expect(wolfActivityLine(wolf({ wolf_id: 'scout-2', phase: 'searching' }))).toBe(
      'Scout 2 is searching the web',
    )
  })
})
