/**
 * 会话视图 —— PRD-M8-008（原型 main#main-session）：tab 条 + 状态栏 pill + Chat / Trajectory + Composer。
 * **只渲染**：状态全在 client-core 的 atom 里（INV-04）。
 */

import { type ConnectionState, type DomiClient, missingCredentialOf, type SessionStore } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { IconEye, IconTrash } from '../icons.tsx'
import { cn } from '../lib/cn.ts'
import { NEAR_BOTTOM_PX, nextScrollAction } from '../lib/scroll.ts'
import { formatRoute } from '../router.ts'
import { StatusBar } from '../StatusBar.tsx'
import { Transcript } from '../Transcript.tsx'
import { ChangesBar } from './ChangesBar.tsx'
import { Composer, ModelSwitch, type PendingRef, PermissionsModeSwitch } from './Composer.tsx'
import { CredentialNotice } from './CredentialNotice.tsx'
import { JumpBar } from './JumpBar.tsx'
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
  // PRD-M11-009：窗口化加载——是否还有更早历史、正在向上翻页
  const hasOlder = useStore(store.$hasOlder)
  const loadingOlder = useStore(store.$loadingOlder)
  const [notice, setNotice] = useState<ReactNode>(null)
  const scroller = useRef<HTMLDivElement>(null)
  // PRD-M11-002：用户上翻离开底部后，新内容累计成「N 条新消息」浮条
  const [newCount, setNewCount] = useState(0)
  const awayFromBottom = useRef(false)
  const lastLen = useRef(items.length)

  // 进入/切换会话：重置跟随态（在底部），历史事件灌进来时贴底
  // biome-ignore lint/correctness/useExhaustiveDependencies: 切会话时以当前条数为基准重置，items.length 变化不该再触发重置
  useEffect(() => {
    awayFromBottom.current = false
    setNewCount(0)
    lastLen.current = items.length
  }, [sessionId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容/条数与询问变化是滚动的触发条件（流式逐 token 也在 items 上）
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const action = nextScrollAction({
      awayFromBottom: awayFromBottom.current,
      prevLen: lastLen.current,
      nextLen: items.length,
    })
    if (action.stick) el.scrollTop = el.scrollHeight
    if (action.newCount > 0) setNewCount((n) => n + action.newCount)
    lastLen.current = items.length
    reportRead()
  }, [items, ask])

  // 已读（PRD-M8-009 AC-2）：页面在前台、看到了底，就告诉 daemon 读到了哪；1 秒最多一次
  const lastReport = useRef({ at: 0, seq: 0, timer: 0 as ReturnType<typeof setTimeout> | 0 })
  const reportRead = (): void => {
    const el = scroller.current
    if (!el || document.visibilityState !== 'visible') return
    // PRD-M11-002：距底远近决定浮条；回到底部就清计数
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    if (dist <= NEAR_BOTTOM_PX) {
      awayFromBottom.current = false
      setNewCount(0)
    } else {
      awayFromBottom.current = true
    }
    // PRD-M11-009 AC-2：向上滚到顶（scrollTop < 80px）且还有更早 → 加载一页
    if (el.scrollTop < 80 && hasOlder && !loadingOlder) {
      const prevHeight = el.scrollHeight
      // loadOlder 是 async（网络往返 + prepend）。必须等它 resolve（新事件已落进 $items、
      // React 重渲染、DOM 变高）之后再补 scrollTop——之前在 rAF 里立刻跑，那时 prepend
      // 还没发生，scrollHeight 没变，差值算成 0，scrollTop 被钉死在 0，prepend 完成后
      // 用户看到的是新内容顶部而不是原位置，感觉翻页没效果。
      client
        .loadOlder(sessionId)
        .then(() => {
          requestAnimationFrame(() => {
            const el2 = scroller.current
            if (el2) el2.scrollTop = el2.scrollHeight - prevHeight
          })
        })
        .catch(() => undefined)
    }
    if (dist > 80) return
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

  const jumpToBottom = (): void => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    awayFromBottom.current = false
    setNewCount(0)
  }
  const answer = (allowed: boolean, content?: Record<string, unknown>, grant?: boolean): void => {
    if (!ask?.askId) return
    client.answer(ask.askId, allowed, content, undefined, grant).then(
      (applied) => {
        // 没生效 = 别的客户端已经答过了；确认卡会随 askDone 关掉，这里只说明一下
        if (!applied) setNotice(tr('web.session.answeredElsewhere'))
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
            {tr('web.session.toTask')}
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
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto" onScroll={reportRead}>
          {tab === 'trajectory' ? (
            <Trajectory items={items} />
          ) : (
            <div className="mx-auto max-w-[860px] px-6 py-5">
              {hasOlder && (
                <div className="mb-3 text-center text-xs text-zinc-500">
                  {loadingOlder ? tr('web.session.loadingOlder') : tr('web.session.scrollToTopForMore')}
                </div>
              )}
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
        <JumpBar count={newCount} onClick={jumpToBottom} />
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
        placeholder={status.busy ? tr('web.session.busy') : tr('web.session.placeholder')}
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
        <PermissionsModeSwitch
          client={client}
          sessionId={sessionId}
          busy={status.busy}
          mode={status.metrics?.permissionsMode ?? 'on-demand'}
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
        kind === 'chat' && <span className="shrink-0 text-mut">{tr('web.session.chat')}</span>
      )}
      {(project !== undefined || kind === 'chat') && <span className="text-mut2">›</span>}
      {editing ? (
        <input
          className="field-input w-56 py-0.5 text-[12.5px]"
          value={value}
          aria-label={tr('web.session.title')}
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
          title={tr('web.session.clickRename')}
          onClick={() => {
            setValue(title)
            setEditing(true)
          }}
        >
          {title ?? ''}
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
          title={tr('web.session.reviewHint')}
        >
          <IconEye size={12} />
          {tr('web.session.review')}
        </Button>
      )}
      <Button
        variant={armed ? 'armed' : 'ghost'}
        size="xs"
        disabled={busy}
        onClick={remove}
        onBlur={() => setArmed(false)}
        data-action="delete"
        title={tr('web.session.deleteHint')}
      >
        <IconTrash size={12} />
        {armed ? tr('common.confirmDelete') : tr('web.session.delete')}
      </Button>
    </span>
  )
}

export { Composer, ModelSwitch, PermissionsModeSwitch } from './Composer.tsx'
