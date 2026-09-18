/**
 * Composer —— PRD-M8-010（原型 .composer）：多行输入 + 工具栏（文件、技能、模型、模式、发送）。
 * - `@` 或「文件」：从工作目录的文件清单里选（fs.list），作为引用带进这一轮；也能上传 / 粘贴 / 拖进来附件（attachment.put）
 * - `/` 或「技能」：选一个 Skill（skill.list），这一轮强制注入
 * - 待发送的东西以 chip 显示在输入框上方：跨会话引用（PRD-M3-005）、文件、附件、技能
 * 校验都在 daemon：附件太大、模型不支持图片，提交时原样把错误给人看。
 */
import type { DomiClient, RefLink } from '@domi/client-core'
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '../components/ui/button.tsx'
import { IconPaperclip, IconX, IconZap } from '../icons.tsx'
import { cn } from '../lib/cn.ts'

export interface PendingRef extends RefLink {
  /** 给人看的：被引用那一轮的第一句话 */
  label: string
}

export interface ComposerExtras {
  uploads: string[]
  files: string[]
  skills: string[]
}

type Upload = { key: string; name: string; size: number; id?: string; error?: string }
type Skill = Awaited<ReturnType<DomiClient['listSkills']>>[number]
type Pop = { kind: 'files' | 'skills'; query: string /** 从输入框里的 @ / 触发时，触发符的位置 */; at: number | null }

const MAX_ITEMS = 8

function sizeOf(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('读不了这个文件'))
    r.readAsDataURL(file)
  })
}

/** 光标前面是不是在打 `@xxx` 或 `/xxx`（行首或空格之后） */
export function triggerAt(text: string, caret: number): Pop | null {
  const m = text.slice(0, caret).match(/(^|\s)([@/])([^\s@/]*)$/)
  if (!m) return null
  return { kind: m[2] === '@' ? 'files' : 'skills', query: m[3] ?? '', at: caret - (m[3] ?? '').length - 1 }
}

function Chip({
  tone,
  label,
  title,
  onRemove,
}: {
  tone: string
  label: ReactNode
  title?: string | undefined
  onRemove(): void
}) {
  return (
    <li
      className="flex max-w-full items-center gap-1.5 rounded-xl border border-border bg-panel py-0.5 pr-1 pl-2.5 text-xs"
      title={title}
    >
      <span className="text-mut">{tone}</span>
      <span className="max-w-[24em] truncate">{label}</span>
      <button
        type="button"
        className="inline-flex items-center rounded-sm p-0.5 text-mut hover:bg-panel-h hover:text-ink"
        onClick={onRemove}
        title="去掉"
        aria-label="去掉"
      >
        <IconX size={11} />
        <span className="sr-only">去掉</span>
      </button>
    </li>
  )
}

/** 跨会话引用的 chip（原 PendingRefs.tsx） */
export function PendingRefs({ refs, onRemove }: { refs: readonly PendingRef[]; onRemove: (index: number) => void }) {
  if (refs.length === 0) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {refs.map((r, i) => (
        <Chip
          key={`${r.sessionId}#${r.fromSeq}`}
          tone={`引用 ${r.sessionId}`}
          label={r.label}
          onRemove={() => onRemove(i)}
        />
      ))}
    </ul>
  )
}

function Popover({
  pop,
  files,
  skills,
  sel,
  canUpload,
  onQuery,
  onPick,
  onUpload,
  onKey,
}: {
  pop: Pop
  files: string[]
  skills: Skill[]
  sel: number
  canUpload: boolean
  onQuery(q: string): void
  onPick(i: number): void
  onUpload(): void
  onKey(e: KeyboardEvent): void
}) {
  const rows =
    pop.kind === 'files'
      ? files.map((f) => ({ key: f, main: f.slice(f.lastIndexOf('/') + 1), sub: f }))
      : skills.map((s) => ({ key: s.name, main: s.name, sub: s.description }))
  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-1.5 w-[min(420px,100%)] overflow-hidden rounded-md border border-border bg-bg2 shadow-pop"
      data-part={`pop-${pop.kind}`}
    >
      {pop.at === null && (
        <input
          // biome-ignore lint/a11y/noAutofocus: 点工具栏按钮打开时，焦点直接给搜索框
          autoFocus
          className="block w-full border-b border-border2 bg-transparent px-3 py-2 text-[12.5px] text-ink outline-none"
          placeholder={pop.kind === 'files' ? '搜索文件…' : '搜索技能…'}
          value={pop.query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
        />
      )}
      {pop.kind === 'files' && canUpload && (
        <button
          type="button"
          className="flex w-full items-center gap-2 border-b border-border2 px-3 py-1.5 text-left text-[12.5px] text-accent hover:bg-panel-h"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onUpload}
        >
          <IconPaperclip size={12} />
          上传附件…<span className="text-mut2">（也可以直接粘贴或拖进输入框）</span>
        </button>
      )}
      <ul className="max-h-64 overflow-y-auto py-1">
        {rows.length === 0 && (
          <li className="px-3 py-1.5 text-[12.5px] text-mut">
            {pop.kind === 'files' ? '没有匹配的文件' : '没有匹配的技能'}
          </li>
        )}
        {rows.map((r, i) => (
          <li key={r.key}>
            <button
              type="button"
              className={cn(
                'flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12.5px]',
                i === sel ? 'bg-accent-d text-accent' : 'text-ink2 hover:bg-panel-h',
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(i)}
            >
              <span className={cn('shrink-0 font-medium', pop.kind === 'files' && 'font-mono')}>{r.main}</span>
              <span className="min-w-0 truncate text-[11.5px] text-mut2">{r.sub}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-border2 px-3 py-1 text-[11px] text-mut2">↑↓ 选择 · Enter 确定 · Esc 关闭</div>
    </div>
  )
}

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
  tools,
}: {
  busy: boolean
  /** 一句提示；缺凭据时是带链接的那段（CredentialNotice） */
  notice?: ReactNode
  refs?: readonly PendingRef[]
  onRemoveRef?: (i: number) => void
  placeholder: string
  submitLabel?: string
  /** 返回的 Promise 成功后清空输入框与 chip；失败时保留原样 */
  onSubmit: (text: string, extras: ComposerExtras) => Promise<unknown>
  children?: ReactNode
  className?: string
  /**
   * 文件 / 技能的数据源。给了 sessionId 才能引用文件、上传附件（它们挂在会话上）；
   * 只给 client 时只有技能；都不给时两个按钮是灰的
   */
  tools?: { client: DomiClient; sessionId?: string | undefined; hint?: string } | undefined
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [skills, setSkills] = useState<string[]>([])
  const [uploads, setUploads] = useState<Upload[]>([])
  const [pop, setPop] = useState<Pop | null>(null)
  const [sel, setSel] = useState(0)
  const [fileHits, setFileHits] = useState<string[]>([])
  const [skillList, setSkillList] = useState<Skill[] | null>(null)
  const [localNotice, setLocalNotice] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const client = tools?.client
  const sessionId = tools?.sessionId
  const canFiles = client !== undefined && sessionId !== undefined
  const canSkills = client !== undefined
  const popKind = pop?.kind
  const popQuery = pop?.query ?? ''

  // 文件清单按查询现取（daemon 那边做模糊匹配）
  useEffect(() => {
    if (popKind !== 'files' || !client || sessionId === undefined) return
    let stale = false
    const t = setTimeout(() => {
      client.listFiles(sessionId, popQuery, MAX_ITEMS + 4).then(
        (r) => {
          if (!stale) setFileHits(r.files)
        },
        (e: Error) => setLocalNotice(e.message),
      )
    }, 120)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [popKind, popQuery, client, sessionId])

  // 技能清单打开时取一次
  useEffect(() => {
    if (popKind !== 'skills' || !client || skillList !== null) return
    client.listSkills(sessionId).then(setSkillList, (e: Error) => setLocalNotice(e.message))
  }, [popKind, client, sessionId, skillList])

  const q = popQuery.toLowerCase()
  const skillHits = (skillList ?? [])
    .filter((s) => !skills.includes(s.name) && `${s.name} ${s.description}`.toLowerCase().includes(q))
    .slice(0, MAX_ITEMS)
  const shownFiles = fileHits.filter((f) => !files.includes(f)).slice(0, MAX_ITEMS)
  const count = popKind === 'files' ? shownFiles.length : skillHits.length

  const open = (p: Pop | null): void => {
    setPop(p)
    setSel(0)
  }

  const pick = (i: number): void => {
    if (!pop) return
    if (pop.kind === 'files') {
      const f = shownFiles[i]
      if (f) setFiles((xs) => [...xs, f])
    } else {
      const s = skillHits[i]
      if (s) setSkills((xs) => [...xs, s.name])
    }
    // 从输入框触发的：把「@查询」这段字去掉
    if (pop.at !== null) {
      const at = pop.at
      const end = at + 1 + pop.query.length
      setText((t) => t.slice(0, at) + t.slice(end))
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(at, at)
      })
    }
    open(null)
  }

  const upload = (list: FileList | File[]): void => {
    if (!client || sessionId === undefined) return
    for (const file of Array.from(list)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 6)}`
      setUploads((u) => [...u, { key, name: file.name, size: file.size }])
      toBase64(file)
        .then((dataBase64) =>
          client.putAttachment(sessionId, {
            name: file.name,
            mime: file.type || 'application/octet-stream',
            dataBase64,
          }),
        )
        .then(
          (r) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, id: r.id } : x))),
          (e: Error) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: e.message } : x))),
        )
    }
  }

  const pending = uploads.some((u) => u.id === undefined && u.error === undefined)
  const failed = uploads.some((u) => u.error !== undefined)

  const submit = (e?: FormEvent): void => {
    e?.preventDefault()
    const t = text.trim()
    if (t === '' || busy || pending) return
    if (failed) {
      setLocalNotice('有附件没传上去，去掉它再发')
      return
    }
    onSubmit(t, { uploads: uploads.map((u) => u.id as string), files, skills }).then(
      () => {
        setText('')
        setFiles([])
        setSkills([])
        setUploads([])
        setLocalNotice(null)
      },
      () => undefined,
    )
  }

  const popKey = (e: KeyboardEvent): boolean => {
    if (!pop) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (count > 0) setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + count) % count)
      return true
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (count > 0) pick(Math.min(sel, count - 1))
      else open(null)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      open(null)
      if (pop.at === null) area.current?.focus()
      return true
    }
    return false
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (pop !== null && pop.at !== null && popKey(e)) return
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  const onChange = (value: string, caret: number): void => {
    setText(value)
    const t = triggerAt(value, caret)
    if (t && ((t.kind === 'files' && canFiles) || (t.kind === 'skills' && canSkills))) {
      if (pop?.kind !== t.kind || pop.at !== t.at) setSel(0)
      setPop(t)
    } else if (pop !== null && pop.at !== null) {
      setPop(null)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!canFiles || e.clipboardData.files.length === 0) return
    e.preventDefault()
    upload(e.clipboardData.files)
  }
  const onDrop = (e: DragEvent<HTMLFormElement>): void => {
    if (!canFiles || e.dataTransfer.files.length === 0) return
    e.preventDefault()
    upload(e.dataTransfer.files)
  }

  const shownNotice = notice ?? localNotice
  const chips = refs.length + files.length + skills.length + uploads.length
  const disabledHint = tools?.hint ?? '开始之后可以引用文件、上传附件'
  const fromToolbar = (k: Pop['kind']): boolean => pop?.kind === k && pop.at === null

  return (
    <form
      className={cn('shrink-0 px-5 pb-3.5', className)}
      onSubmit={submit}
      onDragOver={(e) => {
        if (canFiles) e.preventDefault()
      }}
      onDrop={onDrop}
      data-part="composer"
    >
      {shownNotice !== null && shownNotice !== undefined && (
        <p className="mb-1.5 text-[13px] text-bad">{shownNotice}</p>
      )}
      {chips > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" data-part="chips">
          {refs.map((r, i) => (
            <Chip
              key={`${r.sessionId}#${r.fromSeq}`}
              tone={`引用 ${r.sessionId}`}
              label={r.label}
              onRemove={() => onRemoveRef?.(i)}
            />
          ))}
          {files.map((f) => (
            <Chip
              key={`f:${f}`}
              tone="文件"
              label={<span className="font-mono">{f}</span>}
              onRemove={() => setFiles((xs) => xs.filter((x) => x !== f))}
            />
          ))}
          {uploads.map((u) => (
            <Chip
              key={u.key}
              tone={u.error !== undefined ? '失败' : u.id === undefined ? '上传中' : '附件'}
              title={u.error}
              label={
                <span className={cn(u.error !== undefined && 'text-bad')}>
                  {u.name} <span className="text-mut2">{sizeOf(u.size)}</span>
                </span>
              }
              onRemove={() => setUploads((xs) => xs.filter((x) => x.key !== u.key))}
            />
          ))}
          {skills.map((s) => (
            <Chip key={`s:${s}`} tone="技能" label={s} onRemove={() => setSkills((xs) => xs.filter((x) => x !== s))} />
          ))}
        </ul>
      )}
      <div className="relative rounded-lg border border-border bg-panel transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-d)]">
        {pop !== null && (
          <Popover
            pop={pop}
            files={shownFiles}
            skills={skillHits}
            sel={Math.min(sel, Math.max(count - 1, 0))}
            canUpload={canFiles}
            onQuery={(query) => {
              setPop({ ...pop, query })
              setSel(0)
            }}
            onPick={pick}
            onUpload={() => {
              open(null)
              picker.current?.click()
            }}
            onKey={(e) => {
              popKey(e)
            }}
          />
        )}
        <textarea
          ref={area}
          value={text}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={() => {
            if (pop !== null && pop.at !== null) setPop(null)
          }}
          aria-label="输入"
          className="block max-h-40 w-full resize-none bg-transparent px-3.5 pt-2.5 pb-0.5 text-sm text-ink outline-none"
        />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) upload(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1.5 pb-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={!canFiles}
            title={canFiles ? '引用工作目录里的文件，或上传附件（也可以输入 @）' : disabledHint}
            className={cn(fromToolbar('files') && 'bg-panel-h text-ink2')}
            onClick={() => open(fromToolbar('files') ? null : { kind: 'files', query: '', at: null })}
            data-action="files"
          >
            <IconPaperclip size={13} />
            文件
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!canSkills}
            title={canSkills ? '这一轮指定一个技能（也可以输入 /）' : disabledHint}
            className={cn(fromToolbar('skills') && 'bg-panel-h text-ink2')}
            onClick={() => open(fromToolbar('skills') ? null : { kind: 'skills', query: '', at: null })}
            data-action="skills"
          >
            <IconZap size={13} />
            技能
          </Button>
          <span className="flex-1" />
          {children}
          <Button type="submit" variant="primary" disabled={busy || pending} data-action="send">
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

type ModelList = Awaited<ReturnType<DomiClient['listModels']>>
const SEP = ''

/**
 * 切换模型（原型 .ctb-select）：选项来自 model.list（已配置的供应商与模型，PRD-M8-010 AC-5）；
 * 清单里没有的选「其他…」手填。切换成功后 model.switch 事件自己会出现在对话里，这里只显示会失去的能力。
 */
export function ModelSwitch({
  client,
  sessionId,
  busy,
  current,
  provider,
  onNotice,
}: {
  client: DomiClient
  sessionId: string
  busy: boolean
  current: string
  provider?: string | undefined
  onNotice: (msg: string | null) => void
}) {
  const [list, setList] = useState<ModelList | null>(null)
  const [custom, setCustom] = useState(false)
  const [model, setModel] = useState('')
  useEffect(() => {
    client.listModels().then(setList, () => setList(null))
  }, [client])

  const switchTo = (name: string, p?: string): void => {
    client.switchModel(sessionId, name, p).then(
      (lost) => {
        setModel('')
        setCustom(false)
        onNotice(lost.length > 0 ? `已切换。新模型不支持：${lost.join('、')}` : null)
      },
      (err: Error) => onNotice(err.message),
    )
  }

  const models = list?.models ?? []
  if (custom || (list !== null && models.length === 0)) {
    return (
      <span className="flex items-center gap-1">
        <input
          className="w-52 rounded-sm border border-border bg-bg2 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
          value={model}
          // biome-ignore lint/a11y/noAutofocus: 选了「其他…」就是要马上输入
          autoFocus={custom}
          placeholder={`${current || '模型名'} [provider]`}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const [name, p] = model.trim().split(/\s+/)
              if (name) switchTo(name, p)
            }
            if (e.key === 'Escape') setCustom(false)
          }}
          disabled={busy}
          aria-label="切换模型"
          title="切换模型：名字 [provider]，回车"
        />
        {custom && (
          <Button variant="ghost" size="xs" onClick={() => setCustom(false)}>
            取消
          </Button>
        )}
      </span>
    )
  }
  // 清单还没到时只有当前这一项
  const here = provider ?? list?.current.provider ?? ''
  const value = `${here}${SEP}${current}`
  const known = models.some((m) => m.name === current && m.provider === here)
  return (
    <select
      className="max-w-56 rounded-sm border border-border bg-bg2 px-2 py-1 font-mono text-xs text-ink"
      disabled={busy}
      value={value}
      title="切换模型"
      aria-label="切换模型"
      onChange={(e) => {
        if (e.target.value === '__custom') {
          setCustom(true)
          return
        }
        const [p, name] = e.target.value.split(SEP)
        if (name && e.target.value !== value) switchTo(name, p)
      }}
    >
      {!known && <option value={value}>{current === '' ? '模型' : current}</option>}
      {models.map((m) => (
        <option key={`${m.provider}/${m.name}`} value={`${m.provider}${SEP}${m.name}`}>
          {m.name}
          {m.provider === here ? '' : ` · ${m.provider}`}
          {m.vision ? '' : ' · 不支持图片'}
        </option>
      ))}
      <option value="__custom">其他…</option>
    </select>
  )
}
