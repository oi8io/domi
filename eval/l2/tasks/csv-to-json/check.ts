import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rows = JSON.parse(readFileSync('data.json', 'utf8'))
assert.equal(rows.length, 4)
assert.deepEqual(rows[0], { name: 'alice', city: 'beijing', score: 90 })
assert.equal(typeof rows[3].score, 'number')
