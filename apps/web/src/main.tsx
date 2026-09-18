/**
 * Web 端入口 —— 先定界面语言（PRD-M9-004），再加载界面（start.tsx）。
 * 顺序不能反：界面模块加载时就会求值一部分文案，语言得在那之前定下来
 */
import { bootLocale } from './locale.ts'

bootLocale()
void import('./start.tsx')
