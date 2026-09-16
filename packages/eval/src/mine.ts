/**
 * 从 git 历史出评估题 —— PRD-M7-008 · SPEC-M7-008
 *
 * 挑「同时改了源码和测试」的提交：工作区 = 父提交，判据 = 这个提交带来的测试，参考答案 = 这个提交改的源码。
 * 只收「父提交上判据失败、放入参考答案后通过」的题——判别不了的题比没有题更糟。
 * 生成与运行都花时间（运行还花钱），只进 nightly / 手动（INV-08）。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const TEST_FILE =
  /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/

/** 提交说明里要去掉的元数据行（AC-3） */
export const TRAILER =
  /^\s*(co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by|claude-session|change-id|generated-by)\s*:|generated with \[?claude|🤖/i

export interface MineOptions {
  repo: string
  out: string
  since?: string | undefined
  limit?: number | undefined
  /** 跑指定测试文件的命令，`{files}` 换成空格分隔的文件列表 */
  testCmd?: string | undefined
  /** 准备依赖的命令（在工作区里、模型开始之前跑）；空串 = 不需要 */
  setup?: string | undefined
  /** 每条验证命令的超时 */
  timeoutMs?: number | undefined
  onProgress?: (line: string) => void
}

export interface MinedTask {
  id: string
  commit: string
  title: string
  kept: boolean
  reason: string
}

function git(repo: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr ?? '').trim()}`)
  return r.stdout
}

/** 按锁文件猜测试命令与依赖准备命令 */
export function detectCommands(repo: string): { testCmd?: string; setup?: string } {
  const has = (f: string): boolean => existsSync(join(repo, f))
  let pkg: { devDependencies?: Record<string, string>; dependencies?: Record<string, string> } = {}
  try {
    pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  } catch {
    pkg = {}
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const setup =
    has('bun.lock') || has('bun.lockb')
      ? 'bun install --frozen-lockfile'
      : has('pnpm-lock.yaml')
        ? 'pnpm install --frozen-lockfile'
        : has('package-lock.json')
          ? 'npm ci'
          : has('yarn.lock')
            ? 'yarn install --frozen-lockfile'
            : undefined
  let testCmd: string | undefined
  if (deps.vitest) testCmd = 'npx vitest run {files}'
  else if (deps.jest) testCmd = 'npx jest {files}'
  else if (has('bun.lock') || has('bun.lockb') || has('bunfig.toml') || has('package.json'))
    testCmd = 'bun test {files}'
  else if (has('pyproject.toml') || has('pytest.ini') || has('setup.py')) testCmd = 'python -m pytest {files}'
  else if (has('go.mod')) testCmd = 'go test ./...'
  return { ...(testCmd === undefined ? {} : { testCmd }), ...(setup === undefined ? {} : { setup }) }
}

interface Candidate {
  commit: string
  parent: string
  subject: string
  body: string
  tests: string[]
  sources: string[]
  deleted: string[]
}

export function listCandidates(repo: string, since?: string, limit = 50): Candidate[] {
  // 每个提交：\x1e 开头，头部（哈希 / 父 / 标题 / 正文）以 \x1f 结尾，后面跟 -z 的 name-status
  const args = ['log', '--no-merges', '--format=%x1e%H%x00%P%x00%s%x00%b%x1f', '--name-status', '-z']
  if (since) args.push(`--since=${since}`)
  const raw = git(repo, args)
  const out: Candidate[] = []
  for (const rec of raw.split('\x1e')) {
    if (out.length >= limit) break
    const cut = rec.indexOf('\x1f')
    if (cut < 0) continue
    const [commit, parents, subject, body] = rec.slice(0, cut).split('\0') as [string, string, string, string]
    if (!commit || !parents || parents.includes(' ')) continue
    const rest = rec
      .slice(cut + 1)
      .split('\0')
      .map((x) => x.replace(/^\n/, ''))
      .filter((x) => x !== '')
    const tests: string[] = []
    const sources: string[] = []
    const deleted: string[] = []
    for (let i = 0; i < rest.length; i++) {
      const code = (rest[i] as string).trim()
      if (!/^[AMDRTC]\d*$/.test(code)) continue
      // 改名 / 复制是「代码、旧路径、新路径」三段，其余是两段
      const step = code.startsWith('R') || code.startsWith('C') ? 2 : 1
      i += step
      const file = rest[i] as string | undefined
      if (!file) continue
      if (TEST_FILE.test(file)) {
        if (!code.startsWith('D')) tests.push(file)
      } else if (code.startsWith('D')) deleted.push(file)
      else sources.push(file)
    }
    if (tests.length > 0 && (sources.length > 0 || deleted.length > 0)) {
      out.push({ commit: commit.trim(), parent: parents.trim(), subject, body: body ?? '', tests, sources, deleted })
    }
  }
  return out
}

/** 题面：提交说明（去掉元数据行、去掉与改动逐字重合的行）+ 要通过的测试文件 */
export function buildPrompt(c: Pick<Candidate, 'subject' | 'body' | 'tests'>, addedLines: ReadonlySet<string>): string {
  const keep = (l: string): boolean => !TRAILER.test(l) && !(l.trim().length >= 12 && addedLines.has(l.trim()))
  const body = c.body.split('\n').filter(keep).join('\n').trim()
  const title = keep(c.subject) ? c.subject : '按下面的测试完成改动'
  return [
    title,
    ...(body === '' ? [] : ['', body]),
    '',
    '完成后，下面这些测试应该通过（判定时会把这些测试文件的最终版本放进工作区）：',
    ...c.tests.map((t) => `- ${t}`),
  ].join('\n')
}

function run(cmd: string, cwd: string, timeoutMs: number): { ok: boolean; out: string } {
  const r = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(-1500) }
}

function extract(repo: string, commit: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const archive = spawnSync('git', ['archive', '--format=tar', commit], { cwd: repo, maxBuffer: 1024 * 1024 * 1024 })
  if (archive.status !== 0) throw new Error(`git archive ${commit} 失败`)
  const tar = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout })
  if (tar.status !== 0) throw new Error(`解包 ${commit} 失败：${tar.stderr?.toString() ?? ''}`)
}

function writeAt(repo: string, commit: string, file: string, destRoot: string): void {
  const r = spawnSync('git', ['show', `${commit}:${file}`], { cwd: repo, maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`读不到 ${commit}:${file}`)
  const dest = join(destRoot, file)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, r.stdout)
}

export function checkScript(files: readonly string[], testCmd: string): string {
  return `// 由 domi eval mine 生成（PRD-M7-008）：把这一题的测试放进工作区，再跑测试命令，退出码就是结果
import { cpSync } from 'node:fs'
import { join } from 'node:path'

const FILES = ${JSON.stringify(files)}
cpSync(join(import.meta.dir, 'tests'), process.cwd(), { recursive: true })
const cmd = ${JSON.stringify(testCmd)}.replace('{files}', FILES.map((f) => JSON.stringify(f)).join(' '))
const r = Bun.spawnSync(['sh', '-c', cmd], { stdout: 'inherit', stderr: 'inherit' })
process.exit(r.exitCode ?? 1)
`
}

function applySolution(taskDir: string, ws: string): void {
  const sol = join(taskDir, 'solution')
  if (existsSync(sol)) cpSync(sol, ws, { recursive: true })
  const del = join(taskDir, 'solution.delete')
  if (existsSync(del)) {
    for (const f of readFileSync(del, 'utf8').split('\n').filter(Boolean)) rmSync(join(ws, f), { force: true })
  }
}

function yamlString(s: string): string {
  return JSON.stringify(s)
}

export function mineTasks(opts: MineOptions): MinedTask[] {
  const repo = resolve(opts.repo)
  git(repo, ['rev-parse', '--git-dir'])
  const detected = detectCommands(repo)
  const testCmd = opts.testCmd ?? detected.testCmd
  if (!testCmd) throw new Error('猜不出这个仓库怎么跑测试，用 --test-cmd 指定（{files} 会换成测试文件列表）')
  const setup = opts.setup ?? detected.setup ?? ''
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000
  const tasksDir = join(opts.out, 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  const results: MinedTask[] = []
  for (const c of listCandidates(repo, opts.since, opts.limit ?? 50)) {
    const id = `${basename(repo)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')}-${c.commit.slice(0, 10)}`
    const say = (kept: boolean, reason: string): void => {
      results.push({ id, commit: c.commit, title: c.subject, kept, reason })
      opts.onProgress?.(`${kept ? '✅' : '⏭'} ${c.commit.slice(0, 10)} ${c.subject.slice(0, 50)} —— ${reason}`)
    }
    const taskDir = join(tasksDir, id)
    const scratch = mkdtempSync(join(tmpdir(), 'domi-mine-'))
    try {
      if (existsSync(taskDir)) rmSync(taskDir, { recursive: true, force: true })
      mkdirSync(taskDir, { recursive: true })
      extract(repo, c.parent, join(taskDir, 'workspace'))
      for (const t of c.tests) writeAt(repo, c.commit, t, join(taskDir, 'tests'))
      for (const s of c.sources) writeAt(repo, c.commit, s, join(taskDir, 'solution'))
      if (c.deleted.length > 0) writeFileSync(join(taskDir, 'solution.delete'), `${c.deleted.join('\n')}\n`)
      writeFileSync(join(taskDir, 'check.ts'), checkScript(c.tests, testCmd))
      const diff = git(repo, ['diff', c.parent, c.commit])
      const added = new Set(
        diff
          .split('\n')
          .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
          .map((l) => l.slice(1).trim()),
      )
      const prompt = buildPrompt(c, added)
      writeFileSync(
        join(taskDir, 'task.yaml'),
        [
          `id: ${id}`,
          `title: ${yamlString(c.subject)}`,
          `prompt: ${yamlString(prompt)}`,
          ...(setup === '' ? [] : [`setup: ${yamlString(setup)}`]),
          `timeoutMs: 600000`,
          'source:',
          `  repo: ${yamlString(repo)}`,
          `  commit: ${c.commit}`,
          `  parent: ${c.parent}`,
          '',
        ].join('\n'),
      )

      // 双向验证：父提交上必须失败，放入参考答案后必须通过（AC-2）
      const ws = join(scratch, 'ws')
      cpSync(join(taskDir, 'workspace'), ws, { recursive: true })
      if (setup !== '') {
        const s = run(setup, ws, timeoutMs)
        if (!s.ok) {
          rmSync(taskDir, { recursive: true, force: true })
          say(false, `准备依赖失败：${s.out.split('\n').at(-1) ?? ''}`)
          continue
        }
      }
      const check = `${JSON.stringify(process.execPath)} ${JSON.stringify(join(resolve(taskDir), 'check.ts'))}`
      const before = run(check, ws, timeoutMs)
      if (before.ok) {
        rmSync(taskDir, { recursive: true, force: true })
        say(false, '父提交上测试已经通过，判别不了')
        continue
      }
      applySolution(taskDir, ws)
      const after = run(check, ws, timeoutMs)
      if (!after.ok) {
        rmSync(taskDir, { recursive: true, force: true })
        say(false, `放入参考答案后测试仍不通过（多半依赖提交外的环境）：${after.out.split('\n').at(-1) ?? ''}`)
        continue
      }
      say(true, `${c.tests.length} 个测试文件、${c.sources.length + c.deleted.length} 个源文件`)
    } catch (e) {
      rmSync(taskDir, { recursive: true, force: true })
      say(false, e instanceof Error ? e.message : String(e))
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  writeFileSync(join(opts.out, 'mine-report.md'), formatMineReport(repo, opts.out, testCmd, setup, results))
  return results
}

export function formatMineReport(
  repo: string,
  out: string,
  testCmd: string,
  setup: string,
  r: readonly MinedTask[],
): string {
  const kept = r.filter((x) => x.kept)
  return [
    `# 从 ${repo} 出的题`,
    '',
    `测试命令：\`${testCmd}\` · 依赖准备：${setup === '' ? '无' : `\`${setup}\``}`,
    `候选 ${r.length} 个提交，收下 ${kept.length} 题`,
    '',
    '| 提交 | 说明 | 结果 |',
    '|---|---|---|',
    ...r.map(
      (x) =>
        `| ${x.commit.slice(0, 10)} | ${x.title.replace(/\|/g, '\\|').slice(0, 60)} | ${x.kept ? '✅ ' : '⏭ '}${x.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`,
    ),
    '',
    `跑题（花钱）：\`domi eval l2 --tasks ${join(out, 'tasks')} --rounds 1\``,
  ].join('\n')
}
