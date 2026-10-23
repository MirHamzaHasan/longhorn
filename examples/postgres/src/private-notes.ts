import type { Database,Migration,SqlRow } from '@longhorn/database'
import { z } from 'zod'

export const privateNoteMigrations: readonly Migration[]=[{ id: 'postgres_private/001_notes',statements: [
  `CREATE TABLE longhorn_pg_example.private_notes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id text NOT NULL REFERENCES longhorn_auth.users(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND char_length(btrim(title))>0)
  )`,
  'CREATE INDEX private_notes_owner_id ON longhorn_pg_example.private_notes(owner_id,id)',
] }]
export const privateNoteSchema=z.object({ title: z.string().trim().min(1).max(200) }).strict()
const id=z.string().refine(value => /^[1-9]\d{0,18}$/.test(value) && BigInt(value)<=9_223_372_036_854_775_807n,'Expected a positive int64 ID')
export const privateNoteParams=z.object({ id })
export const privateNoteQuery=z.object({ after: id.optional(),limit: z.string().regex(/^\d+$/).default('20').transform(Number).pipe(z.number().int().min(1).max(100)) })
export type PrivateNote={ readonly id: string;readonly title: string }
function note(row: SqlRow): PrivateNote {
  if (typeof row.id!=='bigint' || typeof row.title!=='string') throw new Error('Invalid PostgreSQL private note row')
  return { id: row.id.toString(),title: row.title }
}
/** Ownership is supplied exclusively from the authenticated principal, never HTTP input. */
export class PostgresPrivateNotes {
  constructor(private readonly database: Database) {}
  async list(owner: string,input: z.output<typeof privateNoteQuery>) {
    const rows=(await this.database.execute({ sql: `SELECT id,title FROM longhorn_pg_example.private_notes
      WHERE owner_id=$1 AND ($2::bigint IS NULL OR id>$2::bigint) ORDER BY id LIMIT $3`,args: [owner,input.after ?? null,input.limit+1] })).rows
    const notes=rows.slice(0,input.limit).map(note)
    return { notes,nextCursor: rows.length>input.limit ? notes.at(-1)!.id : null }
  }
  async get(owner: string,id: string): Promise<PrivateNote | undefined> {
    const row=(await this.database.execute({ sql: 'SELECT id,title FROM longhorn_pg_example.private_notes WHERE owner_id=$1 AND id=$2::bigint',args: [owner,id] })).rows[0]
    return row ? note(row) : undefined
  }
  async create(owner: string,title: string): Promise<PrivateNote> {
    const row=(await this.database.execute({ sql: 'INSERT INTO longhorn_pg_example.private_notes(owner_id,title) VALUES ($1,$2) RETURNING id,title',args: [owner,title] })).rows[0]
    if (!row) throw new Error('PostgreSQL private note insertion returned no row')
    return note(row)
  }
  async delete(owner: string,id: string): Promise<boolean> {
    return (await this.database.execute({ sql: 'DELETE FROM longhorn_pg_example.private_notes WHERE owner_id=$1 AND id=$2::bigint',args: [owner,id] })).rowsAffected===1
  }
}
