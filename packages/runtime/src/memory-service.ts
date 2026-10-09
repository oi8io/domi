/**
 * 记忆与 Soul 的编排 —— PRD-M4-001…004 · docs/adr/018 / 019
 *
 * 一个 daemon 一个实例：soul.md 是全局的，两个会话同时更新会互相覆盖，所以这里的写操作**串行**。
 * 逻辑都在 @domi/memory（纯函数），这里只做 IO：读写 soul 目录、调模型、落 memory.write 事件。
 *
 * 所有写入先落事件（_memory 会话），L3 表是事件的投影（store 在同一个事务里投影）；
 * soul.md 是人也会改的文件，所以每次都现读现写，domi 写过什么由 L4 事件记着（INV-09）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Tool } from '@domi/capability'
import { type DomiConfig, providerConnection } from '@domi/config'
import { KeyedError } from '@domi/i18n'
import {
  applyImport,
  applySoulOps,
  changeDiff,
  type Embedder,
  type ExportFinding,
  ExtractionSchema,
  exportSoul,
  extractItems,
  type ImportPlan,
  itemDiff,
  itemId,
  normalizeText,
  ownedLines,
  parseSoul,
  planImport,
  rejectedText,
  renderSoul,
  revertChange,
  type SemanticSearchResult,
  type SoulDoc,
  SoulProposalSchema,
  scanForExport,
  searchSemantic,
  soulForPrompt,
  soulUpdatePrompt,
  transcriptOf,
} from '@domi/memory'
import { createEmbedder, createProvider, generateStructured, type ModelProvider, providerConfigOf } from '@domi/model'
import type { SemanticItem, SoulChange } from '@domi/protocol'
import { estimateTextTokens, fnv1a } from '@domi/protocol'
import { MEMORY_SESSION_ID, SqliteEventLog, type StoredItem } from '@domi/store'
import { type ZodType, z } from 'zod'

export interface MemoryServiceOptions {
  config: DomiConfig
  dbPath: string
  /** ~/.domi/soul */
  soulDir: string
  /** ~/.domi：项目记忆在它下面的 projects/<id>/memory/（PRD-M15-009 AC-1） */
  home: string
  /** 测试注入；不给就按 config.model 建 */
  provider?: ModelProvider
  /** 测试注入；不给就按 config.memory.embedding 建（没配就没有） */
  embed?: Embedder
  now?: () => number
}

/** 审阅列表里的一项 */
export class SoulConflictError extends KeyedError {
  constructor() {
    super('error.soul_conflict')
    this.name = 'SoulConflictError'
  }
}

export interface PendingChange extends SoulChange {
  at: number
  diff: string
}

export const MemoryRecallArgs = z.object({
  query: z.string().min(1).describe('想确认的关于用户的信息，例如「用户偏好的测试框架」'),
  limit: z.number().int().positive().max(20).optional(),
  key: z.string().optional().describe('索引进提示词时给出的条目键：按键直接取该条正文（PRD-M15-009 AC-3）'),
})

/**
 * L3 的读接口给模型用（PRD-M4-001 AC-3）。和 memory.search 共用一个能力 id：
 * 都是「翻用户的记录」，用户开一条规则就够了
 */
export function makeMemoryRecallTool(
  memory: MemoryService,
  projectKey?: () => string | null,
): Tool<z.infer<typeof MemoryRecallArgs>, unknown> {
  return {
    name: 'memory.recall',
    capability: 'memory.search',
    description:
      '查长期记忆（用户事实 / 偏好 / 当前项目的约定与踩坑）。索引进提示词时给了 recall <key> 就带 key 直接取那一条；' +
      '否则按 query 查全局记忆与当前项目记忆。没有相关的就返回空列表——那就当作不知道，不要猜。',
    schema: MemoryRecallArgs,
    async execute(args) {
      const limit = args.limit ?? 8
      if (args.key !== undefined) {
        return { mode: 'key', items: await memory.recallByKey(args.key) }
      }
      const r = await memory.search(args.query, limit)
      const items: Array<{ id: string; kind: string; text: string; source?: 'global' | 'project'; sources: unknown }> =
        r.items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, sources: i.sourceRefs }))
      const pk = projectKey?.() ?? null
      if (pk !== null) {
        for (const i of memory.projectRecall(pk, args.query, limit)) {
          items.push({ id: i.key, kind: i.kind, text: i.text, sources: [] })
        }
      }
      return {
        mode: r.mode === 'keyword' ? '只按关键词匹配（没有配置 embedding）' : '关键词 + 语义',
        items,
      }
    },
  }
}

// ── 项目 id（PRD-M15-009 AC-1）──────────────────────────────

/** `git remote origin` 的 URL 解析成 host/owner/repo slug（如 github.com-domi-domi） */
export function remoteSlugOf(remoteUrl: string): string | null {
  let u = remoteUrl.trim()
  // scp 风格 git@github.com:domi/domi.git
  u = u.replace(/^[^@]+@/, '').replace(/^ssh:\/\//, '')
  u = u.replace(/^https?:\/\//, '').replace(/^git:\/\//, '')
  u = u.replace(/\.git$/, '')
  const [host, ...rest] = u.split(/[/:]/).filter((x) => x !== '')
  if (!host || rest.length === 0) return null
  return [host, ...rest.slice(0, 2)].join('-')
}

/**
 * 项目记忆的稳定 id：git remote slug 优先；无 remote 用 cwd 的 stable hash（path + inode）。
 * 不用 basename(cwd)：同名目录换位置会串味（PRD-M15-009 AC-1）。
 */
export function projectKeyOf(cwd: string): string {
  const r = spawnSync('git', ['-C', cwd, 'config', '--get', 'remote.origin.url'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const remote = r.status === 0 && r.stdout ? r.stdout.trim() : ''
  if (remote !== '') {
    const slug = remoteSlugOf(remote)
    if (slug) return slug
  }
  let ino = 0
  try {
    ino = statSync(cwd).ino
  } catch {
    // 目录不存在：只用 path 也能得到稳定 id
  }
  return `hash-${fnv1a(`${cwd}:${ino}`)}`
}

/** 项目记忆目录（~/.domi/projects/<id>/memory/）与正文文件 */
export function projectMemoryDir(home: string, key: string): string {
  return join(home, 'projects', key, 'memory')
}
export function projectMemoryPath(home: string, key: string): string {
  return join(projectMemoryDir(home, key), 'memory.md')
}

export class MemoryService {
  private readonly log: SqliteEventLog
  private queue: Promise<unknown> = Promise.resolve()
  private readonly embed: { model: string; embedder: Embedder } | undefined
  private providerCache: ModelProvider | undefined
  private seq = 0

  constructor(private readonly opts: MemoryServiceOptions) {
    this.log = new SqliteEventLog({ path: opts.dbPath })
    const e = opts.config.memory.embedding
    if (opts.embed) this.embed = { model: e?.model ?? 'injected', embedder: opts.embed }
    else if (e) {
      // 没写 key / 地址就用 embedding 所在那一家的（providerConnection）；不同家不共用
      const conn = providerConnection(opts.config, e.provider)
      this.embed = {
        model: `${e.provider}/${e.model}`,
        embedder: createEmbedder({
          provider: e.provider,
          vendor: conn.vendor,
          protocol: conn.protocol,
          model: e.model,
          apiKey: e.apiKey ?? conn.apiKey,
          baseUrl: e.baseUrl ?? conn.baseUrl,
        }),
      }
    }
  }

  private get provider(): ModelProvider {
    if (this.opts.provider) return this.opts.provider
    const { provider, name } = this.opts.config.model
    const conn = providerConnection(this.opts.config, provider)
    this.providerCache ??= createProvider(providerConfigOf(conn, name))
    return this.providerCache
  }

  private now(): number {
    return (this.opts.now ?? Date.now)()
  }

  /** 写操作排队，一次一个 */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async structured<T>(schema: ZodType<T>, prompt: string): Promise<T> {
    return generateStructured({ provider: this.provider, capabilities: this.provider.capabilities }, schema, {
      model: this.opts.config.model.name,
      messages: [{ role: 'user', content: prompt }],
    })
  }

  // ── L3 ──────────────────────────────────────────────────

  /**
   * 一轮结束后调：攒够 extractEvery 轮就抽一次，然后分流到全局 Soul / 项目记忆（PRD-M15-009 AC-2）。
   * cwd 为空或非任务会话 = 自由会话：只用全局记忆（AC-5）。失败落一条 error，不抛
   */
  afterTurn(sessionId: string, cwd?: string): Promise<void> {
    const every = this.opts.config.memory.extractEvery
    if (every <= 0 || sessionId.startsWith('_')) return Promise.resolve()
    return this.serial(async () => {
      const view = await this.log.readLineage(sessionId)
      const from = this.log.semantic.extractedSeq(sessionId)
      const turns = view.filter((e) => e.seq > from && e.ev.t === 'user.input').length
      if (turns < every) return
      await this.extractNow(sessionId, view, from, cwd)
    }).catch(async (e) => {
      await this.log.append(MEMORY_SESSION_ID, [
        {
          t: 'error',
          scope: 'memory',
          message: `记忆抽取失败：${e instanceof Error ? e.message : String(e)}`,
          recoverable: true,
        },
      ])
    })
  }

  /** 手动抽取（`domi memory extract`）：不看轮数 */
  extract(sessionId: string, cwd?: string): Promise<{ added: SemanticItem[]; soul: SoulChange[] }> {
    return this.serial(async () => {
      const view = await this.log.readLineage(sessionId)
      return this.extractNow(sessionId, view, this.log.semantic.extractedSeq(sessionId), cwd)
    })
  }

  /** 压缩前冲刷（PRD-M15-009 AC-4）：强制把增量交给抽取，与压缩共用同一段增量输入，不重复读历史 */
  flush(sessionId: string, cwd?: string): Promise<{ added: SemanticItem[]; soul: SoulChange[] }> {
    if (sessionId.startsWith('_')) return Promise.resolve({ added: [], soul: [] })
    return this.serial(async () => {
      const view = await this.log.readLineage(sessionId)
      return this.extractNow(sessionId, view, this.log.semantic.extractedSeq(sessionId), cwd)
    })
  }

  private async extractNow(
    sessionId: string,
    view: Awaited<ReturnType<SqliteEventLog['readLineage']>>,
    from: number,
    cwd?: string,
  ): Promise<{ added: SemanticItem[]; soul: SoulChange[] }> {
    const slice = view.filter((e) => e.seq > from)
    const last = view.at(-1)?.seq ?? from
    if (slice.length === 0) return { added: [], soul: [] }
    // SPEC-M15-008 取舍-22（E8）：不再每次带 200 条已知记忆——只带 FTS 近邻（最多 20），
    // 用段内文本做检索词；候选只和近邻比去重。
    const nearText = transcriptOf(slice, 4_000).slice(0, 300)
    const known = nearText.trim() === '' ? [] : this.log.semantic.searchText(nearText, 20)
    const added = await extractItems({
      sessionId,
      events: slice,
      known,
      rejected: this.rejected(),
      extract: (prompt) => this.structured(ExtractionSchema, prompt),
    })
    await this.log.append(MEMORY_SESSION_ID, [
      ...added.map((item) => ({
        t: 'memory.write' as const,
        layer: 'L3' as const,
        op: 'add' as const,
        item,
        diff: itemDiff('+', item),
      })),
      {
        t: 'memory.write',
        layer: 'L3',
        op: 'extracted',
        range: { sessionId, fromSeq: from + 1, toSeq: last },
        diff: `抽取了会话 ${sessionId} 的第 ${from + 1}–${last} 条，新增 ${added.length} 条`,
      },
    ])
    await this.embedPending()
    // PRD-M15-009 AC-2 分流：偏好 → 全局 Soul；fact / entity → 项目记忆（任务会话）。
    // 自由会话（没给 cwd / 非项目）全部走全局（AC-5）
    if (cwd === undefined) {
      const soul = added.length > 0 && this.opts.config.memory.soul ? await this.updateSoulNow(added) : []
      return { added, soul }
    }
    const projectKey = projectKeyOf(cwd)
    const prefs = added.filter((i) => i.kind === 'preference')
    const facts = added.filter((i) => i.kind !== 'preference')
    const soul = prefs.length > 0 && this.opts.config.memory.soul ? await this.updateSoulNow(prefs) : []
    if (facts.length > 0) this.appendProjectMemory(projectKey, cwd, facts)
    return { added, soul }
  }

  list(opts: { includeDeleted?: boolean } = {}): StoredItem[] {
    return this.log.semantic.list({ ...opts, limit: 1000 })
  }

  async search(query: string, limit = 10): Promise<SemanticSearchResult> {
    return searchSemantic(this.log.semantic, query, { limit, ...(this.embed ? { embed: this.embed } : {}) })
  }

  /** 按键取正文：全局 L3 命中优先；否则扫所有项目记忆文件（recall <key>，PRD-M15-009 AC-3） */
  async recallByKey(
    key: string,
  ): Promise<Array<{ id: string; kind: string; text: string; source: 'global' | 'project' }>> {
    const g = this.log.semantic.get(key)
    const out: Array<{ id: string; kind: string; text: string; source: 'global' | 'project' }> = []
    if (g) out.push({ id: g.id, kind: g.kind, text: g.text, source: 'global' })
    const root = join(this.opts.home, 'projects')
    if (existsSync(root)) {
      for (const keyDir of readdirSync(root)) {
        const p = join(root, keyDir, 'memory', 'memory.md')
        if (!existsSync(p)) continue
        for (const raw of readFileSync(p, 'utf8').split('\n')) {
          const { kind, text } = this.parseProjectLine(raw)
          if (text === '' || itemId(kind, text) !== key) continue
          out.push({ id: key, kind, text, source: 'project' })
          break
        }
      }
    }
    return out
  }

  /** 删一条（AC-3）。不存在或已删返回 false */
  remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const item = this.log.semantic.get(id)
      if (!item || item.deletedAt !== null) return false
      await this.log.append(MEMORY_SESSION_ID, [
        { t: 'memory.write', layer: 'L3', op: 'delete', itemId: id, diff: itemDiff('-', item) },
      ])
      return true
    })
  }

  private async embedPending(): Promise<void> {
    if (!this.embed) return
    const todo = this.log.semantic.missingEmbeddings(this.embed.model)
    if (todo.length === 0) return
    const vecs = await this.embed.embedder(todo.map((t) => t.text))
    todo.forEach((t, i) => {
      const v = vecs[i]
      if (v) this.log.semantic.setEmbedding(t.id, v, (this.embed as { model: string }).model)
    })
  }

  // ── Soul ────────────────────────────────────────────────

  get soulPath(): string {
    return join(this.opts.soulDir, 'soul.md')
  }

  private get rejectedPath(): string {
    return join(this.opts.soulDir, '.rejected')
  }

  readSoul(): SoulDoc {
    return parseSoul(existsSync(this.soulPath) ? readFileSync(this.soulPath, 'utf8') : '')
  }

  private writeSoul(doc: SoulDoc): void {
    mkdirSync(this.opts.soulDir, { recursive: true })
    const tmp = `${this.soulPath}.tmp`
    writeFileSync(tmp, renderSoul(doc), 'utf8')
    renameSync(tmp, this.soulPath)
  }

  /**
   * 界面里保存的 Soul 全文（PRD-M8-012 AC-5）：和手改文件一样，不落事件——
   * 「人改过的行 domi 不再动」由 ownedLines 按文件内容判断。mtime 不对 → SoulConflictError
   */
  writeText(text: string, mtime?: number): Promise<number> {
    return this.serial(async () => {
      if (mtime !== undefined && existsSync(this.soulPath)) {
        const now = statSync(this.soulPath).mtimeMs
        if (Math.abs(now - mtime) > 1) {
          throw new SoulConflictError()
        }
      }
      mkdirSync(this.opts.soulDir, { recursive: true })
      const tmp = `${this.soulPath}.tmp`
      // 过一遍解析再渲染：人写的内容原样留着，六个固定区补齐（M4-002 AC-1）
      writeFileSync(tmp, renderSoul(parseSoul(text)), 'utf8')
      renameSync(tmp, this.soulPath)
      return statSync(this.soulPath).mtimeMs
    })
  }

  rejected(): string[] {
    if (!existsSync(this.rejectedPath)) return []
    return readFileSync(this.rejectedPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
  }

  private addRejected(texts: readonly string[]): void {
    if (texts.length === 0) return
    mkdirSync(this.opts.soulDir, { recursive: true })
    const head = existsSync(this.rejectedPath)
      ? ''
      : '# 在 domi soul review 里否决过的陈述。domi 不会再把它们写回 Soul；删掉一行即撤销否决\n'
    writeFileSync(this.rejectedPath, head + texts.map((t) => `${t}\n`).join(''), { flag: 'a' })
  }

  /** L4 历史：每批改动与被否决回退的改动 */
  private async l4History(): Promise<{
    updates: Array<{ at: number; changes: SoulChange[] }>
    reviewed: Map<string, 'accept' | 'reject'>
  }> {
    const updates: Array<{ at: number; changes: SoulChange[] }> = []
    const reviewed = new Map<string, 'accept' | 'reject'>()
    for (const e of await this.log.read(MEMORY_SESSION_ID)) {
      const ev = e.ev as {
        t: string
        layer?: string
        op?: string
        changes?: SoulChange[]
        reviews?: Array<{ changeId: string; decision: 'accept' | 'reject' }>
      }
      if (ev.t !== 'memory.write' || ev.layer !== 'L4') continue
      if (ev.op === 'update') updates.push({ at: e.ts, changes: ev.changes ?? [] })
      if (ev.op === 'review') for (const r of ev.reviews ?? []) reviewed.set(r.changeId, r.decision)
    }
    return { updates, reviewed }
  }

  private async owned(): Promise<Set<string>> {
    const { updates, reviewed } = await this.l4History()
    const byId = new Map(updates.flatMap((u) => u.changes.map((c) => [c.id, c] as const)))
    const history: Array<{ changes?: SoulChange[]; reverted?: SoulChange[] }> = updates.map((u) => ({
      changes: u.changes,
    }))
    for (const [id, d] of reviewed) {
      const c = byId.get(id)
      if (d === 'reject' && c) history.push({ reverted: [c] })
    }
    return ownedLines(history)
  }

  private newChangeId(): string {
    this.seq += 1
    return `c-${this.now().toString(36)}-${this.seq}`
  }

  private async recordChanges(changes: ReadonlyArray<Omit<SoulChange, 'id'>>): Promise<SoulChange[]> {
    const withIds = changes.map((c) => ({ ...c, id: this.newChangeId() }))
    if (withIds.length === 0) return []
    await this.log.append(MEMORY_SESSION_ID, [
      { t: 'memory.write', layer: 'L4', op: 'update', changes: withIds, diff: withIds.map(changeDiff).join('\n') },
    ])
    return withIds
  }

  private async updateSoulNow(items: readonly SemanticItem[]): Promise<SoulChange[]> {
    const doc = this.readSoul()
    const rejected = this.rejected()
    const proposal = await this.structured(SoulProposalSchema, soulUpdatePrompt(doc, items, rejected))
    const all = this.log.semantic.list({ limit: 5000 })
    const result = applySoulOps(doc, proposal.ops, {
      owned: await this.owned(),
      rejected,
      validSources: new Set(all.map((i) => i.id)),
    })
    if (result.changes.length === 0) return []
    // 先落事件再写文件：文件写失败，事件里仍有「本来要改什么」，审阅列表不会漏
    const recorded = await this.recordChanges(result.changes)
    this.writeSoul(result.doc)
    return recorded
  }

  /** 用全部现存 L3 条目重新过一遍（`domi soul update`） */
  updateSoul(): Promise<SoulChange[]> {
    return this.serial(async () => {
      const items = this.log.semantic.list({ limit: 200 })
      return items.length === 0 ? [] : this.updateSoulNow(items)
    })
  }

  /** 上次审阅以来的改动（M4-003 AC-2） */
  async pendingChanges(): Promise<PendingChange[]> {
    const { updates, reviewed } = await this.l4History()
    return updates.flatMap((u) =>
      u.changes.filter((c) => !reviewed.has(c.id)).map((c) => ({ ...c, at: u.at, diff: changeDiff(c) })),
    )
  }

  /** 接受或否决一处改动。否决 = 撤回文件里的那一处 + 记进 .rejected（M4-003 AC-3） */
  review(changeId: string, decision: 'accept' | 'reject'): Promise<{ ok: boolean; detail: string }> {
    return this.serial(async () => {
      const pending = await this.pendingChanges()
      const c = pending.find((p) => p.id === changeId)
      if (!c) return { ok: false, detail: `没有待审阅的改动 ${changeId}` }
      let detail = decision === 'accept' ? '已接受' : '已否决'
      if (decision === 'reject') {
        const doc = this.readSoul()
        if (revertChange(doc, c)) this.writeSoul(doc)
        else detail += '（文件里那一行已经被改过，没有自动撤回，请手动处理）'
        this.addRejected([rejectedText(c)].filter(Boolean))
      }
      await this.log.append(MEMORY_SESSION_ID, [
        {
          t: 'memory.write',
          layer: 'L4',
          op: 'review',
          reviews: [{ changeId, decision }],
          diff: `${decision === 'accept' ? '接受' : '否决'} ${changeDiff(c)}`,
        },
      ])
      return { ok: true, detail }
    })
  }

  /** 进提示词的 Soul 文本；空档案时是空串 */
  promptText(projectKey?: string | null): string {
    const soul = this.opts.config.memory.soul ? soulForPrompt(this.readSoul()) : ''
    if (!projectKey) return soul
    const idx = this.projectIndexText(projectKey)
    return idx === ''
      ? soul
      : `${soul}

## 项目记忆（只属于当前项目；全文用 memory.recall 取，键是每行末尾的 recall <key>）
${idx}`
  }

  // ── 项目记忆（PRD-M15-009）────────────────────────────────

  /** 项目记忆正文文件；文件头带 project id 与 root，方便手动迁移 */
  private projectMemoryPathOf(key: string): string {
    return projectMemoryPath(this.opts.home, key)
  }

  /** 索引：每条一行 `[kind] text · recall <key>`，上限 4k token（PRD-M15-009 AC-3） */
  projectIndexText(key: string, maxTokens = 4_000): string {
    const p = this.projectMemoryPathOf(key)
    if (!existsSync(p)) return ''
    const lines: string[] = []
    let tokens = 0
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#')) continue
      const { kind, text } = this.parseProjectLine(line)
      if (text === '') continue
      const idx = `[${kind}] ${text} · recall ${itemId(kind, text)}`
      const t = estimateTextTokens(idx)
      if (tokens + t > maxTokens) break
      lines.push(idx)
      tokens += t
    }
    return lines.join('\n')
  }

  /** 项目 recall：按键直接取正文（AC-3），否则按 query 关键词过滤 */
  projectRecall(key: string, query: string, limit: number): Array<{ key: string; kind: string; text: string }> {
    const p = this.projectMemoryPathOf(key)
    if (!existsSync(p)) return []
    const terms = query
      .split(/[\s，。、\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t !== '')
    const out: Array<{ key: string; kind: string; text: string }> = []
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const { kind, text } = this.parseProjectLine(raw)
      if (text === '') continue
      const itemKey = itemId(kind, text)
      if (itemKey === key) return [{ key: itemKey, kind, text }]
      if (terms.length > 0 && terms.some((t) => text.toLowerCase().includes(t))) {
        out.push({ key: itemKey, kind, text })
        if (out.length >= limit) break
      }
    }
    return out
  }

  /**
   * 追加项目记忆：人可手改 / 删改过的行 domi 不动（按文本去重；文件头写 project id · root）。
   * 可否决同 Soul（INV-09）：把条目从 memory.md 删掉并写进项目 .rejected，domi 不再加回
   */
  appendProjectMemory(key: string, root: string, items: readonly SemanticItem[]): void {
    const p = this.projectMemoryPathOf(key)
    mkdirSync(dirname(p), { recursive: true })
    const existing = new Set(
      existsSync(p)
        ? readFileSync(p, 'utf8')
            .split('\n')
            .map((l) => l.replace(/^[-*]\s*/, '').trim())
            .filter((l) => l !== '')
        : [],
    )
    const rejected = new Set(this.projectRejected(key))
    const head = existsSync(p)
      ? ''
      : `# project id: ${key} · root: ${root}\n# domi 在这个项目里学到的（构建命令、约定、踩过的坑）。每行一条，手改 / 删行即否决：删掉一行并写进同目录 .rejected，domi 不再加回\n`
    const add = items
      .filter((i) => !existing.has(i.text))
      .filter((i) => !rejected.has(normalizeText(i.text)))
      .map((i) => `- [${i.kind}] ${i.text}`)
    if (add.length === 0) return
    writeFileSync(p, head + (existing.size > 0 ? '\n' : '') + add.join('\n') + '\n', { flag: 'a' })
  }

  /** 项目 .rejected：与全局同款，行尾文本去重。写进这里的条目 domi 不再写回项目记忆 */
  private projectRejected(key: string): string[] {
    const p = join(projectMemoryDir(this.opts.home, key), '.rejected')
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
  }

  /** 项目文件行：`- [kind] text`；手改后没 kind 前缀时按 fact 兜底 */
  private parseProjectLine(raw: string): { kind: string; text: string } {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) return { kind: 'fact', text: '' }
    const m = line.match(/^[-*]\s*\[(\w+)\]\s*(.+)$/)
    if (m) return { kind: m[1]!, text: m[2]!.trim() }
    const text = line.replace(/^[-*]\s*/, '').trim()
    return { kind: 'fact', text }
  }

  exportText(): { text: string; findings: ExportFinding[] } {
    const text = exportSoul(this.readSoul())
    return { text, findings: scanForExport(text) }
  }

  planImport(text: string, name: string): ImportPlan[] {
    return planImport(this.readSoul(), text, name)
  }

  applyImport(accepted: readonly ImportPlan[]): Promise<SoulChange[]> {
    return this.serial(async () => {
      const doc = this.readSoul()
      const changes = applyImport(doc, accepted)
      const recorded = await this.recordChanges(changes)
      this.writeSoul(doc)
      return recorded
    })
  }

  close(): void {
    this.log.close()
  }
}
