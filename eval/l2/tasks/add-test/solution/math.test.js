import { expect, test } from 'bun:test'
import { clamp } from './math.js'

test('clamp', () => {
  expect(clamp(-1, 0, 10)).toBe(0)
  expect(clamp(11, 0, 10)).toBe(10)
  expect(clamp(5, 0, 10)).toBe(5)
})
