const $ = (selector) => document.querySelector(selector);
const projectDialog = $('#project-dialog');
const evaluationDialog = $('#evaluation-dialog');
let criteria = [];
let activeProject = null;
let activeEvaluation = null;
let currentCriterion = 0;
let scores = [];
let notes = [];
let toastTimer;
let autosaveTimer;
let saving = false;
let saveAgain = false;
let signedInUser = null;
let authMode = 'login';

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function notify(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800); }
async function api(path, options) { const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }); let data; try { data = await response.json(); } catch { data = {}; } if (response.status === 401 && !path.startsWith('/api/auth/')) showAuth(); if (!response.ok) throw new Error(data.error || `Falha na solicitação (${response.status}).`); return data; }
function storageKey() { return `pi-avalia:draft:${activeProject?.id}:${activeEvaluation?.id || signedInUser?.id}`; }
function saveLocally() {
  if (!activeProject) return;
  const draft = { userId: signedInUser?.id, scores, notes, comments: $('#evaluation-form [name="comments"]').value, savedAt: new Date().toISOString() };
  if (!signedInUser || (!scores.some((item) => item !== null) && !notes.some(Boolean))) return;
  try { localStorage.setItem(storageKey(), JSON.stringify(draft)); } catch { /* Network sync remains available even when local storage is unavailable. */ }
}
function setSaveState(text, kind = '') { const node = $('#save-state'); node.textContent = text; node.dataset.state = kind; }
function stageName(stage) { return stage === 'documento' ? 'Documento escrito' : 'Apresentação oral'; }
function pendingDraft(project) { return (project.evaluations || []).filter((item) => item.status !== 'enviada').slice(-1)[0]; }
function projectCard(project) {
  const evaluations = project.evaluations || [];
  const sent = evaluations.filter((item) => item.status === 'enviada' && item.result);
  const average = sent.length ? (sent.reduce((sum, e) => sum + e.result.total, 0) / sent.length).toFixed(2) : null;
  const people = project.team ? project.team.split(/\r?\n/).filter(Boolean).length : 0;
  const draft = pendingDraft(project);
  return `<article class="project"><div><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml([project.course, project.className].filter(Boolean).join(' · ') || 'Curso e turma não informados')}</p><div class="project-meta" style="margin-top:9px"><span class="pill">${people} integrante${people === 1 ? '' : 's'}</span><span class="pill">Escala 0–${project.scale}</span><span class="pill">${sent.length} avaliação${sent.length === 1 ? '' : 'ões'} enviada${sent.length === 1 ? '' : 's'}</span>${average ? `<span class="pill">Média atual ${average}/100</span>` : ''}</div></div><div class="project-actions">${draft ? `<button data-action="continue" data-id="${project.id}" data-evaluation="${draft.id}">Continuar rascunho</button>` : ''}<button data-action="evaluate" data-id="${project.id}">Nova avaliação</button><button data-action="analyze" data-phase="desenvolvimento" data-id="${project.id}">Analisar durante o projeto</button><button data-action="analyze" data-phase="final" data-id="${project.id}">Revisar versão final</button></div></article>`;
}
async function refresh() {
  try {
    const [projects, criterionData] = await Promise.all([api('/api/projects'), api('/api/criteria')]); criteria = criterionData;
    const query = $('#search').value.trim().toLocaleLowerCase('pt-BR');
    const filtered = projects.filter((project) => `${project.title} ${project.course} ${project.className}`.toLocaleLowerCase('pt-BR').includes(query));
    $('#project-count').textContent = projects.length;
    $('#evaluation-count').textContent = projects.reduce((sum, item) => sum + (item.evaluations || []).filter((e) => e.status === 'enviada').length, 0);
    $('#project-list').innerHTML = filtered.length ? filtered.map(projectCard).join('') : `<div class="empty"><strong>${projects.length ? 'Nenhum projeto corresponde à busca' : 'Ainda não há projetos cadastrados'}</strong>${projects.length ? 'Tente outro título, curso ou turma.' : 'Cadastre um projeto para começar a organizar a avaliação.'}</div>`;
    const evaluationRows=projects.flatMap(project=>(project.evaluations||[]).map(evaluation=>({project,evaluation})));
    $('#evaluation-list').innerHTML=evaluationRows.length?evaluationRows.map(({project,evaluation})=>{const sent=evaluation.status==='enviada';const status=sent?'Enviada':evaluation.status==='em_andamento'?'Em andamento':'Rascunho';const score=sent&&evaluation.result?` · Nota ${Number(evaluation.result.total).toFixed(2)}/100`:'';return `<article class="evaluation-row"><div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml([project.course,project.className].filter(Boolean).join(' · ')||'Curso e turma não informados')}</small></div><span class="pill">${status}</span><b>${score||'Aguardando conclusão'}</b></article>`;}).join(''):'<div class="empty"><strong>Nenhuma avaliação registrada</strong>Abra Projetos e selecione “Nova avaliação” para iniciar uma ficha.</div>';
  } catch (error) { $('#project-list').innerHTML = `<div class="empty"><strong>Não foi possível carregar os projetos</strong>${escapeHtml(error.message)}</div>`; }
}
function parseLocalDraft(evaluator) {
  try { return JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch { return null; }
}
function openEvaluation(project, draft = null) {
  activeProject = project; activeEvaluation = draft; currentCriterion = 0;
  $('#evaluation-title').textContent = project.title;
  scores = draft?.scores ? [...draft.scores] : Array(10).fill(null);
  notes = draft?.criterionNotes ? [...draft.criterionNotes] : Array(10).fill('');
  $('#evaluation-form [name="comments"]').value = draft?.comments || '';
  const cached = parseLocalDraft();
  if (cached && (!draft || new Date(cached.savedAt) > new Date(draft.updatedAt || draft.createdAt))) {
    scores = cached.scores || scores; notes = cached.notes || notes;
    $('#evaluation-form [name="comments"]').value = cached.comments || '';
    setSaveState('Rascunho recuperado deste dispositivo', 'saved');
  } else setSaveState(draft ? 'Rascunho carregado' : 'Preencha a ficha; o rascunho salva automaticamente', '');
  $('#evaluation-form').dataset.scale = project.scale;
  $('#scale-hint').textContent = `· 0 a ${project.scale}`;
  $('#current-score').max = project.scale;
  $('#bank-entry').hidden = false; $('#bank-review').hidden = true;
  renderCriterion(); evaluationDialog.showModal();
}
function renderCriterion() {
  const item = criteria[currentCriterion];
  $('#progress-label').textContent = `Critério ${currentCriterion + 1} de ${criteria.length}`;
  $('#progress-fill').style.width = `${((currentCriterion + 1) / criteria.length) * 100}%`;
  $('#criterion-stage').textContent = `${stageName(item.stage)} · peso ${item.weight.toFixed(1)}`;
  $('#criterion-title').textContent = `${item.number}. ${item.title}`;
  $('#criterion-description').textContent = item.description;
  $('#current-score').value = scores[currentCriterion] ?? '';
  $('#current-note').value = notes[currentCriterion] || '';
  $('#previous-criterion').disabled = currentCriterion === 0;
  $('#next-criterion').textContent = currentCriterion === criteria.length - 1 ? 'Último critério' : 'Próximo →';
}
function readCurrent() {
  const raw = $('#current-score').value;
  scores[currentCriterion] = raw === '' ? null : Number(raw);
  notes[currentCriterion] = $('#current-note').value;
  saveLocally();
  if (scores[currentCriterion] !== null && (scores[currentCriterion] < 0 || scores[currentCriterion] > activeProject.scale)) setSaveState(`Nota fora do intervalo de 0 a ${activeProject.scale}`, 'error');
  else scheduleAutosave();
}
function getCalculation() {
  const scale = activeProject.scale;
  if (scores.some((score) => score === null || !Number.isFinite(score) || score < 0 || score > scale)) return null;
  const average = (values) => values.reduce((sum, score) => sum + score / scale, 0) / values.length;
  const document = average(scores.slice(0, 7)) * 70; const presentation = average(scores.slice(7)) * 30;
  return { document: Math.round((document + Number.EPSILON) * 100) / 100, presentation: Math.round((presentation + Number.EPSILON) * 100) / 100, total: Math.round((document + presentation + Number.EPSILON) * 100) / 100 };
}
function updateScorePreview() {
  const result = getCalculation();
  $('#doc-score').innerHTML = result ? `${result.document.toFixed(2)} <small>/ 70</small>` : '— <small>/ 70</small>';
  $('#oral-score').innerHTML = result ? `${result.presentation.toFixed(2)} <small>/ 30</small>` : '— <small>/ 30</small>';
  $('#final-score').innerHTML = result ? `${result.total.toFixed(2)} <small>/ 100</small>` : '— <small>/ 100</small>';
}
function scheduleAutosave() {
  clearTimeout(autosaveTimer); setSaveState('Alterações locais salvas · sincronizando…', 'saving');
  autosaveTimer = setTimeout(saveDraft, 550);
}
async function saveDraft() {
  if (saving) { saveAgain = true; return; }
  if (!signedInUser) { setSaveState('Entre na sua conta para salvar', 'error'); return; }
  if (scores.some((score) => score !== null && (score < 0 || score > activeProject.scale))) return;
  saving = true;
  try {
    if (!activeEvaluation) activeEvaluation = await api(`/api/projects/${activeProject.id}/evaluations`, { method: 'POST', body: JSON.stringify({ scores: Array(10).fill(null), scale: activeProject.scale }) });
    const payload = { scores, criterionNotes: notes, comments: $('#evaluation-form [name="comments"]').value, status: scores.some((score, index) => score !== null || Boolean(notes[index])) ? 'em_andamento' : 'rascunho' };
    activeEvaluation = await api(`/api/projects/${activeProject.id}/evaluations/${activeEvaluation.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    setSaveState(`Salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, 'saved');
    refresh();
  } catch (error) { setSaveState('Sem conexão · rascunho guardado neste dispositivo', 'error'); }
  finally { saving = false; if (saveAgain) { saveAgain = false; saveDraft(); } }
}
function renderReview() {
  const result = getCalculation();
  $('#review-list').innerHTML = criteria.map((item, index) => `<button type="button" class="review-row" data-criterion="${index}"><span><strong>${item.number}. ${escapeHtml(item.title)}</strong><small>${escapeHtml(notes[index] || 'Sem observação')}</small></span><b>${scores[index] === null ? 'Sem nota' : `${scores[index]} / ${activeProject.scale}`}</b><i>Editar</i></button>`).join('');
  updateScorePreview();
  const submit = $('#submit-evaluation'); submit.disabled = !result;
  submit.title = result ? '' : 'Preencha os dez critérios para enviar';
  if (!result) notify('Para enviar, preencha as notas dos dez critérios. Você pode manter o rascunho e voltar depois.');
}

$('#new-project').addEventListener('click', () => { $('#project-form').reset(); projectDialog.showModal(); });
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button.primary'); button.disabled = true;
  try { await api('/api/projects', { method: 'POST', body: JSON.stringify({ title: form.get('title'), course: form.get('course'), className: form.get('className'), team: form.get('team'), scale: Number(form.get('scale')) }) }); projectDialog.close(); await refresh(); notify('Projeto cadastrado.'); }
  catch (error) { notify(error.message); } finally { button.disabled = false; }
});
$('#project-list').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
  try {
    const projects = await api('/api/projects'); const project = projects.find((item) => item.id === button.dataset.id); if (!project) return;
    if (button.dataset.action === 'analyze') { analysisProjectId=project.id; $('#analysis-context').textContent=`${project.title} · ${button.dataset.phase === 'final' ? 'versão final' : 'durante o projeto'}`; $('#verificacao').scrollIntoView({behavior:'smooth'}); return; }
    const draft = (project.evaluations || []).find((item) => item.id === button.dataset.evaluation);
    openEvaluation(project, draft || null);
  } catch (error) { notify(error.message); }
});
$('#previous-criterion').addEventListener('click', () => { readCurrent(); if (currentCriterion > 0) currentCriterion -= 1; renderCriterion(); });
$('#next-criterion').addEventListener('click', () => { readCurrent(); if (currentCriterion < criteria.length - 1) currentCriterion += 1; renderCriterion(); });
$('#current-score').addEventListener('input', () => { readCurrent(); });
$('#current-note').addEventListener('input', () => { readCurrent(); });
$('#evaluation-form [name="comments"]').addEventListener('input', () => { saveLocally(); scheduleAutosave(); });
$('#review-evaluation').addEventListener('click', () => { readCurrent(); renderReview(); $('#bank-entry').hidden = true; $('#bank-review').hidden = false; });
$('#back-to-bank').addEventListener('click', () => { $('#bank-entry').hidden = false; $('#bank-review').hidden = true; });
$('#review-list').addEventListener('click', (event) => { const button = event.target.closest('[data-criterion]'); if (!button) return; currentCriterion = Number(button.dataset.criterion); $('#bank-entry').hidden = false; $('#bank-review').hidden = true; renderCriterion(); });
$('#evaluation-form').addEventListener('submit', async (event) => {
  event.preventDefault(); readCurrent(); const result = getCalculation();
  if (!result) return notify('Preencha as notas dos dez critérios antes de enviar.');
  const submit = $('#submit-evaluation'); submit.disabled = true;
  try {
    if (!activeEvaluation) await saveDraft();
    if (!activeEvaluation?.id) throw new Error('Rascunho ainda não sincronizado. Tente enviar novamente quando a conexão voltar.');
    await api(`/api/projects/${activeProject.id}/evaluations/${activeEvaluation.id}`, { method: 'PATCH', body: JSON.stringify({ scores, criterionNotes: notes, comments: $('#evaluation-form [name="comments"]').value, status: 'enviada' }) });
    try { localStorage.removeItem(storageKey()); } catch { /* No action needed. */ }
    evaluationDialog.close(); await refresh(); notify('Avaliação enviada e registrada.');
  } catch (error) { notify(error.message); }
  finally { submit.disabled = false; }
});
$('#search').addEventListener('input', refresh);

function showAuth() { signedInUser = null; $('#auth-screen').hidden = false; $('#app-shell').hidden = true; }
let analysisProjectId = null;
function renderAnalysis(report) {
  const statusLabel=(item)=>item.status==='não verificado'?'Não verificado':item.status;
  const list=(items)=>items.length?`<ul>${items.map((item)=>`<li>${escapeHtml(typeof item==='string'?item:item.label||item.citation||item.excerpt||'Indício')}${item.excerpt?`<blockquote>${escapeHtml(item.excerpt)}</blockquote>`:''}</li>`).join('')}</ul>`:'<p>Nenhum item encontrado por esta verificação heurística.</p>';
  const card=(title,body)=>`<article class="analysis-card"><h4>${title}</h4>${body}</article>`;
  const findings=report.report.priorityFindings||[];
  const findingMarkup=findings.length?findings.map((finding)=>`<article class="finding-card ${finding.level==='Alta prioridade'?'finding-high':'finding-review'}"><div class="finding-heading"><span>${escapeHtml(finding.level)}</span><strong>${escapeHtml(finding.title)}</strong></div>${finding.evidence?`<p><b>Evidência localizada:</b> ${escapeHtml(finding.evidence)}</p>`:'<p><b>Evidência:</b> seção ou relação não identificada na extração.</p>'}<p><b>Próxima ação:</b> ${escapeHtml(finding.action)}</p><small>Base do alerta: ${escapeHtml(finding.confidence)}. Confirme no documento original.</small></article>`).join(''):'<p>Nenhum alerta prioritário foi produzido. Isso não equivale a aprovação do trabalho.</p>';
  const fmt=report.report.formatting;const fmtRows=(fmt.checks||[]).map(c=>`<tr><th>${escapeHtml(c.label)}</th><td>${c.value===null?'—':`${escapeHtml(c.value)} ${escapeHtml(c.unit)}`}</td><td>${c.target===null?'—':`${escapeHtml(c.target)} ${escapeHtml(c.unit)}`}</td><td>${escapeHtml(c.status)}</td></tr>`).join('');
  const fmtHtml=`<p><b>${escapeHtml(fmt.status)}</b></p>${fmt.checks?.length?`<div class="format-table-wrap"><table class="format-table"><thead><tr><th>Item medido</th><th>PDF</th><th>Perfil</th><th>Resultado</th></tr></thead><tbody>${fmtRows}</tbody></table></div><p>${escapeHtml(fmt.note)}</p>`:`<p>${escapeHtml(fmt.note||fmt.reason||'Sem medidas disponíveis.')}</p>`}`;
  $('#analysis-result').innerHTML=`<div class="analysis-summary"><strong>${escapeHtml(report.filename||'Documento analisado')}</strong><span>${new Date(report.createdAt||report.report.analyzedAt).toLocaleString('pt-BR')}</span><small>Perfil: ${escapeHtml(report.profile?.name||report.report.profile?.name)} · ${escapeHtml(report.profile?.normCode||'ABNT NBR 14724')}:${escapeHtml(report.profile?.edition||'2011')} · vigência ${escapeHtml(report.profile?.year||2026)}</small></div><section class="priority-panel"><h3>Achados prioritários para leitura do professor</h3><p>Alertas altos primeiro; cada um apresenta a evidência extraída e uma ação sugerida. O nível indica prioridade de revisão, não nota nem conclusão automática.</p><div class="finding-list">${findingMarkup}</div></section><div class="analysis-grid">${card('Estrutura do trabalho',`<p>${report.report.structure.sections.filter(s=>s.found).length} de ${report.report.structure.sections.length} títulos procurados foram localizados.</p>${list(report.report.structure.sections.filter(s=>!s.found).map(s=>s.label))}<p class="hint">${escapeHtml(report.report.structure.note)}</p>`)}${card('Problema, objetivos e conclusão',`<p>Status: ${escapeHtml(report.report.researchQuestion.status)}</p><p>${escapeHtml(report.report.researchQuestion.note)}</p>${report.report.researchQuestion.problem?`<details><summary>Ver trechos comparados</summary><p><b>Problema:</b> ${escapeHtml(report.report.researchQuestion.problem)}</p><p><b>Objetivo:</b> ${escapeHtml(report.report.researchQuestion.objective)}</p><p><b>Conclusão:</b> ${escapeHtml(report.report.researchQuestion.conclusion)}</p><p>Sobreposição de palavras (não semântica): problema/objetivo ${report.report.researchQuestion.problemObjectiveOverlap}%; objetivo/conclusão ${report.report.researchQuestion.objectiveConclusionOverlap}%</p></details>`:''}`)}${card('Citações e referências',`<p>${escapeHtml(report.report.references.status)} · ${report.report.references.citationCount} citações e ${report.report.references.referenceCount} referências extraídas.</p><h5>Citações sem correspondência provável</h5>${list(report.report.references.unmatchedCitations)}<h5>Referências não encontradas no texto</h5>${list(report.report.references.referencesNotFoundInCitations)}<p class="hint">${escapeHtml(report.report.references.note)}</p>`)}${card('Plágio / similaridade',`<p class="status-unverified">${statusLabel(report.report.plagiarism)}</p><p>${escapeHtml(report.report.plagiarism.reason)}</p>`)}${card('Possível texto gerado por IA',`<p class="status-unverified">${statusLabel(report.report.aiAuthorship)}</p>${list(report.report.aiAuthorship.indicators)}<p>${escapeHtml(report.report.aiAuthorship.reason)}</p>`)}${card('Formatação ABNT',fmtHtml)}</div><p class="hint">${escapeHtml(report.report.rigorNote)}</p>`;
}
async function loadAnalysisWorkspace() {
  try {
    const [profiles, analyses]=await Promise.all([api('/api/ai/profiles'),api('/api/ai/analyses')]);
    $('#analysis-profile').innerHTML=profiles.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.normCode)}:${escapeHtml(p.edition)} · ${p.year}</option>`).join('');
    $('#analysis-history').innerHTML=analyses.length?analyses.map(item=>`<button class="history-item" data-analysis="${escapeHtml(item.id)}"><span>${escapeHtml(item.filename)} · ${escapeHtml(item.profile.name)} · ${new Date(item.createdAt).toLocaleDateString('pt-BR')}</span><small>Abrir parecer</small></button>`).join(''):'<p class="hint">Nenhuma análise salva.</p>';
    analysisCache=analyses;
  } catch(error) { $('#analysis-status').textContent=error.message; }
}
let analysisCache=[];
function showApp(user) { signedInUser = user; $('#auth-screen').hidden = true; $('#app-shell').hidden = false; $('#signed-in-name').textContent = user.name; refresh(); loadAnalysisWorkspace(); }
function setAuthMode(mode) {
  authMode = mode; const registering = mode === 'register';
  $('#auth-title').textContent = registering ? 'Criar conta de professor' : 'Acesse sua conta';
  $('#name-field').hidden = !registering; $('#name-field input').required = registering;
  $('#confirm-field').hidden = !registering; $('#confirm-field input').required = registering;
  $('#auth-form [name="password"]').autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-form [name="password"]').placeholder = registering ? 'Pelo menos 12 caracteres' : 'Sua senha';
  $('#auth-help').textContent = registering ? 'Uma conta pessoal será usada em todos os projetos em que você participar.' : 'Ainda não tem cadastro? Crie sua conta de professor.';
  $('#forgot-password').hidden = registering;
  $('#auth-submit').textContent = registering ? 'Criar minha conta' : 'Entrar';
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('selected', button.dataset.authMode === mode));
  $('#auth-error').hidden = true;
}
document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const authForm = event.currentTarget; const form = new FormData(authForm); const errorNode = $('#auth-error'); const submit = $('#auth-submit');
  if (authMode === 'register' && form.get('password') !== form.get('confirmPassword')) { errorNode.textContent = 'As senhas não coincidem.'; errorNode.hidden = false; return; }
  submit.disabled = true; errorNode.hidden = true;
  try {
    const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = { email: form.get('email'), password: form.get('password') };
    if (authMode === 'register') payload.name = form.get('name');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Não foi possível acessar a conta.');
    authForm.reset(); showApp(data.user); notify(authMode === 'register' ? 'Cadastro criado. Bem-vindo(a) ao PI AVALIA.' : 'Acesso realizado.');
  } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
  finally { submit.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { showAuth(); setAuthMode('login'); } });
let resetToken = '';
function showResetPanel(token = '') {
  resetToken=token; $('#auth-title').textContent=token?'Definir nova senha':'Recuperar senha';
  document.querySelector('.auth-tabs').hidden=true; $('#auth-form').hidden=true; $('#reset-panel').hidden=false;
  $('#reset-request-form').hidden=Boolean(token); $('#reset-new-form').hidden=!token;
  $('#reset-request-status').textContent=''; $('#reset-new-status').hidden=true;
}
function returnToLogin(email = '') {
  resetToken=''; $('#reset-panel').hidden=true; document.querySelector('.auth-tabs').hidden=false; $('#auth-form').hidden=false;
  $('#auth-title').textContent='Acesse sua conta'; setAuthMode('login'); if(email)$('#auth-form [name="email"]').value=email;
}
$('#forgot-password').addEventListener('click',()=>{ $('#reset-request-form [name="email"]').value=$('#auth-form [name="email"]').value; showResetPanel(); });
$('#back-to-login').addEventListener('click',()=>returnToLogin($('#reset-request-form [name="email"]').value));
$('#reset-request-form').addEventListener('submit',async(event)=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;$('#reset-request-status').textContent='Enviando…';
  try{const data=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:new FormData(event.currentTarget).get('email')})});const status=$('#reset-request-status');status.textContent=data.developmentResetUrl?'Este ambiente local não envia e-mail. Use o link abaixo para redefinir a senha (válido por 15 minutos).':data.message;if(data.developmentResetUrl){const link=document.createElement('a');link.href=data.developmentResetUrl;link.textContent='Abrir link local de recuperação';link.className='dev-reset-link';status.append(document.createElement('br'),link);}}
  catch(error){$('#reset-request-status').textContent=error.message;}finally{button.disabled=false;}
});
$('#reset-new-form').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=new FormData(event.currentTarget);const status=$('#reset-new-status');status.hidden=true;
  if(form.get('password')!==form.get('confirmPassword')){status.textContent='As senhas não coincidem.';status.hidden=false;return;}
  const button=event.currentTarget.querySelector('button');button.disabled=true;
  try{const data=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetToken,password:form.get('password')})});notify(data.message);returnToLogin($('#reset-request-form [name="email"]').value);}
  catch(error){status.textContent=error.message;status.hidden=false;}finally{button.disabled=false;}
});
const initialReset=new URLSearchParams(location.hash.slice(1));if(initialReset.has('reset')){showResetPanel(initialReset.get('reset'));history.replaceState(null,'',location.pathname+location.search);}
$('#document-analysis-form').addEventListener('submit',async(event)=>{event.preventDefault();const file=$('#analysis-file').files[0];if(!file)return;const submit=$('#analyze-document');submit.disabled=true;$('#analysis-status').textContent='Extraindo o texto localmente e preparando o relatório…';try{const response=await fetch('/api/ai/analyses',{method:'POST',headers:{'Content-Type':'application/pdf','X-Profile-Id':$('#analysis-profile').value,'X-Project-Id':analysisProjectId||'','X-Filename':encodeURIComponent(file.name)},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'Falha na análise.');renderAnalysis(result);$('#analysis-status').textContent='Análise concluída. Revise os trechos e as limitações antes de emitir um parecer.';await loadAnalysisWorkspace();}catch(error){$('#analysis-status').textContent=error.message;}finally{submit.disabled=false;}});
$('#profile-form').addEventListener('submit',async(event)=>{event.preventDefault();const profileForm=event.currentTarget;const form=new FormData(profileForm);const submit=profileForm.querySelector('button[type="submit"]');if(submit)submit.disabled=true;try{await api('/api/ai/profiles',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});profileForm.reset();await loadAnalysisWorkspace();notify('Perfil de norma salvo.');}catch(error){notify(error.message);}finally{if(submit)submit.disabled=false;}});
$('#analysis-history').addEventListener('click',(event)=>{const button=event.target.closest('[data-analysis]');const item=analysisCache.find(a=>a.id===button?.dataset.analysis);if(item)renderAnalysis(item);});
const mainNav=document.querySelector('.sidebar nav');
function syncNavigation(){if(!mainNav)return;const hash=location.hash||'#inicio';const requestedId=hash.slice(1);const requestedPanel=document.getElementById(requestedId);const activeId=requestedPanel?.classList.contains('tab-view')?requestedId:'inicio';document.querySelectorAll('main .tab-view').forEach(panel=>{panel.hidden=panel.id!==activeId;});for(const link of mainNav.querySelectorAll('a')){const active=link.getAttribute('href')===`#${activeId}`;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}}
window.addEventListener('hashchange',syncNavigation);syncNavigation();
fetch('/api/auth/me').then(async (response) => { if (!response.ok) throw new Error('Sem sessão'); return response.json(); }).then(({ user }) => showApp(user)).catch(showAuth);
