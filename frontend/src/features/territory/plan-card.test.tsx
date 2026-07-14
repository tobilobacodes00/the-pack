import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlanCard } from './plan-card'
import { HuntStoreContext, createHuntStore } from '@/store/hunt-store'
import type { HuntStoreApi } from '@/store/hunt-store'
import type { PlanState } from '@/events/schema'

function plan(over: Partial<PlanState> = {}): PlanState {
  return {
    steps: [],
    wolves: ['scout-1', 'scout-2', 'scout-3', 'tracker', 'sentinel', 'howler', 'elder'],
    pattern: 'parallel_then_merge',
    assumptions: [],
    est_cost: 0.7,
    est_time: 220,
    strategy: 'orchestrate',
    depth: 'standard',
    ...over,
  }
}

// Render the card inside a fresh per-hunt store (the card reads pendingEdits via context).
function renderCard(props: Partial<React.ComponentProps<typeof PlanCard>> = {}, store?: HuntStoreApi) {
  const s = store ?? createHuntStore()
  const merged = {
    plan: plan(),
    onApprove: vi.fn(),
    onEdit: vi.fn(),
    onEditFormation: vi.fn(),
    approving: false,
    ...props,
  }
  render(
    <HuntStoreContext.Provider value={s}>
      <PlanCard {...merged} />
    </HuntStoreContext.Provider>,
  )
  return merged
}

describe('PlanCard — depth control', () => {
  it('seeds the depth toggle from the plan and marks it active', () => {
    renderCard({ plan: plan({ depth: 'deep' }) })
    expect(screen.getByRole('radio', { name: 'Deep' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'false')
  })

  it('defaults to standard when the plan has no depth', () => {
    renderCard({ plan: plan({ depth: undefined }) })
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the deep warning only when Deep is selected', () => {
    renderCard()
    expect(screen.queryByText(/costs more/i)).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Deep' }))
    expect(screen.getByText(/costs more/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Brief' }))
    expect(screen.queryByText(/costs more/i)).toBeNull()
  })

  it('renders the estimated cost (not hidden)', () => {
    renderCard({ plan: plan({ est_cost: 1.4, est_time: 340 }) })
    expect(screen.getByText(/\$1\.40/)).toBeInTheDocument()
  })

  it('Start Hunt sends the chosen depth and a real boundary (never the magic $5)', () => {
    const { onApprove } = renderCard({ plan: plan({ est_cost: 0.7 }) })
    fireEvent.click(screen.getByRole('radio', { name: 'Deep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start Hunt' }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    const body = (onApprove as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body.depth).toBe('deep')
    // boundary = max(1.0, est_cost*2) = max(1.0, 1.4) = 1.4 — NOT 5
    expect(body.boundary_usd).toBeCloseTo(1.4, 6)
    expect(body.boundary_usd).not.toBe(5)
  })

  it('boundary floors at $1 when the estimate is tiny', () => {
    const { onApprove } = renderCard({ plan: plan({ est_cost: 0.1 }) })
    fireEvent.click(screen.getByRole('button', { name: 'Start Hunt' }))
    const body = (onApprove as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body.boundary_usd).toBeCloseTo(1.0, 6)
  })

  it('carries pendingEdits from the store along with the approval', () => {
    const store = createHuntStore()
    // seed a plan so applyLocalEdits (which requires state.plan) lands, then save formation edits.
    store.getState().dispatch({
      event_id: 'e1', hunt_id: 'h', seq: 0, ts: '2026-07-13T00:00:00Z', actor: 'beta',
      type: 'plan_proposed',
      payload: {
        steps: [], wolves: ['scout-1'], pattern: 'parallel_then_merge', assumptions: [],
        est_cost: 0.7, est_time: 220,
      },
    })
    store.getState().applyLocalEdits({ team: [{ role: 'scout', count: 5 }], notes: {} })
    const { onApprove } = renderCard({}, store)
    fireEvent.click(screen.getByRole('button', { name: 'Start Hunt' }))
    const body = (onApprove as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body.edits).toEqual({ team: [{ role: 'scout', count: 5 }], notes: {} })
  })
})
