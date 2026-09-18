/**
 * PRD-M9-004 AC-2 / AC-3 · CLI 的两份大文本（--help 与 domi init 模板）两种语言都完整、可用
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@domi/config'
import { setLocale } from '@domi/i18n'
import { CONFIG_TEMPLATE, HELP } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  setLocale('zh')
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function load(text: string) {
  const d = mkdtempSync(join(tmpdir(), 'domi-tpl-'))
  dirs.push(d)
  writeFileSync(join(d, 'config.yaml'), text)
  return loadConfig({ path: join(d, 'config.yaml'), env: {} })
}

describe('PRD-M9-004 · CLI 的大段文案', () => {
  test('English 的 --help 与 init 模板里没有中文', () => {
    setLocale('en')
    expect(HELP()).not.toMatch(/[㐀-鿿]/)
    expect(CONFIG_TEMPLATE()).not.toMatch(/[㐀-鿿]/)
  })

  test('两种语言的 init 模板只差注释：装载出来的配置完全相同', () => {
    const zh = load(CONFIG_TEMPLATE())
    setLocale('en')
    const en = load(CONFIG_TEMPLATE())
    expect(en).toEqual(zh)
  })

  test('模板跟上 M9：默认模型指向 providers 里的一家，厂商写明；/model 不再有 provider 参数', () => {
    const cfg = load(CONFIG_TEMPLATE())
    expect(cfg.providers[cfg.model.provider]?.vendor).toBe('anthropic')
    expect(HELP()).not.toContain('[provider]')
  })
})
