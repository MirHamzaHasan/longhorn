import { openSqlite } from '../../runtimes/deno/dist/sqlite.js'
import { verifyNativeSessionControl } from './session-control-native.mjs'
const [mode,filename]=Deno.args
await verifyNativeSessionControl({runtime:'deno',mode,filename,openSqlite,openDatabase:()=>openSqlite({filename})})
