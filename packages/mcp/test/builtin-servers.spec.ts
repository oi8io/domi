/**
 * PRD-M2-009 · 内置 MCP server 清单（browser use / computer use）· ADR-016
 *
 * AC-2（同一条权限路径、二进制不进正文）与 AC-3（失败降级）由 hub.spec 覆盖；
 * 这里验 AC-1：模板里一键启用，且 packages/ 下没有任何自研的浏览器 / GUI 自动化。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PermissionEngine } from '@domi/capability'
import { CONFIG_TEMPLATE } from '@domi/cli'
import { loadConfig } from '@domi/config'

const FIXTURE = join('packages', 'mcp', 'src', '__automation_fixture.ts')
afterEach(() => {
  if (!existsSync(FIXTURE)) return
  try {
    rmSync(FIXTURE)
  } catch {
    writeFileSync(FIXTURE, 'export {}\n', 'utf8')
  }
})

function templateConfig() {
  const d = mkdtempSync(join(tmpdir(), 'domi-builtin-'))
  const p = join(d, 'config.yaml')
  writeFileSync(p, CONFIG_TEMPLATE(), 'utf8')
  const cfg = loadConfig({ path: p, env: {} })
  rmSync(d, { recursive: true, force: true })
  return cfg
}

describe('AC-1 · 模板里一键启用', () => {
  test('browser 与 computer 两个 server 都在，默认不启用，版本钉死', () => {
    const servers = templateConfig().mcp.servers
    const browser = servers.find((s) => s.name === 'browser')
    const computer = servers.find((s) => s.name === 'computer')
    expect(browser).toMatchObject({ command: 'npx', enabled: false })
    expect(browser?.args).toContain('@playwright/mcp@0.0.81')
    expect(browser?.args).toContain('--headless')
    expect(computer).toMatchObject({ command: 'npx', enabled: false })
    expect(computer?.args).toContain('@zavora-ai/computer-use-mcp@7.4.0')
  })

  test('「一键」就是把 enabled 改成 true：别的什么都不用加', () => {
    const on = CONFIG_TEMPLATE().replace(/enabled: false/g, 'enabled: true')
    const d = mkdtempSync(join(tmpdir(), 'domi-builtin-'))
    writeFileSync(join(d, 'config.yaml'), on, 'utf8')
    const servers = loadConfig({ path: join(d, 'config.yaml'), env: {} }).mcp.servers
    rmSync(d, { recursive: true, force: true })
    expect(servers.filter((s) => s.enabled).map((s) => s.name)).toEqual(['browser', 'computer'])
  })

  test('AC-2 · 模板的权限：两组工具默认每一步都要确认（ask），不是放行', async () => {
    const rules = templateConfig().permissions.rules
    const engine = new PermissionEngine({ rules })
    const decision = async (cap: string) => {
      const asked: string[] = []
      const e = new PermissionEngine({ rules }, async (c) => {
        asked.push(c)
        return false
      })
      await e.check(cap, {})
      return asked
    }
    expect(await decision('mcp.browser.browser_navigate')).toEqual(['mcp.browser.browser_navigate'])
    expect(await decision('mcp.computer.run_script')).toEqual(['mcp.computer.run_script'])
    // 没人可问时是拒绝
    expect((await engine.check('mcp.computer.left_click', {})).decision).toBe('deny')
  })
})

async function guard(): Promise<{ code: number; err: string }> {
  const p = Bun.spawn(['bun', 'run', 'scripts/check-no-selfimpl-automation.ts'], { stdout: 'pipe', stderr: 'pipe' })
  const err = await new Response(p.stderr).text()
  return { code: await p.exited, err }
}

describe('AC-1 · packages/ 下没有自研的浏览器 / GUI 自动化（guard:automation）', () => {
  for (const [name, code] of [
    ['import playwright', "export { chromium } from 'playwright'\n"],
    ['import puppeteer', "import puppeteer from 'puppeteer'\nexport default puppeteer\n"],
    ['require nut-js', "export const nut = require('@nut-tree/nut-js')\n"],
    ['动态 import robotjs', "export const r = () => import('robotjs')\n"],
  ] as const) {
    test(`守卫会红：${name}`, async () => {
      writeFileSync(FIXTURE, code, 'utf8')
      const r = await guard()
      expect(r.code).not.toBe(0)
      expect(r.err).toContain('__automation_fixture.ts')
    })
  }

  test('真实仓库是干净的', async () => {
    const r = await guard()
    if (r.code !== 0) throw new Error(r.err)
  })

  test('接线：guard 链里有 guard:automation', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['guard:automation']).toBe('bun run scripts/check-no-selfimpl-automation.ts')
    expect(pkg.scripts.guard?.split('&&').map((s) => s.trim())).toContain('pnpm guard:automation')
  })
})
