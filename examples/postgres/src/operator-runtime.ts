import type { Database } from '@longhornjs/database'

/** This host must never run with provisioning or audit-maintenance authority. */
export async function checkOperatorRuntimeRole(database: Database): Promise<void> {
  const role=(await database.execute(`SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,
    has_database_privilege(current_user,current_database(),'CREATE') AS database_ddl,
    (has_schema_privilege(current_user,'longhorn_auth','CREATE') OR has_schema_privilege(current_user,'longhorn_outbox','CREATE') OR has_schema_privilege(current_user,'longhorn_pg_example','CREATE') OR COALESCE(has_schema_privilege(current_user,pg_catalog.to_regnamespace('longhorn_rate_limit'),'CREATE'),false)) AS schema_ddl,
    COALESCE(has_table_privilege(current_user,pg_catalog.to_regclass('longhorn_rate_limit.buckets'),'DELETE'),false) AS rate_limit_reset,
    EXISTS(SELECT 1 FROM pg_roles delegated WHERE delegated.oid<>r.oid AND pg_has_role(r.oid,delegated.oid,'SET')) AS delegated_role,
    (has_table_privilege(current_user,'longhorn_auth.users','UPDATE') OR has_table_privilege(current_user,'longhorn_auth.users','DELETE')) AS user_mutation,
    has_any_column_privilege(current_user,'longhorn_auth.users','UPDATE') AS user_column_mutation,
    (has_any_column_privilege(current_user,'longhorn_outbox.recovery_audit','UPDATE') OR has_table_privilege(current_user,'longhorn_outbox.recovery_audit','DELETE')) AS audit_mutation
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0]
  if(!role || Object.values(role).some(value=>value!==false))throw new Error('Operator host requires restricted runtime credentials')
}
