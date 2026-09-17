/**
 * 按钮（shadcn/ui 的写法：cva 变体 + cn 合并）。变体对应原型里的几种按钮：
 * primary = .ta-primary / .btn-allow / .ctb-send（底色用 accent-emphasis，白字对比度 ≥ 4.5:1）；
 * outline = .ta-secondary / .btn-deny；ghost = .ctb-btn；icon = .pa-btn；danger = 删除类。
 */
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-150 ease-ui disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent-e text-white font-medium hover:opacity-90',
        outline: 'border border-border text-ink2 hover:bg-panel-h',
        ghost: 'text-mut hover:bg-panel-h hover:text-ink2',
        danger: 'border border-border text-bad hover:bg-bad-d',
        armed: 'border border-bad bg-bad text-white font-medium',
        icon: 'text-mut hover:bg-border hover:text-ink',
      },
      size: {
        sm: 'rounded-sm px-3.5 py-[5px] text-[12.5px]',
        md: 'rounded-md px-3 py-2 text-[13px]',
        xs: 'rounded-sm px-[9px] py-1 text-xs',
        icon: 'size-6 rounded-sm text-sm',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
