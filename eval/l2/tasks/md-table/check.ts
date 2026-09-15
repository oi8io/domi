import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const t = readFileSync('items.md', 'utf8')
assert.match(t, /\|\s*名字\s*\|\s*价格\s*\|/)
assert.match(t, /\|\s*-+\s*\|\s*-+\s*\|/)
const rows = t.split('\n').filter((l) => /^\|\s*(苹果|香蕉|樱桃)/.test(l))
assert.equal(rows.length, 3)
assert.ok(rows[0].includes('苹果') && rows[0].includes('5'))
assert.ok(rows[2].includes('樱桃') && rows[2].includes('20'))
assert.ok(!/^- /m.test(t), '列表应该没了')
