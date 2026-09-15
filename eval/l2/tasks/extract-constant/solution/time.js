export const SECONDS_PER_DAY = 86400

export function days(n) {
  return n * SECONDS_PER_DAY
}

export function toDays(sec) {
  return sec / SECONDS_PER_DAY
}
