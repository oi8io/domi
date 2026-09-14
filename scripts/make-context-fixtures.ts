/**
 * 十条标准会话 fixture —— PRD-M2-002 AC-2
 *
 * AC-2 要「在 10 个标准会话 fixture 上平均减少 ≥15% token，
 * 且被后续事件引用过的内容 100% 保留（引用关系由 fixture 显式标注，逐条断言）」。
 *
 * 这十条是**合成**的，不是真实对话——真实对话里带用户路径与凭据，不进版本库（INV-11）。
 * 合成也不等于随便造：每一条对应一种**真实会话里反复出现的臃肿形状**，
 * 名字就是它要复现的那个形状。
 *
 * 生成过程**零随机**：同样的代码永远产出同样的字节，
 * 否则 AC-3 的「同输入同输出 byte 级一致」就无从验起。
 *
 * 用法：bun run scripts/make-context-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DomiEvent, EventEnvelope } from '../packages/protocol/src/index.ts'

const DIR = join('fixtures', 'contexts')

/** 确定性「长文本」：不用随机数，用可复现的重复 */
function lines(prefix: string, n: number): string {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n')
}

function stack(frames: number): string {
  return `TypeError: x is not a function\n${Array.from(
    { length: frames },
    (_, i) => `    at frame${i + 1} (/repo/src/mod${i + 1}.ts:${i + 10}:${i + 3})`,
  ).join('\n')}`
}

interface Session {
  name: string
  /** 这条 fixture 复现的是哪种臃肿 */
  shape: string
  events: DomiEvent[]
  /** 显式标注：哪些 seq 被后续引用过，必须整条保留 */
  refs?: number[]
}

const SESSIONS: Session[] = [
  {
    name: '01-repeated-reads',
    shape: '同一个文件反复读——最常见的一种，模型每轮都想确认一遍',
    events: [
      { t: 'user.input', text: '把 config.ts 里的超时改成 30 秒' },
      { t: 'tool.call', id: 'a1', name: 'fs.read', args: { path: 'config.ts' } },
      { t: 'tool.result', id: 'a1', ok: true, payload: lines('config line', 60), ms: 3 },
      { t: 'tool.call', id: 'a2', name: 'fs.read', args: { path: 'config.ts' } },
      { t: 'tool.result', id: 'a2', ok: true, payload: lines('config line', 60), ms: 3 },
      { t: 'tool.call', id: 'a3', name: 'fs.read', args: { path: 'config.ts' } },
      { t: 'tool.result', id: 'a3', ok: true, payload: lines('config line', 60), ms: 3 },
      { t: 'model.delta', text: '改好了。' },
    ],
  },
  {
    name: '02-verbose-test-output',
    shape: '测试输出——几百行里只有最后三行有信息量',
    events: [
      { t: 'user.input', text: '跑一下测试' },
      { t: 'tool.call', id: 'b1', name: 'shell.exec', args: { cmd: 'bun test' } },
      {
        t: 'tool.result',
        id: 'b1',
        ok: true,
        payload: `${lines('(pass) some test', 200)}\n\n 200 pass\n 0 fail`,
        ms: 4200,
      },
      { t: 'model.delta', text: '全绿。' },
    ],
  },
  {
    name: '03-resolved-error',
    shape: '先失败后成功——失败的细节在成功之后就没人看了',
    events: [
      { t: 'user.input', text: '装个依赖' },
      { t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'pnpm add zod' } },
      { t: 'tool.result', id: 'c1', ok: false, payload: lines('ERR_PNPM_FETCH network error retry', 40), ms: 9000 },
      { t: 'tool.call', id: 'c2', name: 'shell.exec', args: { cmd: 'pnpm add zod' } },
      { t: 'tool.result', id: 'c2', ok: true, payload: 'added 1 package', ms: 3000 },
      { t: 'model.delta', text: '装好了。' },
    ],
  },
  {
    name: '04-deep-stack',
    shape: '深堆栈——栈底二十帧全是框架代码',
    events: [
      { t: 'user.input', text: '这个报错怎么回事' },
      { t: 'tool.call', id: 'd1', name: 'shell.exec', args: { cmd: 'bun run build' } },
      { t: 'tool.result', id: 'd1', ok: false, payload: stack(24), ms: 800 },
      { t: 'error', scope: 'tool', message: `构建失败\n${stack(20)}`, recoverable: true },
      { t: 'tool.call', id: 'd2', name: 'shell.exec', args: { cmd: 'bun run build' } },
      { t: 'tool.result', id: 'd2', ok: true, payload: 'build ok', ms: 900 },
    ],
  },
  {
    name: '05-referenced-read',
    shape: '读到的内容后面真的被引用了——**这条必须一个字都不少**',
    events: [
      { t: 'user.input', text: '照着 schema.sql 写一份迁移' },
      { t: 'tool.call', id: 'e1', name: 'fs.read', args: { path: 'schema.sql' } },
      { t: 'tool.result', id: 'e1', ok: true, payload: lines('CREATE TABLE t', 80), ms: 5 },
      { t: 'tool.call', id: 'e2', name: 'fs.read', args: { path: 'schema.sql' } },
      { t: 'tool.result', id: 'e2', ok: true, payload: lines('CREATE TABLE t', 80), ms: 5 },
      { t: 'model.delta', text: '按上面的表结构写迁移。' },
    ],
    // 第 3 条（e1 的结果）被后面引用过：即使它和第 5 条重复，也不许被去重掉
    refs: [3],
  },
  {
    name: '06-grep-firehose',
    shape: '全仓 grep——命中几百行，实际只看了前几条',
    events: [
      { t: 'user.input', text: '哪里还在用旧的 API' },
      { t: 'tool.call', id: 'f1', name: 'shell.exec', args: { cmd: 'grep -rn oldApi .' } },
      { t: 'tool.result', id: 'f1', ok: true, payload: lines('src/a/b/c.ts:12: oldApi(', 300), ms: 600 },
      { t: 'model.delta', text: '有三处。' },
    ],
  },
  {
    name: '07-retry-loop',
    shape: '重试三次才成功——中间两次的输出是纯噪音',
    events: [
      { t: 'user.input', text: '部署一下' },
      { t: 'tool.call', id: 'g1', name: 'shell.exec', args: { cmd: 'deploy' } },
      { t: 'tool.result', id: 'g1', ok: false, payload: lines('timeout waiting for healthcheck', 30), ms: 30000 },
      { t: 'tool.call', id: 'g2', name: 'shell.exec', args: { cmd: 'deploy' } },
      { t: 'tool.result', id: 'g2', ok: false, payload: lines('timeout waiting for healthcheck', 30), ms: 30000 },
      { t: 'tool.call', id: 'g3', name: 'shell.exec', args: { cmd: 'deploy' } },
      { t: 'tool.result', id: 'g3', ok: true, payload: 'deployed', ms: 12000 },
    ],
  },
  {
    name: '08-mixed-short',
    shape: '本来就很短的会话——**清理不该在这种会话上硬省**',
    events: [
      { t: 'user.input', text: '现在几点' },
      { t: 'tool.call', id: 'h1', name: 'shell.exec', args: { cmd: 'date' } },
      { t: 'tool.result', id: 'h1', ok: true, payload: 'Mon Sep 14 12:00:00 2026', ms: 2 },
      { t: 'model.delta', text: '中午十二点。' },
    ],
  },
  {
    name: '09-large-json',
    shape: '大块 JSON 返回——依赖树、配置导出这类',
    events: [
      { t: 'user.input', text: '看看依赖' },
      { t: 'tool.call', id: 'i1', name: 'shell.exec', args: { cmd: 'pnpm list --json' } },
      {
        t: 'tool.result',
        id: 'i1',
        ok: true,
        payload: { deps: Array.from({ length: 120 }, (_, i) => ({ name: `pkg-${i}`, version: '1.0.0' })) },
        ms: 500,
      },
      { t: 'model.delta', text: '一百二十个。' },
    ],
  },
  {
    name: '10-long-session',
    shape: '长会话——上面几种混在一起，最接近真实',
    events: [
      { t: 'user.input', text: '把这个 bug 修了' },
      { t: 'tool.call', id: 'j1', name: 'fs.read', args: { path: 'bug.ts' } },
      { t: 'tool.result', id: 'j1', ok: true, payload: lines('code', 50), ms: 3 },
      { t: 'tool.call', id: 'j2', name: 'shell.exec', args: { cmd: 'bun test' } },
      { t: 'tool.result', id: 'j2', ok: false, payload: `${lines('(fail) case', 80)}\n${stack(18)}`, ms: 4000 },
      { t: 'tool.call', id: 'j3', name: 'fs.read', args: { path: 'bug.ts' } },
      { t: 'tool.result', id: 'j3', ok: true, payload: lines('code', 50), ms: 3 },
      { t: 'tool.call', id: 'j4', name: 'fs.write', args: { path: 'bug.ts', content: 'fixed' } },
      { t: 'tool.result', id: 'j4', ok: true, payload: { bytes: 5 }, ms: 2 },
      { t: 'tool.call', id: 'j5', name: 'shell.exec', args: { cmd: 'bun test' } },
      { t: 'tool.result', id: 'j5', ok: true, payload: `${lines('(pass) case', 80)}\n 80 pass`, ms: 4100 },
      { t: 'model.delta', text: '修好了，测试全绿。' },
    ],
    refs: [4],
  },
]

function envelope(s: Session): EventEnvelope[] {
  return s.events.map((ev, i) => {
    const seq = i + 1
    // 显式引用标注挂在**最后一条**上：语义是「这一轮结束时，这些内容仍在被引用」
    const withRefs = i === s.events.length - 1 && s.refs !== undefined ? ({ ...ev, refs: s.refs } as DomiEvent) : ev
    return {
      seq,
      sessionId: s.name,
      parentSeq: seq > 1 ? seq - 1 : null,
      ts: 1_700_000_000_000 + seq,
      schemaVersion: 4,
      ev: withRefs,
    }
  })
}

if (import.meta.main) {
  mkdirSync(DIR, { recursive: true })
  for (const s of SESSIONS) {
    const path = join(DIR, `${s.name}.jsonl`)
    const header = `// ${s.shape}\n`
    const body = envelope(s)
      .map((e) => JSON.stringify(e))
      .join('\n')
    writeFileSync(path, `${header}${body}\n`, 'utf8')
    console.log(
      `[make-context-fixtures] ${path}（${s.events.length} 条${s.refs ? `，引用标注 ${s.refs.join(',')}` : ''}）`,
    )
  }
}
