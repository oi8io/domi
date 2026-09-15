import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.ok(!existsSync('notes/draft.txt'), 'draft.txt 应该不在了')
assert.equal(readFileSync('notes/final.txt', 'utf8'), '第一版草稿\n')
