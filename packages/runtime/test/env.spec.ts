/**
 * PRD-M15-010 AC-2 · 环境两半
 * 定格一半（os/shell/项目根/项目类型/包管理器/git 远端）——会话开始采集一次，进冻结前缀
 * 会变一半（日期/git 分支与改动文件数）——每轮采集，变化走 ctx.note 追加（session 侧）
 *
 * 后台作业：domi 目前没有后台作业机制，SPEC-M15-010 提到的「后台作业」留待机制出现再接（取舍记录见 docs/tasks/M15.md）
 */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectEnv, collectEnvDynamic } from '../src/env.ts'

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'domi-env-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'env-fixture' }))
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:o/domi.git'])
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  })
  return dir
}

describe('定格一半：collectEnv', () => {
  test('带 package.json + git remote 的目录：全部字段非空且正确', () => {
    const dir = makeRepo()
    try {
      const env = collectEnv(dir)
      expect(env.os).toContain('darwin')
      expect(env.shell.length).toBeGreaterThan(0)
      expect(env.projectRoot).toBe(dir)
      expect(env.projectType).toBe('node')
      expect(env.pkgManager.length).toBeGreaterThan(0)
      expect(env.gitRemote).toBe('git@github.com:o/domi.git')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('没有 git 的目录：gitRemote 为 null，其余照常', () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-env-'))
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'no-git' }))
      const env = collectEnv(dir)
      expect(env.gitRemote).toBeNull()
      expect(env.projectRoot).toBe(dir)
      expect(env.projectType).toBe('node')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('会变一半：collectEnvDynamic', () => {
  test('日期非空；有 git 时分支与改动文件数可用', () => {
    const dir = makeRepo()
    try {
      const dyn = collectEnvDynamic(dir)
      expect(dyn.date.length).toBe(10) // YYYY-MM-DD
      expect(dyn.gitBranch).not.toBeNull()
      expect((dyn.gitBranch ?? '').length).toBeGreaterThan(0)
      expect(dyn.gitChanged).not.toBeNull()
      expect(dyn.gitChanged ?? 0).toBeGreaterThanOrEqual(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('没有 git 的目录：分支/改动为 null，不抛', () => {
    const dir = mkdtempSync(join(tmpdir(), 'domi-env-'))
    try {
      const dyn = collectEnvDynamic(dir)
      expect(dyn.gitBranch).toBeNull()
      expect(dyn.gitChanged).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
