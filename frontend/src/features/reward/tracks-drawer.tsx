import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { RawTrackEvent } from '@/api/hunts'
import { deriveNarrative, deriveTrackStats } from './lib/narrative'
import { TracksTimeline } from './tracks-timeline'

const EASE = [0.4, 0, 0.2, 1] as const

interface Props {
  open: boolean
  onClose: () => void
  events: RawTrackEvent[] | undefined
  loading: boolean
  totals: Record<string, unknown> | null
}

export function TracksDrawer({ open, onClose, events, loading, totals }: Props) {
  const items = deriveNarrative(events ?? [])
  const stats = deriveTrackStats(events ?? [], totals)

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: 340, opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 340, opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-cream-50"
        >
          <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4">
            <p className="text-[14px] font-semibold text-text">Tracks</p>
            <button
              onClick={onClose}
              aria-label="Close Tracks"
              className="text-muted transition-colors hover:text-text"
            >
              <X size={16} />
            </button>
          </div>
          <div className="shrink-0 border-b border-border px-4 py-3 text-[12px] text-ink-500">
            {stats.costLabel} · {stats.timeLabel}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-[13px] text-muted">Loading the trail…</p>
            ) : (
              <TracksTimeline items={items} />
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
