/**
 * PRD-M2-004 · L2 跨会话内容检索（AC-1 / AC-3）
 *
 * AC-3 是这里最要紧的一条：**相关度不够就明说没有，不返回 top-k。**
 * 返回一堆不相关的结果，模型会拿它们当真。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteEventLog } from '@domi/store'
import { formatEpisodes, searchEpisodes } from '../src/index.ts'

const dirs: string[] = []
async function seeded(): Promise<SqliteEventLog> {
  const d = mkdtempSync(join(tmpdir(), 'domi-episodic-'))
  dirs.push(d)
  const log = new SqliteEventLog({ path: join(d, 'events.db') })

  await log.append('s-cors', [
    { t: 'user.input', text: '前端调后端接口报 CORS 错误怎么办' },
    { t: 'model.reason', text: '先看预检请求' },
    { t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'curl -I localhost:8080' } },
    { t: 'tool.result', id: 'c1', ok: true, payload: '缺少 Access-Control-Allow-Origin 响应头', ms: 20 },
    { t: 'model.delta', text: '在网关上补一个 Access-Control-Allow-Origin 就好了。' },
  ])
  await log.append('s-sqlite', [
    { t: 'user.input', text: '数据库迁移失败了' },
    { t: 'error', scope: 'migrate', message: '迁移中途失败，已从备份回滚', recoverable: true },
    { t: 'model.delta', text: '回滚成功，备份还在。' },
  ])
  await log.append('s-misc', [
    { t: 'user.input', text: '把 sum.js 的减号改成加号' },
    { t: 'model.delta', text: '改好了。' },
  ])
  return log
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // 挂载没有删除权限时不该把一个本身是好的测试报成失败
    }
  }
})

describe('AC-1 · 全文检索，每条结果可溯源', () => {
  test('跨会话按内容搜到，且带 sessionId + seq', async () => {
    const log = await seeded()
    const a = searchEpisodes(log.search, 'Access-Control')
    log.close()
    expect(a.found).toBe(true)
    if (!a.found) return
    expect(a.hits.every((h) => h.sessionId === 's-cors')).toBe(true)
    expect(a.hits.every((h) => h.seq > 0)).toBe(true)
  })

  test('中文也搜得到 —— 默认分词器不切中文，所以用了 trigram', async () => {
    const log = await seeded()
    const a = searchEpisodes(log.search, '迁移失败')
    log.close()
    expect(a.found).toBe(true)
    if (!a.found) return
    expect(a.hits.some((h) => h.sessionId === 's-sqlite')).toBe(true)
  })

  test('思考与错误事件也进索引 ——「上次那个报错」是真实问法', async () => {
    const log = await seeded()
    const err = searchEpisodes(log.search, '已从备份回滚')
    const reason = searchEpisodes(log.search, '先看预检请求')
    log.close()
    expect(err.found).toBe(true)
    expect(reason.found).toBe(true)
  })

  test('限定会话时不跨库串味', async () => {
    const log = await seeded()
    const a = searchEpisodes(log.search, '改成加号', { sessionId: 's-cors' })
    log.close()
    expect(a.found).toBe(false)
  })

  test('渲染给模型时每条都带 sessionId 与 seq，能跳回轨迹', async () => {
    const log = await seeded()
    const text = formatEpisodes(searchEpisodes(log.search, 'Access-Control'))
    log.close()
    expect(text).toContain('s-cors')
    expect(text).toContain('seq ')
  })
})

describe('AC-3 · 不相关就明说没有，不返回 top-k', () => {
  test('完全无关的查询返回 found:false，而不是三条最不离谱的', async () => {
    const log = await seeded()
    const a = searchEpisodes(log.search, '量子纠缠与超导磁悬浮')
    log.close()
    expect(a.found).toBe(false)
    if (a.found) return
    expect(a.reason).toContain('没有与')
  })

  test('空查询也是 found:false，不是「返回全部」', async () => {
    const log = await seeded()
    const a = searchEpisodes(log.search, '   ')
    log.close()
    expect(a.found).toBe(false)
  })

  test('带 FTS5 语法字符的输入不炸，也不当成语法', async () => {
    const log = await seeded()
    for (const q of ['"', 'a OR b', 'foo*', 'x AND', '(((']) {
      expect(() => searchEpisodes(log.search, q)).not.toThrow()
    }
    log.close()
  })

  test('两个字的中文词走 LIKE 降级路径 —— trigram 匹配不到，但「减号」是真实问法', async () => {
    const log = await seeded()
    const a = searchEpisodes(log.search, '减号')
    log.close()
    expect(a.found).toBe(true)
    if (!a.found) return
    expect(a.hits.some((h) => h.sessionId === 's-misc')).toBe(true)
  })
})

describe('索引是派生数据，跟着写入走', () => {
  test('append 之后立刻搜得到 —— 不是「用的时候再建」', async () => {
    const log = await seeded()
    await log.append('s-new', [{ t: 'user.input', text: '刚刚写进去的这条要马上搜得到' }])
    const a = searchEpisodes(log.search, '刚刚写进去的')
    log.close()
    expect(a.found).toBe(true)
  })

  test('重复 append 不会把同一条索引两遍', async () => {
    const log = await seeded()
    const before = log.search.indexedSeq('s-cors')
    log.search.index(
      's-cors',
      await log.read('s-cors').then((es) => es.map((e) => ({ seq: e.seq, type: e.ev.t, ev: e.ev }))),
    )
    expect(log.search.indexedSeq('s-cors')).toBe(before)
    const a = searchEpisodes(log.search, 'Access-Control')
    log.close()
    expect(a.found).toBe(true)
    if (!a.found) return
    // 同一条 seq 只出现一次
    const seqs = a.hits.map((h) => `${h.sessionId}#${h.seq}`)
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  test('不进上下文的事件类型也不进索引 —— permission / usage 搜出来没有意义', async () => {
    const log = await seeded()
    await log.append('s-perm', [
      { t: 'permission', capabilityId: 'fs.write', decision: 'allow', source: 'user', matchedRule: 'confirm-write' },
    ])
    const a = searchEpisodes(log.search, 'confirm-write')
    log.close()
    expect(a.found).toBe(false)
  })
})
