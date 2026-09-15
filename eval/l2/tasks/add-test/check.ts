import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const t = readFileSync('math.test.js', 'utf8')
assert.ok((t.match(/clamp\(/g) ?? []).length >= 3, '至少三次调用 clamp')
const r = Bun.spawnSync([process.execPath, 'test', 'math.test.js'], { stdout: 'pipe', stderr: 'pipe' })
assert.equal(r.exitCode, 0, new TextDecoder().decode(r.stderr))
assert.equal(readFileSync('math.js', 'utf8').includes('Math.min(hi, Math.max(lo, x))'), true, '不许改被测代码')
