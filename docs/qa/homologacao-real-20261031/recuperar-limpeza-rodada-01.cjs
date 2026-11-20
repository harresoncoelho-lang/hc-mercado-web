// Recuperação exclusiva da rodada interrompida. Inspeção padrão; limpeza exige liberação separada.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const pasta = path.join(__dirname, 'rodada-01');
const inicio = '2026-10-31T02:24:18.370Z', fim = '2026-10-31T02:26:18.370Z';
const usuarios = ['fd64a9bd-de90-44b4-b7b0-a7312814911a', 'd876466d-da4b-4ee4-a58e-5ef15c05c580', '07515d8b-45de-49fa-b010-228c0e920741', '1a26cff5-d68c-4aaa-a51b-b901332d7c30'];
const orgs = ['6f6d3875-ca25-4459-8513-01d005a470db', '3f68c61d-b074-44c7-99d4-2278f5c45a78'];
const ids = values => values.map(v => { assert(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v)); return "'" + v + "'"; }).join(',');
const sql = s => execFileSync('docker', ['exec', 'licitaplena-qa-real-db-1', 'psql', '-U', 'supabase_admin', '-d', 'licitaplena_qa_ui_v2', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
const json = s => JSON.parse(sql(s));
const baseline = JSON.parse(fs.readFileSync(path.join(pasta, 'baseline-dados.json')));
const preflight = fs.readFileSync(path.join(pasta, 'recuperacao-preflight.json'));
assert.equal(createHash('sha256').update(preflight).digest('hex'), '0e252e5da13a418ebadb9644a5b46f2b076a35d5df58148e88b8a749e40c0469', 'Inventario revisado imutavel');
const revisado = JSON.parse(preflight);
function validarSubconjunto(atuais, originais) {
  for (const atual of atuais) {
    const original = originais.find(v => v.id === atual.id);
    assert(original, 'ID fora do inventario revisado');
    for (const key of Object.keys(atual)) assert.deepEqual(atual[key], original[key], 'Propriedade divergente: ' + key);
  }
}
async function limparEmOrdem(dados, remover) {
  for (const objeto of dados.objetos) await remover.objeto(objeto);
  // Falha de Storage interrompe antes de apagar qualquer vínculo ou usuário.
  if (dados.pecas.length || dados.organizacoes.length) await remover.sql();
  for (const usuario of dados.usuarios) await remover.usuario(usuario.id);
}
function snapshot(excluir, objetos = []) {
  return baseline.map(({ tabela }) => {
    assert(/^[a-z_]+\.[a-z_0-9]+$/.test(tabela));
    let where = '';
    if (excluir) {
      if (['auth.users', 'public.clientes'].includes(tabela)) where = `where t.id not in (${ids(usuarios)})`;
      else if (tabela === 'public.operacao_organizacoes') where = `where t.id not in (${ids(orgs)})`;
      else if (tabela === 'storage.objects') where = `where t.id not in (${ids(objetos.map(o => o.id))})`;
      else if (sql(`select count(*) from pg_attribute where attrelid='${tabela}'::regclass and attname='organizacao_id' and not attisdropped`) === '1') where = `where t.organizacao_id is null or t.organizacao_id not in (${ids(orgs)})`;
    }
    return { tabela, ...json(`select json_build_object('linhas',count(*),'hash',md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),''))) from ${tabela} t ${where}`) };
  });
}
function inspecionar() {
  assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'execucao-iniciada.json'))).data, inicio);
  assert.equal(sql('select current_database()'), 'licitaplena_qa_ui_v2');
  const users = json(`select coalesce(json_agg(json_build_object('id',id,'criadoEm',created_at,'fixture',email like 'qa-kit-%@example.invalid' and created_at>='${inicio}' and created_at<'${fim}') order by id),'[]') from auth.users where id in (${ids(usuarios)})`);
  validarSubconjunto(users, revisado.usuarios);
  const organizacoes = json(`select coalesce(json_agg(json_build_object('id',id,'ownerId',owner_id,'criadoEm',criado_em,'fixture',nome in ('QA kit real A','QA kit real B') and criado_em>='${inicio}' and criado_em<'${fim}') order by id),'[]') from public.operacao_organizacoes where id in (${ids(orgs)})`);
  validarSubconjunto(organizacoes, revisado.organizacoes);
  const empresas = json(`select coalesce(json_agg(id order by id),'[]') from public.operacao_empresas where organizacao_id in (${ids(orgs)})`);
  assert(empresas.every(id => revisado.empresas.includes(id)), 'Empresa fora do inventario');
  const pecas = json(`select coalesce(json_agg(json_build_object('id',id,'organizacaoId',organizacao_id,'criadoPor',criado_por,'criadoEm',criado_em) order by id),'[]') from public.operacao_kit_documentos where organizacao_id in (${ids(orgs)}) or id in (${ids(revisado.pecas.map(d => d.id))})`);
  validarSubconjunto(pecas, revisado.pecas);
  const objetoRevisado = revisado.objetos[0];
  assert(/^[a-zA-Z0-9_./-]+$/.test(objetoRevisado.caminho));
  // O ID, bucket e caminho revisados continuam localizáveis mesmo sem o documento.
  const objetos = json(`select coalesce(json_agg(json_build_object('id',id,'bucket',bucket_id,'caminho',name,'criadoEm',created_at) order by id),'[]') from storage.objects where id in (${ids(revisado.objetos.map(o => o.id))}) or (bucket_id='operacao-documentos' and name='${objetoRevisado.caminho}')`);
  validarSubconjunto(objetos, revisado.objetos);
  const documentos = json(`select coalesce(json_agg(json_build_object('id',id,'empresaId',empresa_id,'organizacaoId',organizacao_id,'caminho',arquivo_caminho)),'[]') from public.operacao_documentos where id='${objetoRevisado.documentoId}'`);
  validarSubconjunto(documentos, [{ id: objetoRevisado.documentoId, empresaId: objetoRevisado.empresaId, organizacaoId: objetoRevisado.organizacaoId, caminho: objetoRevisado.caminho }]);
  const atual = snapshot(false), preservado = snapshot(true, revisado.objetos);
  assert.deepEqual(preservado, baseline, 'Todos os registros restantes devem coincidir com a baseline antes de qualquer DELETE');
  return { inicio, fim, usuarios: users, organizacoes, empresas, pecas, objetos, atual, baselineSemFixturesIgual: true };
}
async function main() {
  const dados = inspecionar();
  const tentativa = new Date().toISOString().replace(/[:.]/g, '-');
  if (!process.argv.includes('--limpar')) {
    fs.writeFileSync(path.join(pasta, `recuperacao-inspecao-${tentativa}.json`), JSON.stringify(dados, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ leituraSomente: true, usuarios: dados.usuarios.length, organizacoes: dados.organizacoes.length, pecas: dados.pecas.length, objetos: dados.objetos.length, baselineSemFixturesIgual: true }));
    return;
  }
  assert.equal(process.env.QA_RECUPERAR_RODADA_01, '1', 'Limpeza exige revisão e liberação explícita do coordenador');
  const c = JSON.parse(fs.readFileSync('C:/Users/harre/AppData/Local/LicitaPlena/supabase-homologacao/credenciais-locais.json'));
  const erros = [], etapas = [];
  const req = async (rota, body) => {
    const r = await fetch('http://127.0.0.1:8792' + rota, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { apikey: c.service, Authorization: 'Bearer ' + c.service, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(r.status, 200, 'DELETE local ' + rota.split('/').slice(0, 4).join('/'));
  };
  try {
    await limparEmOrdem(dados, {
      objeto: async objeto => { await req('/storage/v1/object/operacao-documentos', { prefixes: [objeto.caminho] }); assert.equal(sql(`select count(*) from storage.objects where id='${objeto.id}' or (bucket_id='operacao-documentos' and name='${objeto.caminho}')`), '0', 'Storage deve estar ausente antes da cascata'); etapas.push('Objeto ' + objeto.id); },
      sql: async () => { sql(`begin; delete from public.operacao_kit_documentos where id in (${ids(revisado.pecas.map(d => d.id))}) and organizacao_id in (${ids(orgs)}); delete from public.operacao_organizacoes where id in (${ids(orgs)}) and owner_id in (${ids(usuarios)}) and nome in ('QA kit real A','QA kit real B') and criado_em>='${inicio}' and criado_em<'${fim}'; commit;`); etapas.push('Pecas e organizacoes comprovadas'); },
      usuario: async usuario => { await req('/auth/v1/admin/users/' + usuario); etapas.push('Usuario ' + usuario); }
    });
  } catch (e) { erros.push({ etapa: 'Limpeza interrompida; dependencias preservadas para retomar', erro: String(e.message).replaceAll(c.service, '[privado]') }); }
  let final, preservada = false;
  try { final = snapshot(false); assert.deepEqual(final, baseline); preservada = true; } catch { erros.push({ etapa: 'Conferir baseline completa', erro: 'Ainda ha diferencas; retomada usa somente o inventario revisado' }); }
  const report = { aprovado: !erros.length && preservada, etapas, erros, baselinePreservada: preservada, final };
  fs.writeFileSync(path.join(pasta, `recuperacao-limpeza-${tentativa}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ aprovado: report.aprovado, etapas: etapas.length, erros: erros.length, baselinePreservada: preservada }));
  if (!report.aprovado) process.exitCode = 1;
}
async function selfTest() {
  const dados = { objetos: [{ id: 'objeto' }], pecas: [{ id: 'peca' }], organizacoes: [{ id: 'org' }], usuarios: [{ id: 'a' }, { id: 'b' }] };
  let passos = [];
  await assert.rejects(() => limparEmOrdem(dados, { objeto: async () => { passos.push('storage'); throw new Error('Storage falhou'); }, sql: async () => passos.push('sql'), usuario: async () => passos.push('auth') }), /Storage falhou/);
  assert.deepEqual(passos, ['storage']);
  passos = [];
  await assert.rejects(() => limparEmOrdem({ ...dados, objetos: [] }, { sql: async () => { passos.push('sql'); throw new Error('SQL falhou'); }, usuario: async () => passos.push('auth') }), /SQL falhou/);
  assert.deepEqual(passos, ['sql']);
  passos = [];
  await assert.rejects(() => limparEmOrdem({ ...dados, objetos: [] }, { sql: async () => passos.push('sql'), usuario: async id => { passos.push(id); if (id === 'b') throw new Error('Auth parcial'); } }), /Auth parcial/);
  assert.deepEqual(passos, ['sql', 'a', 'b']);
  const restantes = [{ id: 'b' }]; validarSubconjunto(restantes, dados.usuarios); validarSubconjunto([], dados.objetos);
  passos = []; await limparEmOrdem({ objetos: [], pecas: [], organizacoes: [], usuarios: restantes }, { usuario: async id => passos.push(id) });
  assert.deepEqual(passos, ['b']); assert.throws(() => validarSubconjunto([{ id: 'fora' }], dados.usuarios));
  console.log('Offline: Storage falho preserva dependencias; SQL falho impede Auth; Auth parcial retoma so sobreviventes; IDs externos rejeitados. Nenhum DB/HTTP.');
}
(process.argv.includes('--self-test') ? selfTest() : main()).catch(e => { console.error(String(e.message)); process.exitCode = 1; });
