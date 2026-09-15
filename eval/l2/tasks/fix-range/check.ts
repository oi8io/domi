import assert from 'node:assert/strict'

const { range } = await import(`${process.cwd()}/range.js`)
assert.deepEqual(range(1, 3), [1, 2, 3])
assert.deepEqual(range(5, 5), [5])
assert.deepEqual(range(3, 1), [])
