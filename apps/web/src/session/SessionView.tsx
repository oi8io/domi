/**
 * 会话视图 —— PRD-M8-008（原型 main#main-session）：tab 条 + 状态栏 pill + Chat / Trajectory + Composer。
 * **只渲染**：状态全在 client-core 的 atom 里（INV-04）。
 */
import { type ConnectionState, type DomiClient, missingCredentialOf, type SessionStore } from '@domi/client-core'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { IconEye, IconTrash } from '../icons.tsx'
import { cn } from '../lib/cn.ts'
import { formatRoute } from '../router.ts'
import { StatusBar } from '../StatusBar.tsx'
import { Transcript } from '../Transcript.tsx'
import { ChangesBar } from './ChangesBar.tsx'
import { Composer, ModelSwitch, ModeToggle, type PendingRef } from './Composer.tsx'
import { CredentialNotice } from './CredentialNotice.tsx'
import { ReviewFindings } from './ReviewFindings.tsx'
import { Trajectory } from './Trajectory.tsx'

export function SessionView({
  client,
  sessionId,
  store,
  title,
  kind,
  project,
  tab = 'chat',
  connection,
  onRenamed,
  onToTask,
  onDeleted,
  onBranched,
  refs = [],
  onRefsChange,
}: {
  client: DomiClient
  sessionId: string
  store: SessionStore
  title?: string | undefined
  kind?: 'chat' | 'task' | undefined
  /** 任务所属的项目（面包屑用） */
  project?: { id: string; name: string } | undefined
  tab?: 'chat' | 'trajectory'
  connection?: ConnectionState
  onRenamed?: () => void
  /** 自由会话才有：打开「转为任务」 */
  onToTask?: (() => void) | undefined
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
  const review = useStore(store.$review)
  const [notice, setNotice] = useState<ReactNode>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // 新内容进来时贴底（用户往上翻了就不打扰）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 条数与询问变化是滚动的触发条件
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
    reportRead()
  }, [items.length, ask])

  // 已读（PRD-M8-009 AC-2）：页面在前台、看到了底，就告诉 daemon 读到了哪；1 秒最多一次
  const lastReport = useRef({ at: 0, seq: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 })
  const reportRead = (): void => {
    const el = scroller.current
    if (!el || document.visibilityState !== 'visible') return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) return
    const r = lastReport.current
    if (r.timer !== 0) return
    const send = (): void => {
      r.timer = 0
      const seq = client.watchedSeq(sessionId)
      if (seq <= r.seq) return
      r.seq = seq
      r.at = Date.now()
      client.markRead(sessionId, seq).catch(() => undefined)
    }
    const wait = Math.max(0, 1000 - (Date.now() - r.at))
    if (wait === 0) send()
    else r.timer = setTimeout(send, wait)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在切会话时挂一次
  useEffect(() => {
    const onVisible = (): void => reportRead()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (lastReport.current.timer !== 0) clearTimeout(lastReport.current.timer)
    }
  }, [sessionId])

  const answer = (allowed: boolean, content?: Record<string, unknown>, grant?: boolean): void => {
    if (!ask?.askId) return
    client.answer(ask.askId, allowed, content, undefined, grant).then(
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
        <SessionTitle
          client={client}
          sessionId={sessionId}
          title={title ?? ''}
          kind={kind}
          project={project}
          onNotice={setNotice}
          {...(onRenamed === undefined ? {} : { onRenamed })}
        />
        {onToTask !== undefined && (
          <Button variant="ghost" size="xs" className="ml-1" onClick={onToTask} data-action="to-task">
            转为任务
          </Button>
        )}
        <SessionTools
          client={client}
          sessionId={sessionId}
          busy={status.busy}
          onNotice={setNotice}
          {...(onDeleted === undefined ? {} : { onDeleted })}
          {...(onBranched === undefined ? {} : { onReview: onBranched })}
        />
      </div>
      <StatusBar status={status} {...(connection === undefined ? {} : { connection })} />
      {status.worktree !== undefined && (
        <ChangesBar client={client} sessionId={sessionId} busy={status.busy} items={items} />
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onScroll={reportRead}>
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
            {review !== null && <ReviewFindings findings={review} />}
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
        placeholder={
          status.busy ? '正在处理上一条…' : '说点什么…  (Enter 发送，Shift+Enter 换行，@ 引用文件，/ 指定技能)'
        }
        tools={{ client, sessionId }}
        onSubmit={(text, extras) =>
          client.submit(sessionId, text, refs, extras).then(
            () => {
              setNotice(null)
              if (refs.length > 0) onRefsChange?.([])
            },
            // SESSION_BUSY 之类的结构化错误原样给人看（PRD-M3-004 AC-3）
            // 缺凭据（OPT-M8-001）换成带链接的那段，指去设置页
            (err: Error) => {
              const provider = missingCredentialOf(err)
              setNotice(provider === null ? err.message : <CredentialNotice provider={provider} />)
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
          provider={status.provider}
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

/** 面包屑 + 可改的标题（PRD-M8-008 AC-4）：任务显示「项目 › 标题」，会话显示「会话 › 标题」 */
function SessionTitle({
  client,
  sessionId,
  title,
  kind,
  project,
  onNotice,
  onRenamed,
}: {
  client: DomiClient
  sessionId: string
  title: string
  kind?: 'chat' | 'task' | undefined
  project?: { id: string; name: string } | undefined
  onNotice: (m: string | null) => void
  onRenamed?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const save = (): void => {
    setEditing(false)
    const t = value.trim()
    if (t === '' || t === title) return
    client.renameSession(sessionId, t).then(
      () => {
        onNotice(null)
        onRenamed?.()
      },
      (e: Error) => onNotice(e.message),
    )
  }
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1.5 pl-4 text-[12.5px]" data-part="session-title">
      {project !== undefined ? (
        <a href={formatRoute({ view: 'project', id: project.id })} className="shrink-0 text-accent hover:underline">
          {project.name}
        </a>
      ) : (
        kind === 'chat' && <span className="shrink-0 text-mut">会话</span>
      )}
      {(project !== undefined || kind === 'chat') && <span className="text-mut2">›</span>}
      {editing ? (
        <input
          className="field-input w-56 py-0.5 text-[12.5px]"
          value={value}
          aria-label="会话标题"
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          // biome-ignore lint/a11y/noAutofocus: 点了改名就该直接能打字
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="min-w-0 truncate rounded-sm px-1 text-ink2 hover:bg-panel-h"
          title="点击改名"
          onClick={() => {
            setValue(title)
            setEditing(true)
          }}
        >
          {title === '' ? '未命名' : title}
        </button>
      )}
    </span>
  )
}

/**
 * 输入框（原型 .composer）：多行输入 + 底部工具栏。Enter 发送、Shift+Enter 换行，输入法组合中不发送。
 * 「文件」「技能」要等 PRD-M8-010 的接口，先占位。
 */
/**
 * 会话级操作：删除要点两下——第一下变成「确认删除」，防手滑（软删除，可以在全部会话里恢复）。
 */
export function SessionTools({
  client,
  sessionId,
  busy,
  onNotice,
  onDeleted,
  onReview,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  onNotice: (msg: string | null) => void
  onDeleted?: () => void
  /** 审阅会话建好了，交给上层打开它（PRD-M7-010） */
  onReview?: (sessionId: string) => void
}) {
  const [armed, setArmed] = useState(false)
  const review = (): void => {
    client.startReview({ fromSessionId: sessionId }).then(
      (id) => {
        onNotice(null)
        onReview?.(id)
      },
      (err: Error) => onNotice(err.message),
    )
  }
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
      {onReview !== undefined && (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={review}
          data-action="review"
          title="派一个只读的审阅者，对照需求审这个会话目录里的未提交改动（看不到对话历史）"
        >
          <IconEye size={12} />
          审阅改动
        </Button>
      )}
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

export { Composer, ModelSwitch, ModeToggle } from './Composer.tsx'
