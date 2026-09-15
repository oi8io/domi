import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

assert.equal(readFileSync('answer.txt', 'utf8').trim(), 'b.txt')
