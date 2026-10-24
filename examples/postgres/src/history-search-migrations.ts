import type { Database,Migration } from '@longhorn/database'

/** Append after the complete deployed profile; regular index builds commit with the ledger. */
export const postgresHistorySearchMigrations:readonly Migration[]=[{
  id:'postgres_account_operations/004_history_search',statements:[
    'CREATE INDEX operator_commands_search_history ON longhorn_pg_example.operator_commands(pg_catalog.lower(id) text_pattern_ops,history_id DESC)',
    'CREATE INDEX operator_commands_owner_search_history ON longhorn_pg_example.operator_commands(owner_id,pg_catalog.lower(id) text_pattern_ops,history_id DESC)',
  ],
}]
export async function checkHistorySearchIndexes(database:Database):Promise<void>{
  for(const index of ['longhorn_pg_example.operator_commands_search_history','longhorn_pg_example.operator_commands_owner_search_history']){
    const row=(await database.execute({sql:"SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass($1) AND indrelid='longhorn_pg_example.operator_commands'::regclass AND indisvalid AND indisready) AS available",args:[index]})).rows[0]
    if(row?.available!==true)throw new Error('Command history search indexes must be deployed')
  }
}
