import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lines = readFileSync('.gitignore', 'utf8')
  .split('\n')
  .map((l) => l.trim())
for (const want of ['*.log']) assert.ok(lines.includes(want), `保留 ${want}`)
assert.ok(
  lines.some((l) => /^\/?node_modules\/?$/.test(l)),
  'node_modules',
)
assert.ok(
  lines.some((l) => /^\/?dist\/?$/.test(l)),
  'dist',
)
assert.ok(
  lines.some((l) => /^\*?\.env(\*|\.\*)?$/.test(l) || l === '.env*'),
  '.env',
)
