/**
 * domi report-bug —— PRD-M1-009 AC-4
 *
 * **打包前必须展示清单并要求确认。**
 * 日志里可能有路径、命令、项目名——用户有权在按下回车之前看清楚要发出去什么。
 * 「已经脱敏了」不是跳过这一步的理由：脱敏挡的是凭据，挡不了「这个项目叫什么」。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ReportEntry {
  path: string
  bytes: number
}

export interface ReportManifest {
  entries: ReportEntry[]
  totalBytes: number
  version: string
  platform: string
}

export function buildManifest(logDir: string, version: string): ReportManifest {
  const entries: ReportEntry[] = []
  if (existsSync(logDir)) {
    for (const name of readdirSync(logDir)) {
      const p = join(logDir, name)
      try {
        const st = statSync(p)
        if (st.isFile()) entries.push({ path: p, bytes: st.size })
      } catch {
        /* 扫描途中文件没了 */
      }
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return {
    entries,
    totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
    version,
    platform: `${process.platform}-${process.arch}`,
  }
}

export function formatManifest(m: ReportManifest): string {
  const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`
  return [
    '将要打包以下内容：',
    ...m.entries.map((e) => `  ${e.path}  (${kb(e.bytes)})`),
    `  域: 版本 ${m.version} · 平台 ${m.platform}`,
    '',
    `共 ${m.entries.length} 个文件，${kb(m.totalBytes)}。`,
    '日志已做凭据脱敏，但仍可能包含文件路径与命令内容——确认后再发出去。',
  ].join('\n')
}
