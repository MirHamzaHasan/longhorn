import { loadConfig } from '@longhornjs/config'
import { readEnv } from '@longhornjs/node/config'
import { operatorConfigSchema } from './operator-config.js'

/** Native configuration acquisition, shared by the server and read-only checks. */
export async function loadOperatorConfiguration() {
  return loadConfig(operatorConfigSchema,await readEnv({files:[new URL('../.operator.env',import.meta.url),new URL('../.operator.env.local',import.meta.url)],ignoreMissing:true}))
}
