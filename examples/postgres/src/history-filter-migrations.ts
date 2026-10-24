import type { Database,Migration } from '@longhorn/database'

/** Append after the complete existing profile; index creation and ledger commit are atomic. */
export const postgresHistoryFilterMigrations:readonly Migration[]=[{
  id:'postgres_account_operations/003_history_filters',statements:[
    'CREATE INDEX operator_commands_delivery_owner_history ON longhorn_pg_example.operator_commands(delivery_id,owner_id,history_id DESC) WHERE delivery_id IS NOT NULL',
    "CREATE INDEX command_history_state ON longhorn_queue.jobs(state,id) WHERE queue='outbox.command.numbers.v1'",
  ],
}]
export async function checkHistoryFilterIndexes(database:Database):Promise<void>{
  for(const [index,table]of [['longhorn_pg_example.operator_commands_delivery_owner_history','longhorn_pg_example.operator_commands'],['longhorn_queue.command_history_state','longhorn_queue.jobs']]){
    const row=(await database.execute({sql:'SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid=pg_catalog.to_regclass($1) AND indrelid=pg_catalog.to_regclass($2) AND indisvalid AND indisready) AS available',args:[index!,table!]})).rows[0]
    if(row?.available!==true)throw new Error('Command history filter indexes must be deployed')
  }
}
