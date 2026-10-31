import { openPostgres } from '@longhornjs/node/postgres'
import { loadLimitMaintenanceConfiguration } from './limit-maintenance-config.js'
import { runLimitMaintenance } from './limit-maintenance.js'
import type { LimitMaintenanceMode } from './limit-maintenance.js'
const [action = 'once', ...extra] = process.argv.slice(2)
if (!['check', 'once', 'watch'].includes(action) || extra.length) {
  console.error('Usage: maintain:limits [check|once|watch]'); process.exitCode = 1
} else {
  const mode = action as LimitMaintenanceMode, controller = new AbortController()
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined
  const interrupt = () => { interrupted ??= 'SIGINT'; controller.abort() }, terminate = () => { interrupted ??= 'SIGTERM'; controller.abort() }
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate)
  try {
    const report = await runLimitMaintenance({ mode, loadConfiguration: loadLimitMaintenanceConfiguration, signal: controller.signal,
      openDatabase: config => openPostgres({ connectionString: config.databaseUrl, maxConnections: 1, statementTimeoutMs: config.statementTimeoutMs, applicationName: 'longhorn-limit-maintenance' }),
      onReady: () => { if (mode === 'watch') console.log(JSON.stringify({ schemaVersion: 1, event: 'started', mode })) },
      onError: () => { console.error('Expired command limit cleanup failed') },
    })
    console.log(JSON.stringify(report))
    if (!report.ok && !report.cancelled) console.error('Limit maintenance failed; verify its configuration, deployed schema and restricted grants')
    process.exitCode = report.cancelled && mode !== 'watch' ? interrupted === 'SIGTERM' ? 143 : 130 : report.ok ? 0 : 1
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate) }
}
