import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const md = readFileSync('README.md', 'utf8')
assert.match(md, /^# greeter\b/m)
assert.match(md, /^## 用法/m)
assert.match(md, /cli\.js/)
