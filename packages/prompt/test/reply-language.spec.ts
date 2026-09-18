/**
 * PRD-M9-004 AC-5 · 提示词层不翻译，但 identity 层要求模型用用户的语言回复
 */
import { expect, test } from 'bun:test'
import { identityLayer } from '../src/index.ts'

test('identity 层：用用户使用的语言回复', () => {
  const text = identityLayer.render({} as never)
  expect(text).toContain('reply in the language the user writes in')
})
