import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScorecardPanel } from './scorecard-panel'
import type { Scorecard } from '@/api/hunts'

const scorecard: Scorecard = {
  lone_wolf: { quality: 0.62, citations: 3, cost_usd: 0.08, time_s: 45, sources: 4 },
  pack: { quality: 0.88, citations: 9, cost_usd: 0.21, time_s: 95, sources: 12 },
}

function renderPanel(props: Partial<React.ComponentProps<typeof ScorecardPanel>> = {}) {
  const merged = {
    scorecard: null as Scorecard | null,
    loading: false,
    running: false,
    failed: false,
    onRun: vi.fn(),
    onCancel: vi.fn(),
    onExport: vi.fn(),
    ...props,
  }
  render(<ScorecardPanel {...merged} />)
  return merged
}

describe('ScorecardPanel — launch pad (no scorecard yet)', () => {
  it('offers the Run button and fires onRun', () => {
    const { onRun } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run the benchmark' }))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('explains what the benchmark actually does (solo agent, same task, judged)', () => {
    renderPanel()
    expect(screen.getByText('Lone Wolf vs the Pack')).toBeInTheDocument()
    expect(screen.getByText(/single solo agent/)).toBeInTheDocument()
  })

  it('shows the in-flight state while the lone wolf runs — no Run button', () => {
    renderPanel({ running: true })
    expect(screen.getByText(/The Lone Wolf is running your task/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run the benchmark' })).toBeNull()
  })

  it('surfaces a failed benchmark and keeps the retry button', () => {
    renderPanel({ failed: true })
    expect(screen.getByText(/didn’t finish — try again/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run the benchmark' })).toBeInTheDocument()
  })
})

describe('ScorecardPanel — with a scorecard', () => {
  it('renders the side-by-side rows (sources, accuracy, time, cost)', () => {
    renderPanel({ scorecard })
    expect(screen.getByText('Sources found')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument() // pack sources
    expect(screen.getByText('4')).toBeInTheDocument() // lone sources
    expect(screen.getByText('88%')).toBeInTheDocument() // pack accuracy (quality 0.88)
    expect(screen.getByText('62%')).toBeInTheDocument() // lone accuracy
    expect(screen.getByText('$0.21')).toBeInTheDocument()
  })

  it('never shows the launch pad once a scorecard exists', () => {
    renderPanel({ scorecard })
    expect(screen.queryByRole('button', { name: 'Run the benchmark' })).toBeNull()
    expect(screen.queryByText(/The Lone Wolf is running/)).toBeNull()
  })
})
