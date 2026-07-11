import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** The floating surface used across the app (roster, chat, cards): 16px radius, 1px border, warm fill. */
export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface',
        className,
      )}
      {...props}
    />
  ),
)
Panel.displayName = 'Panel'

export function PanelHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-4', className)}
      {...props}
    >
      {children}
    </div>
  )
}
