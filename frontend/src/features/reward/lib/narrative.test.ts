import { describe, it, expect } from 'vitest'
import type { RawTrackEvent } from '@/api/hunts'
import { deriveNarrative, deriveTrackStats } from './narrative'

const ev = (type: string, payload: Record<string, unknown>, seq = 0): RawTrackEvent =>
  ({ seq, type, actor: 'engine', payload }) as unknown as RawTrackEvent

describe('deriveNarrative', () => {
  it('renders a wolf_progress beat (phase word) and the forge special-case', () => {
    const [beat, forge] = deriveNarrative([
      ev('wolf_progress', { wolf_id: 'scout-2', phase: 'thinking', text: 'hmm' }, 1),
      ev('wolf_progress', { wolf_id: 'howler', phase: 'forge', text: 'files' }, 2),
    ])
    expect(beat.title).toBe('Scout 2 thinking')
    expect(beat.detail).toBe('hmm')
    expect(forge.title).toBe('Making the files')
  })

  it('renders message_passed and standoff beats', () => {
    const items = deriveNarrative([
      ev('message_passed', { from_wolf: 'scout-1', to_wolf: 'tracker', summary: 's' }, 1),
      ev('standoff_opened', { challenger: 'sentinel', defendant: 'scout-1' }, 2),
      ev('standoff_resolved', { outcome: 'kept' }, 3),
    ])
    expect(items[0].title).toBe('Scout 1 passing to Tracker')
    expect(items[1].title).toBe('Sentinel challenging')
    expect(items[2].title).toBe('Standoff resolved')
  })

  it('renders boundary + completion beats', () => {
    const items = deriveNarrative([
      ev('boundary_warning', { pct: 72.4, cumulative_usd: 0.31 }, 1),
      ev('boundary_downgrade', { wolf_id: 'scout-1', from_tier: 'plus', to_tier: 'flash' }, 2),
      ev('hunt_completed', {}, 3),
    ])
    expect(items[0].title).toBe('Boundary at 72%')
    expect(items[1].detail).toContain('plus → flash')
    expect(items[2].title).toBe('Hunt returned')
  })

  it('ignores event types that have no narrative', () => {
    expect(deriveNarrative([ev('tokens_spent', { cost_usd: 0.1 })])).toEqual([])
  })
})

describe('deriveTrackStats', () => {
  it('uses the last tokens_spent cumulative when no totals', () => {
    const stats = deriveTrackStats(
      [ev('tokens_spent', { cumulative_usd: 0.1 }), ev('tokens_spent', { cumulative_usd: 0.25 })],
      null,
    )
    expect(stats.costLabel).toBe('$0.25 spent')
  })
  it('prefers totals and formats mm:ss', () => {
    const stats = deriveTrackStats([], { cost_usd: 1.5, time_s: 95 })
    expect(stats.costLabel).toBe('$1.50 spent')
    expect(stats.timeLabel).toBe('Worked for 1:35')
  })
})
