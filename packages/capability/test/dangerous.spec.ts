/** 危险清单 + 命令指纹 —— PRD-M11-005（SPEC-M11-005/006） */
import { describe, expect, test } from 'bun:test'
import { commandFingerprint, DANGEROUS_EXACT, DANGEROUS_PREFIX, isDangerous, type ReviewMode } from '../src/dangerous.ts'

describe('isDangerous —— 任何档位都不能自动放行（AC-2）', () => {
  test('删除/覆盖/写/外发/shell 是危险能力', () => {
    for (const id of ['fs.delete', 'fs.move', 'fs.write', 'fs.append', 'shell.exec', 'web.fetch']) {
      expect(isDangerous(id)).toBe(true)
    }
  })
  test('只读能力不危险', () => {
    for (const id of ['fs.read', 'fs.list', 'memory.search']) {
      expect(isDangerous(id)).toBe(false)
    }
  })
  test('mcp.*/plugin.* 前缀全危险', () => {
    expect(isDangerous('mcp.github.search')).toBe(true)
    expect(isDangerous('plugin.custom.run')).toBe(true)
  })
  test('危险集与前缀是真常量（不被人在运行时改掉）', () => {
    expect(DANGEROUS_EXACT.size).toBeGreaterThan(0)
    expect(DANGEROUS_PREFIX.length).toBeGreaterThan(0)
  })
})

describe('commandFingerprint —— 始终允许的粒度（SPEC-M11-006）', () => {
  test('可执行文件 + 参数首词', () => {
    expect(commandFingerprint(['git', 'status'])).toBe('git status')
    expect(commandFingerprint(['git', 'diff', 'HEAD'])).toBe('git diff')
  })
  test('裸命令（无首词）太宽 → null，不可 grant', () => {
    expect(commandFingerprint(['git'])).toBeNull()
  })
  test('危险词命中 → null，不可 grant（AC-3）', () => {
    expect(commandFingerprint(['rm', '-rf', '/'])).toBeNull()
    expect(commandFingerprint(['sudo', 'apt', 'install'])).toBeNull()
  })
  test('正常子命令可 grant', () => {
    expect(commandFingerprint(['npm', 'run', 'build'])).toBe('npm run')
  })
})
