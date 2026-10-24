import { openPostgres } from '../../runtimes/node/dist/postgres.js'
import { verifyNativeSessionControl } from './session-control-native.mjs'
await verifyNativeSessionControl({runtime:'pg',mode:process.argv[2],openDatabase:()=>openPostgres({connectionString:process.env.LONGHORN_PG_APP_URL})})
