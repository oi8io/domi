import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('SKILL.md 的 frontmatter 齐全，正文写了停下来问人的条件', () => {
  const text = readFileSync(new URL('./skills/git-workflow/SKILL.md', import.meta.url), 'utf8')
  expect(text).toMatch(/^---\nname: git-workflow\ndescription: .+\n/)
  expect(text).toContain('停下来问用户')
  expect(text).toContain('--force-with-lease')
})
