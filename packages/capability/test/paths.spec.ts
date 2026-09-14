/**
 * PRD-M0-003 AC-5 · 8 类路径穿越用例全部被拒
 * SPEC-M0-005 —— 全项目只有 resolveWithinRoot 一处做路径校验
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathEscapeError, resolveWithinRoot } from '../src/index.ts'

const base = mkdtempSync(join(tmpdir(), 'domi-paths-'))
const root = join(base, 'work')
mkdirSync(join(root, 'sub'), { recursive: true })
writeFileSync(join(root, 'ok.txt'), 'ok')
writeFileSync(join(base, 'secret.txt'), 'secret')
symlinkSync(join(base, 'secret.txt'), join(root, 'link-out'))
symlinkSync(join(root, 'ok.txt'), join(root, 'link-in'))
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('AC-5 · 8 类穿越全部被拒', () => {
  test.each([
    ['相对 ../', '../secret.txt'],
    ['深层 ../', 'sub/../../secret.txt'],
    ['绝对路径', '/etc/passwd'],
    ['符号链接指向外部', 'link-out'],
    ['URL 编码分隔符', '..%2fsecret.txt'],
    ['NUL 截断', 'ok.txt\0.png'],
    ['UNC 路径', '\\\\server\\share\\x'],
    ['~ 展开', '~/.ssh/id_rsa'],
  ])('%s', (_label, p) => {
    expect(() => resolveWithinRoot(root, p)).toThrow(PathEscapeError)
  })
})

describe('合法路径照常放行', () => {
  test.each([
    ['工作目录内的文件', 'ok.txt'],
    ['子目录', 'sub/../ok.txt'],
    ['指向内部的符号链接', 'link-in'],
    ['还不存在的新文件（fs.write 要用）', 'sub/new-file.txt'],
    ['根目录自身', '.'],
  ])('%s', (_label, p) => {
    expect(() => resolveWithinRoot(root, p)).not.toThrow()
  })

  test('符号链接被解析到真实路径，而不是原样返回', () => {
    expect(resolveWithinRoot(root, 'link-in')).toBe(resolveWithinRoot(root, 'ok.txt'))
  })
})
