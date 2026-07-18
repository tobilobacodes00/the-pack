import { ChevronUp, ChevronDown, ZoomIn, ZoomOut } from 'lucide-react'
import { color } from '@/lib/theme'

interface Props {
  /** Current zoom (1 = 100%). */
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  /** Nudge the reading column up / down by a small step on each click (not jump to the extremes). */
  onStepUp: () => void
  onStepDown: () => void
  minZoom: number
  maxZoom: number
}

function RailButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34,
        background: 'none', border: 'none', borderRadius: 8, color: color.dim,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(26,26,26,0.05)' }}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      {children}
    </button>
  )
}

/**
 * The reading-view control rail — pinned to the RIGHT of the reward modal (design). Zoom the brief
 * text in/out and nudge the reading column up/down a small step at a time on each click. Reading is
 * HTML prose (not paginated), so "zoom" scales the article font and the arrows step-scroll the
 * column — genuinely functional, no faked pages.
 */
export function ReadingControls({ zoom, onZoomIn, onZoomOut, onStepUp, onStepDown, minZoom, maxZoom }: Props) {
  return (
    <div
      className="absolute bottom-4 right-4 z-10 flex flex-col items-center"
      style={{
        background: color.surface, border: `1px solid ${color.border}`, borderRadius: 12,
        padding: 4, boxShadow: '0 8px 24px rgba(26,26,26,0.12)',
      }}
    >
      <RailButton onClick={onStepUp} label="Scroll up"><ChevronUp size={17} /></RailButton>
      <RailButton onClick={onStepDown} label="Scroll down"><ChevronDown size={17} /></RailButton>
      <div style={{ height: 1, width: 22, margin: '2px 0', background: color.border }} />
      <RailButton onClick={onZoomIn} disabled={zoom >= maxZoom} label="Zoom in"><ZoomIn size={16} /></RailButton>
      <span style={{ fontSize: 11, color: color.faint, padding: '1px 0', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(zoom * 100)}%
      </span>
      <RailButton onClick={onZoomOut} disabled={zoom <= minZoom} label="Zoom out"><ZoomOut size={16} /></RailButton>
    </div>
  )
}
