/**
 * 设置 › 插件 —— PRD-M8-012 AC-6（原型 .plugin-grid），吸收原 PluginPanel.tsx。
 * 卡片列出已装插件、提供的东西与沙箱状态；开关写 config 的 plugins.disabled，daemon 即时生效。
 * 插件的 UI 面板在无同源的沙箱 iframe 里渲染——页面拿不到 cookie、拿不到父页面、连不上 daemon（ADR-022）。
 */

import type { DomiClient } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { Saved } from './fields.tsx'

type List = Awaited<ReturnType<DomiClient['listPlugins']>>
type Plugin = List['plugins'][number]

function tagOf(p: Plugin): string {
  const parts = [`v${p.version}`]
  if (p.tools.length > 0) parts.push(tr('web.plugins.tools', { length: p.tools.length }))
  if (p.skills > 0) parts.push(tr('web.plugins.skills', { skills: p.skills }))
  if (p.mcp.length > 0) parts.push(`MCP · ${p.mcp.join(tr('common.listSep'))}`)
  return parts.join(' · ')
}

export function PluginList({
  list,
  busy,
  onToggle,
  onOpen,
}: {
  list: List
  busy?: string | null
  onToggle?: (plugin: string, enabled: boolean) => void
  onOpen?: (plugin: string, id: string) => void
}) {
  return (
    <div data-part="plugins">
      <p className={cn('mb-3 text-[12.5px]', list.sandbox === 'none' ? 'text-bad' : 'text-mut')}>
        {tr('web.plugins.sandbox', { v: list.sandbox === 'none' ? tr('web.plugins.noSandbox') : list.sandbox })}
      </p>
      {list.plugins.length === 0 && (
        <p className="text-[13px] text-mut">
          {tr('web.plugins.none')}
          <code className="font-mono">{tr('web.plugins.installCmd')}</code>
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {list.plugins.map((p) => {
          const on = p.enabled !== false
          return (
            <div
              key={p.name}
              className="rounded-lg border border-border2 bg-panel px-4 py-3.5 hover:border-border"
              data-plugin={p.name}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-semibold">{p.name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${on ? tr('common.disable') : tr('common.enable')} ${p.name}`}
                  disabled={busy === p.name || onToggle === undefined}
                  onClick={() => onToggle?.(p.name, !on)}
                  className={cn(
                    'shrink-0 rounded-[10px] px-[7px] py-px text-[10.5px] font-semibold',
                    on ? 'bg-ok-d text-ok' : 'bg-border2 text-mut',
                  )}
                  title={on ? tr('web.plugins.clickDisable') : tr('web.plugins.clickEnable')}
                >
                  {on ? tr('common.enabled') : tr('common.notEnabled')}
                </button>
              </div>
              <p className="mt-[3px] mb-2 text-xs text-mut">{p.description}</p>
              <span className="font-mono text-[10.5px] text-mut2">{tagOf(p)}</span>
              {p.ui.length > 0 && on && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.ui.map((u) => (
                    <Button key={u.id} variant="outline" size="xs" onClick={() => onOpen?.(p.name, u.id)}>
                      {u.title}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {list.problems.map((pr) => (
        <p key={pr.name + pr.message} className="mt-2 text-[12.5px] text-bad">
          {pr.message}
        </p>
      ))}
    </div>
  )
}

/** 插件面板：srcdoc + sandbox="allow-scripts"（没有 allow-same-origin） */
export function PluginFrame({ title, html }: { title: string; html: string }) {
  return (
    <iframe
      className="mt-4 h-[420px] w-full rounded-lg border border-border2 bg-white"
      title={title}
      sandbox="allow-scripts"
      srcDoc={html}
    />
  )
}

export function PluginsTab({ client }: { client: DomiClient }) {
  const [list, setList] = useState<List | null>(null)
  const [frame, setFrame] = useState<{ title: string; html: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    client.listPlugins().then(setList, (e: Error) => setError(e.message))
  }, [client])
  useEffect(load, [load])

  const toggle = (name: string, enabled: boolean): void => {
    if (!list) return
    const disabled = list.plugins.filter((p) => (p.name === name ? !enabled : p.enabled === false)).map((p) => p.name)
    setBusy(name)
    setError(null)
    setSaved(null)
    client
      .setSettings({ 'plugins.disabled': disabled })
      .then(
        (r) => {
          setSaved(
            r.restartRequired.length > 0
              ? tr('web.plugins.enabledRestart', { name })
              : tr(enabled ? 'web.plugins.enabledOne' : 'web.plugins.disabledOne', { name }),
          )
          if (!enabled && frame !== null) setFrame(null)
          load()
        },
        (e: Error) => setError(e.message),
      )
      .finally(() => setBusy(null))
  }

  const open = (plugin: string, id: string): void => {
    const title = list?.plugins.find((p) => p.name === plugin)?.ui.find((u) => u.id === id)?.title ?? id
    client.pluginUi(plugin, id).then(
      (html) => setFrame({ title, html }),
      (e: Error) => setError(e.message),
    )
  }

  return (
    <div data-part="plugins-tab">
      <Saved error={error} saved={saved} />
      {list === null ? (
        <p className="text-[13px] text-mut">{tr('common.loading')}</p>
      ) : (
        <PluginList list={list} busy={busy} onToggle={toggle} onOpen={open} />
      )}
      {frame && <PluginFrame {...frame} />}
    </div>
  )
}
