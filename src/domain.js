const criteria = [
  ['Apresentação do Tema', 'Redação com linguagem apropriada, correta e clara.', 'documento'],
  ['Formatação', 'Obediência às normas aplicáveis.', 'documento'],
  ['Relevância do tema', 'Importância do tema na área envolvida e do enfoque dado, considerando se o trabalho foi realizado dentro da área de atuação.', 'documento'],
  ['Fundamentação', 'Contextualização do tema e do problema; embasamento teórico; clareza do método escolhido; identificação clara das fontes de pesquisa a serem utilizadas.', 'documento'],
  ['Procedimentos metodológicos', 'Adequação e correta utilização da metodologia escolhida para a pesquisa.', 'documento'],
  ['Cronograma e orçamento da pesquisa', 'Cronograma e orçamento coerentes com a pesquisa proposta.', 'documento'],
  ['Referências consultadas', 'Revisão bibliográfica e documental adequada e atualizada.', 'documento'],
  ['Clareza na comunicação e domínio do tema', 'Desenvoltura, emprego de linguagem adequada e capacidade de síntese. Domínio do assunto, justificativa da escolha do tema, relevância e foco do tema proposto.', 'apresentacao'],
  ['Objetividade e adequação do conteúdo ao tempo previsto para a apresentação', 'Sequência lógica, segurança e domínio do assunto. O modelo prevê apresentação oral de 20 minutos, permitindo que essa referência seja ajustada por usuário autorizado.', 'apresentacao'],
  ['Respostas às arguições da Banca Examinadora', 'Compreensão, segurança, conhecimento e capacidade de responder às questões levantadas pela banca examinadora.', 'apresentacao']
].map(([title, description, stage], i) => ({ number: i + 1, title, description, stage, weight: 1 }));

function calculate(scores, scale = 10) {
  if (![1, 10].includes(scale)) throw new Error('A escala deve ser 0–1 ou 0–10.');
  if (!Array.isArray(scores) || scores.length !== 10) throw new Error('Informe uma nota para cada um dos dez critérios.');
  const max = scale;
  for (const [i, score] of scores.entries()) if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > max) throw new Error(`A nota do critério ${i + 1} deve estar entre 0 e ${max}.`);
  const stage = (start, end, cap) => {
    const subset = criteria.slice(start, end); const weightTotal = subset.reduce((sum, item) => sum + item.weight, 0);
    if (weightTotal <= 0) throw new Error('A soma dos pesos deve ser maior que zero.');
    return cap * subset.reduce((sum, item, i) => sum + (scores[start + i] / max) * item.weight, 0) / weightTotal;
  };
  const document = stage(0, 7, 70); const presentation = stage(7, 10, 30);
  const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
  return { document: round(document), presentation: round(presentation), total: round(document + presentation) };
}

module.exports = { criteria, calculate };
