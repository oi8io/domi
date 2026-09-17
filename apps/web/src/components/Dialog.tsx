/**
 * 简单的模态框（原型没有画，按原型的卡片样式做）。Esc / 点遮罩关闭；打开时焦点进第一个输入框。
 * 不引 radix Dialog：只有这一处用，焦点圈定用原生 <dialog>。
 */
import { type ReactNode, useEffect, useRef } from 'react'

export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-lg border border-border bg-bg2 p-0 text-ink shadow-pop backdrop:bg-black/50"
    >
      <div className="border-b border-border px-5 py-3 text-sm font-semibold">{title}</div>
      <div className="px-5 py-4">{open && children}</div>
    </dialog>
  )
}

export function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 控件由 children 提供
    <label className="mb-3.5 block">
      <span className="mb-[3px] block text-[13px] font-medium">{label}</span>
      {hint !== undefined && <span className="mb-[5px] block text-[11.5px] text-mut">{hint}</span>}
      {children}
    </label>
  )
}
