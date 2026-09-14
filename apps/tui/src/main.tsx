#!/usr/bin/env bun
/**
 * domi TUI 入口 —— TASK-M0-020 / TASK-M0-021
 *
 * INV-02：这个文件负责**接线与按键**，不负责业务。
 * 业务在 `@domi/runtime` 的 DomiSession 里，M3 拆 daemon 时它整体搬过去，
 * 这里换成协议代理，组件一行不用改。
 *
 * ⚠️ `useInput` 在无 TTY 环境里没法自动验证（见 `docs/adr/001` 退路清单第 1 条）。
 * 它的判定点是在真终端里跑一次 `demos/m0-loop.md`。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { type ParsedCli, parseCli, runCommand } from '@domi/cli'
import { answerFromKey, createSessionStore, focusIdOf, type SessionStore, summarizeArgs } from '@domi/client-core'
import { ConfigParseError, loadConfigOrThrow, MissingCredentialError } from '@domi/config'
import { DomiSession, type PendingAsk } from '@domi/runtime'
import { Box, render, useApp, useInput } from 'ink'
import { useCallback, useRef, useState } from 'react'
import { App } from './App.tsx'
import { Prompt } from './components/Prompt.tsx'

const EXIT_CONFIG_ERROR = 2

function Root({ store, session }: { store: SessionStore; session: DomiSession }): React.ReactElement {
  const { exit } = useApp()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const askRef = useRef<PendingAsk | null>(null)

  const quit = useCallback(() => {
    // PRD-M0-005 AC-3：退出前把事件刷干净，否则最后一轮要靠 WAL 恢复
    void session.flushAndClose().then(() => exit())
  }, [session, exit])

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      quit()
      return
    }

    // 焦点在确认框时，按键只喂给确认框——别让用户以为自己在打字
    if (focusIdOf(store.$ask.get()) === 'domi-confirm') {
      const answer = answerFromKey(input, key)
      if (answer === null) return
      askRef.current?.answer(answer)
      askRef.current = null
      return
    }

    if (busy) return
    if (key.return) {
      const text = draft.trim()
      if (text === '') return
      setDraft('')
      setBusy(true)
      void session.submit(text).finally(() => setBusy(false))
      return
    }
    if (key.backspace || key.delete) {
      setDraft((d) => d.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) setDraft((d) => d + input)
  })

  session.on('onAsk', (ask) => {
    askRef.current = ask
    store.setAsk(ask ? { capabilityId: ask.capabilityId, detail: summarizeArgs(ask.args) } : null)
  })

  return (
    <Box flexDirection="column">
      <App store={store} />
      <Prompt value={draft} disabled={busy} />
    </Box>
  )
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
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

function startChat(): void {
  let config: ReturnType<typeof loadConfigOrThrow>
  try {
    config = loadConfigOrThrow()
  } catch (e) {
    if (e instanceof MissingCredentialError || e instanceof ConfigParseError) {
      process.stderr.write(`${e.message}\n`)
      process.exit(EXIT_CONFIG_ERROR)
    }
    throw e
  }

  const cwd = process.cwd()
  const session = new DomiSession({
    config,
    sessionId: `s-${Date.now()}`,
    cwd,
    dbPath: join(homedir(), '.domi', 'events.db'),
  })
  const store = createSessionStore({ model: config.model.name, provider: config.model.provider })
  session.on('onEvents', (envs) => store.applyEvents(envs))
  session.on('onBusy', (b) => store.setBusy(b))
  session.on('onMetrics', (m) => store.setMetrics(m))

  render(<Root store={store} session={session} />)
}

if (import.meta.main) void main()
