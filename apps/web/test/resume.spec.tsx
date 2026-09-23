/**
 * 续跑条 —— PRD-M12-004 AC-10（提示后一键续跑）。显示条件在 client-core 的 resumeHint
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, resumeHint } from '@domi/client-core'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResumeBar } from '../src/session/ResumeBar.tsx'

function status(plan?: { total: number; remaining: number; interrupted: boolean }, busy = false) {
  const s = createSessionStore({ provider: 'p', model: 'm' })
  s.setMetrics({
    tokens: { input: 1, output: 1, cacheRead: 0 },
    cost: '—',
    contextPercent: 1,
    contextLevel: 'ok',
    unpricedModels: [],
    ...(plan ? { plan } : {}),
  })
  return { ...s.$status.get(), busy }
}

describe('PRD-M12-004 AC-10 · 续跑条', () => {
  test('计划还有没做完的步骤、空闲、没在问：显示「还剩 N 步」和「继续」', () => {
    const html = renderToStaticMarkup(
      <ResumeBar
        status={status({ total: 5, remaining: 2, interrupted: false })}
        ask={null}
        onContinue={() => undefined}
      />,
    )
    expect(html).toContain('计划还剩 2/5 步')
    expect(html).toContain('data-action="continue"')
    expect(html).toContain('data-interrupted="false"')
  })

  test('上次被打断了：警示色 + 明说', () => {
    const html = renderToStaticMarkup(
      <ResumeBar
        status={status({ total: 5, remaining: 2, interrupted: true })}
        ask={null}
        onContinue={() => undefined}
      />,
    )
    expect(html).toContain('上次被打断了')
    expect(html).toContain('data-interrupted="true"')
    expect(html).toContain('border-warn')
  })

  test('做完了 / 正在跑 / 正在问 / 没有计划：不显示', () => {
    const ask = { capabilityId: 'fs.write', detail: '' }
    expect(resumeHint(status({ total: 3, remaining: 0, interrupted: false }), null)).toBeNull()
    expect(resumeHint(status({ total: 3, remaining: 1, interrupted: false }, true), null)).toBeNull()
    expect(resumeHint(status({ total: 3, remaining: 1, interrupted: false }), ask)).toBeNull()
    expect(resumeHint(status(), null)).toBeNull()
  })
})
