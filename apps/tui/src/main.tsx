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
import { answerFromKey, type DomiClient, focusIdOf, type SessionStore } from '@domi/client-core'
import { ConfigParseError, loadConfigOrThrow, MissingCredentialError } from '@domi/config'
import { useStore } from '@nanostores/react'
import { Box, render, useApp, useInput } from 'ink'
import { useCallback, useState } from 'react'
import { App } from './App.tsx'
import { Prompt } from './components/Prompt.tsx'
import { connectChat } from './connect.ts'

const EXIT_CONFIG_ERROR = 2
const EXIT_DAEMON_ERROR = 3
const DAEMON_ROLE_ENV = 'DOMI_INTERNAL_ROLE'

function Root({
  store,
  client,
  sessionId,
}: {
  store: SessionStore
  client: DomiClient
  sessionId: string
}): React.ReactElement {
  const { exit } = useApp()
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
      // 不在这里关框：等 daemon 的 askDone，和别的客户端走同一条路
      void client.answer(ask.askId, answer).catch(() => undefined)
      return
    }

    if (busy) return
    if (key.return) {
      const text = draft.trim()
      if (text === '') return
      setDraft('')
      setSending(true)
      // 斜杠命令。结果都由事件自己显示在对话里（ctx.compact / model.switch），这里不另塞界面状态
      const [cmd, ...rest] = text.split(/\s+/)
      const run =
        cmd === '/compact'
          ? client.request('session.compact', { sessionId }) // PRD-M2-003 AC-1
          : cmd === '/model' && rest[0]
            ? client.switchModel(sessionId, rest[0], rest[1]) // PRD-M1-002 · parity 第 10 项
            : client.submit(sessionId, text)
      void run.catch(() => undefined).finally(() => setSending(false))
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

  return startChat()
}

async function startChat(): Promise<void> {
  let config: ReturnType<typeof loadConfigOrThrow>
  try {
    config = loadConfigOrThrow()
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
    const conn = await connectChat({ home: homedir(), cwd, model: config.model })
    render(<Root store={conn.store} client={conn.client} sessionId={conn.sessionId} />)
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(EXIT_DAEMON_ERROR)
  }
}

if (import.meta.main) void main()
