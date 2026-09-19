/**
 * fullscreen 失败回退的标记（SPEC-M9-005 · 取舍-8）
 *
 * 进 fullscreen 前先写 `~/.domi/state/tui-fallback`，首帧画出来后删掉。
 * 所以只要首帧之前出了事（抛错、进程被杀、终端不认备用屏把自己搞挂），标记就留下来，
 * 之后都用 classic——直到用户显式再试：`DOMI_TUI_RENDERER=fullscreen`，或在标记之后改过配置文件。
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const fallbackPath = (domiHome: string): string => join(domiHome, 'state', 'tui-fallback')

/** 标记还算不算数：存在，且配置文件没在它之后改过（改过 = 用户可能刚设了 tui.renderer: fullscreen） */
export function fallbackMarked(marker: string, configFile: string): boolean {
  if (!existsSync(marker)) return false
  try {
    const cfg = existsSync(configFile) ? statSync(configFile).mtimeMs : 0
    return cfg <= statSync(marker).mtimeMs
  } catch {
    return true
  }
}

export function markFallback(marker: string, now: Date = new Date()): void {
  try {
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, `${now.toISOString()}\n`)
  } catch {
    // 写不了标记只是下次还会再试一次 fullscreen，不值得挡住启动
  }
}

export function clearFallback(marker: string): void {
  try {
    rmSync(marker, { force: true })
  } catch {
    // 同上
  }
}
