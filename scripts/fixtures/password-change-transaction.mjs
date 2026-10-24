import { writeFile } from 'node:fs/promises'
import { AuthService } from '../../packages/auth/dist/index.js'
import { SqliteAuthStore, authMigrations } from '../../packages/auth/dist/sqlite.js'
import { PostgresAuthStore } from '../../packages/auth/dist/postgres.js'
import { migrate } from '../../packages/database/dist/index.js'

const password = 'a native crash current passphrase', nextPassword = 'a native crash replacement passphrase'
export async function holdPasswordTransaction({ database, passwords, runtime, stateFile }) {
  if (database.dialect === 'sqlite') await migrate(database, authMigrations)
  let armed = false
  const borrowed = { dialect: database.dialect, execute: database.execute.bind(database), close: async () => {},
    transaction: work => database.transaction(async tx => {
      let replaced = false
      const observed = { execute: async input => {
          const result = await tx.execute(input), sql = typeof input === 'string' ? input : input.sql
          if (sql.startsWith('UPDATE longhorn_auth_users SET password_hash=') || sql.startsWith('SELECT longhorn_auth.replace_password(')) replaced = true
          return result
      } }
      const result = await work(observed)
      if (armed && replaced) {
        console.log(JSON.stringify({ message: 'Password transaction before commit', runtime }))
        setInterval(() => {}, 1000) // Explicit fault-injection barrier, after actual native writes.
        await new Promise(() => {})
      }
      return result
    }) }
  const store = database.dialect === 'postgres' ? new PostgresAuthStore(borrowed) : new SqliteAuthStore(borrowed)
  const auth = new AuthService(store, passwords, { passwordChanges: true })
  const username = 'crash.' + runtime
  const user = await auth.register(username, password), session = (await auth.login(username, password)).session
  const credential = await store.findUserByUsername(username)
  await writeFile(stateFile, JSON.stringify({ username, userId: user.id, token: session.token, passwordHash: credential.passwordHash }), { mode: 0o600 })
  armed = true
  await auth.changePassword(session.token, password, nextPassword)
  throw new Error('Password transaction barrier was not reached')
}
