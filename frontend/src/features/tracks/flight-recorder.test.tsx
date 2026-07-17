import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, fireEvent } from '@testing-library/react'
import type { HuntState } from '@/events/schema'
import { FlightRecorder } from './flight-recorder'

// The canvas itself is ReactFlow/WebGL territory — proven by its own tests. Here we assert the
// recorder drives it with the REPLAYED state, so a lightweight probe stands in for it.
vi.mock('@/features/territory/graph-canvas', () => ({
  GraphCanvas: ({ huntState }: { huntState: HuntState }) => (
    <div data-testid="canvas" data-status={huntState.status} />
  ),
}))

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(__dirname, '../../../../backend/fixtures')

function loadRaw(filename: string): unknown[] {
  return readFileSync(resolve(FIXTURES, filename), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown)
}

function renderRecorder(raw: unknown[] = loadRaw('flow_a_researcher.jsonl')) {
  render(
    <MemoryRouter>
      <FlightRecorder title="The BNPL market" raw={raw} briefHref="/share/tok" />
    </MemoryRouter>,
  )
  return raw
}

describe('FlightRecorder', () => {
  it('renders the header, the brief link, and starts at 0 events', () => {
    renderRecorder()
    expect(screen.getByText('The BNPL market')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read the brief' })).toHaveAttribute(
      'href',
      '/share/tok',
    )
    expect(screen.getByText(/^0 \/ \d+ events$/)).toBeInTheDocument()
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-status', 'idle')
  })

  it('scrubbing to the end replays the hunt to completion on the canvas', () => {
    renderRecorder()
    const slider = screen.getByRole('slider', { name: 'Replay position' })
    const max = Number(slider.getAttribute('max'))
    expect(max).toBeGreaterThan(0)
    fireEvent.change(slider, { target: { value: String(max) } })
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-status', 'completed')
    // the narrative beats have landed, ending on the return
    expect(screen.getByText('Hunt returned')).toBeInTheDocument()
    // and the transport offers a replay-from-the-top
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument()
  })

  it('offers play before the end and shows the empty-narrative nudge at 0', () => {
    renderRecorder()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByText(/Press play to watch the pack work/)).toBeInTheDocument()
  })
})
