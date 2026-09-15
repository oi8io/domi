export function fizzbuzz(n) {
  return Array.from({ length: n }, (_, i) => {
    const k = i + 1
    return k % 15 === 0 ? 'FizzBuzz' : k % 3 === 0 ? 'Fizz' : k % 5 === 0 ? 'Buzz' : String(k)
  })
}
