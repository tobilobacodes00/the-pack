import { describe, it, expect } from 'vitest'
import { BriefSchema, HuntListResponseSchema, ScorecardSchema } from './schemas'

describe('api schemas (boundary validation)', () => {
  it('parses a valid brief', () => {
    const brief = BriefSchema.parse({
      artifact_id: 'a1',
      hunt_id: 'h1',
      kind: 'final',
      produced_by: 'howler',
      content: {
        text: 'hi',
        blocks: [{ text: 'p', source_ids: [1] }],
        claims: [],
        sources: [{ title: 'T', url: 'u', by: 'scout-1', verified: true }],
        span_map_ref: null,
        no_sources: false,
      },
    })
    expect(brief.content.blocks[0].source_ids).toEqual([1])
    expect(brief.content.sources[0].by).toBe('scout-1')
  })

  it('fills defaults for a thin content payload (degrades, not rejects)', () => {
    const b = BriefSchema.parse({ artifact_id: 'a', hunt_id: 'h', kind: 'final', content: {} })
    expect(b.produced_by).toBeNull()
    expect(b.content.no_sources).toBe(false)
    expect(b.content.blocks).toEqual([])
    expect(b.content.sources).toEqual([])
  })

  it('rejects a mistyped scorecard so drift fails loudly at the boundary', () => {
    expect(() => ScorecardSchema.parse({ lone_wolf: { quality: 'nope' }, pack: {} })).toThrow()
    // all-default sides are fine
    expect(ScorecardSchema.parse({ lone_wolf: {}, pack: {} }).pack.cost_usd).toBe(0)
  })

  it('parses the hunt list, filling row defaults', () => {
    const res = HuntListResponseSchema.parse({
      hunts: [{ hunt_id: 'h', state: 'completed' }],
      next_cursor: null,
    })
    expect(res.hunts[0].title).toBe('')
    expect(res.hunts[0].cost_usd).toBe(0)
  })
})
