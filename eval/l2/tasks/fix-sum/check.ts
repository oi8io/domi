import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { sum } = await import(`${process.cwd()}/sum.js`)
assert.equal(sum(2, 3), 5)
assert.equal(sum(10, -4), 6)
assert.ok(readFileSync('sum.test.js', 'utf8').includes('toBe(5)'), '不许改测试')
