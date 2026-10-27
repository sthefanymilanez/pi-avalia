const http = require('node:http');
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const nodemailer = require('nodemailer');
const { URL } = require('node:url');
const { criteria, calculate } = require('./src/domain');
const storage = require('./src/store');
const { DEFAULT_PROFILE, analyzeDocument, extractPdfText } = require('./src/document-analysis');

const root = __dirname;
const loginAttempts = new Map();
const resetAttempts = new Map();
const resetApplyAttempts = new Map();
const sessionCookie = 'pi_avalia_session';
const sessionLifetime = 8 * 60 * 60 * 1000;
const send = (res, code, value, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
};
const body = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(Object.assign(new Error('Requisição muito grande.'), { status: 413 })); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); } });
});
function readUpload(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => { const chunks=[]; let size=0; let tooLarge=false; req.on('data',(chunk)=>{size+=chunk.length;if(size>limit){tooLarge=true;chunks.length=0;return;}if(!tooLarge)chunks.push(chunk);});req.on('end',()=>tooLarge?reject(Object.assign(new Error('O arquivo excede o limite de 25 MB.'),{status:413})):resolve(Buffer.concat(chunks)));req.on('error',reject); });
}
function getCookie(req, name) {
  const part = (req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email }; }
async function createSession(res, user) {
  const token = randomBytes(32).toString('base64url');
  await storage.createSession(user.id, token, new Date(Date.now() + sessionLifetime));
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetime / 1000}${secure}`);
}
function resetMailer() {
  const host=String(process.env.SMTP_HOST||'').trim(); if(!host)return null;
  const port=Number(process.env.SMTP_PORT||587); const user=String(process.env.SMTP_USER||''); const pass=String(process.env.SMTP_PASS||'');
  if(!Number.isInteger(port)||port<1||port>65535||!user||!pass||!process.env.SMTP_FROM)return null;
  return nodemailer.createTransport({host,port,secure:String(process.env.SMTP_SECURE||'').toLowerCase()==='true'||port===465,auth:{user,pass}});
}
function rejectCrossOrigin(req, res) {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) { send(res, 403, { error: 'Solicitação de outra origem recusada.' }); return true; }
  return false;
}
function validateDraft(input, scale) {
  if (!Array.isArray(input.scores) || input.scores.length !== 10) throw Object.assign(new Error('A avaliação precisa reservar espaço para os dez critérios.'), { status: 400 });
  const scores = input.scores.map((score, index) => {
    if (score === null || score === '') return null;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > scale) throw Object.assign(new Error(`A nota do critério ${index + 1} deve estar entre 0 e ${scale}.`), { status: 400 });
    return score;
  });
  if (input.status === 'enviada' && scores.some((score) => score === null)) throw Object.assign(new Error('Preencha os dez critérios antes de enviar a avaliação.'), { status: 400 });
  return scores;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && rejectCrossOrigin(req, res)) return;
    if (url.pathname === '/healthz' && req.method === 'GET') return send(res, 200, await storage.health());
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const user = await storage.findUserBySession(getCookie(req, sessionCookie));
      return user ? send(res, 200, { user: publicUser(user) }) : send(res, 401, { error: 'Entre na sua conta para continuar.' });
    }
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const input = await body(req); const name = String(input.name || '').trim(); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      if (name.length < 2 || name.length > 100) return send(res, 400, { error: 'Informe seu nome completo.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return send(res, 400, { error: 'Informe um e-mail válido.' });
      if (password.length < 12 || password.length > 200) return send(res, 400, { error: 'A senha precisa ter pelo menos 12 caracteres.' });
      const salt = randomBytes(16).toString('hex'); const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
      const user = { id: randomUUID(), name, email, passwordHash, createdAt: new Date().toISOString() };
      try { await storage.createUser(user); } catch (error) { if (error.status === 409) return send(res, 409, { error: error.message }); throw error; }
      await createSession(res, user); return send(res, 201, { user: publicUser(user) });
    }
    if(url.pathname==='/api/auth/forgot-password'&&req.method==='POST'){
      const ip=req.socket.remoteAddress||'local';const now=Date.now();let state=resetAttempts.get(ip);
      if(!state||state.until<=now)state={count:0,until:now+15*60*1000};state.count++;resetAttempts.set(ip,state);
      const generic={message:'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir sua senha.'};
      if(state.count>5)return send(res,200,generic);
      const input=await body(req);const email=String(input.email||'').trim().toLowerCase();
      const user=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?await storage.findUserByEmail(email):null;
      const transporter=resetMailer();const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip);
      const localMode=process.env.NODE_ENV!=='production'&&(await storage.health()).storage==='local-json'&&loopback;
          const base=String(process.env.APP_BASE_URL||(localMode?`http://localhost:${server.address()?.port||port}`:(process.env.RENDER_EXTERNAL_URL||''))).replace(/\/$/,'');
      if(user&&(transporter||localMode)&&base){
        const token=randomBytes(32).toString('hex');const tokenHash=createHash('sha256').update(token).digest('hex');
        await storage.createPasswordReset(user.id,tokenHash,new Date(now+15*60*1000));
        const link=`${base}/#reset=${token}`;
        if(transporter){
          try{await transporter.sendMail({from:process.env.SMTP_FROM,to:user.email,subject:'Redefinição de senha — PI AVALIA',text:`Olá, ${user.name}.\n\nPara cadastrar uma nova senha, acesse o link abaixo. Ele expira em 15 minutos e só pode ser usado uma vez.\n\n${link}\n\nSe você não pediu esta redefinição, ignore esta mensagem.`});}
          catch(error){console.error(`Password reset email could not be sent: ${error.message}`);return send(res,200,generic);}
        } else return send(res,200,{...generic,developmentResetUrl:link});
      }
      return send(res,200,generic);
    }
    if(url.pathname==='/api/auth/reset-password'&&req.method==='POST'){
      const ip=req.socket.remoteAddress||'local';const now=Date.now();let state=resetApplyAttempts.get(ip);
      if(!state||state.until<=now)state={count:0,until:now+15*60*1000};state.count++;resetApplyAttempts.set(ip,state);
      if(state.count>20)return send(res,429,{error:'Muitas tentativas. Aguarde 15 minutos e solicite um novo link.'});
      const input=await body(req);const token=String(input.token||'').trim();const password=String(input.password||'');
      if(!/^[a-f0-9]{64}$/i.test(token))return send(res,400,{error:'Link de recuperação inválido ou expirado. Solicite outro.'});
      if(password.length<12||password.length>200)return send(res,400,{error:'A nova senha precisa ter entre 12 e 200 caracteres.'});
      const salt=randomBytes(16).toString('hex');const passwordHash=`${salt}:${scryptSync(password,salt,64).toString('hex')}`;
      const tokenHash=createHash('sha256').update(token).digest('hex');
      if(!await storage.applyPasswordReset(tokenHash,passwordHash))return send(res,400,{error:'Link de recuperação inválido, expirado ou já utilizado. Solicite outro.'});
      return send(res,200,{message:'Senha redefinida. Entre usando sua nova senha.'});
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const input = await body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      const clientKey = req.socket.remoteAddress || 'local'; const attempt = loginAttempts.get(clientKey);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10) return send(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
      const user = await storage.findUserByEmail(email); let valid = false;
      if (user && typeof user.passwordHash === 'string') {
        const [salt, stored] = user.passwordHash.split(':'); const actual = scryptSync(password, salt, 64); const expected = Buffer.from(stored, 'hex');
        valid = expected.length === actual.length && timingSafeEqual(actual, expected);
      } else scryptSync(password || 'invalid-password', 'pi-avalia-invalid-salt', 64);
      if (!valid) {
        const current = attempt && attempt.until > Date.now() ? attempt : { count: 0, until: Date.now() + 15 * 60 * 1000 };
        current.count += 1; loginAttempts.set(clientKey, current); return send(res, 401, { error: 'E-mail ou senha incorretos.' });
      }
      loginAttempts.delete(clientKey); await createSession(res, user); return send(res, 200, { user: publicUser(user) });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      await storage.deleteSession(getCookie(req, sessionCookie)); const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`); return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/criteria' && req.method === 'GET') return send(res, 200, criteria);
    const user = await storage.findUserBySession(getCookie(req, sessionCookie));
    if ((url.pathname.startsWith('/api/projects') || url.pathname.startsWith('/api/ai/')) && !user) return send(res, 401, { error: 'Entre na sua conta para acessar esta área.' });
    if (url.pathname === '/api/ai/profiles' && req.method === 'GET') {
      let profiles = await storage.listProfiles(user.id);
      if (!profiles.length) profiles = [await storage.createProfile(user.id, { id: randomUUID(), name: DEFAULT_PROFILE.name, normCode: 'ABNT NBR 14724', edition: '2011', year: 2026, source: DEFAULT_PROFILE.source, rules: DEFAULT_PROFILE.rules })];
      profiles = profiles.map(profile => (!profile.rules || !profile.rules.pageWidthCm) && /14724/.test(profile.normCode||'') && profile.edition==='2011' ? {...profile,rules:DEFAULT_PROFILE.rules} : profile);
      return send(res, 200, profiles);
    }
    if (url.pathname === '/api/ai/profiles' && req.method === 'POST') {
      const input = await body(req); const name = String(input.name || '').trim(); const normCode = String(input.normCode || '').trim(); const edition = String(input.edition || '').trim(); const year = Number(input.year);
      if (!name || !normCode || !edition || !Number.isInteger(year) || year < 1950 || year > 2200) return send(res, 400, { error: 'Informe nome, norma, edição e ano de vigência válidos.' });
      const numeric=(key,min,max)=>{const value=Number(input[key]);return Number.isFinite(value)&&value>=min&&value<=max?value:null;};
      const rules={pageWidthCm:numeric('pageWidthCm',10,60),pageHeightCm:numeric('pageHeightCm',10,80),marginsCm:{top:numeric('marginTopCm',0,10),left:numeric('marginLeftCm',0,10),bottom:numeric('marginBottomCm',0,10),right:numeric('marginRightCm',0,10)},bodyFontPt:numeric('bodyFontPt',6,30),lineSpacing:numeric('lineSpacing',0.8,3)};
      if(Object.values(rules).some(value=>value===null)||Object.values(rules.marginsCm).some(value=>value===null))return send(res,400,{error:'Preencha todos os limites de formatação com valores válidos.'});
      return send(res, 201, await storage.createProfile(user.id, { id: randomUUID(), name, normCode, edition, year, source: String(input.source || '').trim().slice(0,1000), rules }));
    }
    if (url.pathname === '/api/ai/analyses' && req.method === 'GET') return send(res, 200, await storage.listAnalyses(user.id));
    if (url.pathname === '/api/ai/analyses' && req.method === 'POST') {
      if (!/^application\/pdf(?:;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Envie um arquivo PDF.' });
      const buffer = await readUpload(req);
      if (buffer.length < 5 || buffer.subarray(0,5).toString() !== '%PDF-') return send(res, 400, { error: 'O arquivo não parece ser um PDF válido.' });
      const profiles = await storage.listProfiles(user.id); const profile = profiles.find((item) => item.id === req.headers['x-profile-id']);
      if (!profile) return send(res, 400, { error: 'Selecione um perfil ABNT antes de analisar.' });
      const projectId = String(req.headers['x-project-id'] || '').trim() || null;
      if (projectId && !(await storage.listProjects(user.id)).some((item) => item.id === projectId)) return send(res, 404, { error: 'Projeto não encontrado.' });
      const document = await extractPdfText(buffer); const report = analyzeDocument(document.text, profile, document);
      let incomingFilename=String(req.headers['x-filename']||'trabalho.pdf');try{incomingFilename=decodeURIComponent(incomingFilename);}catch{}
      const filename = incomingFilename.replace(/[\\/\r\n\0]/g, '_').slice(0,255);
      return send(res, 201, await storage.saveAnalysis(user.id, projectId, filename, profile, report));
    }
    if (url.pathname === '/api/projects' && req.method === 'GET') return send(res, 200, await storage.listProjects(user.id));
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      const input = await body(req); const title = String(input.title || '').trim();
      if (!title) return send(res, 400, { error: 'Informe o título do projeto.' });
      const scale = input.scale === 1 ? 1 : 10;
      const project = await storage.createProject(user.id, { title, course: String(input.course || '').trim(), className: String(input.className || '').trim(), team: String(input.team || '').trim(), scale }, randomUUID(), new Date().toISOString());
      return send(res, 201, project);
    }
    const match = url.pathname.match(/^\/api\/projects\/([^/]+)\/evaluations$/);
    if (match && req.method === 'POST') {
      const input = await body(req); const scores = validateDraft({ ...input, status: 'rascunho' }, input.scale);
      const evaluation = await storage.createEvaluation(match[1], user.id, user, { ...input, scores }, randomUUID(), new Date().toISOString());
      const wasExisting = Boolean(evaluation.wasExisting); delete evaluation.wasExisting;
      return send(res, wasExisting ? 200 : 201, evaluation);
    }
    const evaluationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/evaluations\/([^/]+)$/);
    if (evaluationMatch && req.method === 'PATCH') {
      const input = await body(req); const project = (await storage.listProjects(user.id)).find((item) => item.id === evaluationMatch[1]);
      if (!project) return send(res, 404, { error: 'Projeto não encontrado.' });
      const evaluation = project.evaluations.find((item) => item.id === evaluationMatch[2] && item.evaluatorId === user.id);
      if (!evaluation) return send(res, 404, { error: 'Rascunho não encontrado.' });
      if (evaluation.status === 'enviada') return send(res, 409, { error: 'Esta avaliação já foi enviada e não pode ser alterada.' });
      const status = ['rascunho', 'em_andamento', 'enviada'].includes(input.status) ? input.status : 'em_andamento';
      const scores = validateDraft({ ...input, status }, project.scale);
      const notes = Array.isArray(input.criterionNotes) && input.criterionNotes.length === 10 ? input.criterionNotes.map((note) => String(note || '').slice(0, 2000)) : evaluation.criterionNotes;
      const updates = { scores, criterionNotes: notes, comments: String(input.comments || '').slice(0, 10000), status, result: scores.every((score) => score !== null) ? calculate(scores, project.scale) : null, updatedAt: new Date().toISOString() };
      await storage.updateEvaluation(project.id, user.id, evaluation.id, user.id, updates);
      return send(res, 200, { ...evaluation, ...updates });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Rota não encontrada.' });
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const publicRoot = path.resolve(root, 'public'); const file = path.resolve(publicRoot, rel);
    if (!file.startsWith(publicRoot + path.sep)) return send(res, 403, { error: 'Acesso negado.' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Não encontrado.', 'text/plain; charset=utf-8');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    send(res, 200, fs.readFileSync(file), types[path.extname(file)] || 'application/octet-stream');
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(`Request failed: ${error.message}`);
    send(res, status, { error: status >= 500 ? 'Erro interno. Tente novamente.' : error.message });
  }
});
const port = Number(process.env.PORT || 3000);
async function start(listenPort = port) {
  await storage.initialize();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listenPort, () => { server.removeListener('error', reject); resolve(); }); });
}
if (require.main === module) start().then(() => console.log(`PI AVALIA disponível em http://localhost:${port}`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { server, start };
