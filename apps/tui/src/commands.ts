/**
 * 输入框里的斜杠命令。只做「这行字是什么意思」，不做事——执行在 main.tsx 里，
 * 结果由事件自己显示在对话里（ctx.compact / model.switch），不另塞界面状态。
 * 单独成文件是为了能测：Ink 的按键在无 TTY 环境里验不了（docs/adr/001）
 */
import type { RefLink } from '@domi/client-core'

export type SlashCommand =
  | { kind: 'submit'; text: string }
  | { kind: 'compact' }
  | { kind: 'model'; model: string }
  | { kind: 'model-picker' }
  | { kind: 'branch'; atSeq: number }
  | { kind: 'ref'; ref: RefLink }
  | { kind: 'sessions'; includeDeleted: boolean }
  | { kind: 'open'; sessionId: string }
  | { kind: 'new' }
  | { kind: 'delete'; sessionId: string }
  | { kind: 'restore'; sessionId: string }
  | { kind: 'soul' }
  | { kind: 'soul-review'; changeId: string; decision: 'accept' | 'reject' }
  | { kind: 'memory'; query: string }
  | { kind: 'extract' }
  | { kind: 'mode'; mode: 'plan' | 'act' }
  | { kind: 'budget'; budget: { tokens?: number; costUsd?: number; toolCalls?: number } }
  | { kind: 'changes'; path?: string }
  | { kind: 'discard'; path: string }
  | { kind: 'undo'; trash: string }
  | { kind: 'apply'; mode: 'squash' | 'merge' | 'branch' }
  | { kind: 'invalid'; message: string }

/** 命令表：`/` 补全与帮助弹层用（PRD-M8-015 AC-5）。和 parseSlash 的分支一一对应 */
export const COMMANDS: ReadonlyArray<{ name: string; args?: string; desc: string }> = [
  { name: '/new', desc: '新会话' },
  { name: '/sessions', args: '[--all]', desc: '列出会话' },
  { name: '/open', args: '<会话 id>', desc: '打开会话' },
  { name: '/delete', args: '<会话 id>', desc: '删除会话（可恢复）' },
  { name: '/restore', args: '<会话 id>', desc: '恢复删除的会话' },
  { name: '/branch', args: '[seq]', desc: '从这里分支' },
  { name: '/ref', args: '<会话 id> [起-止]', desc: '下一句话引用另一个会话' },
  { name: '/plan', desc: '切到计划模式' },
  { name: '/act', desc: '切回执行模式' },
  { name: '/model', args: '[模型]', desc: '换模型（不带参数打开模型列表）' },
  { name: '/compact', desc: '压缩上下文' },
  { name: '/budget', args: 'tokens|cost|calls <数>', desc: '设用量上限' },
  { name: '/changes', args: '[文件]', desc: '看单独工作区里的改动' },
  { name: '/discard', args: '<文件>', desc: '丢弃一个文件的改动' },
  { name: '/undo', args: '<编号>', desc: '撤销丢弃' },
  { name: '/apply', args: '[squash|merge|branch]', desc: '把改动带回原仓库' },
  { name: '/soul', args: '[accept|reject <id>]', desc: 'Soul 待审阅的改动' },
  { name: '/memory', args: '[关键词]', desc: '查记忆' },
  { name: '/extract', desc: '从这个会话提取记忆' },
]

/** 输入框里还在打命令名（`/` 开头、没有空格）时，给出候选 */
export function completeSlash(draft: string): Array<(typeof COMMANDS)[number]> {
  if (!draft.startsWith('/') || /\s/.test(draft)) return []
  return COMMANDS.filter((c) => c.name.startsWith(draft))
}

/** lastSeq = 当前对话里最后一条的 seq；`/branch` 不带数字时从这里分 */
export function parseSlash(text: string, lastSeq: number): SlashCommand {
  const [cmd, ...rest] = text.split(/\s+/)
  switch (cmd) {
    case '/compact':
      return { kind: 'compact' } // PRD-M2-003 AC-1
    case '/model': // PRD-M1-002 · parity 第 10 项 · PRD-M9-003 AC-4
      // 只接受模型名：归属哪一家由 daemon 定（provider 是配置概念，不在对话里切）
      if (!rest[0]) return { kind: 'model-picker' }
      if (rest.length > 1) return { kind: 'invalid', message: '用法：/model [模型名]——只填模型名，供应商由设置决定' }
      return { kind: 'model', model: rest[0] }
    case '/branch': {
      // parity 第 7 项。常用的是不带数字；带数字时和 Web 端「分支」按钮是同一套视图编号
      const at = rest[0] === undefined ? lastSeq : Number(rest[0])
      if (!Number.isInteger(at) || at < 1) {
        return {
          kind: 'invalid',
          message: rest[0] === undefined ? '对话还是空的，没有可以分支的地方' : '用法：/branch [seq]',
        }
      }
      return { kind: 'branch', atSeq: at }
    }
    case '/ref': {
      // PRD-M3-005。会话 id 从 `domi session list` 里看；区间不给就是整个会话（终点由 daemon 截到末尾）
      const usage = { kind: 'invalid' as const, message: '用法：/ref <会话 id> [起-止]，下一句话会带上这段引用' }
      if (!rest[0]) return usage
      if (rest[1] === undefined) {
        return { kind: 'ref', ref: { sessionId: rest[0], fromSeq: 1, toSeq: Number.MAX_SAFE_INTEGER } }
      }
      const m = rest[1].match(/^(\d+)(?:-(\d+))?$/)
      const from = Number(m?.[1])
      const to = m?.[2] === undefined ? from : Number(m[2])
      if (!m || from < 1 || to < from) return usage
      return { kind: 'ref', ref: { sessionId: rest[0], fromSeq: from, toSeq: to } }
    }
    // 会话管理（parity 第 5、6、8 项）
    case '/sessions':
      if (rest[0] !== undefined && rest[0] !== '--all') return { kind: 'invalid', message: '用法：/sessions [--all]' }
      return { kind: 'sessions', includeDeleted: rest[0] === '--all' }
    case '/new':
      return { kind: 'new' }
    case '/open':
    case '/delete':
    case '/restore': {
      if (!rest[0]) return { kind: 'invalid', message: `用法：${cmd} <会话 id>（/sessions 可以看到 id）` }
      const kind = cmd.slice(1) as 'open' | 'delete' | 'restore'
      return { kind, sessionId: rest[0] }
    }
    // 记忆与 Soul（PRD-M4）
    case '/soul': {
      if (rest[0] === undefined) return { kind: 'soul' }
      if ((rest[0] === 'accept' || rest[0] === 'reject') && rest[1]) {
        return { kind: 'soul-review', changeId: rest[1], decision: rest[0] }
      }
      return { kind: 'invalid', message: '用法：/soul 看待审阅的改动；/soul accept|reject <改动 id>' }
    }
    case '/memory':
      return { kind: 'memory', query: rest.join(' ') }
    case '/extract':
      return { kind: 'extract' }
    case '/plan':
      return { kind: 'mode', mode: 'plan' } // PRD-M7-005
    case '/act':
      return { kind: 'mode', mode: 'act' }
    // 用量上限（PRD-M7-009）：/budget tokens 200000 · /budget cost 2 · /budget calls 100
    case '/budget': {
      const key = { tokens: 'tokens', cost: 'costUsd', calls: 'toolCalls' }[rest[0] ?? ''] as
        | 'tokens'
        | 'costUsd'
        | 'toolCalls'
        | undefined
      const n = Number(rest[1])
      if (!key || !Number.isFinite(n) || n <= 0 || (key !== 'costUsd' && !Number.isInteger(n))) {
        return { kind: 'invalid', message: '用法：/budget tokens <数量> | /budget cost <美元> | /budget calls <次数>' }
      }
      return { kind: 'budget', budget: { [key]: n } }
    }
    // 隔离会话的改动审阅（PRD-M7-006）
    case '/changes':
      return rest[0] ? { kind: 'changes', path: rest[0] } : { kind: 'changes' }
    case '/discard':
      return rest[0] ? { kind: 'discard', path: rest[0] } : { kind: 'invalid', message: '用法：/discard <文件>' }
    case '/undo':
      return rest[0] && /^\d+$/.test(rest[0])
        ? { kind: 'undo', trash: rest[0] }
        : { kind: 'invalid', message: '用法：/undo <回收站编号>（/discard 时给出的）' }
    case '/apply': {
      const mode = rest[0] ?? 'squash'
      return mode === 'squash' || mode === 'merge' || mode === 'branch'
        ? { kind: 'apply', mode }
        : { kind: 'invalid', message: '用法：/apply [squash|merge|branch]' }
    }
    default:
      return { kind: 'submit', text }
  }
}
