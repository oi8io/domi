import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const p = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(p.version, '1.2.0')
assert.equal(p.name, 'demo')
assert.deepEqual(p.scripts, { test: 'bun test' })
assert.equal(p.private, true)
