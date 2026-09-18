/**
 * OPT-M8-001 · 缺模型凭据的事在提交时说，而不是启动时
 *
 * domid 允许无 key 启动（这样第一把 key 能在设置页里填）；代价是「缺 key」得在每条提交路径上拦住。
 * daemon 的 session.submit 在接受之前拦（domid.spec）；编排任务、定时任务直接调 Session.submit，这里证它们也被拦住，
 * 而且拦在写任何事件之前——不然事件流里会留下一轮没头没尾的 turn。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema, MissingCredentialError } from '@domi/config'
import { DomiSession } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-cred-'))
  dirs.push(d)
  return d
}

function session(model: Record<string, unknown>, providers: Record<string, unknown> = {}) {
  const config = ConfigSchema.parse({ model: { provider: 'anthropic', name: 'model-a', ...model }, providers })
  return { s: new DomiSession({ config, sessionId: 's1', cwd: tmp(), dbPath: join(tmp(), 'e.db') }), config }
}

describe('OPT-M8-001 · 提交时查凭据', () => {
  test('没有 key：submit 抛 MissingCredentialError，指明哪一家、该设哪个变量，事件流一条不写', async () => {
    const { s } = session({})
    const err = await s.submit('你好').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(MissingCredentialError)
    expect((err as MissingCredentialError).provider).toBe('anthropic')
    expect((err as MissingCredentialError).envNames).toContain('ANTHROPIC_API_KEY')
    expect(await s.pumpAll()).toEqual([])
    await s.flushAndClose()
  })

  test('设置页填上 key（reconfigure）之后，同一个会话不再被拦', async () => {
    const { s, config } = session({})
    expect(() => s.checkCredential()).toThrow(MissingCredentialError)
    s.reconfigure({ ...config, model: { ...config.model, apiKey: 'k' } })
    expect(() => s.checkCredential()).not.toThrow()
    await s.flushAndClose()
  })

  test('切到别家：查的是那一家的 key；那一家没配就沿用默认的（与建 provider 的规则一致）', async () => {
    const own = session({}, { openai: { apiKey: 'k-openai' } }).s
    await own.switchModel('gpt-x', { provider: 'openai' })
    expect(() => own.checkCredential()).not.toThrow()
    await own.flushAndClose()

    const inherit = session({ apiKey: 'k' }).s
    await inherit.switchModel('gpt-x', { provider: 'openai' })
    expect(() => inherit.checkCredential()).not.toThrow()
    await inherit.flushAndClose()

    const none = session({}).s
    await none.switchModel('gpt-x', { provider: 'openai' })
    expect(() => none.checkCredential()).toThrow(/OPENAI_API_KEY/)
    await none.flushAndClose()
  })
})
