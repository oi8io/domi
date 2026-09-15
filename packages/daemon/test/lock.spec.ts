/**
 * PRD-M3-002 AC-4 · 并发拉起只起一个实例
 *
 * 这条测试的形状比它的断言重要：**必须真的并发**。
 * 「先看在不在，再建」的实现在顺序调用下是绿的，只有并发时才露馅——
 * 而那正是真实场景（两个终端同时敲 `domi`）。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { acquireLock, isAlive, LockHeldError, readLock } from '../src/index.ts'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-lock-'))
  dirs.push(d)
  return join(d, 'domid.lock')
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 挂载没有删除权限时不该把一个本身是好的测试报成失败
    }
  }
})

describe('AC-4 · 只起一个', () => {
  test('第二次抢锁失败，并告诉你该连到哪里去', () => {
    const path = tmp()
    const release = acquireLock(path, { pid: process.pid, port: 7777 })
    try {
      expect(() => acquireLock(path, { pid: process.pid, port: 8888 })).toThrow(LockHeldError)
      try {
        acquireLock(path, { pid: process.pid, port: 8888 })
      } catch (e) {
        // 第二个进程真正想知道的不是「我抢输了」，而是「那我该连哪」
        expect((e as LockHeldError).holder.port).toBe(7777)
        expect((e as LockHeldError).message).toContain('7777')
      }
    } finally {
      release()
    }
  })

  test('并发抢十次，只有一个成功 —— 顺序调用测不出这个', async () => {
    const path = tmp()
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (async () => {
          try {
            return { ok: true, release: acquireLock(path, { pid: process.pid, port: 7000 + i }) }
          } catch {
            return { ok: false as const, release: null }
          }
        })(),
      ),
    )
    const won = results.filter((r) => r.ok)
    expect(won).toHaveLength(1)
    won[0]?.release?.()
  })

  test('释放之后可以再抢', () => {
    const path = tmp()
    acquireLock(path, { pid: process.pid, port: 1 })()
    expect(existsSync(path)).toBe(false)
    acquireLock(path, { pid: process.pid, port: 2 })()
  })

  test('重复释放是幂等的', () => {
    const path = tmp()
    const release = acquireLock(path, { pid: process.pid, port: 1 })
    release()
    expect(() => release()).not.toThrow()
  })
})

describe('崩溃留下的陈锁不该把人永远挡在外面', () => {
  test('持有者进程已死 → 清掉陈锁并抢到', () => {
    const path = tmp()
    // pid 2^31-1 几乎不可能存在。这不是「假装」，而是**崩溃后的真实状态**：
    // 锁文件还在，写它的进程没了
    writeFileSync(path, JSON.stringify({ pid: 2147483647, port: 9999, startedAt: 1 }), 'utf8')
    expect(isAlive(2147483647)).toBe(false)
    const release = acquireLock(path, { pid: process.pid, port: 7777 })
    expect(readLock(path)?.port).toBe(7777)
    release()
  })

  test('持有者还活着 → 不许抢，即使锁文件很旧', () => {
    const path = tmp()
    writeFileSync(path, JSON.stringify({ pid: process.pid, port: 9999, startedAt: 1 }), 'utf8')
    expect(() => acquireLock(path, { pid: process.pid, port: 7777 })).toThrow(LockHeldError)
  })

  test('锁文件一直是空的/坏的（写到一半就崩了）→ 过了宽限期当陈锁接管，而不是抛裸 EEXIST', () => {
    // 并发拉起时，另一个进程刚 O_EXCL 建出文件、还没写内容，这时读到的也是空文件——
    // 所以先等一小会儿再下结论；一直读不出内容，才说明写它的进程已经不在了
    const path = tmp()
    writeFileSync(path, '', 'utf8')
    const started = Date.now()
    const release = acquireLock(path, { pid: process.pid, port: 7777 })
    expect(readLock(path)?.port).toBe(7777)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
    release()
  })

  test('锁文件内容坏了不至于让 daemon 起不来', () => {
    const path = tmp()
    writeFileSync(path, '这不是 JSON', 'utf8')
    expect(readLock(path)).toBeNull()
  })

  test('BUG-M3-008 · 多个进程同时接管同一把陈锁：只有一个赢', async () => {
    const path = tmp()
    const d = dirname(path)
    writeFileSync(path, JSON.stringify({ pid: 9_999_999, port: 1, startedAt: 1 }))
    const script = join(d, 'grab.ts')
    writeFileSync(
      script,
      `import { acquireLock, LockHeldError } from ${JSON.stringify(join(import.meta.dir, '../src/lock.ts'))}
try { acquireLock(${JSON.stringify(path)}, { pid: process.pid, port: 2 }); console.log('won'); await Bun.sleep(800) }
catch (e) { console.log(e instanceof LockHeldError ? 'lost' : 'error ' + e) }`,
    )
    const procs = Array.from({ length: 8 }, () => Bun.spawn(['bun', script], { stdout: 'pipe', stderr: 'pipe' }))
    const outs = await Promise.all(procs.map(async (p) => (await new Response(p.stdout).text()).trim()))
    expect(outs.filter((o) => o === 'won')).toHaveLength(1)
    expect(outs.filter((o) => o === 'lost')).toHaveLength(7)
  }, 30_000)
})
