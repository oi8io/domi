/**
 * Markdown 渲染 —— PRD-M11-003 · 排版对齐原型（docs/ui-redesign/index.html）。
 *
 * 排版原则：回复里的 Markdown 是「对话里的一段说明」，不是一篇文档——
 * - 标题压成小阶梯（16 / 15 / 14 / 13px），只比正文大一点，靠字重和细分隔线分层；
 * - 代码块用和工具调用卡片同一套外观：panel 底的窄头（语言 + 复制）+ code-bg 的正文，12px 等宽；
 * - 表格也是卡片：外框 + 表头 panel 底 + 只有横线，宽度跟着内容走，不撑满；
 * - 引用与「思考」同一个样子（左侧 2px 边线 + 次要色）；列表序号 / 圆点用次要色。
 * 全部用 token 类，跟随深浅主题与 accent 换色。
 *
 * 安全（AC-4 / INV-06）：不装 rehype-raw，原文里的 HTML 不渲染成标签；react-markdown 默认 urlTransform 滤掉 javascript: 等。
 * 代码块正文是原生 <pre><code>，可选中复制（AC-3）；复制按钮只是省一步。
 */

import type { SyntaxSpan } from '@domi/client-core/highlight'
import { tr } from '@domi/i18n'
import { Children, isValidElement, type ReactElement, type ReactNode, useEffect, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { IconCheck, IconCopy } from '../icons.tsx'

/** 代码块里的纯文本（复制用）。children 一般就是字符串 */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-mut2 hover:bg-panel-h hover:text-ink2"
      title={tr('web.md.copy')}
      aria-label={tr('web.md.copy')}
      data-action="copy-code"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
    >
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{done ? tr('web.md.copied') : tr('web.md.copy')}</span>
    </button>
  )
}

/**
 * 语法色（PRD-M11-003 AC-9 · ADR-028）：颜色是 globals.css 的 --syn-* 变量，跟深浅主题走。
 * 类名写成字面量，Tailwind 才扫得到
 */
const SYN_CLASS: Record<SyntaxSpan['kind'], string> = {
  plain: '',
  keyword: 'text-[var(--syn-keyword)]',
  string: 'text-[var(--syn-string)]',
  constant: 'text-[var(--syn-constant)]',
  comment: 'text-[var(--syn-comment)] italic',
  title: 'text-[var(--syn-title)]',
  type: 'text-[var(--syn-type)]',
  variable: 'text-[var(--syn-variable)]',
  meta: 'text-[var(--syn-meta)]',
  added: 'text-[var(--syn-added)]',
  removed: 'text-[var(--syn-removed)]',
}

/** 着色后的代码（纯展示，测试直接喂 lines） */
export function HighlightedCode({ lines }: { lines: readonly SyntaxSpan[][] }) {
  return (
    <>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 代码按行展示，顺序不可变
        <span key={i}>
          {i > 0 && '\n'}
          {line.map((s, j) =>
            s.kind === 'plain' ? (
              s.text
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: 同上
              <span key={j} className={SYN_CLASS[s.kind]} data-syn={s.kind}>
                {s.text}
              </span>
            ),
          )}
        </span>
      ))}
    </>
  )
}

/**
 * 按需加载高亮器（不进首屏包）：先按纯文本画，加载好了再换成着色的。
 * 没写语言就不加载、不猜
 */
function useHighlight(code: string, lang: string | undefined): SyntaxSpan[][] | null {
  const [lines, setLines] = useState<SyntaxSpan[][] | null>(null)
  useEffect(() => {
    if (lang === undefined) return
    let live = true
    import('@domi/client-core/highlight').then(
      (m) => {
        if (live) setLines(m.highlightLines(code, lang))
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [code, lang])
  return lines
}

/** 代码块：与工具调用卡片同一套外观（原型 .tool-call / .tool-header / .tool-body） */
function CodeBlock({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children).find((c): c is ReactElement<{ className?: string; children?: ReactNode }> =>
    isValidElement(c),
  )
  const lang = /language-([\w+#.-]+)/.exec(code?.props.className ?? '')?.[1]
  const text = textOf(code?.props.children ?? children).replace(/\n$/, '')
  const lines = useHighlight(text, lang)
  return (
    <div className="my-2.5 overflow-hidden rounded-md border border-border2" data-part="code-block">
      <div className="flex items-center justify-between bg-panel px-3 py-1 font-mono text-[11px] text-mut">
        <span data-lang={lang ?? ''}>{lang ?? tr('web.md.code')}</span>
        <CopyButton text={text} />
      </div>
      <pre className="max-h-[420px] overflow-auto border-t border-border2 bg-code px-3 py-2 font-mono text-[12px] leading-[1.6] text-ink">
        <code>{lines ? <HighlightedCode lines={lines} /> : text}</code>
      </pre>
    </div>
  )
}

const H_BASE = 'font-semibold leading-[1.35] text-ink'

const components: Components = {
  // 标题：小阶梯，h1 / h2 带一条细分隔线——分层靠线和字重，不靠字号
  h1: ({ node: _node, ...props }) => (
    <h1 className={`${H_BASE} mt-[1.1em] mb-[0.5em] border-b border-border2 pb-1 text-[16px]`} {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className={`${H_BASE} mt-[1.1em] mb-[0.5em] border-b border-border2 pb-1 text-[15px]`} {...props} />
  ),
  h3: ({ node: _node, ...props }) => <h3 className={`${H_BASE} mt-[1em] mb-[0.35em] text-[14px]`} {...props} />,
  h4: ({ node: _node, ...props }) => (
    <h4 className="mt-[0.9em] mb-[0.3em] text-[13px] font-semibold leading-[1.35] text-ink2" {...props} />
  ),
  h5: ({ node: _node, ...props }) => (
    <h5 className="mt-[0.9em] mb-[0.3em] text-[13px] font-semibold leading-[1.35] text-mut" {...props} />
  ),
  h6: ({ node: _node, ...props }) => (
    <h6 className="mt-[0.9em] mb-[0.3em] text-[12.5px] font-semibold leading-[1.35] text-mut" {...props} />
  ),
  p: ({ node: _node, ...props }) => <p className="my-[0.55em]" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      className="text-accent underline decoration-accent-b underline-offset-2 hover:decoration-accent"
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
  em: ({ node: _node, ...props }) => <em className="italic text-ink2" {...props} />,
  del: ({ node: _node, ...props }) => <del className="text-mut line-through" {...props} />,
  ul: ({ node: _node, ...props }) => (
    <ul className="my-[0.5em] list-disc pl-[1.3em] marker:text-mut2 [&_ul]:my-0.5 [&_ol]:my-0.5" {...props} />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol
      className="my-[0.5em] list-decimal pl-[1.5em] marker:font-mono marker:text-[12px] marker:text-mut [&_ul]:my-0.5 [&_ol]:my-0.5"
      {...props}
    />
  ),
  li: ({ node: _node, ...props }) => <li className="my-[0.15em] pl-[0.15em]" {...props} />,
  // 引用：与「思考」同一个样子（原型 .thought 的左边线 + 次要色）
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-[0.6em] border-l-2 border-border pl-3 text-mut" {...props} />
  ),
  // 只管行内代码；代码块由 pre → CodeBlock 自己画
  code: ({ node: _node, className, ...props }) => (
    <code
      className={`rounded-[4px] border border-border2 bg-panel px-[0.35em] py-[0.05em] font-mono text-[0.86em] text-ink ${className ?? ''}`}
      {...props}
    />
  ),
  pre: ({ node: _node, children }) => <CodeBlock>{children}</CodeBlock>,
  // 表格：卡片（外框 + 表头 panel 底 + 只有横线），宽度跟着内容
  table: ({ node: _node, ...props }) => (
    <div className="my-2.5 w-fit max-w-full overflow-x-auto rounded-md border border-border2" data-part="md-table">
      <table className="border-collapse text-[13px]" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-panel" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th
      className="border-b border-border2 px-3 py-1.5 text-left text-[12px] font-semibold whitespace-nowrap text-ink2"
      {...props}
    />
  ),
  tr: ({ node: _node, ...props }) => <tr className="border-b border-border2 last:border-b-0" {...props} />,
  td: ({ node: _node, ...props }) => <td className="px-3 py-1.5 align-top text-ink" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="my-[1em] border-t border-border2" {...props} />,
  // biome-ignore lint/a11y/useAltText: alt 由 react-markdown 从 `![alt](url)` 透传（...props 带上）
  img: ({ node: _node, ...props }) => <img className="max-w-full rounded-md border border-border2" {...props} />,
  input: ({ node: _node, ...props }) => <input className="mr-1.5 align-middle accent-[var(--accent)]" {...props} />,
}

export function MarkdownView({ children }: { children: string }) {
  return (
    <div className="md-body text-sm leading-[1.65] break-words text-ink">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
