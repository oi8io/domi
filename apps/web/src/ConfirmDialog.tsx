/**
 * 确认框 —— 与 TUI 的 ConfirmDialog 同一个立场（PRD-M0-003 · INV-03）：
 * 显示**完整**的待执行内容；默认焦点在「拒绝」上，误按回车不等于同意。
 *
 * 工具要输入时（TASK-M3-016，比如 MCP elicitation）按 JSON Schema 画一个简单表单：
 * 文本、数字、布尔、枚举四种，够 MCP 规范里 elicitation 允许的那几种原始类型。
 */
import type { AskSnapshot } from '@domi/client-core'
import type { FormEvent } from 'react'

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
  let input: React.ReactElement
  if (field.enum) {
    input = (
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={field.default === undefined ? '' : String(field.default)}
      >
        {!required && <option value="">（不填）</option>}
        {field.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'boolean') {
    input = <input id={id} type="checkbox" name={name} defaultChecked={field.default === true} />
  } else if (field.type === 'integer' || field.type === 'number') {
    input = (
      <input
        id={id}
        type="number"
        name={name}
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
        required={required}
        defaultValue={field.default === undefined ? undefined : String(field.default)}
      />
    )
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && ' *'}
      </label>
      {input}
      {field.description && <span className="field-hint">{field.description}</span>}
    </div>
  )
}

export function ConfirmDialog({
  ask,
  onAnswer,
}: {
  ask: AskSnapshot
  onAnswer: (allowed: boolean, content?: Record<string, unknown>) => void
}) {
  const form = ask.form
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
      <form className="confirm" role="dialog" aria-labelledby="confirm-title" onSubmit={submit}>
        <p id="confirm-title" className="confirm-title">
          <code>{ask.capabilityId}</code> {approval ? '等你审批' : '需要你提供信息'}
        </p>
        <p className="confirm-message">{form.message}</p>
        <div className="confirm-fields">
          {fieldsOf(form.schema).map(([name, field]) => (
            <Field key={name} name={name} field={field} required={required.has(name)} />
          ))}
        </div>
        <div className="confirm-actions">
          <button
            type="button"
            className="deny"
            onClick={(e) => onAnswer(false, approval && e.currentTarget.form ? read(e.currentTarget.form) : undefined)}
          >
            {approval ? '驳回' : '拒绝'}
          </button>
          <button type="submit" className="allow">
            {approval ? '批准' : '提交'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="confirm" role="alertdialog" aria-labelledby="confirm-title">
      <p id="confirm-title" className="confirm-title">
        domi 想执行 <code>{ask.capabilityId}</code>，需要你确认
      </p>
      <pre className="confirm-detail">{ask.detail}</pre>
      <div className="confirm-actions">
        {/* biome-ignore lint/a11y/noAutofocus: 默认焦点必须在拒绝上，这是 fail-closed 在交互层的延续 */}
        <button type="button" className="deny" autoFocus onClick={() => onAnswer(false)}>
          拒绝
        </button>
        <button type="button" className="allow" onClick={() => onAnswer(true)}>
          允许
        </button>
      </div>
    </div>
  )
}
