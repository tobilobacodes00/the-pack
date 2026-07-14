import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WolfInspector } from './wolf-inspector'
import type { WolfState } from '@/events/schema'

function wolf(patch: Partial<WolfState> = {}): WolfState {
  return {
    wolf_id: 'scout-2',
    role: 'scout',
    model_tier: 'flash',
    thinking: false,
    phase: 'reading',
    last_text: null,
    status: 'active',
    cost_usd: 0,
    parent_wolf_id: null,
    phaseHistory: [],
    lastTool: null,
    lastLatencyMs: null,
    toolCalls: 0,
    ...patch,
  }
}

describe('WolfInspector', () => {
  it('shows the wolf label, a working status, and what it is doing now', () => {
    render(<WolfInspector wolf={wolf({ phase: 'searching' })} onClose={vi.fn()} />)
    expect(screen.getByText('Scout 2')).toBeInTheDocument()
    expect(screen.getByText('working')).toBeInTheDocument()
    expect(screen.getByText(/searching the web/i)).toBeInTheDocument()
  })

  it('renders the phase trail in order and marks the last step live', () => {
    render(
      <WolfInspector
        wolf={wolf({ phaseHistory: ['web_search', 'web_fetch', 'thinking'] })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('searched')).toBeInTheDocument()
    expect(screen.getByText('read a page')).toBeInTheDocument()
    expect(screen.getByText('thinking')).toBeInTheDocument()
  })

  it('shows a DONE state distinctly and its latest output', () => {
    render(
      <WolfInspector
        wolf={wolf({ status: 'done', last_text: 'Found 3 sources on the EV charging market.' })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.getByText(/Found 3 sources/)).toBeInTheDocument()
  })

  it('surfaces stats (steps, last-call latency, cost) when present', () => {
    render(
      <WolfInspector
        wolf={wolf({ toolCalls: 3, lastLatencyMs: 4200, cost_usd: 0.0031 })}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('3 steps')).toBeInTheDocument()
    expect(screen.getByText('4.2s last call')).toBeInTheDocument()
    expect(screen.getByText('$0.003')).toBeInTheDocument()
  })

  it('closes when the close button is clicked', () => {
    const onClose = vi.fn()
    render(<WolfInspector wolf={wolf()} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
