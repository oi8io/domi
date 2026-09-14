/**
 * SPEC-M0-009 · 脱敏在写入边界
 * 本文件只覆盖 PRD-M0-008 AC-2 的存储侧一半；配置装载与退出码（AC-1/AC-3）归 TASK-M0-019。
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CREDENTIAL_PATTERNS, REDACTED, redactString, SqliteEventLog, serializeRedacted } from '../src/index.ts'

describe('PRD-M0-008 AC-2 · 凭据不进事件流', () => {
  const secrets = [
    'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz01',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'AKIAIOSFODNN7EXAMPLE',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  ]

  test('5 类凭据模式全部被替换', () => {
    for (const s of secrets) {
      expect(redactString(`token=${s} end`)).toBe(`token=${REDACTED} end`)
    }
    expect(CREDENTIAL_PATTERNS).toHaveLength(5)
  })

  test('脱敏后仍是合法 JSON', () => {
    const json = serializeRedacted({ t: 'user.input', text: `我的 key 是 ${secrets[0]}` })
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json).toContain(REDACTED)
  })

  test('落盘的事件里扫不出凭据（写入边界，不是渲染层）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-redact-'))
    const log = new SqliteEventLog({ path: join(dir, 'e.db') })
    await log.append('s', [
      { t: 'user.input', text: `用这个 key: ${secrets[0]}` },
      { t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: `export TOKEN=${secrets[2]}` } },
    ])
    const dump = JSON.stringify(await log.read('s'))
    for (const s of secrets) expect(dump).not.toContain(s)
    expect(dump).toContain(REDACTED)
    log.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('无法序列化的事件整批失败，而不是爆栈', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => serializeRedacted(circular)).toThrow(TypeError)
  })
})
