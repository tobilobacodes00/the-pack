import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Bookmark, BarChart3, ListTree, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './icon-button'

interface Props {
  onSaveInstinct: () => void
  onScorecard: () => void
  onTracks: () => void
  onRefine: () => void
}

function Item({
  icon,
  label,
  onSelect,
}: {
  icon: ReactNode
  label: string
  onSelect: () => void
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-700 outline-none data-[highlighted]:bg-cream-100 data-[highlighted]:text-text"
    >
      <span className="text-muted">{icon}</span>
      {label}
    </DropdownMenu.Item>
  )
}

export function MoreMenu({ onSaveInstinct, onScorecard, onTracks, onRefine }: Props) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="More">
          <MoreHorizontal size={18} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[70] min-w-[184px] rounded-xl border border-border bg-white p-1.5 shadow-soft"
        >
          <Item icon={<Bookmark size={15} />} label="Save as Instinct" onSelect={onSaveInstinct} />
          <Item icon={<BarChart3 size={15} />} label="Scorecard" onSelect={onScorecard} />
          <Item icon={<ListTree size={15} />} label="Tracks" onSelect={onTracks} />
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <Item icon={<Sparkles size={15} />} label="Refine" onSelect={onRefine} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
