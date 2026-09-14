/**
 * `domi eval` —— PRD-M2-008 AC-1 / AC-2
 *
 * 命令实现住在 **packages/eval 自己**，`packages/cli` 只做一次动态 import 把它接上。
 * 理由是 AC-5：eval 必须能被整个删掉。实现留在 eval 里，删掉时跟着一起走；
 * 接线处只剩一个 try/catch，退化成一句「评估层没装」，而不是让 `domi` 整个起不来。
 *
 * 录制不写任何新埋点 —— 数据来源只有事件流（INV-13）。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SqliteEventLog } from '@domi/store'
import { type Fixture, parse, record, serialize } from './fixture.ts'
import { formatResult, replay } from './replay.ts'

export interface Io {
  out(s: string): void
  err(s: string): void
}

/** fixture 默认落在仓库里，跟着代码一起进版本库 —— 它是测试资产，不是用户数据 */
export const FIXTURE_DIR = join('fixtures', 'sessions')

export const EVAL_HELP = `domi eval —— L1 确定性轨迹回放（不联网、不花钱）

  domi eval record <sessionId>   把一条真实会话导出成 fixture
  domi eval run [fixture...]     回放 fixture，断言工具调用序列与录制一致

fixture 默认读写 ${FIXTURE_DIR}/ 。回放全程不发出任何网络请求。`

function dbPath(): string {
  return join(homedir(), '.domi', 'events.db')
}

async function cmdRecord(sessionId: string | undefined, io: Io): Promise<number> {
  if (!sessionId) {
    io.err('用法：domi eval record <sessionId>\n（会话 id 用 `domi session list` 看）')
    return 2
  }
  const log = new SqliteEventLog({ path: dbPath() })
  try {
    const events = await log.read(sessionId)
    if (events.length === 0) {
      io.err(`会话 ${sessionId} 没有任何事件。用 \`domi session list\` 确认 id。`)
      return 1
    }
    const fixture = record(events, sessionId)
    mkdirSync(FIXTURE_DIR, { recursive: true })
    const out = join(FIXTURE_DIR, `${sessionId}.json`)
    writeFileSync(out, serialize(fixture), 'utf8')
    io.out(
      `已录制 ${out}\n` +
        `  ${events.length} 条事件 → ${fixture.turns.length} 轮、${fixture.expectedCalls.length} 次工具调用`,
    )
    return 0
  } finally {
    log.close()
  }
}

function loadFixtures(paths: readonly string[], io: Io): Array<{ path: string; fixture: Fixture }> {
  const files =
    paths.length > 0
      ? [...paths]
      : (() => {
          try {
            return readdirSync(FIXTURE_DIR)
              .filter((f) => f.endsWith('.json'))
              .map((f) => join(FIXTURE_DIR, f))
          } catch {
            return []
          }
        })()

  const out: Array<{ path: string; fixture: Fixture }> = []
  for (const p of files) {
    try {
      out.push({ path: p, fixture: parse(readFileSync(p, 'utf8')) })
    } catch (e) {
      io.err(`跳过 ${p}：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return out
}

async function cmdRun(paths: readonly string[], io: Io): Promise<number> {
  const loaded = loadFixtures(paths, io)
  if (loaded.length === 0) {
    io.err(`${FIXTURE_DIR}/ 下没有 fixture。先跑一次 \`domi eval record <sessionId>\`。`)
    return 1
  }

  let failed = 0
  for (const { fixture } of loaded) {
    const r = await replay(fixture)
    io.out(formatResult(r))
    if (!r.ok) failed++
  }
  io.out(`\n${loaded.length - failed}/${loaded.length} 通过`)
  return failed === 0 ? 0 : 1
}

export async function runEval(sub: string | undefined, args: readonly string[], io: Io): Promise<number> {
  switch (sub) {
    case 'record':
      return cmdRecord(args[0], io)
    case 'run':
      return cmdRun(args, io)
    case undefined:
    case 'help':
      io.out(EVAL_HELP)
      return 0
    default:
      io.err(`未知子命令：eval ${sub}\n${EVAL_HELP}`)
      return 2
  }
}
