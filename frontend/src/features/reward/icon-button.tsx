import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ label, className, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-dim',
        'transition-colors hover:bg-cream-100 hover:text-text',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = 'IconButton'
