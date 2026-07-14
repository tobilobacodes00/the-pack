import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Download } from 'lucide-react'
import type { ArtifactMeta } from '@/api/hunts'
import { IconButton } from './icon-button'

const FORMAT_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word (.docx)',
  md: 'Markdown',
  html: 'HTML',
  xlsx: 'Excel (.xlsx)',
  pptx: 'PowerPoint',
  png: 'Image (.png)',
}
const ORDER = ['pdf', 'docx', 'md', 'html', 'xlsx', 'pptx', 'png']

interface Props {
  artifacts: ArtifactMeta[] | undefined
  onDownload: (art: ArtifactMeta) => void
}

export function DownloadMenu({ artifacts, onDownload }: Props) {
  const items = [...(artifacts ?? [])].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  )
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Download" disabled={!items.length}>
          <Download size={17} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[70] min-w-[184px] rounded-xl border border-border bg-white p-1.5 shadow-soft"
        >
          {items.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-muted">No files yet</div>
          ) : (
            items.map((a) => (
              <DropdownMenu.Item
                key={a.artifact_id}
                onSelect={() => onDownload(a)}
                className="flex cursor-pointer items-center justify-between gap-6 rounded-lg px-2.5 py-2 text-[13px] text-ink-700 outline-none data-[highlighted]:bg-cream-100 data-[highlighted]:text-text"
              >
                {FORMAT_LABEL[a.kind] ?? a.kind.toUpperCase()}
                <span className="text-[11px] uppercase text-text-faint">.{a.kind}</span>
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
