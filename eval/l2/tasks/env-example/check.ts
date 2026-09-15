import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lines = readFileSync('.env.example', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
assert.deepEqual([...lines].sort(), ['DATABASE_URL=', 'DEBUG=', 'PORT=', 'SESSION_SECRET='])
