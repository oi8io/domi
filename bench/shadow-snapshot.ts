/**
 * 快照耗时基准 —— SPEC-M14-003 取舍-8（只报告不 gate）
 *
 * 在 domi 自身仓库上跑 N 次 `snapshot()` 与「无变化跳过」路径，输出中位数 / P95。
 * git 版本与机器差异太大，不进 CI 门禁。
 *
 *   bun bench/shadow-snapshot.ts [iterations]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ShadowRepo, workspaceHash } from '../packages/checkpoint/src/index.ts'

const here = resolve(fileURLToPath(import.meta.url), '..')
const workTree = resolve(here, '..') // packages/checkpoint/.. = 仓库根
const iterations = Number(process.argv[2] ?? 5)

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}
function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now()
  await fn()
  return performance.now() - t0
}

async function main(): Promise<void> {
  // 影子仓库放进 tmp，别把 bench 产物写进用户仓库
  const tmp = mkdtempSync(join(tmpdir(), 'domi-bench-shadow-'))
  const repo = new ShadowRepo({ workTree, gitDir: join(tmp, 'shadow.git') })
  console.log(`workTree = ${workTree}`)
  console.log(`gitDir   = ${repo.gitDir}（workspace hash ${workspaceHash(workTree)}，本次临时）`)
  console.log(`available= ${await repo.available()}`)

  const snapMs: number[] = []
  const skipMs: number[] = []
  let id: string | null = null
  for (let i = 0; i < iterations; i++) {
    snapMs.push(await time(async () => (id = (await repo.snapshot(`bench ${i}`)).id)))
  }
  for (let i = 0; i < iterations; i++) {
    skipMs.push(await time(() => repo.clean())) // 无变化跳过的判定路径
  }

  console.log(`snapshot ×${iterations}：中位数 ${median(snapMs).toFixed(0)}ms · P95 ${p95(snapMs).toFixed(0)}ms`)
  console.log(`clean 判定 ×${iterations}：中位数 ${median(skipMs).toFixed(0)}ms · P95 ${p95(skipMs).toFixed(0)}ms`)
  console.log(`快照 id = ${id}`)
  rmSync(tmp, { recursive: true, force: true })
}

void main()
