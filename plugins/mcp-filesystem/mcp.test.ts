import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('只开放 ./docs，server 版本钉死', () => {
  const text = readFileSync(new URL('./domi-plugin.yaml', import.meta.url), 'utf8')
  expect(text).toContain('"./docs"')
  expect(text).toContain('@modelcontextprotocol/server-filesystem@2026.8.31')
})
