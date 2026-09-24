/**
 * 输入框里的斜杠命令。只做「这行字是什么意思」，不做事——执行在 main.tsx 里，
 * 结果由事件自己显示在对话里（ctx.compact / model.switch），不另塞界面状态。
 * 单独成文件是为了能测：Ink 的按键在无 TTY 环境里验不了（docs/adr/001）
 */

import { continuePrompt, type RefLink } from '@domi/client-core'
import { tr } from '@domi/i18n'

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
  | { kind: 'permissions-mode'; mode: 'always-ask' | 'on-demand' | 'allow-all' }
  | { kind: 'budget'; budget: { tokens?: number; costUsd?: number; toolCalls?: number } }
  | { kind: 'changes'; path?: string }
  | { kind: 'discard'; path: string }
  | { kind: 'undo'; trash: string }
  | { kind: 'apply'; mode: 'squash' | 'merge' | 'branch' }
  | { kind: 'settings' } // PRD-M10-004 AC-1：TUI 设置入口（本轮只做语言切换）
  | { kind: 'unqueue' } // PRD-M13-001 AC-6：撤回最后一条排队中的补充
  | { kind: 'invalid'; message: string }

/** 命令表：`/` 补全与帮助弹层用（PRD-M8-015 AC-5）。和 parseSlash 的分支一一对应 */
export const COMMANDS = (): ReadonlyArray<{ name: string; args?: string; desc: string }> => [
  { name: '/new', desc: tr('tui.cmd.new') },
  { name: '/sessions', args: '[--all]', desc: tr('tui.cmd.sessions') },
  { name: '/open', args: tr('tui.cmd.argSession'), desc: tr('tui.cmd.open') },
  { name: '/delete', args: tr('tui.cmd.argSession'), desc: tr('tui.cmd.delete') },
  { name: '/restore', args: tr('tui.cmd.argSession'), desc: tr('tui.cmd.restore') },
  { name: '/branch', args: '[seq]', desc: tr('tui.cmd.branch') },
  { name: '/ref', args: tr('tui.cmd.argRef'), desc: tr('tui.cmd.ref') },
  { name: '/model', args: tr('tui.cmd.argModel'), desc: tr('tui.cmd.model') },
  { name: '/continue', args: '', desc: tr('tui.cmd.continue') },
  { name: '/unqueue', desc: tr('tui.cmd.unqueue') },
  { name: '/mode', args: '[on-demand|always-ask|allow-all]', desc: tr('tui.cmd.permissionsMode') },
  { name: '/compact', desc: tr('tui.cmd.compact') },
  { name: '/budget', args: tr('tui.cmd.argBudget'), desc: tr('tui.cmd.budget') },
  { name: '/changes', args: tr('tui.cmd.argFileOpt'), desc: tr('tui.cmd.changes') },
  { name: '/discard', args: tr('tui.cmd.argFile'), desc: tr('tui.cmd.discard') },
  { name: '/undo', args: tr('tui.cmd.argTrash'), desc: tr('tui.cmd.undo') },
  { name: '/apply', args: '[squash|merge|branch]', desc: tr('tui.cmd.apply') },
  { name: '/soul', args: '[accept|reject <id>]', desc: tr('tui.cmd.soul') },
  { name: '/memory', args: tr('tui.cmd.argQuery'), desc: tr('tui.cmd.memory') },
  { name: '/extract', desc: tr('tui.cmd.extract') },
  { name: '/settings', desc: tr('tui.cmd.settings') },
]

/** 输入框里还在打命令名（`/` 开头、没有空格）时，给出候选 */
export function completeSlash(draft: string): Array<ReturnType<typeof COMMANDS>[number]> {
  if (!draft.startsWith('/') || /\s/.test(draft)) return []
  return COMMANDS().filter((c) => c.name.startsWith(draft))
}

/** lastSeq = 当前对话里最后一条的 seq；`/branch` 不带数字时从这里分 */
export function parseSlash(text: string, lastSeq: number): SlashCommand {
  const [cmd, ...rest] = text.split(/\s+/)
  switch (cmd) {
    case '/compact':
      return { kind: 'compact' } // PRD-M2-003 AC-1
    case '/model': // PRD-M12-001：只开选择器，不接受手填模型名
      if (!rest[0]) return { kind: 'model-picker' }
      return { kind: 'invalid', message: tr('tui.usage.modelNoArg') }
    case '/branch': {
      // parity 第 7 项。常用的是不带数字；带数字时和 Web 端「分支」按钮是同一套视图编号
      const at = rest[0] === undefined ? lastSeq : Number(rest[0])
      if (!Number.isInteger(at) || at < 1) {
        return {
          kind: 'invalid',
          message: rest[0] === undefined ? tr('tui.usage.branchEmpty') : tr('tui.usage.branch'),
        }
      }
      return { kind: 'branch', atSeq: at }
    }
    case '/ref': {
      // PRD-M3-005。会话 id 从 `domi session list` 里看；区间不给就是整个会话（终点由 daemon 截到末尾）
      const usage = { kind: 'invalid' as const, message: tr('tui.usage.ref') }
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
      if (rest[0] !== undefined && rest[0] !== '--all') return { kind: 'invalid', message: tr('tui.usage.sessions') }
      return { kind: 'sessions', includeDeleted: rest[0] === '--all' }
    case '/new':
      return { kind: 'new' }
    case '/open':
    case '/delete':
    case '/restore': {
      if (!rest[0]) return { kind: 'invalid', message: tr('tui.usage.sessionArg', { cmd }) }
      const kind = cmd.slice(1) as 'open' | 'delete' | 'restore'
      return { kind, sessionId: rest[0] }
    }
    // 记忆与 Soul（PRD-M4）
    case '/soul': {
      if (rest[0] === undefined) return { kind: 'soul' }
      if ((rest[0] === 'accept' || rest[0] === 'reject') && rest[1]) {
        return { kind: 'soul-review', changeId: rest[1], decision: rest[0] }
      }
      return { kind: 'invalid', message: tr('tui.usage.soul') }
    }
    case '/memory':
      return { kind: 'memory', query: rest.join(' ') }
    case '/extract':
      return { kind: 'extract' }
    case '/settings':
      return { kind: 'settings' } // PRD-M10-004 AC-1
    // PRD-M12-004 AC-10：续跑 = 替用户说一句「接着做」，计划本身已经在上下文里
    case '/continue':
      return { kind: 'submit', text: continuePrompt() }
    case '/unqueue':
      return { kind: 'unqueue' }
    case '/mode': {
      // PRD-M12-002：会话确认模式三档
      if (!rest[0]) return { kind: 'invalid', message: tr('tui.usage.permissionsMode') }
      if (rest.length > 1) return { kind: 'invalid', message: tr('tui.usage.permissionsMode') }
      const m = rest[0]
      if (m !== 'on-demand' && m !== 'always-ask' && m !== 'allow-all') {
        return { kind: 'invalid', message: tr('tui.usage.permissionsMode') }
      }
      return { kind: 'permissions-mode', mode: m }
    }
    // 用量上限（PRD-M7-009）：/budget tokens 200000 · /budget cost 2 · /budget calls 100
    case '/budget': {
      const key = { tokens: 'tokens', cost: 'costUsd', calls: 'toolCalls' }[rest[0] ?? ''] as
        | 'tokens'
        | 'costUsd'
        | 'toolCalls'
        | undefined
      const n = Number(rest[1])
      if (!key || !Number.isFinite(n) || n <= 0 || (key !== 'costUsd' && !Number.isInteger(n))) {
        return { kind: 'invalid', message: tr('tui.usage.budget') }
      }
      return { kind: 'budget', budget: { [key]: n } }
    }
    // 隔离会话的改动审阅（PRD-M7-006）
    case '/changes':
      return rest[0] ? { kind: 'changes', path: rest[0] } : { kind: 'changes' }
    case '/discard':
      return rest[0] ? { kind: 'discard', path: rest[0] } : { kind: 'invalid', message: tr('tui.usage.discard') }
    case '/undo':
      return rest[0] && /^\d+$/.test(rest[0])
        ? { kind: 'undo', trash: rest[0] }
        : { kind: 'invalid', message: tr('tui.usage.undo') }
    case '/apply': {
      const mode = rest[0] ?? 'squash'
      return mode === 'squash' || mode === 'merge' || mode === 'branch'
        ? { kind: 'apply', mode }
        : { kind: 'invalid', message: tr('tui.usage.apply') }
    }
    default:
      return { kind: 'submit', text }
  }
}
