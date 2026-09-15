/**
 * 插件（PRD-M6-001 / 003）。列出已装的插件与沙箱状态；插件的 UI 面板在无同源的沙箱 iframe 里渲染——
 * 页面拿不到 cookie、拿不到父页面、连不上 daemon（ADR-022）。
 */
import type { DomiClient } from '@domi/client-core'
import { useEffect, useState } from 'react'

type List = Awaited<ReturnType<DomiClient['listPlugins']>>

export function PluginList({ list, onOpen }: { list: List; onOpen?: (plugin: string, id: string) => void }) {
  return (
    <div className="plugins">
      <p className={list.sandbox === 'none' ? 'error' : 'meta'}>
        沙箱：{list.sandbox === 'none' ? '没有（带代码的插件不会运行）' : list.sandbox}
      </p>
      {list.plugins.length === 0 && <p className="empty">还没有安装插件。终端里：domi plugin install &lt;目录&gt;</p>}
      <ul className="plugin-items">
        {list.plugins.map((p) => (
          <li key={p.name}>
            <span className="plugin-name">
              {p.name} <span className="meta">{p.version}</span>
            </span>
            <span className="meta">{p.description}</span>
            <span className="meta">
              工具 {p.tools.length} · skill {p.skills} · MCP {p.mcp.length}
            </span>
            {p.ui.map((u) => (
              <button key={u.id} type="button" onClick={() => onOpen?.(p.name, u.id)}>
                {u.title}
              </button>
            ))}
          </li>
        ))}
      </ul>
      {list.problems.map((pr) => (
        <p key={pr.name + pr.message} className="error">
          {pr.message}
        </p>
      ))}
    </div>
  )
}

/** 插件面板：srcdoc + sandbox="allow-scripts"（没有 allow-same-origin） */
export function PluginFrame({ title, html }: { title: string; html: string }) {
  return <iframe className="plugin-frame" title={title} sandbox="allow-scripts" srcDoc={html} />
}

export function PluginPanel({ client }: { client: DomiClient }) {
  const [list, setList] = useState<List | null>(null)
  const [frame, setFrame] = useState<{ title: string; html: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    client.listPlugins().then(setList, (e: Error) => setNotice(e.message))
  }, [client])

  const open = (plugin: string, id: string): void => {
    const title = list?.plugins.find((p) => p.name === plugin)?.ui.find((u) => u.id === id)?.title ?? id
    client.pluginUi(plugin, id).then(
      (html) => setFrame({ title, html }),
      (e: Error) => setNotice(e.message),
    )
  }

  return (
    <section className="session">
      {notice !== null && <p className="error">{notice}</p>}
      {list && <PluginList list={list} onOpen={open} />}
      {frame && <PluginFrame {...frame} />}
    </section>
  )
}
