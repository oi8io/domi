import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

assert.equal(readFileSync('count.txt', 'utf8').trim(), '4')
