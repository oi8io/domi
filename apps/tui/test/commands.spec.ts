import { describe, expect, test } from 'bun:test'
import { COMMANDS, completeSlash, parseSlash } from '../src/commands.ts'
import { languageItems, modelItems } from '../src/overlays/Overlays.tsx'

describe('斜杠命令', () => {
  test('普通文字照常提交；/compact 不变', () => {
    expect(parseSlash('你好', 3)).toEqual({ kind: 'submit', text: '你好' })
    expect(parseSlash('/compact', 3)).toEqual({ kind: 'compact' })
  })

  test('PRD-M9-003 AC-8 / PRD-M12-001 AC-6 · /model 只开模型列表，不再接受手填模型名', () => {
    expect(parseSlash('/model', 3)).toEqual({ kind: 'model-picker' })
    for (const typed of ['/model glm-4.6', '/model glm-4.6 anthropic']) {
      expect(parseSlash(typed, 3).kind).toBe('invalid')
    }
  })

  test('PRD-M12-002 AC-2 · /mode 切会话确认模式：三档之一，别的都是用法错误', () => {
    for (const mode of ['on-demand', 'always-ask', 'allow-all'] as const) {
      expect(parseSlash(`/mode ${mode}`, 3)).toEqual({ kind: 'permissions-mode', mode })
    }
    for (const bad of ['/mode', '/mode review', '/mode allow-all now', '/mode plan']) {
      expect(parseSlash(bad, 3).kind).toBe('invalid')
    }
  })

  test('/ref 会话 [起-止]：记下一个引用，下一句话带上（PRD-M3-005）', () => {
    expect(parseSlash('/ref s-abc', 3)).toEqual({
      kind: 'ref',
      ref: { sessionId: 's-abc', fromSeq: 1, toSeq: Number.MAX_SAFE_INTEGER },
    })
    expect(parseSlash('/ref s-abc 4-9', 3)).toEqual({ kind: 'ref', ref: { sessionId: 's-abc', fromSeq: 4, toSeq: 9 } })
    expect(parseSlash('/ref s-abc 7', 3)).toEqual({ kind: 'ref', ref: { sessionId: 's-abc', fromSeq: 7, toSeq: 7 } })
    expect(parseSlash('/ref', 3)).toMatchObject({ kind: 'invalid' })
    expect(parseSlash('/ref s 9-4', 3)).toMatchObject({ kind: 'invalid' })
  })

  test('PRD-M10-004 AC-1 / AC-3 · /settings 打开设置层；命令补全可见', () => {
    expect(parseSlash('/settings', 3)).toEqual({ kind: 'settings' })
    expect(COMMANDS().some((c) => c.name === '/settings')).toBe(true)
    expect(completeSlash('/set').map((c) => c.name)).toContain('/settings')
  })

  test('PRD-M10-004 AC-1 · 语言选项与 Web 一致，当前值点亮', () => {
    const items = languageItems('zh')
    expect(items.map((i) => i.label)).toEqual(['跟随系统', '简体中文', 'English'])
    expect(items.find((i) => i.key === 'zh')?.dot).toBe('accent')
    expect(items.find((i) => i.key === 'auto')?.dot).toBe('off')
  })

  test('/branch 不带数字从最后一条分，带数字从那一条分（parity 第 7 项）', () => {
    expect(parseSlash('/branch', 12)).toEqual({ kind: 'branch', atSeq: 12 })
    expect(parseSlash('/branch 5', 12)).toEqual({ kind: 'branch', atSeq: 5 })
    expect(parseSlash('/branch', 0)).toMatchObject({ kind: 'invalid', message: expect.stringContaining('空') })
    expect(parseSlash('/branch x', 12)).toMatchObject({ kind: 'invalid' })
    expect(parseSlash('/branch 0', 12)).toMatchObject({ kind: 'invalid' })
  })
})

describe('PRD-M7-006 AC-2 / AC-3 · TUI 的改动审阅命令', () => {
  test('/changes 列清单，给文件名看 diff', () => {
    expect(parseSlash('/changes', 3)).toEqual({ kind: 'changes' })
    expect(parseSlash('/changes src/a.ts', 3)).toEqual({ kind: 'changes', path: 'src/a.ts' })
  })

  test('/discard 逐文件丢弃，/undo 按回收站编号撤销', () => {
    expect(parseSlash('/discard src/a.ts', 3)).toEqual({ kind: 'discard', path: 'src/a.ts' })
    expect(parseSlash('/discard', 3)).toMatchObject({ kind: 'invalid' })
    expect(parseSlash('/undo 12', 3)).toEqual({ kind: 'undo', trash: '12' })
    expect(parseSlash('/undo abc', 3)).toMatchObject({ kind: 'invalid' })
  })

  test('/apply 默认 squash，三种方式之外的拒绝（带回本身还要在确认框里批准）', () => {
    expect(parseSlash('/apply', 3)).toEqual({ kind: 'apply', mode: 'squash' })
    expect(parseSlash('/apply merge', 3)).toEqual({ kind: 'apply', mode: 'merge' })
    expect(parseSlash('/apply branch', 3)).toEqual({ kind: 'apply', mode: 'branch' })
    expect(parseSlash('/apply force', 3)).toMatchObject({ kind: 'invalid' })
  })
})

describe('PRD-M9-003 AC-4 · TUI 模型列表', () => {
  const list = {
    models: [
      {
        provider: 'anthropic',
        providerName: 'Anthropic',
        name: 'claude-sonnet-4-5',
        source: 'probe' as const,
        vision: true,
        toolCall: true,
      },
      {
        provider: 'my-gw',
        providerName: '公司网关',
        name: 'claude-sonnet-4-5',
        source: 'manual' as const,
        vision: false,
        toolCall: true,
      },
      {
        provider: 'my-gw',
        providerName: '公司网关',
        name: 'glm-4.6',
        source: 'fallback' as const,
        vision: false,
        toolCall: false,
      },
    ],
    providers: [],
    current: { provider: 'anthropic', name: 'claude-sonnet-4-5' },
  }

  test('按供应商分组；同名模型在两家各一行，key 带上供应商；当前在用的点亮', () => {
    const items = modelItems(list, { provider: 'my-gw', name: 'claude-sonnet-4-5' })
    expect(items.map((i) => [i.group, i.label, i.dot])).toEqual([
      ['Anthropic', 'claude-sonnet-4-5', 'off'],
      ['公司网关', 'claude-sonnet-4-5', 'accent'],
      ['公司网关', 'glm-4.6', 'off'],
    ])
    expect(new Set(items.map((i) => i.key)).size).toBe(3)
    expect(items[0]?.meta).toBe('默认')
    expect(items[1]?.meta).toBe('手填 · 不支持图片')
    expect(items[2]?.meta).toBe('未探测到 · 不能用工具 · 不支持图片')
  })
})
