/**
 * PRD-M0-005 AC-4 · 40 / 60 / 80 / 200 四种宽度下 golden 快照 diff 为 0
 *
 * 快照文件提交进仓库。改了渲染就会红——那是它的作用，不是麻烦：
 * 终端 UI 的回归没有别的办法看见。
 * 更新方式：`UPDATE_GOLDEN=1 bun test apps/tui`，然后**读一遍 diff** 再提交。
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSessionStore } from '@domi/client-core'
import { setLocale } from '@domi/i18n'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { App } from '../src/App.tsx'
import { Overlays } from '../src/overlays/Overlays.tsx'
import { renderAt } from './render.tsx'

const DIR = 'apps/tui/test/__snapshots__'
const WIDTHS = [40, 60, 80, 200]

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts: 0, schemaVersion: 2, ev }
}

/** 固定场景：一轮完整对话，覆盖每一种 transcript 条目 */
const SCENE: DomiEvent[] = [
  { t: 'user.input', text: '把 sum.js 的减号改成加号，然后跑测试' },
  { t: 'model.reason', text: '先看看文件内容' },
  { t: 'model.delta', text: '我先读一下 sum.js。' },
  { t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } },
  { t: 'permission', capabilityId: 'fs.read', decision: 'allow', source: 'config', matchedRule: 'allow-read' },
  { t: 'tool.result', id: 'c1', ok: true, payload: { lines: 1 }, ms: 4 },
  { t: 'model.delta', text: '减号写错了，改成加号。' },
  {
    t: 'tool.call',
    id: 'c2',
    name: 'fs.write',
    args: { path: 'sum.js', content: 'export const sum = (a, b) => a + b' },
  },
  { t: 'permission', capabilityId: 'fs.write', decision: 'allow', source: 'user', matchedRule: 'confirm-write' },
  { t: 'tool.result', id: 'c2', ok: true, payload: { bytes: 34, created: false }, ms: 2 },
  { t: 'model.usage', raw: { input_tokens: 421, cache_read_input_tokens: 256 } },
]

function scene() {
  seq = 0
  const s = createSessionStore({ model: 'stub-1', provider: 'stub' })
  s.applyEvents(SCENE.map(env))
  // 指标由 runtime 算好推过来（PRD-M1-007 AC-3：状态栏不自己算），
  // 所以快照场景里也要显式推一次——这正是真实 app 的路径
  s.setMetrics({
    tokens: { input: 421, output: 88, cacheRead: 256 },
    cost: '$0.0021',
    contextPercent: 42,
    contextLevel: 'ok',
    unpricedModels: [],
  })
  return s
}

describe('PRD-M0-005 AC-4 · 四宽度 golden 快照', () => {
  test.each(WIDTHS)(
    '宽度 %i',
    async (columns) => {
      const h = renderAt(columns, <App store={scene()} />)
      await h.flush()
      const frame = h.lastFrame()
      h.unmount()

      const file = join(DIR, `scene-${columns}.txt`)
      if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
        mkdirSync(DIR, { recursive: true })
        writeFileSync(file, `${frame}\n`, 'utf8')
      }
      expect(frame).toBe(readFileSync(file, 'utf8').replace(/\n$/, ''))
    },
    15_000,
  )

  test('窄宽度下不会把状态栏挤没', async () => {
    const h = renderAt(40, <App store={scene()} />)
    await h.flush()
    expect(h.lastFrame()).toContain('stub-1')
    h.unmount()
  })
})

/**
 * PRD-M9-004 AC-6 · English 界面的一组金样（80 列）。中文四个宽度照旧（上面那组，默认 zh）。
 * 顺带断言：界面文案一个中文字都不剩——剩下的中文只能来自用户内容（场景里的用户输入与模型输出）
 */
/** PRD-M10-004 · 设置层（语言）的 en 金样：选项与当前值点亮的渲染不漂移 */
describe('PRD-M10-004 · 设置层金样', () => {
  test('宽度 80（en）', async () => {
    const fake = {
      setSettings: async () => ({}),
      getSettings: async () => ({ values: {} }),
      listProjects: async () => [],
      listSessions: async () => ({ sessions: [] }),
      listSchedules: async () => [],
    }
    setLocale('en')
    try {
      const h = renderAt(
        80,
        <Overlays
          client={fake as never}
          state={{ id: 'settings' }}
          sessionId="s"
          onChange={() => undefined}
          onOpenSession={() => undefined}
        />,
      )
      await h.flush()
      const frame = h.lastFrame()
      h.unmount()
      const file = join(DIR, 'scene-settings.en.txt')
      if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
        mkdirSync(DIR, { recursive: true })
        writeFileSync(file, `${frame}\n`, 'utf8')
      }
      expect(frame).toBe(readFileSync(file, 'utf8').replace(/\n$/, ''))
      expect(frame).toContain('Settings · Language')
      expect(frame).toContain('Follow system')
      // 语言名保持母语显示（en 界面也是「简体中文」，PRD-M9-004 既有行为）
      expect(frame).toContain('简体中文')
      expect(frame).toContain('English')
    } finally {
      setLocale('zh')
    }
  }, 15_000)
})

describe('PRD-M9-004 AC-6 · English 金样', () => {
  test('宽度 80（en）', async () => {
    setLocale('en')
    try {
      const h = renderAt(80, <App store={scene()} />)
      await h.flush()
      const frame = h.lastFrame()
      h.unmount()
      const file = join(DIR, 'scene-80.en.txt')
      if (process.env.UPDATE_GOLDEN === '1' || !existsSync(file)) {
        mkdirSync(DIR, { recursive: true })
        writeFileSync(file, `${frame}\n`, 'utf8')
      }
      expect(frame).toBe(readFileSync(file, 'utf8').replace(/\n$/, ''))
      const userContent = [
        '把 sum.js 的减号改成加号，然后跑测试',
        '先看看文件内容',
        '我先读一下 sum.js。',
        '减号写错了，改成加号。',
      ]
      let rest = frame ?? ''
      for (const u of userContent) rest = rest.split(u).join('')
      expect(rest).not.toMatch(/[\u3400-\u9fff]/)
    } finally {
      setLocale('zh')
    }
  }, 15_000)
})
