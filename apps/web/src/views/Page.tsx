/** 全页视图的公共骨架（原型 .panel-inner / .card / .pd-session） */
import type { ReactNode } from 'react'
import { type DotState, StatusDot } from '../components/StatusDot.tsx'
import { cn } from '../lib/cn.ts'

export function Page({
  title,
  sub,
  icon,
  children,
  narrow,
  view,
}: {
  title: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  children: ReactNode
  narrow?: boolean
  view: string
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-view={view}>
      <div className={cn('mx-auto', narrow ? 'max-w-[760px] px-6 py-8' : 'max-w-[860px] px-8 py-7')}>
        <h1 className="mb-1 flex items-center gap-2.5 text-xl font-bold tracking-[-0.02em]">
          {icon}
          {title}
        </h1>
        {sub !== undefined && <div className="mb-6 text-[13px] text-mut">{sub}</div>}
        {children}
      </div>
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3.5 rounded-lg border border-border2 bg-panel px-[22px] py-[18px]', className)}>
      {children}
    </div>
  )
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="mb-4 rounded-md border border-border bg-panel px-3.5 py-2 text-[12.5px] text-mut">{children}</p>
}

export function ListRow({
  href,
  state,
  title,
  meta,
  badge,
  aside,
  muted,
}: {
  href?: string
  state: DotState
  title: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  aside?: ReactNode
  muted?: boolean
}) {
  const body = (
    <>
      <StatusDot state={state} className="size-2" />
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-1.5 text-[13.5px] font-medium', muted && 'text-mut line-through')}>
          <span className="truncate">{title}</span>
          {badge}
        </span>
        {meta !== undefined && <span className="block truncate text-[11.5px] text-mut">{meta}</span>}
      </span>
    </>
  )
  const cls = 'flex items-center gap-2.5 rounded-md px-3.5 py-2.5 transition-colors duration-150 hover:bg-panel-h'
  return (
    <div className="flex items-center gap-2">
      {href === undefined ? (
        <div className={cn(cls, 'min-w-0 flex-1')}>{body}</div>
      ) : (
        <a href={href} className={cn(cls, 'min-w-0 flex-1')}>
          {body}
        </a>
      )}
      {aside}
    </div>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block shrink-0 rounded px-[5px] text-[9.5px] font-semibold text-warn [background:var(--warn-d)]">
      {children}
    </span>
  )
}

export function FilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      className="field-input mb-4"
      placeholder={placeholder}
      value={value}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
