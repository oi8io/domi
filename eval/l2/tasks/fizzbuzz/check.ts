import assert from 'node:assert/strict'

const { fizzbuzz } = await import(`${process.cwd()}/fizz.js`)
assert.deepEqual(fizzbuzz(5), ['1', '2', 'Fizz', '4', 'Buzz'])
assert.equal(fizzbuzz(15)[14], 'FizzBuzz')
assert.deepEqual(fizzbuzz(0), [])
