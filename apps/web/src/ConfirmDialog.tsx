/**
 * 确认卡 —— 与 TUI 的 ConfirmDialog 同一个立场（PRD-M0-003 · INV-03），样式是原型的内嵌 .perm-prompt（PRD-M8-008 AC-1）：
 * 显示**完整**的待执行内容；默认焦点在「拒绝」上，误按回车不等于同意。
 *
 * 工具要输入时（TASK-M3-016，比如 MCP elicitation）按 JSON Schema 画一个简单表单：
 * 文本、数字、布尔、枚举四种，够 MCP 规范里 elicitation 允许的那几种原始类型。
 */

import { type AskSnapshot, questionsOf } from '@domi/client-core'
import { tr } from '@domi/i18n'
import type { FormEvent, ReactElement } from 'react'
import { Button } from './components/ui/button.tsx'
import { QuestionsDialog } from './QuestionsDialog.tsx'

interface FieldSchema {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  default?: unknown
}

function fieldsOf(schema: unknown): Array<[string, FieldSchema]> {
  const props = (schema as { properties?: Record<string, FieldSchema> } | undefined)?.properties ?? {}
  return Object.entries(props)
}

/** 表单里读出来的都是字符串：按 schema 转回该有的类型；空字符串当作没填 */
export function formValues(schema: unknown, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of fieldsOf(schema)) {
    const v = raw[key]
    if (field.type === 'boolean') {
      out[key] = v === 'on' || v === 'true'
      continue
    }
    if (v === undefined || v === '') continue
    if (field.type === 'integer') out[key] = Number.parseInt(v, 10)
    else if (field.type === 'number') out[key] = Number(v)
    else out[key] = v
  }
  return out
}

function Field({ name, field, required }: { name: string; field: FieldSchema; required: boolean }) {
  const label = field.title ?? name
  const id = `ask-field-${name}`
  let input: ReactElement
  if (field.enum) {
    input = (
      <select
        id={id}
        name={name}
        required={required}
        className="field-input"
        defaultValue={field.default === undefined ? '' : String(field.default)}
      >
        {!required && <option value="">{tr('web.confirm.empty')}</option>}
        {field.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'boolean') {
    input = (
      <input
        id={id}
        type="checkbox"
        name={name}
        className="justify-self-start accent-[var(--accent)]"
        defaultChecked={field.default === true}
      />
    )
  } else if (field.type === 'integer' || field.type === 'number') {
    input = (
      <input
        id={id}
        type="number"
        name={name}
        className="field-input"
        step={field.type === 'integer' ? 1 : 'any'}
        required={required}
        defaultValue={field.default === undefined ? undefined : String(field.default)}
      />
    )
  } else {
    input = (
      <input
        id={id}
        type="text"
        name={name}
        className="field-input"
        required={required}
        defaultValue={field.default === undefined ? undefined : String(field.default)}
      />
    )
  }
  return (
    <div className="grid gap-1">
      <label className="text-xs text-mut" htmlFor={id}>
        {label}
        {required && ' *'}
      </label>
      {input}
      {field.description && <span className="text-xs text-mut">{field.description}</span>}
    </div>
  )
}

const CARD = 'my-2 overflow-hidden rounded-md border border-warn bg-warn-d'
const TITLE = 'px-3.5 pt-2 pb-1 text-[13px] font-semibold text-warn'
const DETAIL =
  'mx-3.5 mb-2 max-h-[40vh] overflow-auto rounded-sm border border-border2 bg-code px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap'
const ACTIONS = 'flex justify-end gap-2 px-3.5 pb-2.5'

export function ConfirmDialog({
  ask,
  onAnswer,
}: {
  ask: AskSnapshot
  /** grant：本会话内始终允许（PRD-M8-016） */
  onAnswer: (allowed: boolean, content?: Record<string, unknown>, grant?: boolean) => void
}) {
  const form = ask.form
  // 问题框（PRD-M12-004 AC-7）：form 带扩展键就画多 tab；key 用 askId，换一次提问就重置状态
  const questions = form ? questionsOf(form.schema) : null
  if (questions) return <QuestionsDialog key={ask.askId ?? ask.detail} questions={questions} onAnswer={onAnswer} />
  if (form) {
    const required = new Set((form.schema as { required?: string[] } | undefined)?.required ?? [])
    // 审批类表单（字段都可选，例如计划审批）：驳回时也把填的意见带上
    const approval = (form.schema as Record<string, unknown> | undefined)?.['x-domi-accept-empty'] === true
    const read = (el: HTMLFormElement): Record<string, unknown> => {
      const raw: Record<string, string> = {}
      new FormData(el).forEach((v, k) => {
        raw[k] = String(v)
      })
      return formValues(form.schema, raw)
    }
    const submit = (e: FormEvent<HTMLFormElement>): void => {
      e.preventDefault()
      onAnswer(true, read(e.currentTarget))
    }
    return (
      <form className={CARD} role="dialog" aria-labelledby="confirm-title" onSubmit={submit}>
        <p id="confirm-title" className={TITLE}>
          {approval ? tr('web.confirm.awaitingApproval') : tr('web.confirm.needsInput')} ·{' '}
          <code className="font-normal">{ask.capabilityId}</code>
        </p>
        <p className="mx-3.5 mb-2 text-[13px] whitespace-pre-wrap">{form.message}</p>
        <div className="mx-3.5 mb-3 grid gap-2.5">
          {fieldsOf(form.schema).map(([name, field]) => (
            <Field key={name} name={name} field={field} required={required.has(name)} />
          ))}
        </div>
        <div className={ACTIONS}>
          <Button
            onClick={(e) => onAnswer(false, approval && e.currentTarget.form ? read(e.currentTarget.form) : undefined)}
          >
            {approval ? tr('web.confirm.reject') : tr('common.deny')}
          </Button>
          <Button type="submit" variant="primary">
            {approval ? tr('web.confirm.approve') : tr('common.submit')}
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className={CARD} role="alertdialog" aria-labelledby="confirm-title">
      <p id="confirm-title" className={TITLE}>
        {tr('web.confirm.permissionRequest')} <code className="font-normal">{ask.capabilityId}</code>
      </p>
      <pre className={DETAIL}>{ask.detail}</pre>
      <div className={ACTIONS}>
        {/* 默认焦点必须在拒绝上，这是 fail-closed 在交互层的延续 */}
        <Button autoFocus onClick={() => onAnswer(false)}>
          {tr('common.deny')}
        </Button>
        {ask.grantable === true && (
          <Button
            onClick={() => onAnswer(true, undefined, true)}
            title={tr('web.confirm.alwaysAllowHint')}
            data-action="grant"
          >
            {tr('web.confirm.alwaysAllow')}
          </Button>
        )}
        <Button variant="primary" onClick={() => onAnswer(true)}>
          {tr('common.allow')}
        </Button>
      </div>
    </div>
  )
}
