import { useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { color } from '@/lib/theme'

// One-time flag: once the Packmaster has seen (saved or dismissed) the first-completion instinct
// nudge, never show it again. Kept in localStorage so it's per-browser and survives refresh.
const SEEN_KEY = 'pack:seen-first-instinct-prompt'

export function hasSeenFirstInstinctPrompt(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked (private mode) → don't nag
  }
}

export function markFirstInstinctPromptSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Suggested name for the instinct — the brief title. */
  defaultName: string
  saving: boolean
  onSave: (name: string) => void
  onDismiss: () => void
}

/**
 * A gentle, one-time nudge shown the FIRST time a reward completes: save this hunt as an Instinct so
 * it can be re-run in one click later. "Save as Instinct" already exists buried in the ⋮ menu — most
 * people never find it, so this surfaces it exactly when its value is obvious (a brief just landed).
 * Dismissible; shows once ever (localStorage-gated by the caller).
 */
export function FirstInstinctPrompt({ defaultName, saving, onSave, onDismiss }: Props) {
  const [name, setName] = useState(defaultName)
  return (
    <div
      className="mb-5 rounded-xl p-4"
      style={{ background: 'rgba(239,68,68,0.06)', border: `1px solid ${color.border}` }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(239,68,68,0.14)', color: '#F87171' }}
        >
          <Bookmark size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-text">Save this as an Instinct?</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            Turn this hunt into a one-click preset — same team and approach, ready to re-run on a new
            topic anytime from your Instincts.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Name this instinct"
              disabled={saving}
              className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
            />
            <button
              onClick={() => onSave(name.trim() || defaultName)}
              disabled={saving}
              className="shrink-0 rounded-full bg-brand-500 px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Instinct'}
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-muted transition-colors hover:text-text"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
