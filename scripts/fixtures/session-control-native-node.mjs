import { openSqlite } from '../../runtimes/node/dist/sqlite.js'
import { verifyNativeSessionControl } from './session-control-native.mjs'
const [mode,filename]=process.argv.slice(2)
await verifyNativeSessionControl({runtime:'node',mode,filename,openSqlite,openDatabase:()=>openSqlite({filename})})
