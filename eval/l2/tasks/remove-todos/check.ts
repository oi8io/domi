import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

assert.equal(readFileSync('src/a.js', 'utf8'), 'export const a = 1\n')
assert.equal(readFileSync('src/b.js', 'utf8'), 'export const b = 2\nexport const c = 3 // 这不是 TODO 行\n')
