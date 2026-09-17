/** 设置页的表单小件（原型 .fg / .fl / .fh / .toggle） */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string
  hint?: string | undefined
  children: ReactNode
  id?: string | undefined
}) {
  return (
    <div className="mb-[18px]">
      <label className="mb-[3px] block text-[13px] font-medium" htmlFor={id}>
        {label}
      </label>
      {hint !== undefined && <div className="mb-[5px] text-[11.5px] text-mut">{hint}</div>}
      {children}
    </div>
  )
}

export function ToggleRow({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  on: boolean
  disabled?: boolean
  onChange?: (on: boolean) => void
}) {
  return (
    <div className="mb-[18px] flex items-center justify-between py-1.5">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11.5px] text-mut">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange?.(!on)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-[10px] transition-colors duration-150',
          on ? 'bg-accent-e' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] left-[3px] size-3.5 rounded-full bg-white transition-transform duration-150',
            on && 'translate-x-4',
          )}
        />
      </button>
    </div>
  )
}

export function Saved({ error, saved }: { error: string | null; saved: string | null }) {
  if (error !== null) return <p className="mb-3 text-[13px] text-bad">{error}</p>
  if (saved !== null) return <p className="mb-3 text-[13px] text-ok">{saved}</p>
  return null
}
