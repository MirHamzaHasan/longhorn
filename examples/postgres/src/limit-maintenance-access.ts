import type { SqlExecutor } from '@longhornjs/database'

/** Read-only startup/provisioning checks. This is not an owner migration-history verifier. */
export async function checkLimitMaintenanceAccess(database: SqlExecutor, role?: string): Promise<void> {
  if (database.dialect !== 'postgres') throw new Error('Limit maintenance requires PostgreSQL')
  const row = (await database.execute({ sql: `WITH principal AS (
    SELECT * FROM pg_catalog.pg_roles WHERE rolname=COALESCE($1::text,current_user::text)
  ), bucket AS (
    SELECT c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,n.oid AS namespace,n.nspowner
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='longhorn_rate_limit' AND c.relname='buckets' AND c.relkind='r'
  ) SELECT
    (pg_catalog.has_database_privilege(r.oid,current_database(),'CONNECT')
      AND pg_catalog.has_schema_privilege(r.oid,b.namespace,'USAGE')
      AND pg_catalog.has_table_privilege(r.oid,b.oid,'SELECT')
      AND pg_catalog.has_table_privilege(r.oid,b.oid,'DELETE')
      AND pg_catalog.has_column_privilege(r.oid,b.oid,'claim','UPDATE')) AS allowed,
    (NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
      AND r.oid<>b.relowner AND r.oid<>b.nspowner
      AND NOT pg_catalog.has_database_privilege(r.oid,current_database(),'CREATE')
      AND NOT pg_catalog.has_schema_privilege(r.oid,b.namespace,'CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname IN ('public','longhorn_pg_example','longhorn_auth','longhorn_idempotency','longhorn_outbox','longhorn_queue','longhorn_scheduler') AND pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE'))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles delegated WHERE delegated.oid<>r.oid AND pg_catalog.pg_has_role(r.oid,delegated.oid,'SET'))
      AND NOT pg_catalog.has_any_column_privilege(r.oid,b.oid,'INSERT')
      AND NOT pg_catalog.has_table_privilege(r.oid,b.oid,'TRUNCATE')
      AND NOT pg_catalog.has_any_column_privilege(r.oid,b.oid,'REFERENCES')
      AND NOT pg_catalog.has_table_privilege(r.oid,b.oid,'TRIGGER')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=b.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'claim' AND pg_catalog.has_column_privilege(r.oid,b.oid,a.attnum,'UPDATE'))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname IN ('longhorn_pg_example','longhorn_auth','longhorn_idempotency','longhorn_outbox','longhorn_queue','longhorn_scheduler')
          AND (pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT') OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT') OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'UPDATE') OR pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE') OR pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE') OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'REFERENCES') OR pg_catalog.has_table_privilege(r.oid,c.oid,'TRIGGER')))
    ) AS restricted,
    (NOT b.relrowsecurity AND NOT b.relforcerowsecurity AND NOT EXISTS(
      SELECT 1 FROM (VALUES ('scope','text'::regtype,true),('subject_hash','text'::regtype,true),('claim','text'::regtype,true),
        ('policy_limit','int4'::regtype,true),('window_ms','int4'::regtype,true),('attempts','int4'::regtype,true),('expires_at','int8'::regtype,false)) expected(name,type,required)
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=b.oid AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
      WHERE a.attnum IS NULL OR a.atttypid<>expected.type OR a.attnotnull<>expected.required
    )) AS shape
    FROM principal r CROSS JOIN bucket b`, args: [role ?? null] })).rows[0]
  if (!row || row.allowed !== true || row.restricted !== true || row.shape !== true) throw new Error('Limit maintenance requires its deployed bucket schema and separate restricted credentials')
}
