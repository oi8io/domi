/**
 * INV-01 · 协议契约变更必须在 diff 里显式出现
 * docs/ENGINEERING.md 第三道防线（API 快照）
 */
import { describe, expect, test } from 'bun:test'

describe('事件契约快照', () => {
  test('packages/protocol/.api.md 与当前契约一致', async () => {
    const p = Bun.spawn(['bun', 'run', 'scripts/gen-api-snapshot.ts', '--check'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const err = await new Response(p.stderr).text()
    const code = await p.exited
    if (code !== 0) {
      throw new Error(
        `协议契约变了但快照没更新。跑 \`bun run scripts/gen-api-snapshot.ts\` 重新生成，\n` +
          `并在 commit message 里说明旧事件为什么仍可解析。\n${err}`,
      )
    }
    expect(code).toBe(0)
  })
})
