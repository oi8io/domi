import { expect, test } from 'bun:test'
import tool, { count } from './count.ts'

test('中英混排：中文按字计，英文按词计', () => {
  expect(count('hello world\n你好世界')).toEqual({ lines: 2, words: 6, chars: 16 })
  expect(count('')).toEqual({ lines: 0, words: 0, chars: 0 })
})

test('读不到的文件单独报错，不影响其它文件', async () => {
  const ctx = {
    async readFile(path: string) {
      if (path === 'a.md') return 'a b c'
      throw new Error('没有声明这个权限')
    },
  }
  expect(await tool.execute({ paths: ['a.md', 'b.env'] }, ctx)).toEqual({
    files: [
      { path: 'a.md', lines: 1, words: 3, chars: 5 },
      { path: 'b.env', error: '没有声明这个权限' },
    ],
  })
  await expect(tool.execute({ paths: [] }, ctx)).rejects.toThrow('paths')
})
