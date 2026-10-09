/**
 * PRD-M15-009 · 项目级记忆（TASK-M15-011）
 * AC-1 项目 id（git remote slug 优先 / 无 remote 用 cwd stable hash）
 * AC-2 类型分流（偏好 → 全局 Soul；fact / entity → 项目记忆）
 * AC-3 索引进提示词（上限 4k token，每条一行 `[kind] text · recall <key>`）；正文 memory.recall 取；随会话冻结
 * AC-4 压缩前冲刷
 * AC-5 自由会话只用全局记忆
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSchema } from '@domi/config'
import { itemId } from '@domi/memory'
import { StubProvider } from '@domi/model'
import { SqliteEventLog } from '@domi/store'
import {
  MemoryService,
  type MemoryServiceOptions,
  makeMemoryRecallTool,
  projectKeyOf,
  projectMemoryPath,
  remoteSlugOf,
} from '../src/memory-service.ts'

const dirs: string[] = []
function tmp(prefix = 'pm-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function service(script: unknown[][], home: string, over: Partial<MemoryServiceOptions> = {}): MemoryService {
  return new MemoryService({
    config: ConfigSchema.parse({
      model: { provider: 'stub', name: 'stub-1', apiKey: 'k' },
      memory: { soul: true, extractEvery: 0 },
    }),
    dbPath: join(home, 'events.db'),
    soulDir: join(home, 'soul'),
    home,
    provider: new StubProvider(script as never, { onExhausted: 'repeat-last' }),
    ...over,
  })
}

/** 往会话里写一轮「用户输入 + 模型回话」，抽取要看得到 user.input */
function seed(sessionId: string, dbPath: string, texts: string[]): void {
  const log = new SqliteEventLog({ path: dbPath })
  log.append(sessionId, [
    { t: 'user.input', text: texts[0]! },
    { t: 'model.delta', text: texts[1] ?? '好的，明白了。' },
  ])
  log.close()
}

const EXTRACT_TWO = [
  {
    type: 'delta',
    text: JSON.stringify({
      items: [
        { kind: 'fact', text: 'domi 的构建命令是 pnpm check', seqs: [1] },
        { kind: 'preference', text: '用户偏好回复用简体中文', seqs: [1] },
      ],
    }),
  },
]
// 让偏好真的进 Soul：提案给一个 add op（sources 指向抽取条目的确定性 id）
const PREF_TEXT = '用户偏好回复用简体中文'
const NO_SOUL_OPS = JSON.stringify({
  ops: [{ section: '技术偏好', op: 'add', text: PREF_TEXT, sources: [itemId('preference', PREF_TEXT)] }],
})

describe('PRD-M15-009 AC-1 · 项目 id', () => {
  test('remoteSlugOf：https / ssh / scp 风格都归一成 host-owner-repo', () => {
    expect(remoteSlugOf('https://github.com/domi/domi.git')).toBe('github.com-domi-domi')
    expect(remoteSlugOf('git@github.com:domi/domi.git')).toBe('github.com-domi-domi')
    expect(remoteSlugOf('ssh://git@gitlab.com/a/b.git')).toBe('gitlab.com-a-b')
  })

  test('git remote slug 优先；无 remote 用 cwd stable hash（同 cwd 稳定、不含 basename 歧义）', () => {
    const d = tmp('pm-repo-')
    mkdirSync(join(d, '.git'), { recursive: true })
    execFileSync('git', ['-C', d, 'init', '-q'], { stdio: 'ignore' })
    execFileSync('git', ['-C', d, 'remote', 'add', 'origin', 'https://github.com/domi/domi.git'], { stdio: 'ignore' })
    expect(projectKeyOf(d)).toBe('github.com-domi-domi')

    const plain = tmp('pm-norepo-')
    const k1 = projectKeyOf(plain)
    const k2 = projectKeyOf(plain)
    expect(k1).toMatch(/^hash-[0-9a-f]{8}$/)
    expect(k2).toBe(k1) // 稳定
  })
})

describe('PRD-M15-009 AC-2/AC-5 · 类型分流', () => {
  test('任务会话（给 cwd）：fact 进项目记忆文件，preference 进全局 Soul', async () => {
    const home = tmp()
    const cwd = tmp('pm-proj-')
    mkdirSync(join(cwd, '.git'), { recursive: true })
    const m = service([EXTRACT_TWO, [{ type: 'delta', text: NO_SOUL_OPS }]], home)
    const sid = 'pm-s1'
    seed(sid, join(home, 'events.db'), ['帮我看看构建命令', '好的。'])
    const { added, soul } = await m.extract(sid, cwd)

    expect(added.length).toBe(2)
    expect(soul.length).toBe(1) // 偏好的 add 进了 Soul

    // fact → 项目记忆文件，文件头带 project id · root
    const key = projectKeyOf(cwd)
    const p = projectMemoryPath(home, key)
    expect(existsSync(p)).toBe(true)
    const file = readFileSync(p, 'utf8')
    expect(file).toContain(`# project id: ${key} · root: ${cwd}`)
    expect(file).toContain('- [fact] domi 的构建命令是 pnpm check')
    // preference 不进项目文件
    expect(file).not.toContain('简体中文')
  })

  test('偏好进全局 Soul（文件里出现），自由会话（不传 cwd）全部走全局', async () => {
    const home = tmp()
    // 第一次：任务会话，preference 进 soul
    const cwd = tmp('pm-proj2-')
    mkdirSync(join(cwd, '.git'), { recursive: true })
    const m1 = service([EXTRACT_TWO, [{ type: 'delta', text: NO_SOUL_OPS }]], home)
    seed('pm-s2', join(home, 'events.db'), ['帮我看看构建命令', '好的。'])
    await m1.extract('pm-s2', cwd)
    const soul1 = readFileSync(join(home, 'soul', 'soul.md'), 'utf8')
    expect(soul1).toContain('简体中文')

    // 第二次：自由会话（不传 cwd）——抽到的 fact 也只进全局（L3），不写项目文件（独立 home 验证）
    const home2 = tmp()
    const m2 = service([EXTRACT_TWO, [{ type: 'delta', text: NO_SOUL_OPS }]], home2)
    seed('pm-s3', join(home2, 'events.db'), ['再帮我看看构建命令', '好的。'])
    const r2 = await m2.extract('pm-s3')
    expect(r2.added.length).toBe(2)
    // 没有 cwd → 没写任何项目文件
    expect(existsSync(join(home2, 'projects'))).toBe(false)
  })
})

describe('PRD-M15-009 AC-3 · 索引进提示词 + recall', () => {
  test('promptText(projectKey) 含索引行；promptText(null)（自由会话）没有项目记忆段', async () => {
    const home = tmp()
    const cwd = tmp('pm-proj3-')
    mkdirSync(join(cwd, '.git'), { recursive: true })
    const m = service([EXTRACT_TWO, [{ type: 'delta', text: NO_SOUL_OPS }]], home)
    seed('pm-s4', join(home, 'events.db'), ['帮我看看构建命令', '好的。'])
    await m.extract('pm-s4', cwd)

    const key = projectKeyOf(cwd)
    const idx = m.projectIndexText(key)
    const factId = itemId('fact', 'domi 的构建命令是 pnpm check')
    expect(idx).toContain(`[fact] domi 的构建命令是 pnpm check · recall ${factId}`)

    const withKey = m.promptText(key)
    expect(withKey).toContain('## 项目记忆')
    expect(withKey).toContain(`recall ${factId}`)
    // 自由会话：没有项目 key → 只有全局 Soul，没有项目记忆段
    const free = m.promptText(null)
    expect(free).not.toContain('## 项目记忆')
  })

  test('索引上限 4k token：超出时截断（projectIndexText 默认上限）', () => {
    const home = tmp()
    const key = 'github.com-x-y'
    const p = projectMemoryPath(home, key)
    mkdirSync(join(home, 'projects', key, 'memory'), { recursive: true })
    const lines = Array.from({ length: 300 }, (_, i) => `- [fact] 项目约定 ${i}：构建用 pnpm check 保持测试全绿`)
    writeFileSync(p, `# project id: ${key} · root: /x\n${lines.join('\n')}\n`)
    const m = service([], home)
    const idx = m.projectIndexText(key, 4_000)
    expect(idx).toContain('[fact] 项目约定 0')
    // 300 行不可能都塞进 4k token：必然截断
    expect(idx.split('\n').length).toBeLessThan(300)
  })

  test('memory.recall 带 key 取项目正文；不带 key 按 query 过滤项目条目', async () => {
    const home = tmp()
    const key = 'github.com-x-y'
    const p = projectMemoryPath(home, key)
    mkdirSync(join(home, 'projects', key, 'memory'), { recursive: true })
    writeFileSync(
      p,
      `# project id: ${key} · root: /x\n- [fact] 部署用 rsync 到生产机\n- [fact] 缓存目录在 .tmp/cache\n`,
    )
    const m = service([], home)
    const tool = makeMemoryRecallTool(m, () => key)

    const factId = itemId('fact', '部署用 rsync 到生产机')
    const byKey = (await tool.execute({ query: '随便', key: factId }, {} as never)) as {
      mode: string
      items: Array<{ id: string; kind: string; text: string; source: string }>
    }
    expect(byKey.mode).toBe('key')
    expect(byKey.items).toEqual([{ id: factId, kind: 'fact', text: '部署用 rsync 到生产机', source: 'project' }])

    const byQuery = (await tool.execute({ query: 'rsync' }, {} as never)) as { items: Array<{ text: string }> }
    expect(byQuery.items.map((i: { text: string }) => i.text)).toContain('部署用 rsync 到生产机')
  })
})

describe('PRD-M15-009 AC-1（INV-09）· 可否决', () => {
  test('把条目删掉并写进项目 .rejected：再抽取同文本不会加回', async () => {
    const home = tmp()
    const key = 'github.com-x-y'
    const memDir = join(home, 'projects', key, 'memory')
    mkdirSync(memDir, { recursive: true })
    const text = '这个约定不对'
    writeFileSync(join(memDir, 'memory.md'), `# project id: ${key} · root: /x\n- [fact] ${text}\n`)
    writeFileSync(join(memDir, '.rejected'), `# 否决\n${text}\n`)
    const m = service([], home)
    m.appendProjectMemory(key, '/x', [{ id: 'x', kind: 'fact', text, sourceRefs: [] }])
    const file = readFileSync(join(memDir, 'memory.md'), 'utf8')
    // 只有原来的那一行，没有被加回第二遍
    expect(file.split('\n').filter((l) => l.includes(text)).length).toBe(1)
  })
})

describe('PRD-M15-009 AC-4 · 压缩前冲刷', () => {
  test('flush 不看轮数强制抽取（extractEvery=0 时 afterTurn 不抽，flush 抽）', async () => {
    const home = tmp()
    const cwd = tmp('pm-proj4-')
    mkdirSync(join(cwd, '.git'), { recursive: true })
    const m = service([EXTRACT_TWO, [{ type: 'delta', text: NO_SOUL_OPS }]], home)
    seed('pm-s5', join(home, 'events.db'), ['帮我看看构建命令', '好的。'])
    // extractEvery=0：afterTurn 不会抽
    await m.afterTurn('pm-s5', cwd)
    const key = projectKeyOf(cwd)
    expect(existsSync(projectMemoryPath(home, key))).toBe(false)
    // flush 强制抽
    const r = await m.flush('pm-s5', cwd)
    expect(r.added.length).toBe(2)
    expect(existsSync(projectMemoryPath(home, key))).toBe(true)
  })
})
