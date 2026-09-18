/**
 * PRD-M9-004 AC-2 / AC-3 · guard:i18n 先证明会红
 */
import { describe, expect, test } from 'bun:test'
import { localeProblems, scanFile } from '../../../scripts/check-i18n.ts'

describe('guard:i18n', () => {
  test('AC-3：端代码里的中文字面量被拦下——字符串、模板串、JSX 文本、JSX 属性都算；注释不算；i18n-ignore 放行', () => {
    const src = [
      '// 注释里写中文没关系',
      "const a = '保存'",
      'const b = `共 ${n} 条`',
      "const c = <p title='提示'>你好</p>",
      '// i18n-ignore：识别用户输入的关键词',
      "const d = '继续'",
      "const e = tr('common.save')",
    ].join('\n')
    const hits = scanFile('x.tsx', src).map((h) => h.line)
    expect(hits).toEqual([2, 3, 4, 4])
  })

  test('AC-2：两份 locale 的 key 与参数名必须一致', () => {
    expect(localeProblems({ a: '{n} 个', b: '好' }, { a: '{n} items', b: 'ok' })).toEqual([])
    expect(localeProblems({ a: '{n} 个' }, { a: '{count} items' })).toEqual(['a 的参数对不上：zh {n} / en {count}'])
    expect(localeProblems({ a: 'x' }, { b: 'y' })).toEqual(['en 缺 a', 'en 多了 b（zh 里没有）'])
  })
})
