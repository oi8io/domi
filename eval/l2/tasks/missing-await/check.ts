import assert from 'node:assert/strict'

const { loadAll } = await import(`${process.cwd()}/load.js`)
const r = await loadAll([1, 2])
assert.deepEqual(r, [
  { id: 1, ok: true },
  { id: 2, ok: true },
])
