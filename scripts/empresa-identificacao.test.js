const test = require('node:test');
const assert = require('node:assert/strict');
const identidade = require('../defesa-licitante');
const empresa = { id: 'empresaA', razao_social: 'Empresa Autorizada', cnpj: '12345678000190' };
const perfil = { status: 'confirmado', versao: 1, confirmadoEm: '2026-10-23T18:00:00Z', dados: { endereco: 'Rua Exemplo, 10', representante: 'Representante Exemplo', cargo: 'Administrador' } };
test('identificação confirmada é aplicada localmente e órgão não vira empresa ou autoridade inventada', () => {
  const texto = 'Destinatário e identificação da interessada: [preencher e conferir]\nPrazo e canal: [confirmar]\nCorpo revisado pelo usuário.';
  const r = identidade.preencherIdentificacao(texto, { empresa, perfil, orgao: 'Município Exemplo' });
  assert.match(r, /Destinatário: Município Exemplo/);
  assert.match(r, /Interessada: Empresa Autorizada/); assert.match(r, /CNPJ: 12345678000190/);
  assert.match(r, /Endereço da interessada: Rua Exemplo, 10/); assert.match(r, /Representante: Representante Exemplo/); assert.match(r, /Cargo do representante: Administrador/);
  assert.match(r, /autoridade competente/); assert.match(r, /Prazo e canal: \[confirmar\]/);
  assert.ok(r.endsWith('Corpo revisado pelo usuário.')); assert.doesNotMatch(r, /CPF|prefeito|procurador/i);
});
test('aplicar novo perfil troca somente bloco de identificação e conserva edição do corpo', () => {
  const r = identidade.preencherIdentificacao('Destinatário e identificação da interessada: [preencher e conferir]\nArgumento escrito manualmente.', { empresa, perfil, orgao: 'Órgão' });
  const atualizado = identidade.preencherIdentificacao(r, { empresa, perfil: { ...perfil, dados: { ...perfil.dados, endereco: 'Nova Rua, 20' } }, orgao: 'Órgão' });
  assert.match(atualizado, /Nova Rua, 20/); assert.doesNotMatch(atualizado, /Rua Exemplo, 10/);
  assert.equal((atualizado.match(/Interessada:/g) || []).length, 1); assert.ok(atualizado.endsWith('Argumento escrito manualmente.'));
});
test('perfil inválido e dados ausentes não viram identificação confirmada', () => {
  const r = identidade.preencherIdentificacao('Destinatário e identificação da interessada: [preencher e conferir]', { empresa, perfil: { ...perfil, status: 'invalidado' } });
  assert.doesNotMatch(r, /Rua Exemplo|Representante Exemplo|Administrador/);
  assert.match(r, /\[preencher e conferir\]/);
  assert.notEqual(identidade.assinaturaIdentificacao({ empresa, perfil }), identidade.assinaturaIdentificacao({ empresa, perfil: { ...perfil, status: 'invalidado' } }));
  assert.notEqual(identidade.assinaturaIdentificacao({ empresa, perfil }), identidade.assinaturaIdentificacao({ empresa: { ...empresa, id: 'empresaB' }, perfil }));
});
