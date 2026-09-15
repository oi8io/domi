import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('time.js', 'utf8')
assert.equal((src.match(/86400/g) ?? []).length, 1, '86400 只应出现在常量定义里')
const m = await import(`${process.cwd()}/time.js`)
assert.equal(m.SECONDS_PER_DAY, 86400)
assert.equal(m.days(2), 172800)
assert.equal(m.toDays(43200), 0.5)
