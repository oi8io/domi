import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn/ui 的类名合并：后面的 Tailwind 类覆盖前面冲突的 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
