/**
 * PRD-M14-009 AC-1…AC-5 · SPEC-M14-009 —— TUI 右侧栏
 *
 * 测试先行条目：
 * 1. keys：`i` 开 / 关（输入框空、无弹层）；弹层内不响应；与 p/s/t/?/e 不冲突；数字 1–4 切 tab
 * 2. 组件：≥140 列 → 右侧分栏；否则全屏覆盖层；Esc 关闭覆盖层
 * 3. 组件：四个 tab 用同一套 client-core 投影（parity）——渲染快照
 * 4. 默认开关规则同 Web（chat 关 / task 开）
 */
import { describe, expect, test } from 'bun:test'
import { createSessionStore, type DomiClient } from '@domi/client-core'
import type { EventEnvelope } from '@domi/protocol'
import { Inspector, inspectorMode } from '../src/Inspector.tsx'
import { inspectorTabOf, isInspectorKey, isReasonToggle, routeKey } from '../src/keys.ts'
import { KEYS, renderAt } from './render.tsx'

let seq = 0
function env(ev: EventEnvelope['ev']): EventEnvelope {
  seq += 1
  return { seq, sessionId: 's', parentSeq: null, ts: 0, schemaVersion: 2, ev }
}

/** 四个 tab 都能喂到的数据：计划 2 步、一条带 ctx 的 model.request、一次文件快照、一条上传 */
function sampleEvents(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: '做个调研', uploads: [{ id: 'u1', name: 'notes.md', size: 12, mime: 'text/plain' }] }),
    env({
      t: 'plan.update',
      id: 'p1',
      steps: [
        { id: 's1', text: '读代码', status: 'done' },
        { id: 's2', text: '改代码', status: 'in_progress' },
      ],
    }),
    env({
      t: 'model.request',
      provider: 'stub',
      model: 'stub-1',
      tokensIn: 10,
      ctx: {
        layers: [{ id: 'system', role: 'system', cacheable: true, approxTokens: 100 }],
        tools: 5,
        history: 20,
      },
    }),
    env({ t: 'fs.snapshot', path: 'a.ts', phase: 'before', sha256: null, bytes: 0 }),
    env({ t: 'fs.snapshot', path: 'a.ts', phase: 'after', sha256: 'abc', bytes: 12 }),
  ]
}

function clientStub(diff: unknown): DomiClient {
  return {
    checkpointDiff: () => Promise.resolve(diff),
    worktreeDiff: () => Promise.resolve({ files: [], errors: [] }),
    artifact: () => Promise.resolve({ ok: true, mime: 'text/plain', size: 0, text: '' }),
  } as unknown as DomiClient
}

function taskStore(): ReturnType<typeof createSessionStore> {
  const store = createSessionStore({ kind: 'task', model: 'stub-1', provider: 'stub' })
  store.applyEvents(sampleEvents())
  return store
}

describe('SPEC-M14-009 取舍-1 · 键位', () => {
  test('i 只在输入框空、无弹层时开 / 关', () => {
    expect(isInspectorKey('i', {}, true, null)).toBe(true)
    expect(isInspectorKey('i', {}, false, null)).toBe(false)
    expect(isInspectorKey('i', {}, true, 'projects')).toBe(false)
    expect(isInspectorKey('i', { ctrl: true }, true, null)).toBe(false)
    expect(isInspectorKey('i', { meta: true }, true, null)).toBe(false)
    expect(isInspectorKey('x', {}, true, null)).toBe(false)
  })

  test('弹层内不响应：routeKey 先接管，弹层打开时 i 无效', () => {
    // 弹层打开：routeKey 会把 i 交给弹层（返回 null 而非 open），isInspectorKey 也在 overlay 参数上挡掉
    expect(routeKey('i', {}, { inputEmpty: true, overlay: 'projects' })).toBeNull()
    expect(isInspectorKey('i', {}, true, 'projects')).toBe(false)
  })

  test('与 p/s/t/?/e 不冲突', () => {
    // i 不占 p/s/t/?（routeKey 对 i 返回 null）也不占 e（思考折叠）
    expect(routeKey('i', {}, { inputEmpty: true, overlay: null })).toBeNull()
    expect(isReasonToggle('i', {}, true)).toBe(false)
    // 反向：p / e 不被 isInspectorKey 吃掉
    expect(isInspectorKey('p', {}, true, null)).toBe(false)
    expect(isInspectorKey('e', {}, true, null)).toBe(false)
  })

  test('数字 1–4 切 tab（可见 + 输入框空）', () => {
    expect(inspectorTabOf('1', {}, true, true)).toBe(0)
    expect(inspectorTabOf('4', {}, true, true)).toBe(3)
    expect(inspectorTabOf('2', {}, true, false)).toBeNull() // 不可见
    expect(inspectorTabOf('2', {}, false, true)).toBeNull() // 输入框非空
    expect(inspectorTabOf('5', {}, true, true)).toBeNull() // 越界
    expect(inspectorTabOf('0', {}, true, true)).toBeNull()
    expect(inspectorTabOf('a', {}, true, true)).toBeNull()
    expect(inspectorTabOf('1', { ctrl: true }, true, true)).toBeNull()
  })
})

describe('SPEC-M14-009 取舍-1 · 布局断点', () => {
  test('≥140 列右侧分栏，否则全屏覆盖层（AC-1）', () => {
    expect(inspectorMode(139)).toBe('overlay')
    expect(inspectorMode(140)).toBe('side')
    expect(inspectorMode(200)).toBe('side')
  })
})

describe('SPEC-M14-009 · 默认开关规则（AC-2）', () => {
  test('task 默认开、进度 tab；chat 默认关', () => {
    const task = createSessionStore({ kind: 'task' })
    expect(task.$inspector.get().open).toBe(true)
    expect(task.$inspector.get().tab).toBe('progress')
    const chat = createSessionStore({ kind: 'chat' })
    expect(chat.$inspector.get().open).toBe(false)
  })
})

describe('SPEC-M14-009 取舍-2 · 四 tab 渲染（parity 快照）', () => {
  test('进度 tab：步骤 + 剩余 + 用时', async () => {
    const store = taskStore()
    const h = renderAt(160, <Inspector store={store} client={clientStub(null)} sessionId="s" mode="side" />)
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain('1 进度')
    expect(frame).toContain('读代码')
    expect(frame).toContain('改代码')
    expect(frame).toContain('计划还剩')
  })

  test('改动 tab：文件列表 + 统一 diff 着色', async () => {
    const store = taskStore()
    store.setInspector({ tab: 'changes' })
    const diff = {
      available: true,
      reason: undefined,
      files: [{ path: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }],
    }
    const h = renderAt(160, <Inspector store={store} client={clientStub(diff)} sessionId="s" mode="side" />)
    await h.flush()
    await h.flush() // diff promise 落地后再取一帧
    let frame = h.lastFrame()
    expect(frame).toContain('2 改动')
    expect(frame).toContain('a.ts')
    // 列表页只有 +N −M；Enter 进详情后才有 diff 内容（AC-3：统一 diff 着色）
    await h.press(KEYS.enter)
    await h.flush()
    frame = h.lastFrame()
    expect(frame).toContain('+new')
    expect(frame).toContain('-old')
  })

  test('产物 tab：清单 + 路径（含上传）', async () => {
    const store = taskStore()
    store.setInspector({ tab: 'artifacts' })
    const diff = {
      available: true,
      reason: undefined,
      files: [{ path: 'a.ts', status: 'added', patch: '+new', added: 1, removed: 0 }],
    }
    const h = renderAt(160, <Inspector store={store} client={clientStub(diff)} sessionId="s" mode="side" />)
    await h.flush()
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain('3 产物')
    expect(frame).toContain('a.ts')
    expect(frame).toContain('notes.md')
  })

  test('上下文 tab：总量 + 分段 + 压缩记录', async () => {
    const store = taskStore()
    store.setInspector({ tab: 'context' })
    const h = renderAt(160, <Inspector store={store} client={clientStub(null)} sessionId="s" mode="side" />)
    await h.flush()
    const frame = h.lastFrame()
    expect(frame).toContain('4 上下文')
    expect(frame).toContain('上下文:')
  })
})

describe('SPEC-M14-009 取舍-1 · 覆盖层 Esc 关闭', () => {
  test('覆盖层模式 Esc 关闭右侧栏', async () => {
    const store = taskStore()
    const h = renderAt(100, <Inspector store={store} client={clientStub(null)} sessionId="s" mode="overlay" />)
    await h.flush()
    expect(h.lastFrame()).toContain('1 进度')
    await h.press('\u001B') // Esc
    expect(store.$inspector.get().open).toBe(false)
    h.unmount()
  })
})
