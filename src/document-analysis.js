const crypto = require('node:crypto');

const DEFAULT_PROFILE = Object.freeze({
  id: 'institutional-2026', name: 'Manual institucional · 2026', year: 2026,
  norm: 'ABNT NBR 14724:2011', source: 'Edição informada pela instituição; conferir o manual vigente',
  rules: { pageWidthCm: 21, pageHeightCm: 29.7, marginsCm: { top: 3, left: 3, bottom: 2, right: 2 }, bodyFontPt: 12, lineSpacing: 1.5 },
  updatedAt: null
});

function measureFormatting(document, profile) {
  const rules = profile?.rules;
  if (!document?.pages?.length || !rules) return { status: 'parcial', checks: [], note: 'Este perfil não tem limites de formatação cadastrados. Configure os critérios da edição antes de comparar.' };
  const pages = document.pages;
  const mean = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
  const median = (xs) => { if (!xs.length) return null; const s=[...xs].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
  const rounded = (n, d=1) => n == null ? null : Number(n.toFixed(d));
  const dims = pages.map(p=>({w:p.widthPt*2.54/72,h:p.heightPt*2.54/72}));
  const a4 = dims.every(d=>Math.abs(d.w-rules.pageWidthCm)<=0.2 && Math.abs(d.h-rules.pageHeightCm)<=0.2);
  const bodySizes=pages.flatMap(p=>p.items.filter(i=>i.text.trim().length>2 && i.fontPt>0).map(i=>i.fontPt));
  const font=median(bodySizes);
  const lineRatios=[]; const marginSamples={left:[],right:[],top:[],bottom:[]};
  for (const p of pages) {
    const grouped=new Map();
    for (const it of p.items) {
      if (!it.text.trim() || !it.fontPt) continue;
      const key=Math.round(it.y/3)*3; const line=grouped.get(key)||{xs:[],ends:[],text:'',font:[]};
      line.xs.push(it.x); line.ends.push(it.x+it.width); line.text+=` ${it.text}`; line.font.push(it.fontPt); grouped.set(key,line);
    }
    const lines=[...grouped.entries()].map(([y,l])=>({y,x:Math.min(...l.xs),end:Math.max(...l.ends),text:l.text.trim(),font:median(l.font)})).sort((a,b)=>b.y-a.y);
    const bodyLines=lines.filter(l=>l.text.length>=35 && Math.abs(l.font-(font||12))<=2.5);
    for(const l of bodyLines){marginSamples.left.push(l.x*2.54/72);marginSamples.right.push((p.widthPt-l.end)*2.54/72);}
    const ys=bodyLines.map(l=>l.y).sort((a,b)=>b-a);
    for(let i=1;i<ys.length;i++){const gap=ys[i-1]-ys[i];if(gap>=font*0.75&&gap<=font*2.2)lineRatios.push(gap/font);}
    const topLines=lines.filter(l=>l.text.length>=35); if(topLines.length){const first=Math.max(...topLines.map(l=>l.y));const last=Math.min(...topLines.map(l=>l.y));marginSamples.top.push((p.heightPt-first)*2.54/72);marginSamples.bottom.push(last*2.54/72);}
  }
  const checks=[];
  const add=(label,value,target,unit,tolerance,how='mediana aproximada')=>{if(value==null){checks.push({label,value:null,target,unit,status:'inconclusivo',method:how});return;} const pass=Math.abs(value-target)<=tolerance; checks.push({label,value:rounded(value,2),target,unit,status:pass?'dentro do limite':'fora do limite',method:how});};
  add('Papel (largura)',mean(dims.map(d=>d.w)),rules.pageWidthCm,'cm',0.2,'caixa da página PDF');
  add('Papel (altura)',mean(dims.map(d=>d.h)),rules.pageHeightCm,'cm',0.2,'caixa da página PDF');
  for(const side of ['top','left','bottom','right']) add(`Margem ${({top:'superior',left:'esquerda',bottom:'inferior',right:'direita'})[side]}`,median(marginSamples[side]),rules.marginsCm[side],'cm',0.3,'posição mediana das linhas de texto identificadas');
  add('Fonte predominante',font,rules.bodyFontPt,'pt',0.7,'mediana do tamanho das fontes extraídas');
  add('Entrelinhas predominante',median(lineRatios),rules.lineSpacing,'× a fonte',0.18,'distância entre linhas longas consecutivas / tamanho mediano da fonte');
  checks.push({label:'Imagens no PDF',value:pages.reduce((n,p)=>n+(p.imageCount||0),0),target:null,unit:'objeto(s)',status:'informativo',method:'objetos de imagem identificados; não valida resolução, legenda nem pertinência'});
  const measurable=checks.filter(c=>c.target!==null); const status=measurable.every(c=>c.status==='dentro do limite')?'medidas dentro dos limites':measurable.some(c=>c.status==='fora do limite')?'revisar medidas fora do limite':'medição parcial';
  return {status,checks,note:'Leitura geométrica do PDF; margens e entrelinhas são aproximações baseadas em texto extraído. Elementos pré-textuais, citações longas, notas, tabelas e cabeçalhos podem exigir exceções do manual. Revise as páginas indicadas no arquivo original.'};
}

const SECTION_PATTERNS = [
  ['Resumo', /^resumo(?:\s|$)/im], ['Introdução', /^1?\.?\s*introdu[cç][aã]o\b/im],
  ['Problema de pesquisa', /\b(problema de pesquisa|quest[aã]o de pesquisa|pergunta de pesquisa)\b/i],
  ['Objetivos', /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:objetivos?\b|objetivo geral\b)/im],
  ['Metodologia', /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:metodologia|procedimentos metodol[oó]gicos)\b/im],
  ['Desenvolvimento / fundamentação', /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:fundamenta[cç][aã]o te[oó]rica|referencial te[oó]rico|desenvolvimento)\b/im],
  ['Resultados', /^\s*(?:\d+(?:\.\d+)*\.?\s*)?resultados?\b/im],
  ['Conclusão', /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:considera[cç][oõ]es finais|conclus[aã]o)\b/im],
  ['Referências', /^\s*refer[eê]ncias\b/im]
];

function norm(text) { return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR'); }
function excerpt(text, index, size = 260) { return text.slice(Math.max(0, index - 100), Math.min(text.length, index + size)).replace(/\s+/g, ' ').trim(); }
function analyzeDocument(text, profile = DEFAULT_PROFILE, pdfDocument = null) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const normalized = norm(clean);
  const sections = SECTION_PATTERNS.map(([label, pattern]) => {
    const match = pattern.exec(clean); return { label, found: Boolean(match), evidence: match ? excerpt(clean, match.index, 100) : null };
  });
  const citations = [...clean.matchAll(/\(([^()\n]{1,140}(?:19|20)\d{2}[a-z]?[^()\n]{0,60})\)/gi)].map((m) => ({ text: m[1].trim(), index: m.index }));
  const refIndex = sections.find((s) => s.label === 'Referências' && s.found)?.evidence;
  const refStart = normalized.lastIndexOf('referencias');
  const refsText = refStart >= 0 ? clean.slice(refStart + 'referências'.length) : '';
  const references = refsText.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 30 && /\b(?:19|20)\d{2}\b/.test(line)).slice(0, 500);
  const unmatchedCitations = citations.filter((citation) => {
    const match = citation.text.match(/\b([A-ZÀ-Ü][A-Za-zÀ-ÿ'’-]+)(?:\s+et\s+al\.)?[^\d]*(?:19|20)\d{2}/);
    return match && !references.some((ref) => norm(ref).includes(norm(match[1])) && ref.includes(citation.text.match(/(?:19|20)\d{2}/)?.[0] || ''));
  }).map((c) => ({ excerpt: excerpt(clean, c.index, 160), citation: c.text }));
  const citedAuthorYears = new Set(citations.map((c) => c.text));
  const missingInText = references.filter((ref) => {
    const author = ref.match(/^\s*([A-ZÀ-Ü][A-ZÀ-Ü'’-]+)/)?.[1]; const year = ref.match(/\b(?:19|20)\d{2}\b/)?.[0];
    return author && year && ![...citedAuthorYears].some((c) => norm(c).includes(norm(author)) && c.includes(year));
  }).slice(0, 100);
  const introHeading=/^\s*(?:\d+(?:\.\d+)*\.?\s*)?introdu[cç][aã]o\b/im.exec(clean);
  const introText=introHeading?clean.slice(introHeading.index,Math.min(clean.length,introHeading.index+7000)):clean.slice(0,7000);
  const problemTerms=[...introText.matchAll(/(?:problema de pesquisa|quest[aã]o(?: norteadora)? de pesquisa|pergunta(?: norteadora)? de pesquisa|problema investigado|busca responder)\s*[:?]?\s*([^.!?\n]{20,320}(?:[.!?]|$))/gi)];
  if(!problemTerms.length){for(const match of introText.matchAll(/([^.!?\n]{25,260}\?)/g)){if(/(?:como|qual|quais|de que forma|em que medida|por que|porque)/i.test(match[1])){problemTerms.push(match);break;}}}
  const objectives = [...clean.matchAll(/(?:objetivo geral|objetivo principal|objetiva-se|o objetivo deste trabalho)\s*[:\-]?\s*([^.!?\n]{25,240})/gi)];
  const conclusions = [...clean.matchAll(/(?:conclui-se|conclu[ií]mos|os resultados permitem|considera[cç][oõ]es finais)\s*[:\-]?\s*([^.!?\n]{25,240})/gi)];
  const overlap = (a, b) => {
    const stop = new Set('para com uma que por dos das este esta esse essa sobre entre como mais sua seus pelo pela das aos nos nas foi será pode deve trabalho pesquisa objetivo'.split(' '));
    const tokens = (s) => norm(s).match(/[a-z]{5,}/g)?.filter((word) => !stop.has(word)) || [];
    const left = new Set(tokens(a)); const right = new Set(tokens(b));
    if (!left.size || !right.size) return 0;
    let common = 0; for (const word of left) if (right.has(word)) common++;
    return Math.round(100 * common / Math.min(left.size, right.size));
  };
  const alignment = problemTerms.length && objectives.length && conclusions.length ? {
    status: 'orientativo', problem: problemTerms[0][1].trim(), objective: objectives[0][1].trim(), conclusion: conclusions[0][1].trim(),
    problemObjectiveOverlap: overlap(problemTerms[0][1], objectives[0][1]), objectiveConclusionOverlap: overlap(objectives[0][1], conclusions[0][1]),
    note: 'Os percentuais comparam palavras em comum, não o sentido. Use os trechos como roteiro de leitura; a resposta do problema exige julgamento acadêmico.'
  } : { status: 'inconclusivo', note: 'Não foi possível identificar com segurança problema, objetivo e conclusão no texto extraído.' };
  const aiIndicators = [];
  for (const match of clean.matchAll(/\b(?:como modelo de linguagem|sou uma intelig[eê]ncia artificial|gerado por intelig[eê]ncia artificial|não posso ajudar com isso)\b/gi)) aiIndicators.push({ type: 'expressão explícita que pode indicar texto de sistema de IA', excerpt: excerpt(clean, match.index, 150) });
  const referenceStatus = !sections.find((s) => s.label === 'Referências').found ? 'seção não localizada' : citations.length || references.length ? 'conferência de correspondência textual parcial' : 'seção localizada; nenhum item comparável foi extraído';
  const priorityFindings=[];
  const addFinding=(level,title,evidence,action,confidence='moderada')=>priorityFindings.push({level,title,evidence,action,confidence});
  for(const required of ['Introdução','Metodologia','Conclusão','Referências']){
    const item=sections.find((section)=>section.label===required);
    if(!item?.found)addFinding('Alta prioridade',`${required}: título não localizado no texto extraído`,null,'Confira se a seção existe com outro título e se o PDF contém texto pesquisável. Se estiver ausente, inclua ou justifique conforme o manual do curso.','limitada pela extração');
  }
  if(alignment.status==='inconclusivo')addFinding('Alta prioridade','Problema, objetivo e resposta final não puderam ser conferidos juntos',null,'Na leitura, destaque a pergunta/problema na introdução, o objetivo geral e a resposta explícita nas considerações finais.','limitada pela extração');
  else{
    if(alignment.problemObjectiveOverlap<20)addFinding('Alta prioridade','Problema e objetivo geral usam poucos termos em comum',`Problema: “${alignment.problem}” Objetivo: “${alignment.objective}”`,'Verifique se o objetivo geral responde diretamente à pergunta apresentada. O alerta compara vocabulário, não significado.','heurística lexical');
    if(alignment.objectiveConclusionOverlap<20)addFinding('Alta prioridade','Conclusão pode não retomar claramente o objetivo geral',`Objetivo: “${alignment.objective}” Conclusão: “${alignment.conclusion}”`,'Confira se a conclusão responde ao objetivo com resultados do próprio trabalho, apontando limites quando não houver resposta completa.','heurística lexical');
  }
  if(unmatchedCitations.length)addFinding('Revisar','Há citações autor/ano sem correspondência provável na lista final',unmatchedCitations.slice(0,3).map((item)=>item.citation).join('; '),'Confira grafia do autor e ano nas referências. A checagem automática pode não reconhecer citações numéricas, institucionais ou formatos diferentes.','heurística autor/ano');
  if(missingInText.length)addFinding('Revisar','Há referências que não aparecem nas citações reconhecidas',missingInText.slice(0,3).join('; '),'Confirme se cada item da lista foi citado no texto ou se deve ser removido, conforme o padrão adotado.','heurística autor/ano');
  if(aiIndicators.length)addFinding('Revisar','Foi encontrado trecho que merece conferência de autoria e contexto',aiIndicators[0].excerpt,'Confira o contexto, a origem do trecho e os registros do processo. Esta expressão isolada não prova uso de IA.','indício textual');
  const priorityOrder={'Alta prioridade':0,'Revisar':1};priorityFindings.sort((a,b)=>priorityOrder[a.level]-priorityOrder[b.level]);
  return {
    id: crypto.randomUUID(), analyzedAt: new Date().toISOString(), profile: { ...profile },
    document: { characters: clean.length, words: clean ? clean.split(/\s+/).length : 0 },
    structure: { sections, missing: sections.filter((s) => !s.found).map((s) => s.label), note: 'Verificação por títulos textuais; a estrutura exigida varia por curso e manual.' },
    researchQuestion: alignment,
    priorityFindings,
    references: { status: referenceStatus, citationCount: citations.length, referenceCount: references.length, unmatchedCitations, referencesNotFoundInCitations: missingInText, note: 'Correspondência heurística autor/ano; não confere conteúdo, pertinência, integridade nem formatação ABNT.' },
    plagiarism: { status: 'não verificado', reason: 'Nenhum corpus ou serviço de comparação externa foi configurado. Correspondência interna de citações não é detecção de plágio.' },
    aiAuthorship: { status: aiIndicators.length ? 'revisão humana necessária' : 'não verificado', indicators: aiIndicators, reason: 'Não há detector validado neste sistema. Indicadores textuais isolados não demonstram autoria por IA.' },
    formatting: measureFormatting(pdfDocument, profile),
    rigorNote: 'Este parecer auxilia a revisão e não substitui a avaliação acadêmica nem afirma plágio ou autoria por IA.'
  };
}

async function extractPdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  if (doc.numPages > 400) throw Object.assign(new Error('O arquivo excede o limite de 400 páginas.'), { status: 413 });
  const pages = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo); const content = await page.getTextContent(); const view=page.view;
    const items=content.items.filter(item=>item.str).map(item=>({text:item.str,x:item.transform[4]-view[0],y:item.transform[5]-view[1],width:item.width||0,fontPt:Math.hypot(item.transform[2],item.transform[3])||item.height||0}));
    const ops=await page.getOperatorList();const imageOps=new Set([pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintJpegXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject]);
    pages.push({text:content.items.map(item=>item.str||'').join(' '),widthPt:view[2]-view[0],heightPt:view[3]-view[1],items,imageCount:ops.fnArray.filter(fn=>imageOps.has(fn)).length});
  }
  await doc.destroy();
  const text = pages.map(p=>p.text).join('\n');
  if (text.trim().length < 100) throw Object.assign(new Error('O PDF não contém texto extraível. PDFs digitalizados precisam de OCR, que ainda não está configurado.'), { status: 422 });
  return {text,pages};
}
module.exports = { DEFAULT_PROFILE, analyzeDocument, extractPdfText };
