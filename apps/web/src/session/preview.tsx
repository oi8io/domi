/**
 * 产物预览 —— PRD-M14-007 AC-3 / AC-4（SPEC-M14-007 取舍-2）
 *
 * Markdown 复用 MarkdownView；代码走 client-core highlight；CSV/TSV 前 50 行成表；
 * PDF/图片用 data URL 内嵌；HTML 放进**无同源沙箱 iframe**（sandbox="allow-scripts"，无 allow-same-origin）
 * 并注入 CSP（default-src 'none'）——产物是不可信数据（INV-06），预览不得让本机数据出站（INV-11）。
 */
import type { SyntaxSpan } from '@domi/client-core/highlight'
import { highlightLines } from '@domi/client-core/highlight'
import { tr } from '@domi/i18n'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { MarkdownView } from './MarkdownView.tsx'

export interface ArtifactContent {
  mime: string
  size: number
  text?: string | undefined
  base64?: string | undefined
  truncated: boolean
}

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

const CODE_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  py: 'py',
  go: 'go',
  rs: 'rs',
  sh: 'sh',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  html: 'html',
  sql: 'sql',
}

function CodePreview({ code, lang }: { code: string; lang?: string | undefined }) {
  const [lines, setLines] = useState<SyntaxSpan[][] | null>(null)
  useEffect(() => {
    setLines(lang === undefined || CODE_LANG[lang] === undefined ? null : highlightLines(code, CODE_LANG[lang]!))
  }, [code, lang])
  if (lines === null) {
    return (
      <pre className="max-h-[60vh] overflow-auto rounded-md bg-code-bg p-2 text-xs leading-relaxed text-ink2">
        <code>{code}</code>
      </pre>
    )
  }
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md bg-code-bg p-2 text-xs leading-relaxed">
      <code>
        {lines.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 代码按行展示，顺序不可变
          <span key={i}>
            {row.map((t, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 同一行内 token 位置稳定
              <span key={j} className={SYN_CLASS[t.kind]}>
                {t.text}
              </span>
            ))}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}

function CsvPreview({ text }: { text: string }) {
  const rows = useMemo(() => {
    const sep = text.includes('\t') && !text.includes(',') ? '\t' : ','
    const all = text
      .split('\n')
      .slice(0, 50)
      .map((l) => l.split(sep))
      .filter((r) => r.length > 1 || r[0] !== '')
    return { all, over: text.split('\n').length > 50 }
  }, [text])
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border2">
      <table className="w-full text-left text-xs">
        <tbody>
          {rows.all.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: CSV 行号即稳定展示键
            <tr key={i} className={i % 2 === 1 ? 'bg-panel-h/40' : ''}>
              {r.map((c, j) => (
                <td
                  // biome-ignore lint/suspicious/noArrayIndexKey: 列位置稳定
                  key={j}
                  className="max-w-[28ch] truncate border-b border-border2 px-2 py-1 font-mono text-[10.5px] text-mut"
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.over && <p className="px-2 py-1 text-[10px] text-mut">{tr('web.artifacts.csvMore')}</p>}
    </div>
  )
}

/** HTML 预览：无同源沙箱 iframe + CSP（INV-06 / INV-11）。srcdoc 里注入 meta，禁一切网络出站 */
export function HtmlPreview({ text }: { text: string }) {
  const csp = `default-src 'none'; script-src 'unsafe-inline'; img-src data:; style-src 'unsafe-inline'`
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${text}</body></html>`
  return (
    <iframe
      className="h-[60vh] w-full rounded-md border border-border2 bg-white"
      title={tr('web.artifacts.previewTitle')}
      sandbox="allow-scripts"
      data-part="html-preview"
      srcDoc={srcdoc}
    />
  )
}

export function ArtifactPreview({ path, content }: { path: string; content: ArtifactContent | null }): ReactNode {
  if (content === null) {
    return <p className="p-2 text-xs text-mut">{tr('web.artifacts.loading')}</p>
  }
  const { mime, text, base64, truncated } = content
  if (truncated && text === undefined && base64 === undefined) {
    return <p className="p-2 text-xs text-mut">{tr('web.artifacts.tooBig')}</p>
  }
  if (mime === 'text/markdown' && text !== undefined) {
    return (
      <div className="max-h-[60vh] overflow-auto rounded-md border border-border2 p-2">
        <MarkdownView>{text}</MarkdownView>
      </div>
    )
  }
  if (mime === 'text/html' && text !== undefined) return <HtmlPreview text={text} />
  if (mime === 'text/csv' || mime === 'text/tab-separated-values') {
    if (text === undefined) return null
    return <CsvPreview text={text} />
  }
  if (mime.startsWith('image/') && base64 !== undefined) {
    return (
      <img
        className="max-h-[60vh] max-w-full rounded-md border border-border2"
        alt={path}
        src={`data:${mime};base64,${base64}`}
      />
    )
  }
  if (mime === 'application/pdf' && base64 !== undefined) {
    return (
      <embed
        className="h-[60vh] w-full rounded-md border border-border2"
        type="application/pdf"
        src={`data:application/pdf;base64,${base64}`}
      />
    )
  }
  if (text !== undefined) {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    return <CodePreview code={text} lang={CODE_LANG[ext] !== undefined ? ext : undefined} />
  }
  return <p className="p-2 text-xs text-mut">{tr('web.artifacts.noPreview', { path })}</p>
}
