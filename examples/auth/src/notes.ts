import { z } from 'zod'
import type { Database } from '@longhorn/database'

const maximum = 9223372036854775807n
export const noteListQuery = z.object({
  limit: z.string().regex(/^[1-9]\d{0,2}$/).default('20').transform(Number).pipe(z.number().int().min(1).max(100)),
  after: z.string().refine(value => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= maximum, 'Expected a positive int64 cursor').optional(),
}).strict().transform(({ limit, after }) => ({ limit, ...(after === undefined ? {} : { after }) }))
export type NoteQuery = z.output<typeof noteListQuery>
export async function listNotes(database: Database, owner: string, input: NoteQuery) {
  // Parse/copy typed callers too, before crossing the async database boundary.
  const { limit, after } = noteListQuery.parse({ limit: String(input.limit), ...(input.after === undefined ? {} : { after: input.after }) })
  const rows = (await database.execute({
    sql: 'SELECT id,title FROM private_notes WHERE owner_id=?' + (after === undefined ? '' : ' AND id>?') + ' ORDER BY id LIMIT ?',
    args: [owner, ...(after === undefined ? [] : [BigInt(after)]), limit + 1],
  })).rows
  const notes = rows.slice(0, limit).map(row => {
    if ((typeof row.id !== 'bigint' && typeof row.id !== 'number') || (typeof row.id === 'number' && !Number.isSafeInteger(row.id))
      || row.id <= 0 || row.id > maximum || typeof row.title !== 'string') throw new Error('Invalid private note row')
    return { id: String(row.id), title: row.title }
  })
  return { notes, nextCursor: rows.length > limit ? notes.at(-1)!.id : null }
}
