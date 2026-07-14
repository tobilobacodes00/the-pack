import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './icon-button'

interface Props {
  prompt: string
  actions?: ReactNode
  onClose: () => void
}

export function RewardHeader({ prompt, actions, onClose }: Props) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{prompt}</span>
      <div className="flex items-center gap-1">
        {actions}
        <IconButton label="Close" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
    </div>
  )
}
