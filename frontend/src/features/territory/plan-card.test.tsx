import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlanCard } from './plan-card'
import { HuntStoreContext, createHuntStore } from '@/store/hunt-store'
import type { HuntStoreApi } from '@/store/hunt-store'
import type { PlanState } from '@/events/schema'
import { api } from '@/api/client'

// The card re-prices edited formations through POST /rehearse — mock the transport so the
// query layer runs for real (schema parse included) without a network.
vi.mock('@/api/client', () => ({ api: { post: vi.fn() } }))
const apiPost = vi.mocked(api.post)

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

// Render the card inside a fresh per-hunt store (the card reads pendingEdits via context) and a
// fresh QueryClient (the card's rehearse re-pricing runs through react-query).
function renderCard(props: Partial<React.ComponentProps<typeof PlanCard>> = {}, store?: HuntStoreApi) {
  const s = store ?? createHuntStore()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const merged = {
    huntId: null as string | null,
    plan: plan(),
    onApprove: vi.fn(),
    onEdit: vi.fn(),
    onEditFormation: vi.fn(),
    approving: false,
    ...props,
  }
  render(
    <QueryClientProvider client={qc}>
      <HuntStoreContext.Provider value={s}>
        <PlanCard {...merged} />
      </HuntStoreContext.Provider>
    </QueryClientProvider>,
  )
  return merged
}

beforeEach(() => {
  apiPost.mockReset()
})

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
    // no est_by_depth in this plan → falls back to est_cost 0.7; boundary = max(1.0, 0.7*2) = 1.4
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

describe('PlanCard — the Estimate (rehearsed pricing)', () => {
  const rehearsedPlan = () =>
    plan({
      est_by_depth: {
        brief: { cost: 0.15, time: 60, calls: 6 },
        standard: { cost: 0.26, time: 85, calls: 6 },
        deep: { cost: 0.86, time: 170, calls: 11 },
      },
      est_detail: { scouts: 3, warnings: [] },
    })

  it('shows the rehearsal receipt line — scouts + model calls priced', () => {
    renderCard({ plan: rehearsedPlan() })
    expect(screen.getByText(/Rehearsed for this formation/)).toBeInTheDocument()
    expect(screen.getByText(/3 scouts · 6 model calls/)).toBeInTheDocument()
  })

  it('hides the receipt line for legacy plans that predate the rehearsed table', () => {
    renderCard({ plan: plan() }) // no est_by_depth/est_detail
    expect(screen.queryByText(/Rehearsed for/)).toBeNull()
  })

  it('receipt line tracks the selected depth (deep → the deep call count)', () => {
    renderCard({ plan: rehearsedPlan() })
    fireEvent.click(screen.getByRole('radio', { name: 'Deep' }))
    expect(screen.getByText(/3 scouts · 11 model calls/)).toBeInTheDocument()
  })

  it('surfaces rehearsal warnings (e.g. an over-cap scout count)', () => {
    renderCard({
      plan: plan({
        est_by_depth: { standard: { cost: 0.4, time: 90, calls: 8 } },
        est_detail: { scouts: 5, warnings: ['7 scouts is a lot — the engine will cap it at 5.'] },
      }),
    })
    expect(screen.getByText(/the engine will cap it at 5/)).toBeInTheDocument()
  })

  it('re-prices live for an edited formation via POST /rehearse', async () => {
    apiPost.mockResolvedValue({
      data: { est_cost_usd: 0.44, est_time_s: 85, calls: 8, scouts: 5, warnings: [] },
    })
    const store = createHuntStore()
    store.getState().dispatch({
      event_id: 'e1', hunt_id: 'h1', seq: 0, ts: '2026-07-13T00:00:00Z', actor: 'beta',
      type: 'plan_proposed',
      payload: {
        steps: [], wolves: ['scout-1'], pattern: 'parallel_then_merge', assumptions: [],
        est_cost: 0.26, est_time: 85, strategy: 'orchestrate',
        est_by_depth: { standard: { cost: 0.26, time: 85, calls: 6 } },
        est_detail: { scouts: 3, warnings: [] },
      },
    })
    store.getState().applyLocalEdits({ team: [{ role: 'scout', count: 5 }], notes: {} })
    renderCard({ huntId: 'h1' }, store)
    // the rehearse call fires for the edited team at the selected depth
    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect(apiPost).toHaveBeenCalledWith('/hunts/h1/rehearse', {
      team: [{ role: 'scout', count: 5 }],
      strategy: 'orchestrate',
      depth: 'standard',
    })
    // and the card shows the re-priced figures, labeled as the edited formation's
    expect(await screen.findByText(/your edited formation/)).toBeInTheDocument()
    expect(screen.getByText(/5 scouts · 8 model calls/)).toBeInTheDocument()
    expect(screen.getByText(/\$0\.44/)).toBeInTheDocument()
  })

  it('does NOT call /rehearse when there are no formation edits', async () => {
    renderCard({ huntId: 'h1', plan: rehearsedPlan() })
    // give any stray query a tick to fire — it must not
    await new Promise((r) => setTimeout(r, 50))
    expect(apiPost).not.toHaveBeenCalled()
  })
})
