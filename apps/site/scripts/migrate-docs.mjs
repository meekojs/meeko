import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required to migrate the documentation database')

const pool = new pg.Pool({ connectionString: url })
try {
  const sql = await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '001_docs.sql'), 'utf8')
  await pool.query(sql)
  console.log('Documentation schema is ready')
} finally {
  await pool.end()
}
