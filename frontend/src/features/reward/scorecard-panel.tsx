import { Star } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Scorecard } from '@/api/hunts'
import { accuracyPct, deriveVerdict, hms, usd } from './lib/scorecard-copy'

interface Props {
  scorecard: Scorecard | null | undefined
  loading: boolean
  onCancel: () => void
  onExport: () => void
}

function Row({ lone, label, pack }: { lone: ReactNode; label: string; pack: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-3">
      <div className="text-right text-[15px] text-[#C7C7C7] tabular-nums">{lone}</div>
      <div className="w-[112px] text-center text-[12px] text-muted">{label}</div>
      <div className="text-left text-[15px] font-medium text-text tabular-nums">{pack}</div>
    </div>
  )
}

export function ScorecardPanel({ scorecard, loading, onCancel, onExport }: Props) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading the Scorecard…
      </div>
    )
  }

  if (!scorecard) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-8 text-center">
          <div>
            <p className="text-[15px] font-semibold text-[#EDEDED]">No benchmark yet</p>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
              Run “Lone Wolf vs the Pack” from the hunt to see how the pack compares.
            </p>
          </div>
        </div>
        <footer className="flex shrink-0 justify-end border-t border-[#242424] px-6 py-4">
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[13px] text-text-dim transition-colors hover:text-text"
          >
            Back to the brief
          </button>
        </footer>
      </div>
    )
  }

  const { lone_wolf: lone, pack } = scorecard

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-8 py-10">
        <div className="mx-auto max-w-[560px]">
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F59E0B]/15">
              <Star size={26} className="fill-[#F59E0B] text-[#F59E0B]" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <p className="text-right text-[15px] font-semibold text-[#D8D8D8]">Lone Wolf</p>
            <p className="text-[12px] uppercase tracking-wide text-text-faint">Vs</p>
            <p className="text-left text-[15px] font-semibold text-text">The Pack</p>
          </div>

          <div className="mt-6 flex flex-col divide-y divide-[#242424] border-y border-[#242424]">
            <Row lone={lone.sources} label="Sources found" pack={pack.sources} />
            <Row lone={`${accuracyPct(lone)}%`} label="Accuracy" pack={`${accuracyPct(pack)}%`} />
            <Row lone={hms(lone.time_s)} label="Time" pack={hms(pack.time_s)} />
            <Row lone={usd(lone.cost_usd)} label="Cost" pack={usd(pack.cost_usd)} />
          </div>

          <p className="mt-6 text-center text-[13.5px] leading-relaxed text-text-dim">
            {deriveVerdict(scorecard)}
          </p>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#242424] px-6 py-4">
        <button
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-[13px] text-text-dim transition-colors hover:text-text"
        >
          Cancel
        </button>
        <button
          onClick={onExport}
          className="rounded-full bg-[#FAFAFA] px-5 py-2 text-[13px] font-semibold text-[#0F0F0F]"
        >
          Export
        </button>
      </footer>
    </div>
  )
}
