import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReceiptsPanel, receiptsMarkdown } from './receipts-panel'
import type { Receipts } from '@/api/hunts'

const receipts: Receipts = {
  hunt_id: 'h1',
  critique_ran: true,
  review_note: '',
  claims: [
    {
      text: 'Kenya added 300MW of solar in 2025',
      status: 'verified',
      sources: [
        { n: 1, title: 'IEA report', url: 'https://iea.org/x', by: 'scout-1', verified: true, library: false },
      ],
      challenge: null,
    },
    {
      text: 'Adoption is driven by falling panel prices',
      status: 'challenged_kept',
      sources: [
        { n: 2, title: 'News piece', url: 'https://news.com/y', by: 'scout-2', verified: false, library: false },
      ],
      challenge: { problem: 'single-source claim' },
    },
    {
      text: 'Grid instability accelerates home solar',
      status: 'verified',
      sources: [{ n: 3, title: 'My notes', url: 'lib://42', by: 'your library', verified: true, library: true }],
      challenge: null,
    },
  ],
  dropped: [{ text: 'A vendor claims 90% market share', problem: 'no source' }],
  standoff: { challenger: 'sentinel', defendant: 'tracker', outcome: 'alpha_call', rationale: 'no source held up' },
  wolves: { 'scout-1': { sources: 1, verified: 1 }, 'scout-2': { sources: 1, verified: 0 } },
  documents: [{ doc_id: '42', title: 'My notes', cited_by_claims: 1 }],
  totals: { claims: 3, verified: 2, cited: 0, unsourced: 0, challenged_kept: 1, dropped: 1 },
}

function renderPanel(props: Partial<React.ComponentProps<typeof ReceiptsPanel>> = {}) {
  const merged = { receipts: null as Receipts | null, loading: false, onCancel: vi.fn(), ...props }
  render(<ReceiptsPanel {...merged} />)
  return merged
}

describe('ReceiptsPanel', () => {
  it('shows the empty state until a brief exists', () => {
    renderPanel()
    expect(screen.getByText('No receipts yet')).toBeInTheDocument()
  })

  it('renders every claim with its status chip and sources', () => {
    renderPanel({ receipts })
    expect(screen.getByText('Kenya added 300MW of solar in 2025')).toBeInTheDocument()
    expect(screen.getAllByText('Verified')).toHaveLength(2)
    expect(screen.getByText('Challenged · kept')).toBeInTheDocument()
    // the source line credits the wolf and marks the page as actually read
    const link = screen.getByRole('link', { name: 'IEA report' })
    expect(link).toHaveAttribute('href', 'https://iea.org/x')
    // library sources are NOT external links (lib:// is not navigable)
    expect(screen.queryByRole('link', { name: 'My notes' })).toBeNull()
  })

  it('surfaces the Sentinel challenge, the dropped claim, and the standoff', () => {
    renderPanel({ receipts })
    expect(screen.getByText(/Sentinel: single-source claim/)).toBeInTheDocument()
    expect(screen.getByText('A vendor claims 90% market share')).toBeInTheDocument()
    expect(screen.getByText(/no source$/)).toBeInTheDocument()
    expect(screen.getByText(/Standoff\./)).toBeInTheDocument()
  })

  it('shows your-documents coverage', () => {
    renderPanel({ receipts })
    expect(screen.getByText(/My notes · cited by 1 claim/)).toBeInTheDocument()
  })

  it('summarizes the totals in the header', () => {
    renderPanel({ receipts })
    expect(screen.getByText(/3 claims · 2 verified · 1 challenged & kept · 1 dropped/)).toBeInTheDocument()
  })

  it('back button fires onCancel', () => {
    const { onCancel } = renderPanel({ receipts })
    fireEvent.click(screen.getByRole('button', { name: 'Back to the brief' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('warns honestly when verification did not complete, with the reason', () => {
    renderPanel({
      receipts: {
        ...receipts,
        critique_ran: false,
        review_note: 'verification did not complete — claims are unverified',
      },
    })
    expect(screen.getByText(/Verification didn’t complete/)).toBeInTheDocument()
    expect(screen.getByText(/claims are unverified/)).toBeInTheDocument()
  })

  it('shows no did-not-complete warning when the critique ran', () => {
    renderPanel({ receipts })
    expect(screen.queryByText(/Verification didn’t complete/)).toBeNull()
  })
})

describe('receiptsMarkdown', () => {
  it('renders a complete, attachable appendix', () => {
    const md = receiptsMarkdown(receipts)
    expect(md).toContain('# Receipts')
    expect(md).toContain('3 claims · 2 verified · 1 challenged & kept · 1 dropped in verification')
    expect(md).toContain('## Kenya added 300MW of solar in 2025')
    expect(md).toContain('- [1] IEA report — https://iea.org/x (found by scout-1, read in full)')
    expect(md).toContain('Challenge: single-source claim')
    expect(md).toContain('## Dropped in verification')
    expect(md).toContain('- A vendor claims 90% market share — no source')
    expect(md).toContain('## Standoff')
    expect(md).toContain('## Your documents used')
  })

  it('includes the did-not-complete warning when verification was skipped', () => {
    const md = receiptsMarkdown({ ...receipts, critique_ran: false, review_note: 'timed out' })
    expect(md).toContain("Verification didn't complete — timed out")
  })
})
