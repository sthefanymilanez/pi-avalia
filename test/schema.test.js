const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('migração cria o esquema PostgreSQL e aplica integridade referencial', async () => {
  const db = new PGlite();
  try {
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_initial_schema.sql'), 'utf8');
    await db.exec(migration);
    const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    assert.deepEqual(tables.rows.map((row) => row.table_name), ['evaluations', 'professors', 'projects', 'sessions']);
    await db.query('INSERT INTO professors (id,full_name,email,password_hash) VALUES ($1,$2,$3,$4)', ['00000000-0000-4000-8000-000000000001','Professora Teste','teste@example.edu','salt:hash']);
    await db.query('INSERT INTO projects (id,owner_id,title,scale) VALUES ($1,$2,$3,$4)', ['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Projeto para teste',10]);
    await db.query(`INSERT INTO evaluations (id,project_id,evaluator_id,status,scores,criterion_notes)
      VALUES ($1,$2,$3,$4,$5,$6)`, ['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','rascunho',JSON.stringify(Array(10).fill(null)),JSON.stringify(Array(10).fill(''))]);
    const counts = await db.query('SELECT (SELECT count(*) FROM professors)::int AS professors,(SELECT count(*) FROM projects)::int AS projects,(SELECT count(*) FROM evaluations)::int AS evaluations');
    assert.deepEqual(counts.rows[0], { professors: 1, projects: 1, evaluations: 1 });
    await assert.rejects(db.query('INSERT INTO projects (id,owner_id,title,scale) VALUES ($1,$2,$3,$4)', ['00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000099','Orphan project',10]), (error) => error.code === '23503');
    await assert.rejects(db.query('INSERT INTO projects (id,owner_id,title,scale) VALUES ($1,$2,$3,$4)', ['00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','Invalid scale',5]), (error) => error.code === '23514');
  } finally { await db.close(); }
});
