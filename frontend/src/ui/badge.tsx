import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-surface-raised text-text-dim',
  accent: 'border border-accent/40 text-[#B79BF5]',
  warn: 'text-warn',
  success: 'text-success',
  danger: 'text-danger',
} as const

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof tones
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
