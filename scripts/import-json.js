const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('Configure DATABASE_URL antes de importar dados.');
  const file = path.resolve(process.env.JSON_STORE_PATH || path.join(__dirname, '..', 'data', 'store.json'));
  if (!fs.existsSync(file)) throw new Error(`Arquivo JSON não encontrado: ${file}`);
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  const users = Array.isArray(store.users) ? store.users : [];
  const projects = Array.isArray(store.projects) ? store.projects : [];
  const pool = new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  let importedUsers = 0; let importedProjects = 0; let importedEvaluations = 0;
  try {
    await client.query('BEGIN');
    for (const user of users) {
      const result = await client.query(`INSERT INTO professors (id, full_name, email, password_hash, created_at)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`, [user.id, user.name, user.email, user.passwordHash, user.createdAt || new Date().toISOString()]);
      importedUsers += result.rowCount;
    }
    for (const project of projects) {
      if (!project.ownerId) throw new Error(`O projeto "${project.title}" não possui responsável associado; resolva o responsável antes da importação.`);
      const result = await client.query(`INSERT INTO projects (id, owner_id, title, course, class_name, team, scale, sheet_version, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`, [project.id, project.ownerId, project.title, project.course || '', project.className || '', project.team || '', project.scale === 1 ? 1 : 10, project.sheetVersion || 1, project.createdAt || new Date().toISOString()]);
      importedProjects += result.rowCount;
      for (const evaluation of project.evaluations || []) {
        if (!evaluation.evaluatorId) throw new Error(`A avaliação do projeto "${project.title}" não possui avaliador associado.`);
        const scores = Array.isArray(evaluation.scores) && evaluation.scores.length === 10 ? evaluation.scores : Array(10).fill(null);
        const notes = Array.isArray(evaluation.criterionNotes) && evaluation.criterionNotes.length === 10 ? evaluation.criterionNotes : Array(10).fill('');
        const added = await client.query(`INSERT INTO evaluations (id, project_id, evaluator_id, status, scores, criterion_notes, comments, result, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`, [evaluation.id, project.id, evaluation.evaluatorId, evaluation.status || 'rascunho', JSON.stringify(scores), JSON.stringify(notes), evaluation.comments || '', evaluation.result ? JSON.stringify(evaluation.result) : null, evaluation.createdAt || new Date().toISOString(), evaluation.updatedAt || evaluation.createdAt || new Date().toISOString()]);
        importedEvaluations += added.rowCount;
      }
    }
    await client.query('COMMIT');
    console.log(`Importação concluída. Novos registros: ${importedUsers} professores, ${importedProjects} projetos e ${importedEvaluations} avaliações.`);
    console.log('Sessões de login não foram copiadas; os usuários entrarão novamente após a migração.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error(`Falha na importação: ${error.message}`); process.exitCode = 1; });
