import { Check, ChevronDown, Globe2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

const regions = ['Global', 'United States', 'India', 'China', 'Europe', 'Japan', 'United Kingdom']
export function RegionPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    if (!open) return
    options.current[Math.max(0, regions.indexOf(value))]?.focus()
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, value])
  return <div className="region-control" ref={container}>
    <button ref={trigger} className="region-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`Region: ${value}`} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}><Globe2 size={16} /><span>{value}</span><ChevronDown size={14} className={open ? 'is-open' : ''} /></button>
    {open && <div className="region-options" id={listId} role="listbox" aria-label="News region">{regions.map((region, index) => <button type="button" key={region} ref={node => { options.current[index] = node }} role="option" aria-selected={region === value} tabIndex={0} onClick={() => { setOpen(false); onChange(region); trigger.current?.focus() }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); options.current[(index + (event.key === 'ArrowDown' ? 1 : -1) + regions.length) % regions.length]?.focus() }
      if (event.key === 'Home') { event.preventDefault(); options.current[0]?.focus() }
      if (event.key === 'End') { event.preventDefault(); options.current.at(-1)?.focus() }
      if (event.key === 'Tab') setOpen(false)
    }}><span>{region}</span>{region === value && <Check size={14} />}</button>)}</div>}
  </div>
}
