/**
 * 记忆与 Soul 的编排 —— PRD-M4-001…004 · docs/adr/018 / 019
 *
 * 一个 daemon 一个实例：soul.md 是全局的，两个会话同时更新会互相覆盖，所以这里的写操作**串行**。
 * 逻辑都在 @domi/memory（纯函数），这里只做 IO：读写 soul 目录、调模型、落 memory.write 事件。
 *
 * 所有写入先落事件（_memory 会话），L3 表是事件的投影（store 在同一个事务里投影）；
 * soul.md 是人也会改的文件，所以每次都现读现写，domi 写过什么由 L4 事件记着（INV-09）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Tool } from '@domi/capability'
import type { DomiConfig } from '@domi/config'
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
} from '@domi/memory'
import { createEmbedder, createProvider, generateStructured, type ModelProvider } from '@domi/model'
import type { SemanticItem, SoulChange } from '@domi/protocol'
import { MEMORY_SESSION_ID, SqliteEventLog, type StoredItem } from '@domi/store'
import { type ZodType, z } from 'zod'

export interface MemoryServiceOptions {
  config: DomiConfig
  dbPath: string
  /** ~/.domi/soul */
  soulDir: string
  /** 测试注入；不给就按 config.model 建 */
  provider?: ModelProvider
  /** 测试注入；不给就按 config.memory.embedding 建（没配就没有） */
  embed?: Embedder
  now?: () => number
}

/** 审阅列表里的一项 */
export class SoulConflictError extends Error {
  constructor(message: string) {
    super(message)
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
})

/**
 * L3 的读接口给模型用（PRD-M4-001 AC-3）。和 memory.search 共用一个能力 id：
 * 都是「翻用户的记录」，用户开一条规则就够了
 */
export function makeMemoryRecallTool(memory: MemoryService): Tool<z.infer<typeof MemoryRecallArgs>, unknown> {
  return {
    name: 'memory.recall',
    capability: 'memory.search',
    description:
      '查关于用户的长期记忆（事实、偏好、常提到的人和项目），每条带来源。' +
      '没有相关的就返回空列表——那就当作不知道，不要猜。',
    schema: MemoryRecallArgs,
    async execute(args) {
      const r = await memory.search(args.query, args.limit ?? 8)
      return {
        mode: r.mode === 'keyword' ? '只按关键词匹配（没有配置 embedding）' : '关键词 + 语义',
        items: r.items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, sources: i.sourceRefs })),
      }
    },
  }
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
      const sameProvider = e.provider === opts.config.model.provider
      this.embed = {
        model: `${e.provider}/${e.model}`,
        embedder: createEmbedder({
          provider: e.provider,
          model: e.model,
          apiKey: e.apiKey ?? (sameProvider ? opts.config.model.apiKey : undefined),
          baseUrl: e.baseUrl ?? (sameProvider ? opts.config.model.baseUrl : undefined),
        }),
      }
    }
  }

  private get provider(): ModelProvider {
    if (this.opts.provider) return this.opts.provider
    this.providerCache ??= createProvider({
      provider: this.opts.config.model.provider,
      name: this.opts.config.model.name,
      apiKey: this.opts.config.model.apiKey,
      baseUrl: this.opts.config.model.baseUrl,
      capabilities: this.opts.config.model.capabilities,
    })
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

  /** 一轮结束后调：攒够 extractEvery 轮就抽一次，然后更新 Soul。失败落一条 error，不抛 */
  afterTurn(sessionId: string): Promise<void> {
    const every = this.opts.config.memory.extractEvery
    if (every <= 0 || sessionId.startsWith('_')) return Promise.resolve()
    return this.serial(async () => {
      const view = await this.log.readLineage(sessionId)
      const from = this.log.semantic.extractedSeq(sessionId)
      const turns = view.filter((e) => e.seq > from && e.ev.t === 'user.input').length
      if (turns < every) return
      await this.extractNow(sessionId, view, from)
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
  extract(sessionId: string): Promise<{ added: SemanticItem[]; soul: SoulChange[] }> {
    return this.serial(async () => {
      const view = await this.log.readLineage(sessionId)
      return this.extractNow(sessionId, view, this.log.semantic.extractedSeq(sessionId))
    })
  }

  private async extractNow(
    sessionId: string,
    view: Awaited<ReturnType<SqliteEventLog['readLineage']>>,
    from: number,
  ): Promise<{ added: SemanticItem[]; soul: SoulChange[] }> {
    const slice = view.filter((e) => e.seq > from)
    const last = view.at(-1)?.seq ?? from
    if (slice.length === 0) return { added: [], soul: [] }
    const added = await extractItems({
      sessionId,
      events: slice,
      known: this.log.semantic.list({ limit: 200 }),
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
    const soul = added.length > 0 && this.opts.config.memory.soul ? await this.updateSoulNow(added) : []
    return { added, soul }
  }

  list(opts: { includeDeleted?: boolean } = {}): StoredItem[] {
    return this.log.semantic.list({ ...opts, limit: 1000 })
  }

  async search(query: string, limit = 10): Promise<SemanticSearchResult> {
    return searchSemantic(this.log.semantic, query, { limit, ...(this.embed ? { embed: this.embed } : {}) })
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
          throw new SoulConflictError('Soul 在你打开之后被改过（可能是 domi 刚更新，或者你在别处改了）。刷新看看再保存')
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
  promptText(): string {
    return this.opts.config.memory.soul ? soulForPrompt(this.readSoul()) : ''
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
