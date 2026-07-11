import { color } from '@/lib/theme'

export interface ChoiceOption {
  label: string
  /** Replaces the number badge (e.g. a pencil for "tell Alpha differently"). */
  icon?: React.ReactNode
}

interface ChoiceCardProps {
  title: string
  description?: string
  options: ChoiceOption[]
  selected: number | null
  onSelect: (i: number) => void
  onSubmit: () => void
  onSkip?: () => void
  submitting?: boolean
  submitLabel?: string
  skipLabel?: string
}

/**
 * The raised #272727 numbered-choice card shared by the plan-ready, hold, and completion states
 * (matches the "Hunt Summary" / "Data hold" / "How would you like your result?" designs): a title,
 * optional body, numbered options (selected = filled white badge), and a Skip / Submit row.
 */
export function ChoiceCard({
  title, description, options, selected, onSelect, onSubmit, onSkip,
  submitting, submitLabel = 'Submit', skipLabel = 'Skip',
}: ChoiceCardProps) {
  const canSubmit = selected !== null && !submitting
  return (
    <div style={{ margin: 12, background: color.raised, borderRadius: 14, padding: 18 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: color.text }}>{title}</p>
      {description && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: color.dim, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {description}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '18px 0' }}>
        {options.map((opt, i) => {
          const sel = selected === i
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, background: 'none',
                border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 32, height: 32, borderRadius: 16, flexShrink: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600,
                  background: sel ? color.text : 'transparent',
                  border: sel ? 'none' : `1px solid ${color.border}`,
                  color: sel ? color.canvas : color.dim,
                }}
              >
                {opt.icon ?? i + 1}
              </span>
              <span style={{ fontSize: 14, color: sel ? color.text : '#D4D4D4', lineHeight: 1.4 }}>
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 18 }}>
        {onSkip && (
          <button
            onClick={onSkip}
            style={{ background: 'none', border: 'none', color: color.dim, fontSize: 13, cursor: 'pointer', padding: 0 }}
          >
            {skipLabel}
          </button>
        )}
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{
            background: color.text, color: color.canvas, border: 'none', borderRadius: 20, fontSize: 13,
            fontWeight: 600, padding: '9px 22px', cursor: canSubmit ? 'pointer' : 'default',
            opacity: canSubmit ? 1 : 0.5,
          }}
        >
          {submitting ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
