/**
 * 审阅子 agent —— PRD-M7-010 · SPEC-M7-010
 *
 * 一个只读的新会话：输入是改动 diff 与需求文档，**不带发起会话的任何历史**——
 * 没看过实现过程的眼睛才问得出实现者想不到的问题（PROCESS.md 验收环节的同一个立场）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Tool } from '@domi/capability'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import { z } from 'zod'

export const REVIEW_PREFIX = 'review-'
/** 审阅会话能用的能力：只读 + 提交发现 */
export const REVIEW_SCOPE = ['fs.read', 'code.*', 'review.report'] as const
export const REVIEW_REPORT_RULE = { name: 'review-report', capability: 'review.report', decision: 'allow' as const }

const DIFF_MAX = 200_000
const SPEC_MAX = 50_000

export const ReviewFinding = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  severity: z.enum(['high', 'medium', 'low']),
  problem: z.string().min(1).describe('问题是什么，会导致什么后果'),
  basis: z.string().min(1).describe('依据：需求文档的哪一条、或代码里的哪处事实'),
})
export const ReviewReportArgs = z.object({ findings: z.array(ReviewFinding) })

export function makeReviewReportTool(): Tool<z.infer<typeof ReviewReportArgs>, { recorded: number; next: string }> {
  return {
    name: 'review.report',
    capability: 'review.report',
    description: '提交审阅发现（结构化）。审完调用一次；没有发现问题也要提交空列表。',
    schema: ReviewReportArgs,
    async execute(args, ctx) {
      ctx.emit({ t: 'review.findings', findings: args.findings })
      return { recorded: args.findings.length, next: '已记录。用一两句话总结后结束。' }
    },
  }
}

export class ReviewInputError extends KeyedError {
  constructor(key: MessageKey, params?: Params) {
    super(key, params)
    this.name = 'ReviewInputError'
  }
}

/** 相对 base（默认 HEAD）的改动，含未跟踪文件 */
export function collectDiff(cwd: string, base = 'HEAD'): string {
  const inRepo = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  if (inRepo.status !== 0) throw new ReviewInputError('error.review.notGit', { cwd })
  const tracked = spawnSync('git', ['diff', '--no-color', base, '--'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (tracked.status !== 0)
    throw new ReviewInputError('error.review.diffFailed', { base, detail: (tracked.stderr ?? '').trim() })
  let out = tracked.stdout
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' })
  for (const f of (untracked.stdout ?? '').split('\0').filter(Boolean)) {
    out += spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], {
      cwd,
      encoding: 'utf8',
    }).stdout
  }
  if (out.trim() === '') throw new ReviewInputError('error.review.noChanges', { base })
  return out.length > DIFF_MAX ? `${out.slice(0, DIFF_MAX)}\n…（diff 太长，已截断；需要时用 fs.read 看完整文件）` : out
}

export function readSpecs(cwd: string, specs: readonly string[]): Array<{ path: string; text: string }> {
  return specs.map((p) => {
    const abs = isAbsolute(p) ? p : join(cwd, p)
    if (!existsSync(abs)) throw new ReviewInputError('error.review.noSpec', { path: p })
    const t = readFileSync(abs, 'utf8')
    return { path: p, text: t.length > SPEC_MAX ? `${t.slice(0, SPEC_MAX)}\n…（已截断）` : t }
  })
}

export function reviewPrompt(diff: string, specs: ReadonlyArray<{ path: string; text: string }>, base: string): string {
  return [
    '你是这次改动的审阅者。你没有参与实现，也看不到实现过程——只根据下面的需求与改动判断。',
    '',
    '要做的：',
    '1. 对照需求逐条检查：有没有漏做、做错、做过头；每条验收标准有没有被测试覆盖到',
    '2. 找出实现里的缺陷：边界条件、错误处理、并发、安全（越权、注入、凭据泄露）',
    '3. 需要时用 fs.read / fs.grep / code.outline 看完整文件，不要只看 diff 猜',
    '4. 审完调用一次 review.report 提交结构化发现（没发现问题就提交空列表），然后用一两句话总结',
    '',
    '只报真实的问题，每条都要有依据（需求的哪一条，或代码里的哪处事实）。风格偏好不算问题。',
    '你只能读，不能改任何东西。',
    '',
    specs.length === 0
      ? '（没有给需求文档：只按通用标准审）'
      : specs.map((s) => `===== 需求文档：${s.path} =====\n${s.text}`).join('\n\n'),
    '',
    `===== 改动（相对 ${base}）=====`,
    diff,
  ].join('\n')
}
