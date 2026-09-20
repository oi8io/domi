/**
 * Markdown 渲染 —— PRD-M11-003（只 Web，TUI 保持纯文本）。
 *
 * 安全（AC-4 / INV-06）：不装 rehype-raw，原文里的 HTML 不渲染成标签；
 * react-markdown 默认 urlTransform 滤掉 javascript: 等危险协议。
 * 代码块保持原生 <pre><code>，浏览器原生可选中复制（AC-3）。
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownView({ children }: { children: string }) {
  return (
    <div className="text-sm leading-[1.65] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}
