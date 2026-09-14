/**
 * PRD-M2-005 AC-5 · 导出为单文件静态 HTML，在无网络的浏览器里可打开并展开全部节点
 *
 * 这里的做法是：**一行 JavaScript 都不写**，折叠展开交给原生 `<details>/<summary>`。
 * 于是「无外部请求」从一条要靠测试去守的性质，变成了结构上不可能违反的性质——
 * 没有 script、没有 link、没有 img，就没有任何可以发出去的请求。
 *
 * 用 Bun 内置的 HTMLRewriter 做结构断言，不引 Playwright：
 * 要验的是「文件里有没有外部引用、节点能不能展开」，这是**文档结构**问题，不是渲染问题。
 * （原 PRD 验收方式写的是 Playwright，见 docs/spec/M2.md 取舍-9 的回写理由。）
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { buildTrace, COLLAPSE_BYTES, exportHtml } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq++
  return {
    seq,
    sessionId: 's1',
    parentSeq: seq > 1 ? seq - 1 : null,
    ts: 1_700_000_000_000 + seq,
    schemaVersion: 4,
    ev,
  }
}

function sample(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: '跑测试 <script>alert(1)</script>' }),
    env({ t: 'model.request', provider: 'anthropic', model: 'm', tokensIn: 3 }),
    env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'bun test' } }),
    env({
      t: 'permission',
      capabilityId: 'shell.exec',
      decision: 'allow',
      source: 'user',
      matchedRule: 'confirm-shell',
    }),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: 'x'.repeat(COLLAPSE_BYTES + 10), ms: 30 }),
    env({ t: 'model.delta', text: '通过了。' }),
  ]
}

const HTML = exportHtml(buildTrace(sample()))

/** 用 HTMLRewriter 收集元素 —— Bun 自带，不需要装浏览器 */
async function collect(html: string, selector: string): Promise<Array<Record<string, string>>> {
  const found: Array<Record<string, string>> = []
  const rewriter = new HTMLRewriter().on(selector, {
    element(el) {
      const attrs: Record<string, string> = {}
      for (const [k, v] of el.attributes) attrs[k] = v
      found.push(attrs)
    },
  })
  await rewriter.transform(new Response(html)).text()
  return found
}

describe('AC-5 · 无外部请求', () => {
  test('没有任何 script / link / img / iframe / 外链字体', async () => {
    for (const sel of ['script', 'link', 'img', 'iframe', 'source', 'video', 'audio', 'object', 'embed']) {
      expect(await collect(HTML, sel)).toHaveLength(0)
    }
  })

  test('全文里没有 http(s):// 与 // 开头的协议相对地址', () => {
    expect(HTML).not.toMatch(/https?:\/\//)
    expect(HTML).not.toMatch(/src\s*=\s*["']\/\//)
    expect(HTML).not.toMatch(/@import/)
    expect(HTML).not.toMatch(/url\(/)
  })

  test('CSS 是内联的 —— 不是外链也不是空的', async () => {
    const styles = await collect(HTML, 'style')
    expect(styles).toHaveLength(1)
    expect(HTML).toContain('font:14px/1.6')
  })

  test('单文件：没有相对路径的附属资源', () => {
    expect(HTML).not.toMatch(/(src|href)\s*=\s*["'](?!#)/)
  })
})

describe('AC-5 · 打开后能展开全部节点', () => {
  test('每个节点都是 details，靠原生能力展开，不依赖 JS', async () => {
    const details = await collect(HTML, 'details')
    const summaries = await collect(HTML, 'summary')
    expect(details.length).toBeGreaterThan(0)
    expect(summaries).toHaveLength(details.length) // 每个 details 都有把手
  })

  test('折叠的节点也把全文写进了文件 —— 折叠是显示状态，不是数据缺失', () => {
    expect(HTML).toContain('x'.repeat(COLLAPSE_BYTES + 10))
    expect(HTML).toContain(`共 ${COLLAPSE_BYTES + 10} 字节`)
  })

  test('> 2KB 的节点没有 open 属性，其余有 —— 与 AC-2 一致', async () => {
    const details = await collect(HTML, 'details')
    const collapsed = details.filter((d) => !('open' in d))
    expect(collapsed).toHaveLength(1)
    expect(details.length - collapsed.length).toBeGreaterThan(0)
  })
})

describe('AC-5 · 内容安全', () => {
  test('用户内容里的标签被转义，不会变成真的 script', async () => {
    expect(HTML).toContain('&lt;script&gt;')
    expect(await collect(HTML, 'script')).toHaveLength(0)
  })
})

describe('快照，不是客户端', () => {
  test('没有任何与 daemon 通信的痕迹 —— 与 M3 Web 端的边界就在这里', () => {
    expect(HTML).not.toMatch(/WebSocket|EventSource|fetch\(|XMLHttpRequest/)
  })

  test('同一份事件流导出两次 byte 级一致', () => {
    expect(exportHtml(buildTrace(sample()))).toBe(exportHtml(buildTrace(sample())))
  })
})
