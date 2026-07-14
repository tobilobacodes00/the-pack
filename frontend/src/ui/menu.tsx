import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Radix dropdown wrapper — the one menu the app uses (replaces the hand-rolled absolute-positioned
 *  menus with focus management, outside-click, and Esc handled for free). */
export const Menu = Dropdown.Root
export const MenuTrigger = Dropdown.Trigger

export function MenuContent({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  className?: string
}) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-[168px] rounded-xl border border-border bg-surface-raised p-1 shadow-soft',
          className,
        )}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  )
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
}: {
  icon?: ReactNode
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
}) {
  return (
    <Dropdown.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none',
        'data-[highlighted]:bg-[rgba(26,26,26,0.06)] data-[highlighted]:text-text',
        danger ? 'text-danger' : 'text-text-dim',
      )}
    >
      {icon && <span className="text-muted">{icon}</span>}
      {children}
    </Dropdown.Item>
  )
}
