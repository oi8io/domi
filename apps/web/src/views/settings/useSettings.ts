/**
 * 设置页的数据（PRD-M8-011 / 012）：config.get 读、config.set 写。
 * 写完重新读一遍——显示的永远是 daemon 那边生效的值，不是页面自己记的。
 */
import type { DomiClient } from '@domi/client-core'
import { useCallback, useEffect, useState } from 'react'

export type Settings = Awaited<ReturnType<DomiClient['getSettings']>>

export function useSettings(client: DomiClient, online: boolean) {
  const [data, setData] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const load = useCallback(() => {
    client.getSettings().then(
      (d) => {
        setData(d)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [client])
  useEffect(() => {
    if (online) load()
  }, [online, load])
  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      try {
        const r = await client.setSettings(patch)
        setError(null)
        setSaved(
          r.restartRequired.length > 0
            ? `已保存。${r.restartRequired.join('、')} 要重启 domid 才生效`
            : '已保存，下一轮生效',
        )
        load()
        return true
      } catch (e) {
        setSaved(null)
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [client, load],
  )
  return { data, error, saved, save, reload: load }
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
