export type Preset = {
  id: string
  title: string
  desc: string
  prompt: string
}

export const PRESETS: Preset[] = [
  {
    id: 'newsroom',
    title: 'The Newsroom',
    desc: 'Verify claims and write articles',
    prompt: 'Verify this claim: ',
  },
  {
    id: 'meeting',
    title: 'The Meeting Room',
    desc: 'Summarize recordings and decisions',
    prompt: 'Summarise this meeting: ',
  },
  {
    id: 'pipeline',
    title: 'The Pipeline',
    desc: 'Research leads and draft outreach',
    prompt: 'Research and build a brief on: ',
  },
]

interface Props {
  preset: Preset
  onClick: () => void
}

export function PresetCard({ preset, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-2xl px-4 py-3.5 cursor-pointer bg-white border-[2.5px] border-ink-900
                 shadow-chunk-sm transition-all hover:-translate-y-0.5 hover:shadow-chunk"
    >
      <p className="text-sm font-bold font-display text-ink-900">{preset.title}</p>
      <p className="text-xs mt-1 leading-snug text-ink-500">{preset.desc}</p>
    </button>
  )
}
