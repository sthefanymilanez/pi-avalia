const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const dataDir = process.env.PI_AVALIA_DATA_DIR || path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'store.json');
const localSessions = new Map();
let pool = null;
let initialized = false;

class StoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const sessionHash = (token) => createHash('sha256').update(token).digest('hex');
function readLocal() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storePath)) fs.writeFileSync(storePath, JSON.stringify({ users: [], projects: [] }, null, 2));
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  return { users: raw.users || [], projects: raw.projects || [], profiles: raw.profiles || [], analyses: raw.analyses || [], passwordResets: raw.passwordResets || [], invitations: raw.invitations || [], presentationEvaluations: raw.presentationEvaluations || [] };
}
function writeLocal(store) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ users: store.users || [], projects: store.projects || [], profiles: store.profiles || [], analyses: store.analyses || [], passwordResets: store.passwordResets || [], invitations: store.invitations || [], presentationEvaluations: store.presentationEvaluations || [] }, null, 2));
}
function mapEvaluation(row) {
  return { id: row.id, evaluator: row.evaluator_name, evaluatorId: row.evaluator_id, status: row.status, scores: row.scores, criterionNotes: row.criterion_notes, comments: row.comments, result: row.result, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapPresentationEvaluation(row) {
  return { id: row.id, evaluator: row.evaluator_name || row.evaluator, evaluatorId: row.evaluator_id || row.evaluatorId, status: row.status, scores: row.scores, criterionNotes: row.criterion_notes || row.criterionNotes, comments: row.comments, result: row.result === null ? null : Number(row.result), createdAt: row.created_at || row.createdAt, updatedAt: row.updated_at || row.updatedAt };
}
function mapProject(row) {
  return { id: row.id, ownerId: row.owner_id, ownerName: row.owner_name || '', isOwner: Boolean(row.is_owner), title: row.title, course: row.course, className: row.class_name, team: row.team, scale: row.scale, sheetVersion: row.sheet_version, createdAt: row.created_at, evaluations: (row.evaluations || []).map(mapEvaluation), presentationEvaluations: (row.presentation_evaluations || row.presentationEvaluations || []).map(mapPresentationEvaluation) };
}

async function initialize() {
  if (initialized) return;
  if (databaseUrl) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: true },
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
    pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));
    try {
      const health = await pool.query("SELECT to_regclass('public.professors') AS professors");
      if (!health.rows[0].professors) throw new Error('O esquema do banco ainda não foi criado. Execute `npm run db:migrate` antes de iniciar.');
    } catch (error) { await pool.end(); pool = null; throw error; }
  } else {
    readLocal();
  }
  initialized = true;
}
async function health() {
  await initialize();
  if (pool) await pool.query('SELECT 1');
  return { status: 'ok', storage: pool ? 'postgresql' : 'local-json' };
}
function requireInitialized() { if (!initialized) throw new Error('Armazenamento ainda não inicializado.'); }
async function createUser({ id, name, email, passwordHash, createdAt }) {
  requireInitialized();
  if (pool) {
    try {
      await pool.query('INSERT INTO professors (id, full_name, email, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)', [id, name, email, passwordHash, createdAt]);
      return;
    } catch (error) {
      if (error.code === '23505') throw new StoreError(409, 'Já existe uma conta com esse e-mail. Entre ou use outro e-mail.');
      throw error;
    }
  }
  const store = readLocal();
  if (store.users.some((user) => user.email === email)) throw new StoreError(409, 'Já existe uma conta com esse e-mail. Entre ou use outro e-mail.');
  store.users.push({ id, name, email, passwordHash, createdAt });
  if (store.users.length === 1) for (const project of store.projects) if (!project.ownerId) project.ownerId = id;
  writeLocal(store);
}
async function findUserByEmail(email) {
  requireInitialized();
  if (pool) {
    const result = await pool.query('SELECT id, full_name AS name, email, password_hash AS "passwordHash", created_at AS "createdAt" FROM professors WHERE email=$1', [email]);
    return result.rows[0] || null;
  }
  return readLocal().users.find((user) => user.email === email) || null;
}
async function createSession(userId, token, expiresAt) {
  requireInitialized(); const hash = sessionHash(token);
  if (pool) {
    await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
    await pool.query('INSERT INTO sessions (token_hash, professor_id, expires_at) VALUES ($1,$2,$3)', [hash, userId, expiresAt]); return;
  }
  localSessions.set(hash, { userId, expiresAt: new Date(expiresAt).getTime() });
}
async function findUserBySession(token) {
  requireInitialized(); const hash = sessionHash(token);
  if (pool) {
    const result = await pool.query('SELECT p.id, p.full_name AS name, p.email FROM sessions s JOIN professors p ON p.id=s.professor_id WHERE s.token_hash=$1 AND s.expires_at > NOW()', [hash]);
    return result.rows[0] || null;
  }
  const session = localSessions.get(hash);
  if (!session || session.expiresAt <= Date.now()) { localSessions.delete(hash); return null; }
  const user = readLocal().users.find((item) => item.id === session.userId);
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}
async function deleteSession(token) {
  requireInitialized(); const hash = sessionHash(token);
  if (pool) { await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash]); return; }
  localSessions.delete(hash);
}
async function createProject(userId, input, id, createdAt) {
  requireInitialized(); const project = { id, ownerId: userId, title: input.title, course: input.course, className: input.className, team: input.team, scale: input.scale, sheetVersion: 1, createdAt, evaluations: [] };
  if (pool) {
    const result = await pool.query('INSERT INTO projects (id, owner_id, title, course, class_name, team, scale, sheet_version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8) RETURNING *', [id, userId, input.title, input.course, input.className, input.team, input.scale, createdAt]);
    return mapProject({ ...result.rows[0], evaluations: [] });
  }
  const store = readLocal(); store.projects.unshift(project); writeLocal(store); return project;
}
async function listProjects(userId) {
  requireInitialized();
  if (pool) {
    const result = await pool.query(`SELECT p.*, owner.full_name AS owner_name, (p.owner_id=$1) AS is_owner, COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'evaluator_name', evaluator.full_name, 'evaluator_id', e.evaluator_id,
      'status', e.status, 'scores', e.scores, 'criterion_notes', e.criterion_notes,
      'comments', e.comments, 'result', e.result, 'created_at', e.created_at, 'updated_at', e.updated_at
    )) FILTER (WHERE e.id IS NOT NULL AND (e.status='enviada' OR e.evaluator_id=$1)), '[]'::jsonb) AS evaluations,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'evaluator_name', pevaluator.full_name, 'evaluator_id', pe.evaluator_id, 'status', pe.status, 'scores', pe.scores, 'criterion_notes', pe.criterion_notes, 'comments', pe.comments, 'result', pe.result, 'created_at', pe.created_at, 'updated_at', pe.updated_at) ORDER BY pe.created_at)
      FROM presentation_evaluations pe JOIN professors pevaluator ON pevaluator.id=pe.evaluator_id WHERE pe.project_id=p.id AND (pe.status='enviada' OR pe.evaluator_id=$1)), '[]'::jsonb) AS presentation_evaluations
    FROM projects p JOIN professors owner ON owner.id=p.owner_id LEFT JOIN evaluations e ON e.project_id=p.id
    LEFT JOIN professors evaluator ON evaluator.id=e.evaluator_id
    WHERE p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=$1 AND i.status='accepted') GROUP BY p.id, owner.full_name ORDER BY p.created_at DESC`, [userId]);
    return result.rows.map(mapProject);
  }
  const store=readLocal();const accepted=new Set(store.invitations.filter(i=>i.inviteeId===userId&&i.status==='accepted').map(i=>i.projectId));
  return store.projects.filter(project=>project.ownerId===userId||accepted.has(project.id)).map(project=>({...project,isOwner:project.ownerId===userId,ownerName:store.users.find(u=>u.id===project.ownerId)?.name||''})).map(project=>({...project,evaluations:project.evaluations.filter(e=>e.status==='enviada'||e.evaluatorId===userId),presentationEvaluations:store.presentationEvaluations.filter(e=>e.projectId===project.id&&(e.status==='enviada'||e.evaluatorId===userId)).map(e=>({...mapPresentationEvaluation(e),evaluator:e.evaluator||store.users.find(u=>u.id===e.evaluatorId)?.name||''}))}));
}
async function createPresentationEvaluation(projectId, userId, input, id, now) {
  requireInitialized();
  if (pool) {
    const allowed = await pool.query("SELECT 1 FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR EXISTS (SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=$2 AND i.status='accepted'))", [projectId,userId]);
    if (!allowed.rowCount) throw new StoreError(404,'Projeto não encontrado ou você não participa desta banca.');
    const result=await pool.query(`INSERT INTO presentation_evaluations(id,project_id,evaluator_id,status,scores,criterion_notes,comments,result,created_at,updated_at) VALUES($1,$2,$3,'rascunho',$4,$5,'',NULL,$6,$6) ON CONFLICT(project_id,evaluator_id) DO UPDATE SET updated_at=presentation_evaluations.updated_at WHERE presentation_evaluations.status='rascunho' RETURNING *`,[id,projectId,userId,JSON.stringify(input.scores),JSON.stringify(Array(3).fill('')),now]);
    if(!result.rowCount)throw new StoreError(409,'Você já enviou sua avaliação da apresentação para este projeto.');
    return mapPresentationEvaluation(result.rows[0]);
  }
  const store=readLocal();const accepted=store.invitations.some(i=>i.projectId===projectId&&i.inviteeId===userId&&i.status==='accepted');const project=store.projects.find(p=>p.id===projectId&&(p.ownerId===userId||accepted));
  if(!project)throw new StoreError(404,'Projeto não encontrado ou você não participa desta banca.');
  const existing=store.presentationEvaluations.find(e=>e.projectId===projectId&&e.evaluatorId===userId);
  if(existing?.status==='enviada')throw new StoreError(409,'Você já enviou sua avaliação da apresentação para este projeto.');
  if(existing)return mapPresentationEvaluation(existing);
  const evaluation={id,projectId,evaluatorId:userId,evaluator:store.users.find(u=>u.id===userId)?.name||'',status:'rascunho',scores:input.scores,criterionNotes:Array(3).fill(''),comments:'',result:null,createdAt:now,updatedAt:now};store.presentationEvaluations.push(evaluation);writeLocal(store);return mapPresentationEvaluation(evaluation);
}
async function updatePresentationEvaluation(projectId,userId,evaluationId,updates) {
  requireInitialized();
  if(pool){const result=await pool.query(`UPDATE presentation_evaluations pe SET status=$1,scores=$2,criterion_notes=$3,comments=$4,result=$5,updated_at=$6 FROM projects p WHERE pe.project_id=p.id AND (p.owner_id=$7 OR EXISTS(SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=$7 AND i.status='accepted')) AND pe.project_id=$8 AND pe.id=$9 AND pe.evaluator_id=$7 AND pe.status='rascunho' RETURNING pe.id`,[updates.status,JSON.stringify(updates.scores),JSON.stringify(updates.criterionNotes),updates.comments,updates.result,updates.updatedAt,userId,projectId,evaluationId]);if(result.rowCount)return;const check=await pool.query('SELECT status FROM presentation_evaluations WHERE project_id=$1 AND id=$2 AND evaluator_id=$3',[projectId,evaluationId,userId]);if(!check.rowCount)throw new StoreError(404,'Rascunho da apresentação não encontrado.');throw new StoreError(409,'Esta avaliação da apresentação já foi enviada e não pode ser alterada.');}
  const store=readLocal();const accepted=store.invitations.some(i=>i.projectId===projectId&&i.inviteeId===userId&&i.status==='accepted');const project=store.projects.find(p=>p.id===projectId&&(p.ownerId===userId||accepted));const evaluation=store.presentationEvaluations.find(e=>e.projectId===projectId&&e.id===evaluationId&&e.evaluatorId===userId);if(!project)throw new StoreError(404,'Projeto não encontrado ou você não participa desta banca.');if(!evaluation)throw new StoreError(404,'Rascunho da apresentação não encontrado.');if(evaluation.status==='enviada')throw new StoreError(409,'Esta avaliação da apresentação já foi enviada e não pode ser alterada.');Object.assign(evaluation,updates);writeLocal(store);
}
async function createEvaluation(projectId, ownerId, evaluator, input, evaluationId, now) {
  requireInitialized();
  if (pool) {
    const projectResult = await pool.query("SELECT p.id, p.scale FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR EXISTS (SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=$2 AND i.status='accepted'))", [projectId, ownerId]);
    if (!projectResult.rows[0]) throw new StoreError(404, 'Projeto não encontrado.');
    if (input.scale !== projectResult.rows[0].scale) throw new StoreError(400, 'A escala precisa corresponder à escala configurada na ficha do projeto.');
    const result = await pool.query(`INSERT INTO evaluations (id, project_id, evaluator_id, status, scores, criterion_notes, comments, result, created_at, updated_at)
      VALUES ($1,$2,$3,'rascunho',$4,$5,'',NULL,$6,$6)
      ON CONFLICT (project_id, evaluator_id) DO UPDATE SET updated_at=evaluations.updated_at
      WHERE evaluations.status <> 'enviada'
      RETURNING id, evaluator_id, status, scores, criterion_notes, comments, result, created_at, updated_at`,
      [evaluationId, projectId, evaluator.id, JSON.stringify(input.scores), JSON.stringify(Array(10).fill('')), now]);
    if (!result.rows[0]) throw new StoreError(409, 'Você já enviou uma avaliação definitiva para este projeto.');
    const row = result.rows[0]; return { ...mapEvaluation({ ...row, evaluator_name: evaluator.name }), wasExisting: row.id !== evaluationId };
  }
  const store = readLocal(); const allowed=store.invitations.some(i=>i.projectId===projectId&&i.inviteeId===ownerId&&i.status==='accepted');const project = store.projects.find((item) => item.id === projectId && (item.ownerId === ownerId||allowed));
  if (!project) throw new StoreError(404, 'Projeto não encontrado.');
  if (input.scale !== project.scale) throw new StoreError(400, 'A escala precisa corresponder à escala configurada na ficha do projeto.');
  const existing = project.evaluations.find((item) => item.evaluatorId === evaluator.id);
  if (existing?.status === 'enviada') throw new StoreError(409, 'Você já enviou uma avaliação definitiva para este projeto.');
  if (existing) return existing;
  const evaluation = { id: evaluationId, evaluator: evaluator.name, evaluatorId: evaluator.id, status: 'rascunho', scores: input.scores, criterionNotes: Array(10).fill(''), comments: '', result: null, createdAt: now, updatedAt: now };
  project.evaluations.push(evaluation); writeLocal(store); return evaluation;
}
async function updateEvaluation(projectId, ownerId, evaluationId, evaluatorId, updates) {
  requireInitialized();
  if (pool) {
    const result = await pool.query(`UPDATE evaluations e SET status=$1, scores=$2, criterion_notes=$3, comments=$4, result=$5, updated_at=$6
      FROM projects p WHERE e.project_id=p.id AND (p.owner_id=$7 OR EXISTS (SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=$7 AND i.status='accepted')) AND e.project_id=$8 AND e.id=$9 AND e.evaluator_id=$10 AND e.status <> 'enviada'
      RETURNING e.id`, [updates.status, JSON.stringify(updates.scores), JSON.stringify(updates.criterionNotes), updates.comments, updates.result ? JSON.stringify(updates.result) : null, updates.updatedAt, ownerId, projectId, evaluationId, evaluatorId]);
    if (result.rowCount) return;
    const check = await pool.query(`SELECT e.status FROM evaluations e JOIN projects p ON p.id=e.project_id WHERE (p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_invitations i WHERE i.project_id=p.id AND i.invitee_id=$1 AND i.status='accepted')) AND e.project_id=$2 AND e.id=$3 AND e.evaluator_id=$4`, [ownerId, projectId, evaluationId, evaluatorId]);
    if (!check.rows[0]) throw new StoreError(404, 'Rascunho não encontrado.');
    if (check.rows[0].status === 'enviada') throw new StoreError(409, 'Esta avaliação já foi enviada e não pode ser alterada.');
    throw new StoreError(400, 'A avaliação não pôde ser salva.');
  }
  const store=readLocal();const allowed=store.invitations.some(i=>i.projectId===projectId&&i.inviteeId===ownerId&&i.status==='accepted');const project=store.projects.find(item=>item.id===projectId&&(item.ownerId===ownerId||allowed));
  const evaluation = project?.evaluations.find((item) => item.id === evaluationId && item.evaluatorId === evaluatorId);
  if (!evaluation) throw new StoreError(404, 'Rascunho não encontrado.');
  if (evaluation.status === 'enviada') throw new StoreError(409, 'Esta avaliação já foi enviada e não pode ser alterada.');
  Object.assign(evaluation, updates); writeLocal(store);
}
async function createProjectInvitation(ownerId, projectId, email, invitationId, now) {
  requireInitialized();
  if (pool) {
    const project=(await pool.query('SELECT id,title FROM projects WHERE id=$1 AND owner_id=$2',[projectId,ownerId])).rows[0];
    if(!project)throw new StoreError(404,'Projeto não encontrado ou você não é responsável por ele.');
    const invitee=(await pool.query('SELECT id,email,full_name AS name FROM professors WHERE lower(email)=lower($1)',[email])).rows[0];
    if(!invitee)throw new StoreError(404,'Esse e-mail ainda não tem cadastro. Peça ao professor para criar a conta e tente novamente.');
    if(invitee.id===ownerId)throw new StoreError(400,'Você já é responsável pelo projeto.');
    const prior=(await pool.query("SELECT status FROM project_invitations WHERE project_id=$1 AND invitee_id=$2 AND status IN ('pending','accepted')",[projectId,invitee.id])).rows[0];
    if(prior)throw new StoreError(409,prior.status==='accepted'?'Esse professor já participa da banca.':'Já existe um convite pendente para esse professor.');
    try{const result=await pool.query("INSERT INTO project_invitations(id,project_id,inviter_id,invitee_id,status,created_at) VALUES($1,$2,$3,$4,'pending',$5) RETURNING id,project_id AS \"projectId\",inviter_id AS \"inviterId\",invitee_id AS \"inviteeId\",status,created_at AS \"createdAt\"",[invitationId,projectId,ownerId,invitee.id,now]);return {...result.rows[0],projectTitle:project.title,inviteeEmail:invitee.email,inviteeName:invitee.name};}
    catch(error){if(error.code==='23505')throw new StoreError(409,'Já existe um convite ativo para esse professor.');throw error;}
  }
  const store=readLocal();const project=store.projects.find(p=>p.id===projectId&&p.ownerId===ownerId);if(!project)throw new StoreError(404,'Projeto não encontrado ou você não é responsável por ele.');
  const invitee=store.users.find(u=>u.email.toLowerCase()===email.toLowerCase());if(!invitee)throw new StoreError(404,'Esse e-mail ainda não tem cadastro. Peça ao professor para criar a conta e tente novamente.');
  if(invitee.id===ownerId)throw new StoreError(400,'Você já é responsável pelo projeto.');
  const prior=store.invitations.find(i=>i.projectId===projectId&&i.inviteeId===invitee.id&&['pending','accepted'].includes(i.status));if(prior)throw new StoreError(409,prior.status==='accepted'?'Esse professor já participa da banca.':'Já existe um convite pendente para esse professor.');
  const inviter=store.users.find(u=>u.id===ownerId);const invitation={id:invitationId,projectId,projectTitle:project.title,inviterId:ownerId,inviterName:inviter?.name||'',inviteeId:invitee.id,inviteeName:invitee.name,inviteeEmail:invitee.email,status:'pending',createdAt:now,respondedAt:null};store.invitations.push(invitation);writeLocal(store);return invitation;
}
async function listProjectInvitations(userId) {
  requireInitialized();
  if(pool){const result=await pool.query(`SELECT i.id,i.project_id AS "projectId",p.title AS "projectTitle",i.inviter_id AS "inviterId",owner.full_name AS "inviterName",i.invitee_id AS "inviteeId",invitee.full_name AS "inviteeName",invitee.email AS "inviteeEmail",i.status,i.created_at AS "createdAt",i.responded_at AS "respondedAt",(i.invitee_id=$1) AS received FROM project_invitations i JOIN projects p ON p.id=i.project_id JOIN professors owner ON owner.id=i.inviter_id JOIN professors invitee ON invitee.id=i.invitee_id WHERE i.invitee_id=$1 OR i.inviter_id=$1 ORDER BY i.created_at DESC`,[userId]);return result.rows;}
  const store=readLocal();return store.invitations.filter(i=>i.inviteeId===userId||i.inviterId===userId).map(i=>({...i,projectTitle:store.projects.find(p=>p.id===i.projectId)?.title||'',inviterName:store.users.find(u=>u.id===i.inviterId)?.name||'',inviteeName:store.users.find(u=>u.id===i.inviteeId)?.name||'',inviteeEmail:store.users.find(u=>u.id===i.inviteeId)?.email||'',received:i.inviteeId===userId})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}
async function respondProjectInvitation(userId, invitationId, decision, now) {
  requireInitialized();if(!['accepted','declined'].includes(decision))throw new StoreError(400,'Resposta de convite inválida.');
  if(pool){const result=await pool.query("UPDATE project_invitations SET status=$1,responded_at=$2 WHERE id=$3 AND invitee_id=$4 AND status='pending' RETURNING id",[decision,now,invitationId,userId]);if(!result.rowCount)throw new StoreError(404,'Convite não encontrado ou já respondido.');return;}
  const store=readLocal();const invitation=store.invitations.find(i=>i.id===invitationId&&i.inviteeId===userId&&i.status==='pending');if(!invitation)throw new StoreError(404,'Convite não encontrado ou já respondido.');invitation.status=decision;invitation.respondedAt=now;writeLocal(store);
}
async function revokeProjectInvitation(userId, invitationId, now) {
  requireInitialized();
  if(pool){const result=await pool.query("UPDATE project_invitations SET status='revoked',responded_at=$1 WHERE id=$2 AND inviter_id=$3 AND status IN ('pending','accepted') RETURNING id",[now,invitationId,userId]);if(!result.rowCount)throw new StoreError(404,'Convite ou participação ativa não encontrado.');return;}
  const store=readLocal();const invitation=store.invitations.find(i=>i.id===invitationId&&i.inviterId===userId&&['pending','accepted'].includes(i.status));if(!invitation)throw new StoreError(404,'Convite ou participação ativa não encontrado.');invitation.status='revoked';invitation.respondedAt=now;writeLocal(store);
}
async function listProfiles(userId) {
  requireInitialized();
  if (pool) { const result = await pool.query('SELECT id, name, norm_code AS "normCode", edition, effective_year AS year, source_note AS source, rules, created_at AS "createdAt" FROM normalization_profiles WHERE professor_id=$1 ORDER BY effective_year DESC, created_at DESC', [userId]); return result.rows; }
  return readLocal().profiles.filter((item) => item.ownerId === userId).sort((a,b) => b.year-a.year);
}
async function createProfile(userId, profile) {
  requireInitialized();
  if (pool) { const result = await pool.query('INSERT INTO normalization_profiles (id, professor_id, name, norm_code, edition, effective_year, source_note, rules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,norm_code AS "normCode",edition,effective_year AS year,source_note AS source,rules,created_at AS "createdAt"', [profile.id,userId,profile.name,profile.normCode,profile.edition,profile.year,profile.source,JSON.stringify(profile.rules||null)]); return result.rows[0]; }
  const store=readLocal(); if(store.profiles.some((p)=>p.ownerId===userId&&p.name===profile.name&&p.year===profile.year)) throw new StoreError(409,'Já existe um perfil com esse nome e ano.');
  const saved={...profile,ownerId:userId,createdAt:new Date().toISOString()}; store.profiles.push(saved); writeLocal(store); return saved;
}
async function saveAnalysis(userId, projectId, filename, profile, report) {
  requireInitialized(); const analysis={id:report.id,ownerId:userId,projectId:projectId||null,filename,profile,report,createdAt:report.analyzedAt};
  if (pool) { await pool.query('INSERT INTO document_analyses (id,professor_id,project_id,filename,profile_snapshot,report,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[analysis.id,userId,analysis.projectId,filename,JSON.stringify(profile),JSON.stringify(report),analysis.createdAt]); return analysis; }
  const store=readLocal(); store.analyses.unshift(analysis); writeLocal(store); return analysis;
}
async function listAnalyses(userId) {
  requireInitialized();
  if(pool){const result=await pool.query('SELECT id,project_id AS "projectId",filename,profile_snapshot AS profile,report,created_at AS "createdAt" FROM document_analyses WHERE professor_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]);return result.rows;}
  return readLocal().analyses.filter((item)=>item.ownerId===userId).slice(0,100);
}
async function createPasswordReset(userId, tokenHash, expiresAt) {
  requireInitialized();
  if (pool) {
    const client=await pool.connect();
    try { await client.query('BEGIN'); await client.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE professor_id=$1 AND used_at IS NULL',[userId]); await client.query('INSERT INTO password_reset_tokens (token_hash,professor_id,expires_at) VALUES ($1,$2,$3)',[tokenHash,userId,expiresAt]); await client.query('COMMIT'); }
    catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
    return;
  }
  const store=readLocal(); store.passwordResets=store.passwordResets.filter((item)=>item.expiresAt>Date.now());
  for(const item of store.passwordResets) if(item.userId===userId&&!item.usedAt)item.usedAt=Date.now();
  store.passwordResets.push({userId,tokenHash,expiresAt:new Date(expiresAt).getTime(),usedAt:null});writeLocal(store);
}
async function applyPasswordReset(tokenHash,passwordHash) {
  requireInitialized();
  if(pool){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const result=await client.query('SELECT professor_id FROM password_reset_tokens WHERE token_hash=$1 AND expires_at>NOW() AND used_at IS NULL FOR UPDATE',[tokenHash]);
      if(!result.rows[0]){await client.query('ROLLBACK');return false;}
      const userId=result.rows[0].professor_id;
      await client.query('UPDATE professors SET password_hash=$1 WHERE id=$2',[passwordHash,userId]);
      await client.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE token_hash=$1',[tokenHash]);
      await client.query('UPDATE password_reset_tokens SET used_at=NOW() WHERE professor_id=$1 AND used_at IS NULL',[userId]);
      await client.query('DELETE FROM sessions WHERE professor_id=$1',[userId]);
      await client.query('COMMIT');return true;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  const store=readLocal();const reset=store.passwordResets.find((item)=>item.tokenHash===tokenHash&&item.expiresAt>Date.now()&&!item.usedAt);
  if(!reset)return false;
  const user=store.users.find((item)=>item.id===reset.userId);if(!user)return false;
  user.passwordHash=passwordHash;for(const item of store.passwordResets)if(item.userId===user.id&&!item.usedAt)item.usedAt=Date.now();
  for(const [hash,session] of localSessions)if(session.userId===user.id)localSessions.delete(hash);
  writeLocal(store);return true;
}
function getLocalSnapshotForTests() { if (databaseUrl) throw new Error('Test snapshot só está disponível no armazenamento JSON local.'); return readLocal(); }
function restoreLocalSnapshotForTests(store) { if (databaseUrl) throw new Error('Test snapshot só está disponível no armazenamento JSON local.'); writeLocal(store); }

module.exports = { StoreError, initialize, health, createUser, findUserByEmail, createSession, findUserBySession, deleteSession, createProject, listProjects, createEvaluation, updateEvaluation, createPresentationEvaluation, updatePresentationEvaluation, createProjectInvitation, listProjectInvitations, respondProjectInvitation, revokeProjectInvitation, listProfiles, createProfile, saveAnalysis, listAnalyses, createPasswordReset, applyPasswordReset, getLocalSnapshotForTests, restoreLocalSnapshotForTests };
