// Descoberta de empresas sem processo: só ids da allowlist explícita, só com vínculo do token; linhas extras nunca entram.
const test = require('node:test');
const assert = require('node:assert/strict');
const { descobrirEmpresas } = require('./descoberta-contextos.cjs');

const U = '258eddfe-d761-4ec9-ae63-ee5e5b8db408';
const ORG_A = 'a1000000-0000-4000-8000-000000000001', ORG_B = 'b1000000-0000-4000-8000-000000000001';
const EMP_A = 'a1000000-0000-4000-8000-000000000005', EMP_B = 'b1000000-0000-4000-8000-000000000002', EMP_EXTRA = 'c1000000-0000-4000-8000-000000000009';

function transporteComLinhas({ empresas, membros }) {
  const chamadas = [];
  const t = async (url) => {
    chamadas.push(url);
    const u = new URL(url);
    if (u.pathname === '/rest/v1/operacao_empresas') return Response.json(empresas);
    if (u.pathname === '/rest/v1/operacao_membros') return Response.json(membros);
    throw Error('destino inesperado ' + u.pathname);
  };
  return { t, chamadas };
}

test('devolve só empresas da allowlist com vínculo gestor/operador; ignora linhas extras e empresa sem vínculo', async () => {
  const { t } = transporteComLinhas({
    empresas: [
      { id: EMP_A, organizacao_id: ORG_A, razao_social: 'A sem processo' },
      { id: EMP_B, organizacao_id: ORG_B, razao_social: 'B sem vínculo' },
      { id: EMP_EXTRA, organizacao_id: ORG_A, razao_social: 'Extra fora da allowlist' },
    ],
    membros: [{ usuario_id: U, organizacao_id: ORG_A, empresa_id: null, papel: 'operador' }],
  });
  const r = await descobrirEmpresas({ transporte: t, restUrl: 'https://luguscapasskcsficckf.supabase.co', publicKey: 'sb_publishable_qa', token: 'T', userId: U, allowlist: [EMP_A, EMP_B] });
  assert.deepEqual(r, [{ empresaId: EMP_A, razaoSocial: 'A sem processo' }]);
});

test('consulta só os ids da allowlist (filtro in.) e nunca lista empresas por organização', async () => {
  const { t, chamadas } = transporteComLinhas({ empresas: [], membros: [] });
  await descobrirEmpresas({ transporte: t, restUrl: 'https://luguscapasskcsficckf.supabase.co', publicKey: 'k', token: 'T', userId: U, allowlist: [EMP_A] });
  assert.equal(chamadas.length, 1, 'sem membros quando nenhuma empresa existe');
  assert.match(chamadas[0], new RegExp('id=in\\.\\(' + EMP_A + '\\)'));
});

test('allowlist vazia, inválida ou com id não-UUID é recusada antes de qualquer consulta', async () => {
  const { t, chamadas } = transporteComLinhas({ empresas: [], membros: [] });
  const base = { transporte: t, restUrl: 'https://luguscapasskcsficckf.supabase.co', publicKey: 'k', token: 'T', userId: U };
  assert.deepEqual(await descobrirEmpresas({ ...base, allowlist: [] }), []);
  await assert.rejects(descobrirEmpresas({ ...base, allowlist: ['nao-uuid'] }), /Allowlist QA inválida/);
  await assert.rejects(descobrirEmpresas({ ...base, allowlist: 'x' }), /Allowlist QA inválida/);
  assert.equal(chamadas.length, 0);
});
