/**
 * PRD-M9-004 AC-1 / AC-2 · t() 的渲染、插值、复数与语言解析
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  envLocaleHints,
  format,
  getLocale,
  isMessageKey,
  onLocaleChange,
  paramNames,
  resolveLocale,
  setLocale,
  t,
} from '../src/index.ts'

afterEach(() => setLocale('zh'))

describe('PRD-M9-004 AC-2 · 模板', () => {
  test('插值；参数缺了原样留着占位', () => {
    expect(format('你好，{name}', { name: 'Dymo' })).toBe('你好，Dymo')
    expect(format('你好，{name}')).toBe('你好，{name}')
    expect(format('{a}{b}', { a: 1, b: 'x' })).toBe('1x')
  })

  test('复数：one / other，# 换成数字；中文只写 other', () => {
    const tpl = '{n, plural, one {# file} other {# files}} changed'
    expect(format(tpl, { n: 1 })).toBe('1 file changed')
    expect(format(tpl, { n: 3 })).toBe('3 files changed')
    expect(format('{n, plural, other {# 个文件}}', { n: 1 })).toBe('1 个文件')
  })

  test('参数名提取（守卫用）', () => {
    expect(paramNames('{b} {a, plural, one {#} other {#}} {b}')).toEqual(['a', 'b'])
  })
})

describe('PRD-M9-004 AC-1 · 语言', () => {
  test('手动选择优先；auto 看第一个有效线索，zh 开头为中文，其余英文，没有线索按中文', () => {
    expect(resolveLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveLocale('auto', ['zh_CN.UTF-8'])).toBe('zh')
    expect(resolveLocale('auto', [undefined, 'en_US.UTF-8'])).toBe('en')
    expect(resolveLocale('auto', ['C', 'de-DE'])).toBe('en')
    expect(resolveLocale(undefined, [])).toBe('zh')
  })

  test('终端线索：LC_ALL > LC_MESSAGES > LANG', () => {
    expect(resolveLocale('auto', envLocaleHints({ LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8' }))).toBe('en')
    expect(resolveLocale('auto', envLocaleHints({ LANG: 'zh_CN.UTF-8' }))).toBe('zh')
  })

  test('切换即时生效，订阅者收到通知', () => {
    const seen: string[] = []
    const off = onLocaleChange((l) => seen.push(l))
    expect(t('common.save')).toBe('保存')
    setLocale('en')
    expect(getLocale()).toBe('en')
    expect(t('common.save')).toBe('Save')
    off()
    setLocale('zh')
    expect(seen).toEqual(['en'])
  })

  test('isMessageKey 只认表里有的 key', () => {
    expect(isMessageKey('common.save')).toBe(true)
    expect(isMessageKey('error.nope')).toBe(false)
    expect(isMessageKey(3)).toBe(false)
  })
})
