/**
 * domi data export / purge —— PRD-M1-010 · INV-11
 *
 * 「本地优先」如果不包含「随时全部拿走或删掉」，那只是「数据在你机器上」而已。
 * 所以导出格式必须是**能自己解析的**（JSONL + YAML），不留私有二进制；
 * purge 必须先把要删什么摆出来。
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ConfigSource, readConfigFile } from '@domi/config'
import type { SqliteEventLog } from '@domi/store'
import { CONFIG_TEMPLATE } from './args.ts'

export interface ExportResult {
  dir: string
  files: string[]
  sessions: number
  events: number
}

export async function exportAll(log: SqliteEventLog, outDir: string, configYaml: string): Promise<ExportResult> {
  mkdirSync(outDir, { recursive: true })
  const sessions = log.sessions.list({ includeDeleted: true, limit: 100_000 })

  const files: string[] = []
  let events = 0

  // 一个会话一个 JSONL —— 单文件几百兆的话谁也没法用别的工具看
  for (const s of sessions) {
    const rows = await log.read(s.id)
    events += rows.length
    const p = join(outDir, `session-${s.id}.jsonl`)
    writeFileSync(p, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
    files.push(p)
  }

  const index = join(outDir, 'sessions.jsonl')
  writeFileSync(index, `${sessions.map((s) => JSON.stringify(s)).join('\n')}\n`, 'utf8')
  files.push(index)

  const cfg = join(outDir, 'config.yaml')
  writeFileSync(cfg, configYaml, 'utf8')
  files.push(cfg)

  return { dir: outDir, files, sessions: sessions.length, events }
}

/**
 * 要导出的配置文本 —— BUG-M3-011：原来导出的是**模板**，不是用户自己的配置。
 * 读用户的配置文件（新旧格式都行），去掉 api_key，统一成 YAML。
 * 注释带不过来：重新序列化只保留结构。还没有配置文件时导出模板。
 */
export function exportableConfig(src: ConfigSource): string {
  if (!src.exists) return CONFIG_TEMPLATE
  return toYamlWithoutSecrets(readConfigFile(src), `# 导出自 ${src.path}（已去掉密钥；原文件的注释没有带过来）`)
}

/** 结构原样转成 YAML，去掉 model.api_key 与 server.token。迁移与导出共用 */
export function toYamlWithoutSecrets(config: Record<string, unknown>, header: string, keepSecrets = false): string {
  const copy = structuredClone(config)
  const model = copy.model as Record<string, unknown> | undefined
  if (!keepSecrets && model && 'api_key' in model) delete model.api_key
  const server = copy.server as Record<string, unknown> | undefined
  if (!keepSecrets && server && 'token' in server) delete server.token
  return `${header}\n${Bun.YAML.stringify(copy, null, 2).replace(/: \n/g, ':\n')}\n`
}

export interface PurgePlan {
  entries: Array<{ path: string; bytes: number }>
  totalBytes: number
  confirmWord: string
}

export const PURGE_CONFIRM_WORD = 'DELETE'

function dirSize(p: string): number {
  let n = 0
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else n += st.size
    }
  }
  if (existsSync(p)) walk(p)
  return n
}

export function planPurge(dataDir: string): PurgePlan {
  const entries: Array<{ path: string; bytes: number }> = []
  if (existsSync(dataDir)) {
    for (const name of readdirSync(dataDir)) {
      const p = join(dataDir, name)
      entries.push({ path: p, bytes: statSync(p).isDirectory() ? dirSize(p) : statSync(p).size })
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return {
    entries,
    totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
    confirmWord: PURGE_CONFIRM_WORD,
  }
}

export function formatPurgePlan(plan: PurgePlan): string {
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`
  return [
    '将要永久删除：',
    ...plan.entries.map((e) => `  ${e.path}  (${mb(e.bytes)})`),
    '',
    `共 ${plan.entries.length} 项，${mb(plan.totalBytes)}。**不可恢复。**`,
    `想清楚了就输入 ${plan.confirmWord} 确认；想留一份先跑 domi data export。`,
  ].join('\n')
}
