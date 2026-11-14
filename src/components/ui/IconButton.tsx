import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'
import '@/styles/icon-button.css'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { icon: LucideIcon; label: string; tooltip?: string }

export function IconButton({ icon: Icon, label, tooltip = label, className = '', onKeyDown, onBlur, onPointerEnter, onFocus, ...props }: IconButtonProps) {
  return <Button {...props} type={props.type || 'button'} variant="ghost" className={`studio-icon-action ${className}`} aria-label={label}
    onKeyDown={event => { if (event.key === 'Escape') event.currentTarget.dataset.tooltipDismissed = 'true'; onKeyDown?.(event) }}
    onBlur={event => { delete event.currentTarget.dataset.tooltipDismissed; onBlur?.(event) }}
    onFocus={event => { delete event.currentTarget.dataset.tooltipDismissed; onFocus?.(event) }}
    onPointerEnter={event => { delete event.currentTarget.dataset.tooltipDismissed; onPointerEnter?.(event) }}>
    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
    <span className="studio-action-tooltip" aria-hidden="true">{tooltip}</span>
  </Button>
}
