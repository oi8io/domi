async function loadOne(id) {
  return { id, ok: true }
}

export async function loadAll(ids) {
  const out = []
  for (const id of ids) out.push(loadOne(id))
  return out
}
