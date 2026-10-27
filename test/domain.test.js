const test = require('node:test');
const assert = require('node:assert/strict');
const { criteria, calculate } = require('../src/domain');

test('preserva os dez critérios oficiais em suas duas etapas', () => {
  assert.equal(criteria.length, 10);
  assert.equal(criteria.filter((item) => item.stage === 'documento').length, 7);
  assert.equal(criteria.filter((item) => item.stage === 'apresentacao').length, 3);
});
test('converte notas máximas e médias para os limites 70/30/100', () => {
  assert.deepEqual(calculate(Array(10).fill(10), 10), { document: 70, presentation: 30, total: 100 });
  assert.deepEqual(calculate(Array(10).fill(5), 10), { document: 35, presentation: 15, total: 50 });
  assert.deepEqual(calculate(Array(10).fill(0.8), 1), { document: 56, presentation: 24, total: 80 });
  assert.deepEqual(calculate(Array(10).fill(8), 10), { document: 56, presentation: 24, total: 80 });
  assert.deepEqual(calculate(Array(10).fill(0), 10), { document: 0, presentation: 0, total: 0 });
});
test('rejeita nota fora da escala e quantidade incompleta', () => {
  assert.throws(() => calculate(Array(10).fill(11), 10), /critério 1/);
  assert.throws(() => calculate([1], 1), /dez critérios/);
  assert.throws(() => calculate(Array(10).fill(1), 5), /escala/);
});
