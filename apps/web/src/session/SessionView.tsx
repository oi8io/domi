/**
 * 会话视图 —— PRD-M8-008（原型 main#main-session）：tab 条 + 状态栏 pill + Chat / Trajectory + Composer。
 * **只渲染**：状态全在 client-core 的 atom 里（INV-04）。
 */
import type { ConnectionState, DomiClient, SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ChangesPanel } from '../ChangesPanel.tsx'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { IconPaperclip, IconTrash, IconZap } from '../icons.tsx'
import { cn } from '../lib/cn.ts'
import { type PendingRef, PendingRefs } from '../PendingRefs.tsx'
import { formatRoute } from '../router.ts'
import { StatusBar } from '../StatusBar.tsx'
import { Transcript } from '../Transcript.tsx'
import { Trajectory } from './Trajectory.tsx'

export function SessionView({
  client,
  sessionId,
  store,
  title,
  tab = 'chat',
  connection,
  onDeleted,
  onBranched,
  refs = [],
  onRefsChange,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  title?: string | undefined
  tab?: 'chat' | 'trajectory'
  connection?: ConnectionState
  onDeleted?: () => void
  /** 分支建好了，交给上层去刷新列表并打开它 */
  onBranched?: (sessionId: string) => void
  /** 待发送的引用；发出去之后清空 */
  refs?: readonly PendingRef[]
  onRefsChange?: (refs: PendingRef[]) => void
}) {
  const items = useStore(store.$items)
  const status = useStore(store.$status)
  const ask = useStore(store.$ask)
  const [notice, setNotice] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // 新内容进来时贴底（用户往上翻了就不打扰）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 条数与询问变化是滚动的触发条件
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [items.length, ask])

  const answer = (allowed: boolean, content?: Record<string, unknown>): void => {
    if (!ask?.askId) return
    client.answer(ask.askId, allowed, content).then(
      (applied) => {
        // 没生效 = 别的客户端已经答过了；确认卡会随 askDone 关掉，这里只说明一下
        if (!applied) setNotice('这个询问已经在别处回答过了')
      },
      (err: Error) => setNotice(err.message),
    )
  }

  const branch = (seq: number): void => {
    client.branchSession(sessionId, seq).then(
      (id) => onBranched?.(id),
      (err: Error) => setNotice(err.message),
    )
  }

  const tabCls = (on: boolean): string =>
    cn(
      '-mb-px border-b-2 px-4 py-2.5 text-[13px]',
      on ? 'border-accent font-medium text-accent' : 'border-transparent text-mut hover:text-ink2',
    )

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-view="session">
      <div className="flex shrink-0 items-center border-b border-border2 px-5">
        <a href={formatRoute({ view: 'session', id: sessionId, tab: 'chat' })} className={tabCls(tab === 'chat')}>
          Chat
        </a>
        <a
          href={formatRoute({ view: 'session', id: sessionId, tab: 'trajectory' })}
          className={tabCls(tab === 'trajectory')}
        >
          Trajectory
        </a>
        <span className="ml-auto min-w-0 truncate pl-4 text-[12.5px] text-mut" title={sessionId}>
          {title}
        </span>
        <SessionTools
          client={client}
          sessionId={sessionId}
          busy={status.busy}
          onNotice={setNotice}
          {...(onDeleted === undefined ? {} : { onDeleted })}
        />
      </div>
      <StatusBar status={status} {...(connection === undefined ? {} : { connection })} />
      {status.worktree !== undefined && (
        <div className="legacy shrink-0 border-b border-border2 px-5 py-1.5">
          <ChangesPanel client={client} sessionId={sessionId} busy={status.busy} items={items} />
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'trajectory' ? (
          <Trajectory items={items} />
        ) : (
          <div className="mx-auto max-w-[860px] px-6 py-5">
            <Transcript
              items={items}
              {...(onBranched === undefined ? {} : { onBranch: branch })}
              {...(onRefsChange === undefined
                ? {}
                : {
                    onQuote: (q) =>
                      onRefsChange([...refs, { sessionId, fromSeq: q.fromSeq, toSeq: q.toSeq, label: q.label }]),
                  })}
            />
            {ask !== null && <ConfirmDialog ask={ask} onAnswer={answer} />}
          </div>
        )}
      </div>
      {tab === 'trajectory' && ask !== null && (
        <div className="shrink-0 px-5">
          <ConfirmDialog ask={ask} onAnswer={answer} />
        </div>
      )}
      <Composer
        busy={status.busy}
        notice={notice}
        refs={refs}
        onRemoveRef={(i) => onRefsChange?.(refs.filter((_, j) => j !== i))}
        placeholder={status.busy ? '正在处理上一条…' : '说点什么…  (Enter 发送，Shift+Enter 换行)'}
        onSubmit={(text) =>
          client.submit(sessionId, text, refs).then(
            () => {
              setNotice(null)
              if (refs.length > 0) onRefsChange?.([])
            },
            // SESSION_BUSY 之类的结构化错误原样给人看（PRD-M3-004 AC-3）
            (err: Error) => {
              setNotice(err.message)
              throw err
            },
          )
        }
      >
        <ModelSwitch
          client={client}
          sessionId={sessionId}
          busy={status.busy}
          current={status.model}
          onNotice={setNotice}
        />
        <ModeToggle
          client={client}
          sessionId={sessionId}
          busy={status.busy}
          mode={status.metrics?.mode ?? 'act'}
          onNotice={setNotice}
        />
      </Composer>
    </section>
  )
}

/**
 * 输入框（原型 .composer）：多行输入 + 底部工具栏。Enter 发送、Shift+Enter 换行，输入法组合中不发送。
 * 「文件」「技能」要等 PRD-M8-010 的接口，先占位。
 */
export function Composer({
  busy,
  notice,
  refs = [],
  onRemoveRef,
  placeholder,
  submitLabel = '发送',
  onSubmit,
  children,
  className,
}: {
  busy: boolean
  notice?: string | null
  refs?: readonly PendingRef[]
  onRemoveRef?: (i: number) => void
  placeholder: string
  submitLabel?: string
  /** 返回的 Promise 成功后清空输入框；失败时保留原文 */
  onSubmit: (text: string) => Promise<unknown>
  children?: React.ReactNode
  className?: string
}) {
  const [text, setText] = useState('')
  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    const t = text.trim()
    if (t === '' || busy) return
    onSubmit(t).then(
      () => setText(''),
      () => undefined,
    )
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <form className={cn('shrink-0 px-5 pb-3.5', className)} onSubmit={submit} data-part="composer">
      {notice !== null && notice !== undefined && <p className="mb-1.5 text-[13px] text-bad">{notice}</p>}
      {onRemoveRef !== undefined && <PendingRefs refs={refs} onRemove={onRemoveRef} />}
      <div className="rounded-lg border border-border bg-panel transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-d)]">
        <textarea
          value={text}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          aria-label="输入"
          className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-2.5 pb-0.5 text-sm text-ink outline-none"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1.5 pb-2">
          <Button variant="ghost" size="xs" disabled title="引用项目文件、上传附件（即将支持）">
            <IconPaperclip size={13} />
            文件
          </Button>
          <Button variant="ghost" size="xs" disabled title="指定技能（即将支持）">
            <IconZap size={13} />
            技能
          </Button>
          <span className="flex-1" />
          {children}
          <Button type="submit" variant="primary" disabled={busy} data-action="send">
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** 计划模式开关（PRD-M7-005）：计划模式下 domi 只读代码，想好方案提交审批，批准后才动手 */
export function ModeToggle({
  client,
  sessionId,
  busy,
  mode,
  onNotice,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  mode: 'plan' | 'act'
  onNotice: (msg: string | null) => void
}) {
  const toggle = (): void => {
    client.setMode(sessionId, mode === 'plan' ? 'act' : 'plan').then(
      () => onNotice(null),
      (err: Error) => onNotice(err.message),
    )
  }
  return (
    <button
      type="button"
      className={cn(
        'rounded-sm border px-2.5 py-1 text-xs font-medium',
        mode === 'plan' ? 'border-info bg-info-d text-info' : 'border-border text-mut hover:text-ink2',
      )}
      data-mode={mode}
      disabled={busy}
      onClick={toggle}
      title="计划模式下 domi 只读代码，想好方案后提交给你审批，批准后才动手"
    >
      {mode === 'plan' ? '计划模式' : '执行模式'}
    </button>
  )
}

/**
 * 切换模型（原型 .ctb-select 的位置）。模型清单接口（PRD-M8-010 AC-5）落地前，点开是一个「名字 [provider]」输入框。
 * 切换成功后 model.switch 事件自己会出现在对话里，这里只显示会失去的能力。
 */
export function ModelSwitch({
  client,
  sessionId,
  busy,
  current,
  onNotice,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  current: string
  onNotice: (msg: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState('')
  const switchModel = (): void => {
    const [name, provider] = model.trim().split(/\s+/)
    if (!name) return
    client.switchModel(sessionId, name, provider).then(
      (lost) => {
        setModel('')
        setOpen(false)
        onNotice(lost.length > 0 ? `已切换。新模型不支持：${lost.join('、')}` : null)
      },
      (err: Error) => onNotice(err.message),
    )
  }
  return (
    <span className="relative">
      <button
        type="button"
        className="rounded-sm border border-border bg-bg2 px-2 py-1 font-mono text-xs text-ink"
        disabled={busy}
        onClick={() => setOpen(!open)}
        title="切换模型"
        aria-expanded={open}
      >
        {current === '' ? '模型' : current} ▾
      </button>
      {open && (
        <span className="absolute right-0 bottom-full z-10 mb-1.5 flex w-72 gap-1.5 rounded-md border border-border bg-bg2 p-2 shadow-pop">
          <input
            className="field-input font-mono text-xs"
            value={model}
            placeholder="切换模型：名字 [provider]"
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                switchModel()
              }
              if (e.key === 'Escape') setOpen(false)
            }}
            disabled={busy}
          />
          <Button variant="primary" disabled={busy || model.trim() === ''} onClick={switchModel}>
            切换
          </Button>
        </span>
      )}
    </span>
  )
}

/**
 * 会话级操作：删除要点两下——第一下变成「确认删除」，防手滑（软删除，可以在全部会话里恢复）。
 */
export function SessionTools({
  client,
  sessionId,
  busy,
  onNotice,
  onDeleted,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  onNotice: (msg: string | null) => void
  onDeleted?: () => void
}) {
  const [armed, setArmed] = useState(false)
  const remove = (): void => {
    if (!armed) {
      setArmed(true)
      return
    }
    client.deleteSession(sessionId).then(
      () => onDeleted?.(),
      (err: Error) => {
        setArmed(false)
        onNotice(err.message)
      },
    )
  }
  return (
    <span className="ml-2 flex items-center gap-1">
      <Button
        variant={armed ? 'armed' : 'ghost'}
        size="xs"
        disabled={busy}
        onClick={remove}
        onBlur={() => setArmed(false)}
        data-action="delete"
        title="删除会话（可在全部会话里恢复）"
      >
        <IconTrash size={12} />
        {armed ? '确认删除' : '删除会话'}
      </Button>
    </span>
  )
}
