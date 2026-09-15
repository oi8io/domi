import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

assert.equal(readFileSync('names.txt', 'utf8').trim(), 'alice\nbob\ncarol\ndave')
