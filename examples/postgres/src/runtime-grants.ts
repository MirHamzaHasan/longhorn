import type { Database } from '@longhorn/database'

/** Trusted deployment tool only; does not create roles or remove existing privileges. */
export async function grantOperatorRuntime(database: Database, role: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role) || role.startsWith('pg_')) throw new Error('Invalid runtime role')
  await database.transaction(async tx => {
    const row = (await tx.execute({ sql: 'SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=$1', args: [role] })).rows[0]
    if (!row || row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolbypassrls) throw new Error('Runtime role must already exist without administrative privileges')
    const target = '"' + role + '"'
    for (const statement of [
      'GRANT USAGE ON SCHEMA longhorn_pg_example,longhorn_queue,longhorn_scheduler,longhorn_auth,longhorn_idempotency,longhorn_outbox',
      'GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE longhorn_pg_example.tasks',
      'GRANT USAGE ON SEQUENCE longhorn_pg_example.tasks_id_seq,longhorn_pg_example.private_notes_id_seq',
      'GRANT SELECT,INSERT,UPDATE ON TABLE longhorn_queue.jobs,longhorn_scheduler.schedules',
      'GRANT SELECT,INSERT ON TABLE longhorn_pg_example.task_reports,longhorn_auth.users,longhorn_pg_example.operator_commands,longhorn_outbox.recovery_audit',
      'GRANT SELECT,INSERT,DELETE ON TABLE longhorn_auth.sessions,longhorn_pg_example.private_notes',
      'GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE longhorn_auth.attempts,longhorn_idempotency.requests',
      'GRANT EXECUTE ON FUNCTION longhorn_auth.lock_session_user(text)',
    ]) await tx.execute(statement + ' TO ' + target)
  })
}
