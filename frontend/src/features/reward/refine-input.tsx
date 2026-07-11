import { useState } from 'react'

interface Props {
  pending: boolean
  onSubmit: (instruction: string) => void
  onCancel: () => void
}

// Re-draft the brief from the same sources — no re-scout.
export function RefineInput({ pending, onSubmit, onCancel }: Props) {
  const [text, setText] = useState('')
  return (
    <div className="absolute left-1/2 top-4 z-[55] w-[min(560px,90%)] -translate-x-1/2 rounded-xl border border-[#2E2E2E] bg-[#1C1C1C] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
      <p className="text-[13px] font-semibold text-text">Refine the brief</p>
      <p className="mt-1 text-[12px] text-muted">
        Re-draft from the same sources — tell Howler how to re-angle or tighten it.
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Lead with the CBN figure and cut the repetition"
        rows={2}
        disabled={pending}
        className="mt-3 w-full resize-none rounded-lg border border-[#333] bg-[#141414] px-3 py-2 text-[13px] text-[#EDEDED] placeholder:text-[#5F5F5F] focus:border-[#8B5CF6]/60 focus:outline-none"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={pending}
          className="rounded-full px-4 py-1.5 text-[13px] text-text-dim transition-colors hover:text-text disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(text)}
          disabled={pending}
          className="rounded-full bg-[#FAFAFA] px-4 py-1.5 text-[13px] font-semibold text-[#0F0F0F] transition-opacity disabled:opacity-50"
        >
          {pending ? 'Refining…' : 'Refine'}
        </button>
      </div>
    </div>
  )
}
