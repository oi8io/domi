/**
 * PRD-M9-005 · TUI 双渲染器的纯函数部分（SPEC-M9-005 取舍-8）
 *
 * 按键本身在无 TTY 环境里验不了（docs/adr/001），这里验的是按键之后算出来的东西：
 * 切哪几行、滚动条画在哪、往上翻之后新内容来了怎么办、该用哪种渲染器、滚轮怎么解析。
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptItem } from '@domi/client-core'
import { createSessionStore } from '@domi/client-core'
import { tr } from '@domi/i18n'
import type { DomiEvent } from '@domi/protocol'
import { renderToString } from 'ink'
import { App } from '../src/App.tsx'
import { dumpText, settledCount, Transcript, transcriptLines, Viewport } from '../src/components/Transcript.tsx'
import { isReasonToggle } from '../src/keys.ts'
import { clearFallback, fallbackMarked, markFallback } from '../src/render/fallback.ts'
import {
  applyScroll,
  chooseRenderer,
  createScrollBus,
  halfPage,
  INITIAL_SCROLL,
  isMouseReport,
  onContentChange,
  parseWheel,
  scrollbar,
  scrollbarColumn,
  scrollKey,
  visibleRange,
  WHEEL_LINES,
} from '../src/render/viewport.ts'
import { makeTheme, ThemeContext } from '../src/theme.ts'
import { renderAt } from './render.tsx'

/** ANSI 颜色：量宽度、比内容之前先去掉 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI 转义本来就以 ESC 开头
const ANSI = /\u001b\[[0-9;]*m/g

function longSession(n: number) {
  const store = createSessionStore({ model: 'stub-1', provider: 'stub' })
  const evs: DomiEvent[] = Array.from({ length: n }, (_, i) => ({ t: 'user.input', text: `msg-${i}` }) as DomiEvent)
  store.applyEvents(evs.map((ev, i) => ({ seq: i + 1, sessionId: 's', parentSeq: null, ts: 0, schemaVersion: 12, ev })))
  return store
}

describe('PRD-M9-005 AC-2/3 · fullscreen 整屏：高度钉死在终端行数，对话区只画尾巴，按总线翻页', () => {
  test('100 条消息的会话在 40 行终端里：画面不超过 40 行，底部区域在，看得到最新的、看不到最早的；到顶反过来', async () => {
    const bus = createScrollBus()
    const h = renderAt(80, <App store={longSession(100)} renderer="fullscreen" scrollBus={bus} />)
    await h.waitFor((f) => f.includes('msg-99'))
    const frame = h.lastFrame()
    expect(frame.split('\n').length).toBeLessThanOrEqual(40)
    expect(frame).not.toContain('msg-0\n')
    expect(frame).toContain('Ctrl+O')
    bus.emit('top')
    await h.waitFor((f) => f.includes('msg-0'))
    expect(h.lastFrame()).not.toContain('msg-99')
    bus.emit('bottom')
    await h.waitFor((f) => f.includes('msg-99'))
    h.unmount()
  })
})

describe('PRD-M9-005 AC-2 · 只渲染可见的行，右侧滚动条按比例', () => {
  test('贴底时显示最后 height 行；偏移量从底部算，且不越界', () => {
    expect(visibleRange(100, 10, 0)).toEqual({ start: 90, end: 100 })
    expect(visibleRange(100, 10, 30)).toEqual({ start: 60, end: 70 })
    expect(visibleRange(100, 10, 999)).toEqual({ start: 0, end: 10 })
    expect(visibleRange(5, 10, 3)).toEqual({ start: 0, end: 5 })
  })

  test('一屏装得下不画滚动条；滑块长度 = 可见比例，到顶在最上、贴底在最下', () => {
    expect(scrollbar(10, 10, 0)).toBeNull()
    expect(scrollbar(100, 10, 0)).toEqual({ thumbStart: 0, thumbSize: 1 })
    expect(scrollbar(100, 10, 90)).toEqual({ thumbStart: 9, thumbSize: 1 })
    expect(scrollbar(20, 10, 5)).toEqual({ thumbStart: 3, thumbSize: 5 })
    const col = scrollbarColumn(20, 10, 10)
    expect(col).toHaveLength(10)
    expect(col.slice(5).every((c) => c === '┃')).toBe(true)
    expect(col.slice(0, 5).every((c) => c === '│')).toBe(true)
  })

  test('Viewport 只画可见的几行，并带「N 条新消息」', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`)
    const out = renderToString(
      <ThemeContext.Provider value={makeTheme()}>
        <Viewport lines={lines} height={5} offset={10} unseen={2} />
      </ThemeContext.Provider>,
      { columns: 40 },
    )
    // 5 行高、离底 10 行、有新消息：内容 4 行（36–39），第 5 行是提示，不压在内容上
    const rows = out.split('\n')
    expect(rows).toHaveLength(5)
    expect(rows.slice(0, 4).map((r) => r.slice(0, 7))).toEqual(['line-36', 'line-37', 'line-38', 'line-39'])
    expect(out).not.toContain('line-35')
    expect(out).not.toContain('line-40')
    expect(rows[4]).toContain(tr('tui.scroll.newItems', { n: 2 }))
    expect(rows[4]).not.toContain('line')
  })

  test('折行按终端宽度与双宽字符算：窄屏行数更多，每行不超宽', () => {
    const items: TranscriptItem[] = [{ seq: 1, kind: 'assistant', text: '中文双宽字符'.repeat(10) }]
    const theme = makeTheme()
    const narrow = transcriptLines(items, 20, theme)
    const wide = transcriptLines(items, 80, theme)
    expect(narrow.length).toBeGreaterThan(wide.length)
    const width = (s: string) =>
      [...s.replace(ANSI, '')].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1), 0)
    for (const l of narrow) expect(width(l)).toBeLessThanOrEqual(20)
  })
})

describe('PRD-M10-005 AC-2/AC-4 · 思考默认折叠，e 展开（不占滚动键）', () => {
  const theme = makeTheme()

  test('默认折叠：reason 行只显示「思考 · 摘要（80 字截断）」，展开后是全文', () => {
    const long = '先看文件内容'.repeat(30) // 150 字，必超 80
    const items: TranscriptItem[] = [
      { seq: 1, kind: 'user', text: '帮我看看' },
      { seq: 2, kind: 'reason', text: long, ts: 1 },
      { seq: 3, kind: 'assistant', text: '好' },
    ]
    // 折叠行 = 前缀(≈10 双宽) + 80 双宽 + …，需要 > 170 宽才不折行；展开行是 180 双宽，用 400 宽验全文
    const folded = transcriptLines(items, 200, theme)
    expect(folded[1]).toContain(tr('web.transcript.thinking'))
    expect(folded[1]).toContain('…')
    expect(folded[1]).not.toContain(long)
    const expanded = transcriptLines(items, 400, theme, true)
    expect(expanded[1]).toContain(long)
    expect(expanded[1]).not.toContain('…')
  })

  test('短思考折叠时原样显示（不截断，无省略号）', () => {
    const items: TranscriptItem[] = [{ seq: 1, kind: 'reason', text: '短思考', ts: 1 }]
    const folded = transcriptLines(items, 80, theme)
    expect(folded[0]).toContain('思考 · 短思考')
  })

  test('e 键切换：输入框空 + 无修饰键才生效；输入中 / Ctrl / Meta / 其他字母不触发', () => {
    expect(isReasonToggle('e', {}, true)).toBe(true)
    expect(isReasonToggle('e', {}, false)).toBe(false)
    expect(isReasonToggle('e', { ctrl: true }, true)).toBe(false)
    expect(isReasonToggle('e', { meta: true }, true)).toBe(false)
    expect(isReasonToggle('E', {}, true)).toBe(false)
    expect(isReasonToggle('x', {}, true)).toBe(false)
    // e 不是滚动键：PgUp/PgDn/Ctrl+Home/End 的判定不受影响（见下方 PRD-M9-005 AC-3 的 scrollKey 测试）
  })
})

describe('PRD-M9-005 AC-3 · 翻页、到顶到底、滚轮、暂停跟随', () => {
  test('PgUp / PgDn 半屏，Ctrl+Home / Ctrl+End 到顶 / 到底', () => {
    expect(halfPage(20)).toBe(10)
    const up = applyScroll(INITIAL_SCROLL, 'pageUp', 100, 20)
    expect(up).toEqual({ offset: 10, follow: false, unseen: 0 })
    expect(applyScroll(up, 'pageDown', 100, 20)).toEqual(INITIAL_SCROLL)
    expect(applyScroll(INITIAL_SCROLL, 'top', 100, 20).offset).toBe(80)
    expect(applyScroll(up, 'bottom', 100, 20)).toEqual(INITIAL_SCROLL)
    expect(applyScroll(INITIAL_SCROLL, 'wheelUp', 100, 20).offset).toBe(WHEEL_LINES)
    expect(applyScroll(INITIAL_SCROLL, 'wheelDown', 100, 20)).toEqual(INITIAL_SCROLL)
  })

  test('按键映射：只有滚动键被拿走，其它交给输入框', () => {
    expect(scrollKey({ pageUp: true })).toBe('pageUp')
    expect(scrollKey({ pageDown: true })).toBe('pageDown')
    expect(scrollKey({ ctrl: true, home: true })).toBe('top')
    expect(scrollKey({ ctrl: true, end: true })).toBe('bottom')
    // 不带 Ctrl 的 Home / End 是输入框里的光标移动
    expect(scrollKey({ home: true })).toBeNull()
    expect(scrollKey({ end: true })).toBeNull()
  })

  test('往上翻着的时候新内容来了：看到的那一屏不动，记下新来了几条；到底恢复跟随', () => {
    const up = applyScroll(INITIAL_SCROLL, 'pageUp', 100, 20)
    const after = onContentChange(up, { addedLines: 7, addedItems: 2, total: 107, height: 20 })
    expect(visibleRange(107, 20, after.offset)).toEqual(visibleRange(100, 20, up.offset))
    expect(after.unseen).toBe(2)
    expect(after.follow).toBe(false)
    expect(applyScroll(after, 'bottom', 107, 20)).toEqual(INITIAL_SCROLL)
    // 贴底时什么都不改
    expect(onContentChange(INITIAL_SCROLL, { addedLines: 7, addedItems: 2, total: 107, height: 20 })).toEqual(
      INITIAL_SCROLL,
    )
  })

  test('SGR 1006 滚轮：64 向上、65 向下，带修饰键也认；点击不算；一次 data 里多个事件都解析', () => {
    expect(parseWheel('\u001b[<64;10;5M')).toEqual(['up'])
    expect(parseWheel('\u001b[<65;10;5M\u001b[<65;10;5M')).toEqual(['down', 'down'])
    expect(parseWheel('\u001b[<80;1;1M')).toEqual(['up'])
    expect(parseWheel('\u001b[<0;1;1M\u001b[<0;1;1m')).toEqual([])
    expect(isMouseReport('[<64;10;5M')).toBe(true)
    expect(isMouseReport('hello')).toBe(false)
  })
})

describe('PRD-M9-005 AC-1 · 选渲染器与失败回退', () => {
  const base = { setting: 'fullscreen' as const, env: {}, isTTY: true, screenReader: false, fallbackMarked: false }

  test('默认 fullscreen；环境变量优先于配置', () => {
    expect(chooseRenderer(base)).toEqual({ renderer: 'fullscreen', reason: null })
    expect(chooseRenderer({ ...base, env: { DOMI_TUI_RENDERER: 'classic' } }).renderer).toBe('classic')
    expect(chooseRenderer({ ...base, setting: 'classic', env: { DOMI_TUI_RENDERER: 'fullscreen' } }).renderer).toBe(
      'fullscreen',
    )
  })

  test('非 TTY、TERM=dumb、读屏强制 classic——环境变量也拗不过', () => {
    const env = { DOMI_TUI_RENDERER: 'fullscreen' }
    expect(chooseRenderer({ ...base, env, isTTY: false })).toEqual({ renderer: 'classic', reason: 'not-tty' })
    expect(chooseRenderer({ ...base, env: { ...env, TERM: 'dumb' } })).toEqual({ renderer: 'classic', reason: 'dumb' })
    expect(chooseRenderer({ ...base, env, screenReader: true })).toEqual({
      renderer: 'classic',
      reason: 'screen-reader',
    })
  })

  test('上次首帧前挂过：退回 classic 并给出原因；显式环境变量可以再试', () => {
    expect(chooseRenderer({ ...base, fallbackMarked: true })).toEqual({ renderer: 'classic', reason: 'fallback' })
    expect(chooseRenderer({ ...base, fallbackMarked: true, env: { DOMI_TUI_RENDERER: 'fullscreen' } }).renderer).toBe(
      'fullscreen',
    )
  })

  test('回退标记：写了就算数；之后改过配置文件就不算（用户在显式再试）；首帧画出来就清掉', () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-fallback-'))
    const marker = join(dir, 'state', 'tui-fallback')
    const config = join(dir, 'config.yaml')
    writeFileSync(config, 'tui:\n  renderer: fullscreen\n')
    utimesSync(config, new Date(1000), new Date(1000))
    expect(fallbackMarked(marker, config)).toBe(false)
    markFallback(marker, new Date(2000))
    utimesSync(marker, new Date(2000), new Date(2000))
    expect(fallbackMarked(marker, config)).toBe(true)
    utimesSync(config, new Date(3000), new Date(3000))
    expect(fallbackMarked(marker, config)).toBe(false)
    clearFallback(marker)
    utimesSync(config, new Date(1000), new Date(1000))
    expect(fallbackMarked(marker, config)).toBe(false)
  })
})

describe('PRD-M9-005 AC-5 · classic：已完成的条目进 Static，只输出一次', () => {
  const item = (seq: number, kind: TranscriptItem['kind'], text = 'x'): TranscriptItem => ({ seq, kind, text })

  test('最后一条（可能还在流式）不算完成；等结果的工具调用及其之后都不算', () => {
    expect(settledCount([])).toBe(0)
    expect(settledCount([item(1, 'user'), item(2, 'assistant')])).toBe(1)
    expect(settledCount([item(1, 'user'), item(2, 'tool-call'), item(3, 'reason'), item(4, 'assistant')])).toBe(1)
    expect(settledCount([item(1, 'user'), item(2, 'tool-call'), item(3, 'tool-result'), item(4, 'assistant')])).toBe(3)
  })
})

describe('PRD-M9-005 AC-4 · Ctrl+O 写进回滚区的是完整对话、classic 的样子', () => {
  test('滚到哪都一样：100 条全在，和 classic 直接渲染逐行一致，末尾告诉用户按任意键回去', () => {
    const store = longSession(100)
    const items = store.$items.get()
    const theme = makeTheme()
    const text = dumpText(items, 80, theme)
    expect(text).toContain('msg-0\n')
    expect(text).toContain('msg-99')
    const classic = renderToString(
      <ThemeContext.Provider value={theme}>
        <Transcript items={items} />
      </ThemeContext.Provider>,
      { columns: 80 },
    )
    const plain = (s: string) =>
      s
        .replace(ANSI, '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l !== '')
    expect(plain(text).slice(0, -1)).toEqual(plain(classic))
    expect(text.trimEnd().endsWith(tr('tui.scroll.dumpHint'))).toBe(true)
  })
})
