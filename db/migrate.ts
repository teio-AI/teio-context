// Minimal migration runner. Applies db/migrations/*.sql in order, tracked in
// the _migrations table. Run with: `npm run migrate` (needs DATABASE_URL).
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = neon(url)
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/** Run a single dynamic SQL statement via the tagged-template path (no `.query`). */
function runSql(statement: string): Promise<unknown> {
  const template = Object.assign([statement], { raw: [statement] }) as unknown as TemplateStringsArray
  return sql(template) as unknown as Promise<unknown>
}

/** Split a .sql file into individual statements (drops line comments). */
function splitStatements(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function main(): Promise<void> {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`
  const appliedRows = (await sql`select name from _migrations`) as { name: string }[]
  const applied = new Set(appliedRows.map((r) => r.name))

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`)
      continue
    }
    const statements = splitStatements(await readFile(join(migrationsDir, file), 'utf8'))
    for (const stmt of statements) {
      await runSql(stmt)
    }
    await sql`insert into _migrations (name) values (${file})`
    console.log(`applied ${file} (${statements.length} statements)`)
  }
  console.log('migrations complete')
}

await main()
