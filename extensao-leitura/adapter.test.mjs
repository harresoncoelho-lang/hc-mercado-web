import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContext, allowedUrl } from './adapter.mjs';

const url = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026';
// CNPJ de exemplo sintético; não representa cliente ou credencial.
const expected = Object.freeze({ cnpj: '12.345.678/0001-95', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' });
const fixture = () => ({ url, headings: ['Pregão Eletrônico N° 41/2026 (SRP) (Lei 14.133/2021)', 'UASG 788820 - ÓRGÃO FICTÍCIO'], supplierLabels: ['CNPJ do fornecedor: 12.345.678/0001-95'], notices: [], collectionComplete: true });

test('contexto exige identidade observada e compra, sem autorizar escrita', () => {
  const result = validateContext(fixture(), expected);
  assert.equal(result.status, 'confirmado');
  assert.equal(result.writeAuthorized, false);
  assert.deepEqual(result.observed, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: expected.purchaseId });
});
test('CNPJ esperado nunca preenche identidade ausente', () => {
  const snapshot = fixture(); snapshot.supplierLabels = [];
  assert.equal(validateContext(snapshot, expected).status, 'identidade_nao_confirmada');
  assert.equal(validateContext(snapshot, expected).observed.cnpj, null);
});
test('não aceita CNPJ de órgão, CPF ou rótulo genérico', () => {
  for (const label of ['CNPJ: 12.345.678/0001-95', 'CNPJ do órgão: 12.345.678/0001-95', 'CPF do fornecedor: 123.456.789-00']) {
    const snapshot = fixture(); snapshot.supplierLabels = [label];
    assert.equal(validateContext(snapshot, expected).status, 'identidade_nao_confirmada');
  }
});
test('identidades múltiplas bloqueiam mesmo incluindo a esperada', () => {
  const snapshot = fixture(); snapshot.supplierLabels.push('CNPJ do fornecedor: 11.222.333/0001-81');
  assert.equal(validateContext(snapshot, expected).status, 'contexto_ambiguo');
});

test('repetição idêntica não cria identidade extra; repetição inválida ou UASG conflitante bloqueia', () => {
  const same = fixture(); same.supplierLabels.push(...same.supplierLabels); same.headings.push(...same.headings);
  assert.equal(validateContext(same, expected).status, 'confirmado');
  for (const value of ['00.000.000/0000-00', '12.345.678/0001-00', 'inválido']) {
    const mixed = fixture(); mixed.supplierLabels.push(`CNPJ do fornecedor: ${value}`);
    assert.equal(validateContext(mixed, expected).status, 'contexto_ambiguo');
  }
  const mixedUasg = fixture(); mixedUasg.headings.push('UASG 123456');
  assert.equal(validateContext(mixedUasg, expected).status, 'contexto_ambiguo');
  assert.equal(validateContext({ ...fixture(), headings: ['Pregão Eletrônico N° 41/2027', 'UASG 788820'] }, expected).status, 'contexto_divergente');
});
test('CNPJ divergente ou inválido nunca confirma', () => {
  const snapshot = fixture(); snapshot.supplierLabels = ['CNPJ do fornecedor: 11.222.333/0001-81'];
  assert.equal(validateContext(snapshot, expected).status, 'contexto_divergente');
  snapshot.supplierLabels = ['CNPJ do fornecedor: 00.000.000/0000-00'];
  assert.equal(validateContext(snapshot, expected).status, 'identidade_nao_confirmada');
});
test('heading incompleto, divergente ou múltiplo bloqueia', () => {
  for (const headings of [[], ['Pregão Eletrônico N° 42/2026', 'UASG 788820'], [...fixture().headings, 'Pregão Eletrônico N° 43/2026']]) {
    assert.notEqual(validateContext({ ...fixture(), headings }, expected).status, 'confirmado');
  }
});
test('identificador URL não substitui heading nem aceita troca de compra', () => {
  assert.equal(validateContext({ ...fixture(), url: url.replace('0041', '0042') }, expected).status, 'contexto_divergente');
  assert.equal(validateContext({ ...fixture(), headings: [] }, expected).status, 'compra_nao_confirmada');
});
test('origem, protocolo, porta, caminho e query ambígua são recusados', () => {
  for (const bad of [url.replace('https:', 'http:'), url.replace('.gov.br', '.gov.br.evil.test'), url.replace('.br/', '.br:444/'), url.replace('cadastro-propostas', 'compras'), `${url}&compra=outra`, url.replace('https://', 'https://user:pass@'), 'javascript:alert(1)']) {
    assert.equal(allowedUrl(bad), false, bad);
    assert.equal(validateContext({ ...fixture(), url: bad }, expected).status, 'pagina_nao_suportada');
  }
});
test('sessão expirada, acesso negado ou CAPTCHA bloqueiam', () => {
  for (const notice of ['Sua sessão pode ter expirado', 'Acesso não autorizado', 'Não foi possível realizar a validação do Captcha']) {
    assert.equal(validateContext({ ...fixture(), notices: [notice] }, expected).status, 'sessao_ou_verificacao_pendente');
  }
});
test('entrada esperada incompleta ou inválida não confirma', () => {
  for (const bad of [null, {}, { ...expected, cnpj: '00000000000000' }, { ...expected, purchaseId: '' }, { ...expected, number: '41x' }]) {
    assert.equal(validateContext(fixture(), bad).status, 'esperado_invalido');
  }
});
test('snapshot truncado, sem prova de coleta ou malformado falha fechado', () => {
  for (const bad of [null, {}, { ...fixture(), collectionComplete: false }, { ...fixture(), headings: 'texto' }, { ...fixture(), supplierLabels: Array(21).fill('CNPJ do fornecedor: 12.345.678/0001-95') }]) {
    assert.notEqual(validateContext(bad, expected).status, 'confirmado');
  }
});
test('resultado não vaza texto arbitrário ou muta entradas', () => {
  const snapshot = fixture(); snapshot.notices.push('segredo privado que não deve sair');
  const before = JSON.stringify(snapshot);
  assert.equal(JSON.stringify(validateContext(snapshot, expected)).includes('segredo'), false);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(validateContext(snapshot, { ...expected, cnpj: '11.222.333/0001-81' }).status, 'contexto_divergente');
});

test('adaptador recusa quantidade textual acima do limite mesmo em snapshot adulterado', () => {
  const snapshot = fixture();
  snapshot.paginaObservada = { completa: true, itens: [{ id: '1', descricao: 'Item', quantidadeSolicitada: '9'.repeat(65), unidade: 'Unidade', grupo: null, exigencias: null }] };
  assert.equal(validateContext(snapshot, expected).paginaObservada, undefined);
});
