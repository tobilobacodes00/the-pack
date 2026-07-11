import { describe, it, expect } from 'vitest'
import type { Brief } from '@/api/hunts'
import { parseBrief, formatByline } from './brief-view'

const brief = (content: Record<string, unknown>): Brief => ({ content }) as unknown as Brief

describe('parseBrief', () => {
  it('extracts a leading "# " title and keeps non-empty body blocks', () => {
    const v = parseBrief(
      brief({
        blocks: [
          { text: '# The Title', source_ids: [] },
          { text: 'Body one', source_ids: [1] },
          { text: '   ', source_ids: [] },
        ],
        sources: [{ url: 'x' }],
      }),
      'fallback',
    )
    expect(v.title).toBe('The Title')
    expect(v.bodyBlocks.map((b) => b.text)).toEqual(['Body one'])
    expect(v.noSources).toBe(false)
  })

  it('falls back to content.text when there are no body blocks', () => {
    const v = parseBrief(brief({ blocks: [], text: 'plain body', sources: [] }), 'fallback')
    expect(v.bodyBlocks).toHaveLength(1)
    expect(v.bodyBlocks[0].text).toBe('plain body')
    expect(v.noSources).toBe(true) // empty sources
  })

  it('uses the fallback title chain and flags refined', () => {
    expect(parseBrief(brief({ blocks: [] }), 'Fallback').title).toBe('Fallback')
    expect(parseBrief(brief({ blocks: [] }), '').title).toBe('Untitled brief')
    expect(parseBrief(brief({ blocks: [], refined: true }), 'x').refined).toBe(true)
  })
})

describe('formatByline', () => {
  it('joins present segments with · and omits missing ones', () => {
    expect(formatByline(null, null)).toBe('Researched and drafted by Pack')
    expect(formatByline(null, 'Battery Project')).toBe(
      'Researched and drafted by Pack · Battery Project',
    )
  })
  it('formats a valid date and skips an invalid one', () => {
    expect(formatByline('2026-06-17T00:00:00Z')).toContain('June')
    expect(formatByline('not-a-date')).toBe('Researched and drafted by Pack')
  })
})
