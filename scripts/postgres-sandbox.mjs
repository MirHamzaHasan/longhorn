import { randomBytes } from 'node:crypto'
import { startPostgresCluster } from './postgres-cluster.mjs'
import { openPostgres } from '../runtimes/node/dist/postgres.js'
import { migratePostgres } from '../packages/database/dist/postgres.js'
// This fixture is also used by the explicit temporary demo.
export async function startPostgresSandbox() {
  const cluster = await startPostgresCluster()
  const ownerPassword = randomBytes(24).toString('hex'), appPassword = randomBytes(24).toString('hex')
  const address = (user, password) => { const url = new URL(cluster.connectionString); url.username = user; url.password = password; url.pathname = '/longhorn_test'; return url.toString() }
  const ownerUrl = address('longhorn_owner', ownerPassword), appUrl = address('longhorn_app', appPassword)
  let admin, owner
  try {
    admin = await openPostgres({ connectionString: cluster.connectionString })
    await admin.execute("CREATE ROLE longhorn_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" + ownerPassword + "'")
    await admin.execute("CREATE ROLE longhorn_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '" + appPassword + "'")
    await admin.execute('CREATE DATABASE longhorn_test OWNER longhorn_owner')
    await admin.execute('REVOKE ALL ON DATABASE longhorn_test FROM PUBLIC')
    await admin.execute('GRANT CONNECT ON DATABASE longhorn_test TO longhorn_owner,longhorn_app')
    owner = await openPostgres({ connectionString: ownerUrl })
    await owner.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
    // Import the application's actual migration text, avoiding a drifting QA copy.
    const { exampleSchema } = await import('../examples/postgres/dist/tasks.js')
    const { postgresExampleMigrations } = await import('../examples/postgres/dist/migrations.js')
    await migratePostgres(owner, postgresExampleMigrations, { schema: exampleSchema })
    await owner.execute('GRANT USAGE ON SCHEMA longhorn_pg_example TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE longhorn_pg_example.tasks TO longhorn_app')
    await owner.execute('GRANT USAGE ON SEQUENCE longhorn_pg_example.tasks_id_seq TO longhorn_app')
    await owner.execute('GRANT USAGE ON SCHEMA longhorn_queue,longhorn_scheduler TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,UPDATE ON TABLE longhorn_queue.jobs,longhorn_scheduler.schedules TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT ON TABLE longhorn_pg_example.task_reports TO longhorn_app')
    await owner.execute('GRANT USAGE ON SCHEMA longhorn_auth TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT ON TABLE longhorn_auth.users TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,DELETE ON TABLE longhorn_auth.sessions TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE longhorn_auth.attempts TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,DELETE ON TABLE longhorn_pg_example.private_notes TO longhorn_app')
    await owner.execute('GRANT USAGE ON SEQUENCE longhorn_pg_example.private_notes_id_seq TO longhorn_app')
    await owner.execute('GRANT USAGE ON SCHEMA longhorn_idempotency TO longhorn_app')
    await owner.execute('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE longhorn_idempotency.requests TO longhorn_app')
    return { ...cluster, ownerUrl, appUrl }
  } catch (error) { await cluster.stop(); throw error }
  finally { await owner?.close(); await admin?.close() }
}
