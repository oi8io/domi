/**
 * 要不要隔离 —— PRD-M8-006 AC-1 · SPEC-M8-006 · 取舍-6
 *
 * auto：git 仓库里，且（工作区有未提交改动 或 定时触发）才隔离。工作区干净时直接改 + 步级快照就够安全，
 * 用户还能在自己的编辑器里实时看到改动。多节点（dag）在规划之后才知道，这一版不据此隔离（记在 SPEC 留白）。
 */
import { spawnSync } from 'node:child_process'

export type IsolationReason =
  | 'policy-always'
  | 'policy-never'
  | 'dirty-worktree'
  | 'scheduled'
  | 'clean'
  | 'not-a-repo'
  | 'requested'

export interface IsolationDecision {
  isolate: boolean
  reason: IsolationReason
}

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: r.status === 0, out: r.stdout ?? '' }
}

export function decideIsolation(opts: {
  policy: 'auto' | 'always' | 'never'
  cwd: string
  trigger?: 'user' | 'schedule'
}): IsolationDecision {
  const inRepo = git(opts.cwd, ['rev-parse', '--show-toplevel']).ok
  // 有没有提交过：没有 HEAD 的仓库建不了 worktree
  const hasHead = inRepo && git(opts.cwd, ['rev-parse', 'HEAD']).ok
  if (opts.policy === 'never') return { isolate: false, reason: 'policy-never' }
  if (!inRepo || !hasHead) return { isolate: false, reason: 'not-a-repo' }
  if (opts.policy === 'always') return { isolate: true, reason: 'policy-always' }
  if (opts.trigger === 'schedule') return { isolate: true, reason: 'scheduled' }
  const dirty = git(opts.cwd, ['status', '--porcelain']).out.trim() !== ''
  return dirty ? { isolate: true, reason: 'dirty-worktree' } : { isolate: false, reason: 'clean' }
}
