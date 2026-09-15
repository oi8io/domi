import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

for (const f of ['mail.js', 'docs.md']) {
  const t = readFileSync(f, 'utf8')
  assert.ok(!t.includes('recieve'), `${f} 里还有 recieve`)
  assert.ok(t.includes('receive'), `${f} 里应该有 receive`)
}
const m = await import(`${process.cwd()}/mail.js`)
assert.equal(m.receive('x'), 'received: x')
