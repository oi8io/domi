export function lower(s) {
  return s.toLowerCase()
}

export function capitalize(s) {
  return s === '' ? s : s[0].toUpperCase() + s.slice(1)
}
