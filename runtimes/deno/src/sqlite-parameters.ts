/** Plan native named/anonymous binding without rewriting SQL or its result column names. */
export function sqliteParameters<T>(sql: string, args: readonly T[]): { named: Record<string, T>; positional: T[] } {
  const names = new Map<string, number>()
  const slotNames = new Map<number, string>()
  let index = 0, maximum = 0
  const identifier = (char: string | undefined) => char !== undefined && (/[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) >= 128)
  while (index < sql.length) {
    const start = index, char = sql[index]!
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2); index = end < 0 ? sql.length : end + 1
    } else if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2); if (end < 0) throw new Error(); index = end + 2
    } else if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = char === '[' ? ']' : char; index++
      let closed = false
      while (index < sql.length) {
        if (sql[index++] !== end) continue
        if (char !== '[' && sql[index] === end) { index++; continue }
        closed = true; break
      }
      if (!closed) throw new Error()
    } else if (char === '?' || char === ':' || char === '@' || char === '$') {
      index++
      let slot: number
      if (char === '?') {
        while (/[0-9]/.test(sql[index] ?? '')) index++
        slot = index === start + 1 ? maximum + 1 : Number(sql.slice(start + 1, index))
      } else {
        const beginning = index
        while (identifier(sql[index]) || sql.startsWith('::', index)) {
          if (sql.startsWith('::', index)) index += 2; else index++
        }
        if (index === beginning) throw new Error()
        if (sql[index] === '(') {
          index++
          while (index < sql.length && sql[index] !== ')' && !/\s/.test(sql[index]!)) index++
          if (sql[index] !== ')') throw new Error(); index++
        }
        const name = sql.slice(start, index)
        slot = names.get(name) ?? maximum + 1; names.set(name, slot)
      }
      if (!Number.isSafeInteger(slot) || slot < 1 || slot > 1000) throw new Error()
      if (index > start + 1 && !slotNames.has(slot)) slotNames.set(slot, sql.slice(start, index))
      maximum = Math.max(maximum, slot); continue
    } else if (identifier(char)) {
      index++; while (identifier(sql[index])) index++
    } else index++
  }
  if (maximum !== args.length) throw new Error()
  const named: Record<string, T> = Object.create(null), positional: T[] = []
  for (let slot = 1; slot <= maximum; slot++) {
    const name = slotNames.get(slot)
    // Deno binds ?NNN through its positional argument path, alongside anonymous slots/holes.
    if (name === undefined || name.startsWith('?')) positional.push(args[slot - 1]!)
    else named[name] = args[slot - 1]!
  }
  return { named, positional }
}
