const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('Configure DATABASE_URL antes de executar as migrações.');
  const ssl = process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true };
  const pool = new Pool({ connectionString, ssl, max: 2, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const files = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const file of files) {
      const version = Number(file.slice(0, file.indexOf('_')));
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
      if (applied.rowCount) { console.log(`Migração ${file}: já aplicada`); continue; }
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(864209731)');
        const recheck = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
        if (!recheck.rowCount) {
          await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
          await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1,$2)', [version, file]);
          console.log(`Migração ${file}: aplicada`);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error(`Falha na migração: ${error.message}`); process.exitCode = 1; });
