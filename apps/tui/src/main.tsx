#!/usr/bin/env bun
/**
 * domi TUI 入口 —— TASK-M0-020 / TASK-M0-021 · M3 起是 daemon 的客户端（TASK-M3-006）
 *
 * INV-02：这个文件负责**接线与按键**，不负责业务。
 * 业务在 domid 里（@domi/daemon → @domi/runtime），这里经 Domi Protocol 连过去；
 * 组件一行没改——它们只认 client-core 的 store。
 *
 * 同一个可执行文件还有第二个角色：`DOMI_INTERNAL_ROLE=daemon` 时就是 domid 本身，
 * 由 connect.ts 在需要时拉起（单二进制里没有别的文件可以跑）。
 *
 * ⚠️ `useInput` 在无 TTY 环境里没法自动验证（见 `docs/adr/001` 退路清单第 1 条）。
 * 它的判定点是在真终端里跑一次 `demos/m0-loop.md`。
 */
import { homedir } from 'node:os'
import { formatOnboarding, type ParsedCli, parseCli, runCommand } from '@domi/cli'
import {
  answerFromKey,
  createSessionStore,
  type DomiClient,
  DomiRpcError,
  focusIdOf,
  questionsContent,
  questionsOf,
  type RefLink,
  reduceQuestions,
  type SessionStore,
} from '@domi/client-core'
import {
  ConfigParseError,
  configPath,
  domiHome,
  loadConfig,
  loadConfigOrThrow,
  MissingCredentialError,
} from '@domi/config'
import { resolveClientToken } from '@domi/daemon'
import { envLocaleHints, type LocaleSetting, resolveLocale, setLocale, tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { Box, render, Text, useApp, useInput } from 'ink'
import { useCallback, useEffect, useState } from 'react'
import { App } from './App.tsx'
import { completeSlash, parseSlash } from './commands.ts'
import { editAction, Prompt } from './components/Prompt.tsx'
import { SlashHints } from './components/SlashHints.tsx'
import { dumpText } from './components/Transcript.tsx'
import { connectChat, connectDaemon } from './connect.ts'
import { isReasonToggle, moveOf, questionKey, routeKey } from './keys.ts'
import { type OverlayState, Overlays } from './overlays/Overlays.tsx'
import { $questions, questionsStateFor } from './questions-state.ts'
import { clearFallback, fallbackMarked, fallbackPath, markFallback } from './render/fallback.ts'
import {
  chooseRenderer,
  createScrollBus,
  isMouseReport,
  MOUSE_OFF,
  MOUSE_ON,
  parseWheel,
  type Renderer,
  scrollKey,
} from './render/viewport.ts'
import { detectMode, makeTheme, ThemeContext, type TuiTheme } from './theme.ts'

const EXIT_CONFIG_ERROR = 2

/** 终端里能直接回答的表单：只有一个布尔字段时，y 就是 true。其它返回 null（去 Web 端填） */
const CHANGE_MARK = { added: '+', modified: '~', deleted: '-', renamed: '>' } as const

export function tuiFormAnswer(schema: unknown): Record<string, unknown> | null {
  if ((schema as Record<string, unknown> | null)?.['x-domi-accept-empty'] === true) return {}
  const props = Object.entries((schema as { properties?: Record<string, { type?: string }> })?.properties ?? {})
  if (props.length === 0) return {}
  if (props.length === 1 && props[0]?.[1].type === 'boolean') return { [props[0][0]]: true }
  return null
}
const EXIT_DAEMON_ERROR = 3

/** `/sessions` 的一行。当前会话打个 * */
export function formatSessionLine(
  s: { id: string; title: string; model: string; eventCount: number; deleted: boolean; parentId?: string | undefined },
  current: string,
): string {
  const tags = [s.parentId === undefined ? '' : tr('tui.tag.branch'), s.deleted ? tr('tui.tag.deleted') : ''].filter(
    Boolean,
  )
  return tr('tui.sessions.row', {
    v: s.id === current ? '*' : ' ',
    id: s.id,
    v2: s.title || tr('common.untitledParen'),
    model: s.model,
    eventCount: s.eventCount,
    v3: tags.length ? ` · ${tags.join(' · ')}` : '',
  })
}
const DAEMON_ROLE_ENV = 'DOMI_INTERNAL_ROLE'

/** 顶栏要的：会话标题与所属项目名（从列表里查；老 daemon 没有项目接口就只显示标题） */
/**
 * Ctrl+O 之后等用户按任意键回来。Ink 在 suspendTerminal 期间已经放开了输入，这里自己开 raw 模式读一个字节。
 * 不是 TTY（理论上 fullscreen 不会走到这）就直接返回
 */
function waitAnyKey(): Promise<void> {
  const stdin = process.stdin
  if (!stdin.isTTY) return Promise.resolve()
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.once('data', () => {
      stdin.setRawMode(wasRaw)
      resolve()
    })
  })
}

async function contextOf(client: DomiClient, sessionId: string): Promise<{ project: string | null; title: string }> {
  const { sessions } = await client.listSessions()
  const row = sessions.find((s) => s.id === sessionId)
  let project: string | null = null
  if (row?.projectId !== undefined) {
    const projects = await client.listProjects({ includeArchived: true, recent: 0 }).catch(() => [])
    project = projects.find((p) => p.id === row.projectId)?.name ?? null
  }
  return { project, title: row?.title ?? '' }
}

export function Root({
  store: initialStore,
  client,
  sessionId: initialSessionId,
  theme: initialTheme,
  renderer = 'classic',
  scrollBus,
  mouse = false,
}: {
  store: SessionStore
  client: DomiClient
  sessionId: string
  theme: TuiTheme
  /** PRD-M9-005：fullscreen / classic */
  renderer?: Renderer
  /** fullscreen 的滚动命令（滚轮在 startChat 里接好，按键在这里接） */
  scrollBus?: ReturnType<typeof createScrollBus>
  /** 开着鼠标上报：倒进回滚区时要先关掉，回来再开 */
  mouse?: boolean
}): React.ReactElement {
  const { exit, suspendTerminal } = useApp()
  // 分支后切到新会话：换一个 store 重新订阅，旧会话在 daemon 里不受影响
  const [{ sessionId, store }, setActive] = useState({ sessionId: initialSessionId, store: initialStore })
  const [notice, setNotice] = useState<string | null>(null)
  // `/ref` 记下的引用，下一句话带上（PRD-M3-005）
  const [pendingRefs, setPendingRefs] = useState<RefLink[]>([])
  const [draft, setDraft] = useState('')
  // 提交到 daemon 回 accepted、再到第一条 busy 通知之间有个空档，这段时间也不许再提交
  const [sending, setSending] = useState(false)
  const status = useStore(store.$status)
  const connection = useStore(client.$state)
  const busy = sending || status.busy
  const [theme, setTheme] = useState(initialTheme)
  const [context, setContext] = useState<{ project: string | null; title: string }>({ project: null, title: '' })
  // 弹层（PRD-M8-015）与 `/` 补全的选中项
  const [overlay, setOverlay] = useState<OverlayState | null>(null)
  // PRD-M10-005 AC-2/AC-3：思考折叠是纯展示态，会话内可反复切换、不持久化
  const [reasonsExpanded, setReasonsExpanded] = useState(false)
  const [slashSel, setSlashSel] = useState(0)
  // `@` 文件补全：候选从 daemon 的 fs.list 来；选过的路径提交时作为 files 带上（PRD-M8-010 AC-2）
  const atQuery = draft.match(/(^|\s)@([^\s@]*)$/)?.[2]
  const [fileHits, setFileHits] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (atQuery === undefined) return
    let stale = false
    const t = setTimeout(() => {
      client.listFiles(sessionId, atQuery, 6).then(
        (r) => {
          if (!stale) setFileHits(r.files)
        },
        () => undefined,
      )
    }, 80)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [client, sessionId, atQuery])
  const slash = atQuery !== undefined ? fileHits.map((f) => ({ name: f })) : completeSlash(draft)

  /** 切到另一个会话：先订阅新的再放掉旧的（id 不存在时 watch 抛错，留在原会话里） */
  const switchTo = useCallback(
    async (id: string): Promise<void> => {
      const { model, provider } = store.$status.get()
      const next = createSessionStore({ model, provider })
      await client.watch(id, next)
      client.unwatch(sessionId)
      setActive({ sessionId: id, store: next })
      setPendingRefs([])
    },
    [client, sessionId, store],
  )

  // 顶栏：切会话时、每一轮结束时（标题可能刚生成）刷新
  // biome-ignore lint/correctness/useExhaustiveDependencies: busy 翻转是刷新的触发条件
  useEffect(() => {
    contextOf(client, sessionId).then(setContext, () => undefined)
  }, [client, sessionId, status.busy])

  // 已读（PRD-M8-009 AC-2）：终端里打开着的会话就是在看，新事件到了就推进；1 秒最多报一次
  const items = useStore(store.$items)
  const lastSeq = items.at(-1)?.seq ?? 0
  useEffect(() => {
    if (lastSeq === 0) return
    const t = setTimeout(() => {
      client.markRead(sessionId, client.watchedSeq(sessionId)).catch(() => undefined)
    }, 1000)
    return () => clearTimeout(t)
  }, [client, sessionId, lastSeq])

  // 主题色存在 daemon（与 Web 共用，PRD-M8-001 AC-5）；连远程时以对面的为准
  useEffect(() => {
    client.getSettings().then(
      (d) => {
        const a = d.values['ui.accent']
        if (typeof a === 'string') setTheme(makeTheme({ mode: initialTheme.mode, accent: a, env: process.env }))
      },
      () => undefined,
    )
  }, [client, initialTheme])

  const quit = useCallback(() => {
    // 只断开这个客户端。任务在 domid 里照常跑完——M3 DoD 要的就是这个
    client.close()
    exit()
  }, [client, exit])

  /**
   * Ctrl+O（PRD-M9-005 AC-4）：把完整对话按 classic 的样子写进终端原生回滚区——离开备用屏、写、等任意键、回来。
   * 这时终端自带的搜索与选择复制都能用；Ink 的 suspendTerminal 负责离开 / 回到备用屏并整屏重画
   */
  const dump = useCallback(() => {
    const text = dumpText(store.$items.get(), process.stdout.columns ?? 80, theme)
    void suspendTerminal(async () => {
      if (mouse) process.stdout.write(MOUSE_OFF)
      process.stdout.write(text)
      await waitAnyKey()
      if (mouse) process.stdout.write(MOUSE_ON)
    })
  }, [store, theme, suspendTerminal, mouse])

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      quit()
      return
    }
    // 鼠标上报（滚轮在 startChat 里处理）不能当文字打进输入框
    if (isMouseReport(input)) return
    if (renderer === 'fullscreen') {
      const cmd = scrollKey(key)
      if (cmd !== null) {
        scrollBus?.emit(cmd)
        return
      }
      if (key.ctrl && input === 'o') {
        dump()
        return
      }
    }

    // 焦点在确认框时，按键只喂给确认框——别让用户以为自己在打字
    const ask = store.$ask.get()
    if (focusIdOf(ask) === 'domi-confirm') {
      // 问题框（PRD-M12-004 AC-7）：按键交给问题框的状态机，别当成 y / n
      const qs = ask?.form ? questionsOf(ask.form.schema) : null
      if (qs && ask?.askId) {
        const cur = questionsStateFor(ask.askId, qs)
        const k = questionKey(input, key, { editing: cur.editing, onReview: cur.tab >= qs.length })
        if (k?.kind === 'decline') void client.answer(ask.askId, false).catch(() => undefined)
        else if (k?.kind === 'submit')
          void client
            .answer(ask.askId, true, questionsContent(qs, cur) as unknown as Record<string, unknown>)
            .catch(() => undefined)
        else if (k?.kind === 'act') $questions.set({ askId: ask.askId, state: reduceQuestions(qs, cur, k.action) })
        return
      }
      // a = 本会话始终允许（PRD-M8-016）：只在这次询问可以授权时生效
      if (input.toLowerCase() === 'a' && !key.ctrl && ask?.grantable === true && ask.askId) {
        void client.answer(ask.askId, true, undefined, undefined, true).catch(() => undefined)
        return
      }
      const answer = answerFromKey(input, key)
      if (answer === null || !ask?.askId) return
      // 表单型询问：终端里只接得住「一个布尔字段」这种；其余的 y 不生效，得去 Web 端填（n 照样能拒绝）
      const content = answer && ask.form ? tuiFormAnswer(ask.form.schema) : undefined
      if (answer && ask.form && content === null) return
      // 不在这里关框：等 daemon 的 askDone，和别的客户端走同一条路
      void client.answer(ask.askId, answer, content ?? undefined).catch(() => undefined)
      return
    }

    // 弹层：单键 / Ctrl 键开关；打开时按键归弹层自己
    const route = routeKey(input, key, { inputEmpty: draft === '', overlay: overlay?.id ?? null })
    if (route !== null) {
      setOverlay(route.kind === 'open' ? { id: route.overlay } : null)
      return
    }
    if (overlay !== null) return

    // PRD-M10-005 AC-2：e 在输入框空时切换思考折叠（不占滚动键；滚动键是 PgUp/PgDn/Ctrl+Home/End）
    if (isReasonToggle(input, key, draft === '')) {
      setReasonsExpanded((x) => !x)
      return
    }

    // `/` 补全：Tab 补上选中的命令，↑↓ 换候选
    if (slash.length > 0) {
      const cur = Math.min(slashSel, slash.length - 1)
      if (key.tab) {
        const c = slash[cur]
        if (c && atQuery !== undefined) {
          setDraft(`${draft.slice(0, draft.length - atQuery.length)}${c.name} `)
          setPicked((xs) => (xs.includes(c.name) ? xs : [...xs, c.name]))
        } else if (c) {
          setDraft('args' in c && c.args !== undefined ? `${c.name} ` : c.name)
        }
        setSlashSel(0)
        return
      }
      const d = moveOf(input, key)
      if (d !== 0 && !key.ctrl) {
        setSlashSel((cur + d + slash.length) % slash.length)
        return
      }
    }

    if (busy) return
    const edit = editAction(input, key)
    if (edit === null) return
    if (edit.kind === 'newline') {
      setDraft((d) => `${d}\n`)
      return
    }
    if (edit.kind === 'submit') {
      const text = draft.trim()
      if (text === '') return
      setDraft('')
      setSending(true)
      setNotice(null)
      const cmd = parseSlash(text, store.$items.get().at(-1)?.seq ?? 0)
      const run = (async (): Promise<unknown> => {
        switch (cmd.kind) {
          case 'invalid':
            setNotice(cmd.message)
            return
          case 'compact':
            return client.request('session.compact', { sessionId })
          case 'model-picker':
            setOverlay({ id: 'models' })
            return
          case 'settings':
            setOverlay({ id: 'settings' }) // PRD-M10-004 AC-1
            return
          case 'model':
            // 好几家都有这个名字：打开模型列表让人选（错误信息里列着候选）
            return client.switchModel(sessionId, cmd.model).catch((e: unknown) => {
              if (e instanceof DomiRpcError && e.data?.reason === 'AMBIGUOUS') setOverlay({ id: 'models' })
              throw e
            })
          case 'budget':
            await client.setBudget(sessionId, cmd.budget)
            setNotice(tr('tui.budget.set'))
            return
          case 'changes': {
            const d = await client.worktreeDiff(sessionId)
            if (cmd.path !== undefined) {
              const f = d.files.find((x) => x.path === cmd.path)
              setNotice(f ? f.patch || tr('web.changes.binary') : tr('tui.changes.noneFor', { path: cmd.path }))
              return
            }
            setNotice(
              d.files.length === 0
                ? tr('tui.changes.none', { branch: d.branch })
                : [
                    tr('tui.changes.header', { branch: d.branch, slice: d.base.slice(0, 8) }),
                    ...d.files.map((f) => `  ${CHANGE_MARK[f.status]} ${f.path}`),
                  ].join('\n'),
            )
            return
          }
          case 'discard': {
            const trash = await client.discardChange(sessionId, cmd.path)
            setNotice(tr('tui.changes.discarded', { path: cmd.path, trash }))
            return
          }
          case 'undo': {
            const path = await client.restoreChange(sessionId, cmd.trash)
            setNotice(tr('tui.changes.restored', { path }))
            return
          }
          case 'apply': {
            const r = await client.applyChanges(sessionId, cmd.mode)
            setNotice(r.message)
            return
          }
          case 'permissions-mode': {
            const changed = await client.setPermissionsMode(sessionId, cmd.mode)
            if (!changed) setNotice(tr('tui.mode.alreadyPermissionsMode'))
            else setNotice(tr('tui.mode.permissionsModeSet', { mode: cmd.mode }))
            return
          }
          case 'branch': {
            const id = await client.branchSession(sessionId, cmd.atSeq)
            const { model, provider } = store.$status.get()
            const next = createSessionStore({ model, provider })
            client.unwatch(sessionId)
            await client.watch(id, next)
            setActive({ sessionId: id, store: next })
            setNotice(tr('tui.branch.switched', { id, atSeq: cmd.atSeq }))
            return
          }
          case 'ref': {
            const next = [...pendingRefs, cmd.ref]
            setPendingRefs(next)
            setNotice(tr('tui.ref.pending', { length: next.length, sessionId: cmd.ref.sessionId }))
            return
          }
          case 'sessions': {
            const { sessions } = await client.listSessions({ includeDeleted: cmd.includeDeleted })
            setNotice(
              sessions.length === 0
                ? tr('web.sidebar.noChats')
                : sessions.map((s) => formatSessionLine(s, sessionId)).join('\n'),
            )
            return
          }
          case 'open':
          case 'new': {
            const id = cmd.kind === 'new' ? await client.createSession(process.cwd()) : cmd.sessionId
            if (id === sessionId) return
            await switchTo(id)
            setNotice(tr('tui.session.switched', { id }))
            return
          }
          case 'delete': {
            await client.deleteSession(cmd.sessionId)
            // 删的是自己：换一个新会话接着用，不留在一个已删除的会话里
            if (cmd.sessionId === sessionId) {
              const id = await client.createSession(process.cwd())
              const { model, provider } = store.$status.get()
              const next = createSessionStore({ model, provider })
              await client.watch(id, next)
              client.unwatch(sessionId)
              setActive({ sessionId: id, store: next })
            }
            setNotice(tr('tui.session.deleted', { sessionId: cmd.sessionId, sessionId2: cmd.sessionId }))
            return
          }
          case 'restore':
            await client.restoreSession(cmd.sessionId)
            setNotice(tr('tui.session.restored', { sessionId: cmd.sessionId, sessionId2: cmd.sessionId }))
            return
          case 'soul': {
            const [{ path }, changes] = await Promise.all([client.getSoul(), client.soulChanges()])
            setNotice(
              changes.length === 0
                ? tr('tui.soul.noPending', { path })
                : [
                    tr('tui.soul.pending', { length: changes.length }),
                    ...changes.map((c) => `${c.id}\n${c.diff}`),
                  ].join('\n'),
            )
            return
          }
          case 'soul-review': {
            const r = await client.reviewSoul(cmd.changeId, cmd.decision)
            setNotice(r.detail)
            return
          }
          case 'memory': {
            const r =
              cmd.query === ''
                ? { mode: 'keyword', items: (await client.listMemory()).items }
                : await client.searchMemory(cmd.query)
            setNotice(
              r.items.length === 0
                ? tr('tui.memory.none')
                : r.items.map((i) => `${i.id}  [${i.kind}] ${i.text}`).join('\n'),
            )
            return
          }
          case 'extract': {
            const r = await client.extractMemory(sessionId)
            setNotice(tr('tui.memory.extracted', { length: r.added.length, length2: r.soulChanges.length }))
            return
          }
          case 'submit': {
            // 输入里还留着的、补全选过的 @路径 → 文件引用
            const files = [...cmd.text.matchAll(/(?:^|\s)@(\S+)/g)]
              .map((m) => m[1] as string)
              .filter((f) => picked.includes(f))
            const r = await client.submit(sessionId, cmd.text, pendingRefs, files.length > 0 ? { files } : {})
            setPendingRefs([])
            setPicked([])
            return r
          }
        }
      })()
      // SESSION_BUSY、越界之类的结构化错误原样给人看（PRD-M3-004 AC-3）
      void run
        .catch((e: unknown) => setNotice(e instanceof Error ? e.message : String(e)))
        .finally(() => setSending(false))
      return
    }
    setSlashSel(0)
    if (edit.kind === 'backspace') {
      setDraft((d) => d.slice(0, -1))
      return
    }
    setDraft((d) => d + edit.text)
  })

  const overlayView =
    overlay === null ? null : (
      <Overlays
        client={client}
        state={overlay}
        sessionId={sessionId}
        currentModel={{ provider: status.provider, name: status.model }}
        onChange={setOverlay}
        onOpenSession={(id) => {
          switchTo(id).then(
            () => setNotice(null),
            (e: unknown) => setNotice(e instanceof Error ? e.message : String(e)),
          )
        }}
      />
    )

  return (
    <ThemeContext.Provider value={theme}>
      <App
        store={store}
        context={context}
        connection={connection}
        overlay={overlayView}
        renderer={renderer}
        scrollBus={scrollBus}
        reasonsExpanded={reasonsExpanded}
      >
        {notice !== null && <Text dimColor>{notice}</Text>}
        {/* 上下两条横线，不闭合（PRD-M9-005 AC-6） */}
        <Box borderStyle="single" borderLeft={false} borderRight={false} borderDimColor>
          <Prompt value={draft} disabled={busy} />
        </Box>
        <SlashHints
          items={slash}
          wide={atQuery !== undefined}
          selected={Math.min(slashSel, Math.max(slash.length - 1, 0))}
        />
      </App>
    </ThemeContext.Provider>
  )
}

function localeSetting(): LocaleSetting {
  try {
    return loadConfig().ui.locale
  } catch {
    return 'auto'
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (process.env[DAEMON_ROLE_ENV] === 'daemon') {
    // 动态 import：普通的 domi 命令不必加载 daemon 那一整套
    const { runDaemon } = await import('@domi/daemon')
    const code = await runDaemon()
    if (code !== 0) process.exit(code)
    return
  }

  // 界面语言（PRD-M9-004 AC-1）：配置里的 ui.locale，auto 时跟 LC_ALL / LC_MESSAGES / LANG。
  // 在输出任何东西之前定下来；配置读不了就先按环境变量，读配置的报错留给后面正经报
  setLocale(resolveLocale(localeSetting(), envLocaleHints(process.env)))

  const io = {
    out: (t: string) => {
      process.stdout.write(`${t}\n`)
    },
    err: (t: string) => {
      process.stderr.write(`${t}\n`)
    },
    // 只有真终端才给「问人」的能力：管道里跑的 domi soul import 应该失败，而不是读到 EOF 当成回答
    ...(process.stdin.isTTY
      ? {
          ask: async (q: string): Promise<string> => {
            const { createInterface } = await import('node:readline/promises')
            const rl = createInterface({ input: process.stdin, output: process.stdout })
            try {
              return await rl.question(q)
            } finally {
              rl.close()
            }
          },
        }
      : {}),
  }

  let cli: ParsedCli
  try {
    cli = parseCli(argv)
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e))
    process.exit(2)
  }

  // 要连 domid 的命令：接线在端上（和对话同一条路）
  if (!cli.flags.help && (cli.command === 'task' || cli.command === 'bridge' || cli.command === 'review')) {
    process.exit(await runDaemonCommand(cli, io))
  }

  // 非交互命令走 CLI 分发，不启动 Ink —— 它们要能被管道和脚本用
  if (cli.command !== 'chat' || cli.flags.help || cli.flags.version) {
    process.exit(await runCommand(cli, io))
  }

  return startChat(cli.flags.connect, {
    isolate: cli.flags.isolate,
    chat: cli.flags.chat,
    ...(cli.flags.inProject === undefined ? {} : { inProject: cli.flags.inProject }),
  })
}

async function runDaemonCommand(cli: ParsedCli, io: { out(s: string): void; err(s: string): void }): Promise<number> {
  const config = cli.flags.connect === undefined ? loadConfigOrThrow() : loadConfig()
  const home = process.env.HOME || homedir()
  if (cli.command === 'bridge') {
    const { runBridgeCommand } = await import('./bridge-cli.ts')
    return runBridgeCommand(cli.sub, io, {
      config,
      home,
      ...(cli.flags.connect === undefined ? {} : { connect: cli.flags.connect }),
    })
  }
  const token = resolveClientToken({ config, env: process.env, home })
  try {
    const { client } = await connectDaemon({
      home,
      cwd: process.cwd(),
      model: config.model,
      ...(cli.flags.connect === undefined ? {} : { connect: cli.flags.connect }),
      ...(token === undefined ? {} : { token }),
    })
    try {
      if (cli.command === 'review') {
        const { runReviewCommand } = await import('./review-cli.ts')
        // --spec / --base 要原始参数（parseArgs 会把不认识的选项吞掉）
        return await runReviewCommand(cli.rawArgs, io, client, process.cwd())
      }
      const { runTaskCommand } = await import('./task-cli.ts')
      return await runTaskCommand(cli.sub, cli.args, io, client, { follow: cli.flags.follow, cwd: process.cwd() })
    } finally {
      client.close()
    }
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e))
    return 1
  }
}

async function startChat(
  remote: string | undefined,
  where: { isolate: boolean; chat: boolean; inProject?: string } = { isolate: false, chat: false },
): Promise<void> {
  let config: ReturnType<typeof loadConfigOrThrow>
  try {
    // 连远程时模型在对面跑，本机不需要模型凭据
    config = remote === undefined ? loadConfigOrThrow() : loadConfig()
  } catch (e) {
    // PRD-M1-008 AC-3：**第一次运行大概率就走到这里**（还没填凭据）。
    // 只丢一句 error.missing_credential 就等于把新用户扔在门口，
    // 所以把四步清单一起打出来——「五分钟从零到第一次对话」这条路径全程不需要翻文档。
    if (e instanceof MissingCredentialError || e instanceof ConfigParseError) {
      process.stderr.write(`${e.message}\n\n${formatOnboarding()}\n`)
      process.exit(EXIT_CONFIG_ERROR)
    }
    throw e
  }

  const cwd = process.cwd()
  try {
    const home = process.env.HOME || homedir()
    const token = resolveClientToken({ config, env: process.env, home })
    const conn = await connectChat({
      home,
      cwd,
      model: config.model,
      ...(remote === undefined ? {} : { connect: remote }),
      ...(token === undefined ? {} : { token }),
      ...(where.isolate ? { isolate: true } : {}),
      ...(where.chat ? { chat: true } : {}),
      ...(where.inProject === undefined ? {} : { inProject: where.inProject }),
    })
    const theme = makeTheme({
      mode: detectMode(config.tui.theme, process.env),
      accent: config.ui.accent,
      env: process.env,
    })
    // PRD-M9-005 AC-1/5：选渲染器。非 TTY / dumb / 读屏强制 classic；fullscreen 上次首帧前挂过就退回 classic
    const marker = fallbackPath(domiHome({ home }))
    const screenReader = process.env.INK_SCREEN_READER === 'true'
    const picked = chooseRenderer({
      setting: config.tui.renderer,
      env: process.env,
      isTTY: Boolean(process.stdout.isTTY && process.stdin.isTTY),
      screenReader,
      fallbackMarked: fallbackMarked(marker, configPath()),
    })
    if (picked.reason === 'fallback') process.stderr.write(`${tr('tui.renderer.fellBack')}\n`)
    let live: { unmount(): void; restore(): void } | undefined
    const start = (renderer: Renderer) => {
      const fullscreen = renderer === 'fullscreen'
      const mouse = fullscreen && config.tui.mouse
      const scrollBus = createScrollBus()
      const onData = (data: Buffer | string) => {
        for (const dir of parseWheel(data.toString())) scrollBus.emit(dir === 'up' ? 'wheelUp' : 'wheelDown')
      }
      if (fullscreen) markFallback(marker)
      let restored = false
      const restore = () => {
        if (!mouse || restored) return
        restored = true
        process.stdin.off('data', onData)
        process.stdout.write(MOUSE_OFF)
      }
      // 退出（包括异常退出）一定把鼠标上报关掉，不然用户的终端之后点一下就冒一串转义码
      if (mouse) {
        process.stdout.write(MOUSE_ON)
        process.stdin.on('data', onData)
        process.once('exit', restore)
      }
      live = { unmount: () => {}, restore }
      const app = render(
        <Root
          store={conn.store}
          client={conn.client}
          sessionId={conn.sessionId}
          theme={theme}
          renderer={renderer}
          scrollBus={scrollBus}
          mouse={mouse}
        />,
        // kitty 键盘协议：终端支持时 Shift+Enter 能和 Enter 区分开（PRD-M8-014 AC-5）；不支持的终端上什么都不做
        { kittyKeyboard: { mode: 'auto' }, alternateScreen: fullscreen, isScreenReaderEnabled: screenReader },
      )
      live = { unmount: () => app.unmount(), restore }
      void app.waitUntilExit().finally(restore)
      return app
    }
    if (picked.renderer === 'fullscreen') {
      try {
        const app = start('fullscreen')
        await app.waitUntilRenderFlush()
        clearFallback(marker)
      } catch {
        // 首帧前挂了：标记留着（下次直接 classic），这次也换 classic 接着用
        live?.restore()
        try {
          live?.unmount()
        } catch {
          // 已经坏了的实例，卸不干净也要继续
        }
        process.stderr.write(`${tr('tui.renderer.fellBack')}\n`)
        start('classic')
      }
    } else {
      start('classic')
    }
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(EXIT_DAEMON_ERROR)
  }
}

if (import.meta.main) void main()
