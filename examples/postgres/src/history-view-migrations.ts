import type { Database,Migration } from '@longhorn/database'
/** Append to the complete account operations profile; all earlier statements stay immutable. */
export const postgresHistoryViewMigrations:readonly Migration[]=[{
  id:'postgres_account_operations/005_history_views',statements:[
    `CREATE TABLE longhorn_pg_example.history_views (
      owner_id text NOT NULL CHECK(length(owner_id)>0), id text NOT NULL CHECK(id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
      name text COLLATE "C" NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      scope text NOT NULL CHECK(scope IN ('mine','all')),
      state text NOT NULL CHECK(state IN ('all','pending','running','succeeded','failed','unavailable')),
      q text CHECK(q IS NULL OR (length(q) BETWEEN 4 AND 36 AND (q || pg_catalog.substr('00000000-0000-0000-0000-000000000000',length(q)+1)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
      revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),
      created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
      updated_at bigint NOT NULL CHECK(updated_at BETWEEN created_at AND 9007199254740991),
      PRIMARY KEY(owner_id,id), UNIQUE(owner_id,name)
    )`,
  ],
}]
export async function checkHistoryViewTable(database:Database):Promise<void>{
  await database.execute('SELECT owner_id,id,name,scope,state,q,revision,created_at,updated_at FROM longhorn_pg_example.history_views LIMIT 0')
  const row=(await database.execute("SELECT (has_table_privilege(current_user,'longhorn_pg_example.history_views','SELECT') AND has_table_privilege(current_user,'longhorn_pg_example.history_views','INSERT') AND has_table_privilege(current_user,'longhorn_pg_example.history_views','UPDATE') AND has_table_privilege(current_user,'longhorn_pg_example.history_views','DELETE')) AS allowed")).rows[0]
  if(row?.allowed!==true)throw new Error('Saved history view runtime grants must be deployed')
}
