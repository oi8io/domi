/**
 * Markdown 渲染 —— PRD-M11-003（只 Web，TUI 保持纯文本）。
 *
 * 安全（AC-4 / INV-06）：不装 rehype-raw，原文里的 HTML 不渲染成标签；
 * react-markdown 默认 urlTransform 滤掉 javascript: 等危险协议。
 * 代码块保持原生 <pre><code>，浏览器原生可选中复制（AC-3）。
 *
 * 主题适配：排版全部用 token 类（text-ink / bg-panel / border-border / text-accent…），
 * 跟随深浅主题（[data-theme]）与 accent 换色（内联 --accent）；字体走 @theme 的
 * --font-sans（正文）/ --font-mono（代码）。不再依赖手写 .md-body 色板。
 */
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * 各元素的主题化 class。代码块里的 <code> 会先拿到行内样式，
 * 再由 globals.css 的 `.md-body pre code` 覆盖成透明（特异性更高）。
 */
const components: Components = {
  h1: ({ node: _node, ...props }) => (
    <h1 className="mt-[0.9em] mb-[0.4em] text-[1.4em] font-semibold leading-[1.3] text-ink" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h2 className="mt-[0.85em] mb-[0.4em] text-[1.25em] font-semibold leading-[1.3] text-ink" {...props} />
  ),
  h3: ({ node: _node, ...props }) => (
    <h3 className="mt-[0.8em] mb-[0.35em] text-[1.1em] font-semibold leading-[1.3] text-ink" {...props} />
  ),
  h4: ({ node: _node, ...props }) => (
    <h4 className="mt-[0.8em] mb-[0.35em] text-[1em] font-semibold leading-[1.3] text-ink" {...props} />
  ),
  h5: ({ node: _node, ...props }) => (
    <h5 className="mt-[0.75em] mb-[0.3em] text-[0.95em] font-semibold leading-[1.3] text-ink2" {...props} />
  ),
  h6: ({ node: _node, ...props }) => (
    <h6 className="mt-[0.75em] mb-[0.3em] text-[0.9em] font-semibold leading-[1.3] text-ink2" {...props} />
  ),
  p: ({ node: _node, ...props }) => <p className="my-[0.5em] text-ink" {...props} />,
  a: ({ node: _node, ...props }) => <a className="text-accent underline hover:opacity-80" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
  del: ({ node: _node, ...props }) => <del className="text-mut line-through" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-[0.5em] list-disc pl-[1.4em] text-ink" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-[0.5em] list-decimal pl-[1.4em] text-ink" {...props} />,
  li: ({ node: _node, ...props }) => <li className="my-[0.2em]" {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-[0.5em] border-l-[3px] border-accent-b pl-[0.9em] text-ink2" {...props} />
  ),
  code: ({ node: _node, className, ...props }) => (
    <code
      className={`rounded-[4px] bg-panel px-[0.35em] py-[0.15em] font-mono text-[0.88em] text-ink ${className ?? ''}`}
      {...props}
    />
  ),
  pre: ({ node: _node, ...props }) => (
    <pre
      className="my-[0.6em] max-h-[480px] overflow-x-auto rounded-[6px] border border-border2 bg-code p-[0.7em_0.9em] text-[0.85em] leading-[1.5]"
      {...props}
    />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="my-[0.6em] overflow-x-auto">
      <table className="w-full border-collapse text-[0.9em]" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => (
    <th
      className="border border-border bg-panel-h px-[0.7em] py-[0.35em] text-left font-semibold text-ink"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border border-border px-[0.7em] py-[0.35em] text-left text-ink" {...props} />
  ),
  hr: ({ node: _node, ...props }) => <hr className="my-[0.8em] border-t border-border" {...props} />,
  // biome-ignore lint/a11y/useAltText: alt 由 react-markdown 从 `![alt](url)` 透传（...props 带上）
  img: ({ node: _node, ...props }) => <img className="max-w-full rounded-[6px]" {...props} />,
  input: ({ node: _node, ...props }) => <input className="accent-[var(--accent)]" {...props} />,
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
