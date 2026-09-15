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
  focusIdOf,
  type RefLink,
  type SessionStore,
} from '@domi/client-core'
import { ConfigParseError, loadConfig, loadConfigOrThrow, MissingCredentialError } from '@domi/config'
import { resolveClientToken } from '@domi/daemon'
import { useStore } from '@nanostores/react'
import { Box, render, Text, useApp, useInput } from 'ink'
import { useCallback, useState } from 'react'
import { App } from './App.tsx'
import { parseSlash } from './commands.ts'
import { Prompt } from './components/Prompt.tsx'
import { connectChat } from './connect.ts'

const EXIT_CONFIG_ERROR = 2

/** 终端里能直接回答的表单：只有一个布尔字段时，y 就是 true。其它返回 null（去 Web 端填） */
export function tuiFormAnswer(schema: unknown): Record<string, unknown> | null {
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
  const tags = [s.parentId === undefined ? '' : '分支', s.deleted ? '已删除' : ''].filter(Boolean)
  return `${s.id === current ? '*' : ' '} ${s.id}  ${s.title || '（无标题）'}  ${s.model} · ${s.eventCount} 条${tags.length ? ` · ${tags.join(' · ')}` : ''}`
}
const DAEMON_ROLE_ENV = 'DOMI_INTERNAL_ROLE'

function Root({
  store: initialStore,
  client,
  sessionId: initialSessionId,
}: {
  store: SessionStore
  client: DomiClient
  sessionId: string
}): React.ReactElement {
  const { exit } = useApp()
  // 分支后切到新会话：换一个 store 重新订阅，旧会话在 daemon 里不受影响
  const [{ sessionId, store }, setActive] = useState({ sessionId: initialSessionId, store: initialStore })
  const [notice, setNotice] = useState<string | null>(null)
  // `/ref` 记下的引用，下一句话带上（PRD-M3-005）
  const [pendingRefs, setPendingRefs] = useState<RefLink[]>([])
  const [draft, setDraft] = useState('')
  // 提交到 daemon 回 accepted、再到第一条 busy 通知之间有个空档，这段时间也不许再提交
  const [sending, setSending] = useState(false)
  const status = useStore(store.$status)
  const busy = sending || status.busy

  const quit = useCallback(() => {
    // 只断开这个客户端。任务在 domid 里照常跑完——M3 DoD 要的就是这个
    client.close()
    exit()
  }, [client, exit])

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      quit()
      return
    }

    // 焦点在确认框时，按键只喂给确认框——别让用户以为自己在打字
    const ask = store.$ask.get()
    if (focusIdOf(ask) === 'domi-confirm') {
      const answer = answerFromKey(input, key)
      if (answer === null || !ask?.askId) return
      // 表单型询问：终端里只接得住「一个布尔字段」这种；其余的 y 不生效，得去 Web 端填（n 照样能拒绝）
      const content = answer && ask.form ? tuiFormAnswer(ask.form.schema) : undefined
      if (answer && ask.form && content === null) return
      // 不在这里关框：等 daemon 的 askDone，和别的客户端走同一条路
      void client.answer(ask.askId, answer, content ?? undefined).catch(() => undefined)
      return
    }

    if (busy) return
    if (key.return) {
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
          case 'model':
            return client.switchModel(sessionId, cmd.model, cmd.provider)
          case 'branch': {
            const id = await client.branchSession(sessionId, cmd.atSeq)
            const { model, provider } = store.$status.get()
            const next = createSessionStore({ model, provider })
            client.unwatch(sessionId)
            await client.watch(id, next)
            setActive({ sessionId: id, store: next })
            setNotice(`已切到分支 ${id}（从第 ${cmd.atSeq} 条分出）`)
            return
          }
          case 'ref': {
            const next = [...pendingRefs, cmd.ref]
            setPendingRefs(next)
            setNotice(`下一句话会带上 ${next.length} 段引用（最近一段：会话 ${cmd.ref.sessionId}）`)
            return
          }
          case 'sessions': {
            const { sessions } = await client.listSessions({ includeDeleted: cmd.includeDeleted })
            setNotice(
              sessions.length === 0 ? '还没有会话' : sessions.map((s) => formatSessionLine(s, sessionId)).join('\n'),
            )
            return
          }
          case 'open':
          case 'new': {
            const id = cmd.kind === 'new' ? await client.createSession(process.cwd()) : cmd.sessionId
            if (id === sessionId) return
            const { model, provider } = store.$status.get()
            const next = createSessionStore({ model, provider })
            // 先订阅新的再放掉旧的：id 不存在时 watch 抛错，留在原会话里
            await client.watch(id, next)
            client.unwatch(sessionId)
            setActive({ sessionId: id, store: next })
            setPendingRefs([])
            setNotice(`已切到会话 ${id}`)
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
            setNotice(`已删除会话 ${cmd.sessionId}（事件都还在，/restore ${cmd.sessionId} 可以恢复）`)
            return
          }
          case 'restore':
            await client.restoreSession(cmd.sessionId)
            setNotice(`已恢复会话 ${cmd.sessionId}（/open ${cmd.sessionId} 打开）`)
            return
          case 'submit': {
            const r = await client.submit(sessionId, cmd.text, pendingRefs)
            setPendingRefs([])
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
    if (key.backspace || key.delete) {
      setDraft((d) => d.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) setDraft((d) => d + input)
  })

  return (
    <Box flexDirection="column">
      <App store={store} />
      {notice !== null && <Text dimColor>{notice}</Text>}
      <Prompt value={draft} disabled={busy} />
    </Box>
  )
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (process.env[DAEMON_ROLE_ENV] === 'daemon') {
    // 动态 import：普通的 domi 命令不必加载 daemon 那一整套
    const { runDaemon } = await import('@domi/daemon')
    const code = await runDaemon()
    if (code !== 0) process.exit(code)
    return
  }

  const io = {
    out: (t: string) => {
      process.stdout.write(`${t}\n`)
    },
    err: (t: string) => {
      process.stderr.write(`${t}\n`)
    },
  }

  let cli: ParsedCli
  try {
    cli = parseCli(argv)
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e))
    process.exit(2)
  }

  // 非交互命令走 CLI 分发，不启动 Ink —— 它们要能被管道和脚本用
  if (cli.command !== 'chat' || cli.flags.help || cli.flags.version) {
    process.exit(await runCommand(cli, io))
  }

  return startChat(cli.flags.connect)
}

async function startChat(remote: string | undefined): Promise<void> {
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
    })
    render(<Root store={conn.store} client={conn.client} sessionId={conn.sessionId} />)
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(EXIT_DAEMON_ERROR)
  }
}

if (import.meta.main) void main()
