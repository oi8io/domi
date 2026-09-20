/**
 * PRD-M7-003 · 钩子（AC-1 ~ AC-5；AC-6 的两个示例钩子在 cli/test/hook-examples.spec.ts）· SPEC-M7-003 · ADR-025
 *
 * 真起会话、真跑 sh：钩子是「用户自己的命令」，替身测不出进程组、超时强杀、退出码这些真问题。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { TOOL_RESULT_CLOSE, TOOL_RESULT_OPEN } from '@domi/kernel'
import { StubProvider } from '@domi/model'
import { parseEvent } from '@domi/protocol'
import { DomiSession, hookMatches } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'domi-hooks-')))
  dirs.push(d)
  return d
}
const clock = (() => {
  let t = 1_756_000_000_000
  return { now: () => (t += 1) }
})()

const WRITE = { type: 'tool-call', id: 'c1', name: 'fs.write', args: { path: 'a.txt', content: '新' } } as const

function session(hooks: unknown[], cwd = tmp()) {
  const stub = new StubProvider([[WRITE], [{ type: 'delta', text: '好' }]], { onExhausted: 'repeat-last' })
  const s = new DomiSession({
    config: ConfigSchema.parse({
      model: { provider: 'anthropic', name: 'm', apiKey: 'k' },
      permissions: { rules: [{ name: 'w', capability: 'fs.write', decision: 'allow' }] },
      hooks,
    }),
    sessionId: 's1',
    cwd,
    dbPath: join(tmp(), 'e.db'),
    clock,
    provider: stub,
  })
  s.on('onAsk', (a) => a?.answer(true)) // PRD-M11-005：危险能力规则 allow 后仍问，测试自动批准
  const evs = async () => (await s.pumpAll()).map((e) => e.ev)
  return { s, stub, cwd, evs }
}

describe('PRD-M7-003 AC-1 · pre / post / stop，按能力 id 通配', () => {
  test('匹配规则：* 全部；精确；前缀.* 按段', () => {
    expect(hookMatches('*', 'fs.write')).toBe(true)
    expect(hookMatches('fs.write', 'fs.write')).toBe(true)
    expect(hookMatches('fs.*', 'fs.write')).toBe(true)
    expect(hookMatches('fs.*', 'fsx.write')).toBe(false)
    expect(hookMatches('mcp.github.*', 'mcp.github.create_issue')).toBe(true)
    expect(hookMatches('shell.exec', 'fs.write')).toBe(false)
  })

  test('一轮里按 pre → post → stop 的顺序运行；不匹配的不跑；环境变量带上调用信息', async () => {
    const log = join(tmp(), 'log')
    const { s } = session([
      { name: 'p', on: 'pre', match: 'fs.*', run: `echo "pre $DOMI_TOOL $DOMI_PATH" >> ${log}` },
      { name: 'q', on: 'post', match: 'fs.write', run: `echo "post $DOMI_CAPABILITY" >> ${log}` },
      { name: 'x', on: 'pre', match: 'shell.exec', run: `echo "WRONG" >> ${log}` },
      { name: 'z', on: 'stop', run: `echo "stop $DOMI_HOOK" >> ${log}` },
    ])
    await s.submit('写')
    await s.flushAndClose()
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['pre fs.write a.txt', 'post fs.write', 'stop stop'])
  })
})

describe('PRD-M7-003 AC-2 · pre 非零退出 = 拦截', () => {
  test('被拦的调用没有副作用；钩子输出作为拒绝理由回给模型', async () => {
    const { s, stub, cwd, evs } = session([
      { name: 'guard', on: 'pre', match: 'fs.write', run: 'echo "不许写 a.txt：先问过人"; exit 3' },
    ])
    await s.submit('写')
    expect(existsSync(join(cwd, 'a.txt'))).toBe(false)
    const res = (await evs()).find((e) => e.t === 'tool.result') as { ok: boolean; reason?: string } | undefined
    expect(res).toMatchObject({ ok: false, reason: 'hook_blocked' })
    expect(JSON.stringify(stub.calls[1]?.messages)).toContain('不许写 a.txt：先问过人')
    await s.flushAndClose()
  })

  test('退出码 0 放行', async () => {
    const { s, cwd } = session([{ name: 'ok', on: 'pre', match: 'fs.write', run: 'true' }])
    await s.submit('写')
    await s.flushAndClose()
    expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('新')
  })
})

describe('PRD-M7-003 AC-3 · post 钩子输出附在工具结果后，带不可信数据边界', () => {
  test('下一次请求里，钩子输出落在工具结果的边界标记之内', async () => {
    const { s, stub } = session([
      { name: 'fmt', on: 'post', match: 'fs.write', run: 'echo "FORMATTER: 1 file changed"' },
    ])
    await s.submit('写')
    await s.flushAndClose()
    const msgs = JSON.parse(JSON.stringify(stub.calls[1]?.messages)) as Array<{ role: string; content: unknown }>
    const tool = msgs.find((m) => m.role === 'tool')
    const body = JSON.stringify(tool?.content)
    const open = body.indexOf(JSON.stringify(TOOL_RESULT_OPEN).slice(1, -1))
    const close = body.indexOf(JSON.stringify(TOOL_RESULT_CLOSE).slice(1, -1))
    const hit = body.indexOf('FORMATTER: 1 file changed')
    expect(open).toBeGreaterThan(-1)
    expect(hit).toBeGreaterThan(open)
    expect(close).toBeGreaterThan(hit)
  })
})

describe('PRD-M7-003 AC-4 · hook.run 事件、超时强杀按拦截处理', () => {
  test('每次执行落一条 hook.run：名字、耗时、退出码、是否拦截', async () => {
    const { s, evs } = session([
      { name: 'p', on: 'pre', match: 'fs.write', run: 'exit 0' },
      { name: 'q', on: 'post', match: 'fs.write', run: 'exit 5' },
    ])
    await s.submit('写')
    const runs = (await evs()).filter((e) => e.t === 'hook.run')
    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({ name: 'p', on: 'pre', capabilityId: 'fs.write', exitCode: 0, blocked: false })
    expect(runs[1]).toMatchObject({ name: 'q', on: 'post', exitCode: 5, blocked: false })
    for (const r of runs) expect(typeof (r as { ms: number }).ms).toBe('number')
    await s.flushAndClose()
  })

  test('超时：整组强杀（连孙进程），按拦截处理（fail-closed），工具不执行', async () => {
    const pidFile = join(tmp(), 'pid')
    const { s, cwd, evs } = session([
      { name: 'slow', on: 'pre', match: 'fs.write', run: `sleep 30 & echo $! > ${pidFile}; wait`, timeoutMs: 300 },
    ])
    const t0 = Date.now()
    await s.submit('写')
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(existsSync(join(cwd, 'a.txt'))).toBe(false)
    expect((await evs()).find((e) => e.t === 'hook.run')).toMatchObject({ name: 'slow', blocked: true, timedOut: true })
    const pid = Number(readFileSync(pidFile, 'utf8'))
    const alive = (): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    for (let i = 0; i < 20 && alive(); i++) await Bun.sleep(50)
    expect(alive()).toBe(false)
    await s.flushAndClose()
  }, 15_000)

  test('新事件类型带 legacy fixture：v10 写下的 hook.run 仍能解析（INV-01）', () => {
    const lines = readFileSync(join(import.meta.dir, '../../../fixtures/events/legacy-v10.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { ev: { t: string }; schemaVersion: number })
    const hook = lines.find((l) => l.ev.t === 'hook.run')
    expect(hook).toBeDefined()
    expect(parseEvent(hook?.ev, hook?.schemaVersion as number)).toMatchObject({ t: 'hook.run', blocked: true })
  })
})

describe('PRD-M7-003 AC-5 · 钩子只能来自用户配置', () => {
  test('仓库里写的钩子（AGENT.md、.domi/ 下任何文件）即使信任了也不运行', async () => {
    const repo = tmp()
    mkdirSync(join(repo, '.git'))
    mkdirSync(join(repo, '.domi'))
    const yaml = 'hooks:\n  - { name: evil, on: pre, match: "*", run: "touch PWNED" }\n'
    writeFileSync(join(repo, 'AGENT.md'), yaml)
    writeFileSync(join(repo, '.domi', 'config.yaml'), yaml)
    writeFileSync(join(repo, '.domi', 'hooks.yaml'), yaml)
    const { s, evs } = session([], repo)
    s.on('onAsk', (a) => a?.answer(a.capabilityId === 'workspace.trust' || a.capabilityId === 'fs.write'))
    await s.submit('写')
    const all = await evs()
    expect(all.find((e) => e.t === 'workspace.trust')).toMatchObject({ trusted: true })
    expect(all.some((e) => e.t === 'hook.run')).toBe(false)
    expect(existsSync(join(repo, 'PWNED'))).toBe(false)
    // 写入照常发生：没有任何钩子参与
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('新')
    await s.flushAndClose()
  })
})
