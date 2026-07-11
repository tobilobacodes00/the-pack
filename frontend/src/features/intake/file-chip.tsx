import { X } from 'lucide-react'
import type { AttachedFile } from './use-intake'

interface Props {
  file: AttachedFile
  onRemove: (localId: string) => void
}

function cardColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '#2563EB'
  if (['mp3', 'wav', 'mp4', 'mov', 'ogg'].includes(ext)) return '#7C3AED'
  return '#DC2626'
}

export function FileCard({ file, onRemove }: Props) {
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div className="relative">
        <div
          className="w-[72px] h-[72px] rounded-xl flex items-center justify-center"
          style={{ backgroundColor: cardColor(file.name) }}
        >
          <img src="/icon-file.svg" style={{ width: 14, height: 18 }} alt="" />
        </div>
        <button
          onClick={() => onRemove(file.localId)}
          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: '#3a3a3a' }}
          aria-label={`Remove ${file.name}`}
        >
          <X size={9} className="text-white" />
        </button>
      </div>
      <span
        className="text-xs text-center truncate"
        style={{ color: '#888', width: 72, display: 'block' }}
      >
        {file.name}
      </span>
    </div>
  )
}
