/**
 * 自动隔离 —— PRD-M8-006 AC-1 / AC-3 · SPEC-M8-006 取舍-6
 *
 * 判据是「要不要避开用户的工作区」，不是「用户懂不懂 worktree」：
 * 脏工作区、多节点、定时触发才隔离；干净的工作区直接改（步级快照兜底），非 git 目录退回快照。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideIsolation } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function repo(opts: { commit?: boolean; dirty?: boolean } = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-iso-'))
  dirs.push(d)
  execSync('git init -q', { cwd: d })
  if (opts.commit !== false) {
    execSync('git -c user.email=a@b -c user.name=a commit -q --allow-empty -m init', { cwd: d })
  }
  if (opts.dirty) writeFileSync(join(d, 'dirty.txt'), 'x')
  return d
}

function plain(): string {
  const d = mkdtempSync(join(tmpdir(), 'domi-plain-'))
  dirs.push(d)
  return d
}

describe('PRD-M8-006 AC-1 · auto：脏工作区 / 多节点 / 定时触发才隔离', () => {
  test('干净的仓库不隔离——直接改，用户在自己的编辑器里就能看见', () => {
    expect(decideIsolation({ policy: 'auto', cwd: repo() })).toEqual({ isolate: false, reason: 'clean' })
  })

  test('有未提交改动就隔离', () => {
    expect(decideIsolation({ policy: 'auto', cwd: repo({ dirty: true }) })).toEqual({
      isolate: true,
      reason: 'dirty-worktree',
    })
  })

  test('定时触发（无人值守）就隔离', () => {
    expect(decideIsolation({ policy: 'auto', cwd: repo(), trigger: 'schedule' })).toEqual({
      isolate: true,
      reason: 'scheduled',
    })
  })

  test('多节点就隔离（计划批准转运行时才知道）', () => {
    expect(decideIsolation({ policy: 'auto', cwd: repo(), shape: 'dag' })).toEqual({ isolate: true, reason: 'dag' })
    expect(decideIsolation({ policy: 'auto', cwd: repo(), shape: 'single' })).toMatchObject({ isolate: false })
  })

  test('always / never 压过一切', () => {
    expect(decideIsolation({ policy: 'always', cwd: repo() })).toEqual({ isolate: true, reason: 'policy-always' })
    expect(decideIsolation({ policy: 'never', cwd: repo({ dirty: true }), trigger: 'schedule' })).toEqual({
      isolate: false,
      reason: 'policy-never',
    })
  })
})

describe('PRD-M8-006 AC-3 · 非 git 目录退回步级快照', () => {
  test('不是仓库 → 不隔离', () => {
    expect(decideIsolation({ policy: 'auto', cwd: plain() })).toEqual({ isolate: false, reason: 'not-a-repo' })
    expect(decideIsolation({ policy: 'always', cwd: plain() })).toEqual({ isolate: false, reason: 'not-a-repo' })
  })

  test('仓库还没有任何提交 → 也建不了 worktree，不隔离', () => {
    expect(decideIsolation({ policy: 'always', cwd: repo({ commit: false, dirty: true }) })).toEqual({
      isolate: false,
      reason: 'not-a-repo',
    })
  })
})
