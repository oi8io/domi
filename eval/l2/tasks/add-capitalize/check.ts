import assert from 'node:assert/strict'

const m = await import(`${process.cwd()}/strings.js`)
assert.equal(m.capitalize('hello'), 'Hello')
assert.equal(m.capitalize('hELLO'), 'HELLO')
assert.equal(m.capitalize(''), '')
assert.equal(m.lower('A'), 'a')
