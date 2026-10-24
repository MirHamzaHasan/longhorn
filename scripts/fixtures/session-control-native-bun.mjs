import { openSqlite } from '../../runtimes/bun/dist/sqlite.js'
import { verifyNativeSessionControl } from './session-control-native.mjs'
const [mode,filename]=process.argv.slice(2)
await verifyNativeSessionControl({runtime:'bun',mode,filename,openSqlite,openDatabase:()=>openSqlite({filename})})
