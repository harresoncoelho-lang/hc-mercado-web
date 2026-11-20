// Apenas serviços reais locais e fixtures próprias; nenhuma chamada externa ou envio.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const mammoth = require('mammoth');
let c;
const httpPort = Number(process.env.QA_HTTP_PORT || 8792);
assert(Number.isInteger(httpPort) && httpPort >= 1024 && httpPort <= 65535, 'Porta QA inválida');
const base = `http://127.0.0.1:${httpPort}`;
const users = [], orgs = [], objects = [], results = [], secrets = [], documentos = [];
let evidencias, ui, baseline;
const registrarFixture = (tipo, id) => { assert(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)); fs.appendFileSync(path.join(evidencias, 'fixtures.jsonl'), JSON.stringify({ tipo, id, data: new Date().toISOString() }) + '\n'); };
const sanear = e => secrets.reduce((s, valor) => s.replaceAll(valor, '[privado]'), String(e?.message || e)).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]');
const sql = s => execFileSync('docker', ['exec', 'licitaplena-qa-real-db-1', 'psql', '-U', 'supabase_admin', '-d', 'licitaplena_qa_ui_v2', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', s], { encoding: 'utf8' }).trim();
function escopoLimpeza(org) {
  const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
  assert(orgs.includes(org) && uuid(org) && users.length > 0 && users.every(uuid), 'Limpeza restrita aos IDs desta execução');
  return `o.id='${org}' and o.nome like 'QA kit real %' and o.owner_id in (${users.map(id => "'" + id + "'").join(',')})`;
}
async function req(route, token = c.service, method = 'GET', body, extra = {}) {
  assert(route.startsWith('/') && !route.startsWith('//'));
  const r = await fetch(base + route, { method, redirect: 'error', headers: { apikey: token === c.service ? c.service : c.anon, Authorization: 'Bearer ' + token, ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const bytes = Buffer.from(await r.arrayBuffer());
  let data; try { data = JSON.parse(bytes); } catch { data = bytes; }
  return { status: r.status, data };
}
const expect = (r, status, label) => { assert.equal(r.status, status, label); return r.data; };
const api = (u, empresaId, processoId, acao, body = {}) => req('/api/kit-documentos', u.token, 'POST', { empresaId, processoId, acao, ...body });
const identity = (u, empresaId, acao, body = {}) => req('/api/empresa-identificacao', u.token, 'POST', { empresaId, acao, ...body });
async function makeUser() {
  const email = `qa-kit-${randomUUID()}@example.invalid`, password = `Qa!${randomUUID()}`;
  secrets.push(email, password);
  const user = expect(await req('/auth/v1/admin/users', c.service, 'POST', { email, password, email_confirm: true }), 200, 'Auth criar');
  users.push(user.id);
  registrarFixture('usuario', user.id);
  const userFixture = { id: user.id, email, password };
  await loginUser(userFixture);
  sql(`update public.clientes set status='aprovado' where id='${user.id}'`);
  return userFixture;
}
async function loginUser(user) {
  const login = expect(await req('/auth/v1/token?grant_type=password', c.anon, 'POST', { email: user.email, password: user.password }), 200, 'Auth entrar');
  secrets.push(login.access_token, login.refresh_token);
  const claims = JSON.parse(Buffer.from(login.access_token.split('.')[1], 'base64url'));
  assert.equal(claims.sub, user.id, 'JWT pertence à fixture');
  assert(claims.exp * 1000 > Date.now() + 60000 && claims.iat * 1000 > Date.now() - 60000, 'JWT recém-emitido e válido');
  user.token = login.access_token;
  assert.equal(expect(await req('/auth/v1/user', user.token), 200, 'Auth valida sessão').id, user.id);
}
function snapshot() {
  const tables = JSON.parse(sql("select json_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname='public' or n.nspname='auth' and c.relname='users' or n.nspname='storage' and c.relname in ('objects','buckets'))"));
  return tables.map(table => {
    assert(/^[a-z_]+\.[a-z_0-9]+$/.test(table), 'Tabela de baseline inválida');
    return { tabela: table, ...JSON.parse(sql(`select json_build_object('linhas',count(*),'hash',md5(coalesce(string_agg(md5(row_to_json(t)::text),'' order by md5(row_to_json(t)::text)),''))) from ${table} t`)) };
  });
}
async function exported(r, company, filename, cnpj, outroCnpj) {
  const d = expect(r, 200, 'Exportar');
  assert.equal(d.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const buffer = Buffer.from(d.arquivoBase64, 'base64');
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const text = (await mammoth.extractRawText({ buffer })).value;
  assert(text.includes(company));
  assert(new RegExp(`(?:^|\\D)${cnpj}(?:\\D|$)`).test(text), 'CNPJ exato no DOCX');
  assert(!text.includes(outroCnpj), 'DOCX nao contem CNPJ da outra empresa');
  fs.writeFileSync(path.join(evidencias, filename), buffer, { flag: 'wx' });
  return text;
}
async function persistente({ owner, other, operator, reader, ea, eb, pa, pb, ia, ib }) {
  const da = randomUUID(), db = randomUUID(), dp = randomUUID();
  documentos.push(da, db, dp);
  const declaracao = { tipo: 'declaracao', declaracao: { titulo: 'Peça persistente fictícia', texto: '{{razao_social}}, CNPJ {{cnpj}}, representada por {{representante}}, declara para {{numero_edital}} de {{orgao}}. FIM INTEGRAL QA.', fonte: 'Modelo fictício; não protocolar.' } };
  const salvar = (user, empresa, processo, id, versao, dados) => api(user, empresa, processo, 'salvar', { documentoId: id, versaoEsperada: versao, ...dados });
  const ref = (id, versao) => ({ documentoId: id, versaoEsperada: versao });
  const a = expect(await salvar(operator, ea, pa, da, 0, declaracao), 200, 'Salvar A').documento;
  registrarFixture('peca', da);
  assert.equal(a.versao, 1); assert.equal(a.criadoPor, operator.id); assert.equal(a.empresaId, ea);
  assert.equal(expect(await salvar(operator, ea, pa, da, 0, declaracao), 200, 'Criacao idempotente').documento.id, da);
  expect(await salvar(owner, ea, pa, da, 0, declaracao), 409, 'Outra autoria nao recupera criacao');
  expect(await salvar(operator, ea, pa, da, 0, { ...declaracao, declaracao: { ...declaracao.declaracao, titulo: 'Intencao divergente' } }), 409, 'Intencao divergente');
  expect(await salvar(owner, eb, pb, db, 0, declaracao), 200, 'Salvar B');
  registrarFixture('peca', db);
  assert.deepEqual(expect(await api(operator, ea, pa, 'listar'), 200, 'Listar A').documentos.map(d => d.id), [da]);
  assert.deepEqual(expect(await api(owner, eb, pb, 'listar'), 200, 'Listar B').documentos.map(d => d.id), [db]);
  expect(await api(owner, eb, pb, 'abrir', { documentoId: da }), 404, 'ID cruzado');
  for (const [user, status] of [[other, 404], [reader, 403], [{ token: c.anon }, 401]]) {
    for (const acao of ['listar', 'abrir', 'salvar', 'confirmarRevisao', 'exportar']) expect(await api(user, ea, pa, acao, { ...ref(da, 1), ...declaracao }), status, 'Escopo persistente ' + acao);
  }
  expect(await api(operator, eb, pb, 'listar'), 404, 'Operador restrito em B');
  const select = `/rest/v1/operacao_kit_documentos?empresa_id=in.(${ea},${eb})&select=id&order=id`;
  for (const [user, ids] of [[owner, [da, db]], [operator, [da]], [reader, [da]], [other, []]]) assert.deepEqual(expect(await req(select, user.token), 200, 'RLS leitura kit').map(d => d.id).sort(), ids.sort());
  assert([401, 403].includes((await req(select, c.anon)).status), 'Anon sem SELECT');
  sql(`update public.clientes set status='pendente' where id='${operator.id}'`);
  expect(await api(operator, ea, pa, 'salvar', { ...ref(da, 1), ...declaracao }), 403, 'Pendente nao salva');
  assert.deepEqual(expect(await req(select, operator.token), 200, 'RLS pendente'), []);
  sql(`update public.clientes set status='aprovado' where id='${operator.id}'`);
  for (const token of [operator.token, reader.token, c.service]) {
    for (const method of ['POST', 'PATCH', 'DELETE']) assert([401, 403].includes((await req('/rest/v1/operacao_kit_documentos?id=eq.' + da, token, method, method === 'DELETE' ? undefined : { id: da, versao: 99 })).status), 'DML direto kit negado por permissao');
  }
  const rpc = { p_documento: da, p_empresa: ea, p_processo: pa, p_organizacao: a.organizacaoId, p_usuario: operator.id, p_versao: 1, p_tipo: 'declaracao', p_acao: 'salvar', p_dados: { declaracao: declaracao.declaracao } };
  for (const token of [operator.token, reader.token, c.anon]) assert([401, 403].includes((await req('/rest/v1/rpc/gravar_kit_documento', token, 'POST', rpc)).status), 'RPC privada kit');
  await loginUser(operator);
  assert.deepEqual(expect(await api(operator, ea, pa, 'abrir', { documentoId: da }), 200, 'Reabrir com novo login Auth').documento.dados, a.dados);
  const preview = expect(await api(operator, ea, pa, 'preparar', ref(da, 1)), 200, 'Preparar salva');
  const review = { ...ref(da, 1), revisado: true, revisaoHash: preview.revisaoHash };
  expect(await api(operator, ea, pa, 'exportar', review), 409, 'Sem revisao persistida');
  expect(await api(operator, ea, pa, 'confirmarRevisao', { ...ref(da, 1), revisaoHash: preview.revisaoHash }), 422, 'Confirmacao explicita');
  expect(await api(operator, ea, pa, 'confirmarRevisao', { ...review, revisaoHash: '0'.repeat(64) }), 409, 'Hash falso persistente');
  const reviewed = expect(await api(operator, ea, pa, 'confirmarRevisao', review), 200, 'Confirmar salva').documento;
  assert.equal(reviewed.revisao.hash, preview.revisaoHash); assert.equal(reviewed.revisao.versao, 1); assert.equal(reviewed.revisadoPor, operator.id);
  const alfa = await exported(await api(operator, ea, pa, 'exportar', review), 'Alfa Ficticia Homologacao', 'persistida-declaracao-alfa.docx', '11222333000181', '11222333000262');
  assert(alfa.includes('FIM INTEGRAL QA.') && !alfa.includes('Beta Ficticia'));
  expect(await api(owner, ea, pa, 'exportar', review), 409, 'Outro usuario nao herda revisao');
  const bPreview = expect(await api(owner, eb, pb, 'preparar', ref(db, 1)), 200, 'Preparar salva B');
  const bReview = { ...ref(db, 1), revisado: true, revisaoHash: bPreview.revisaoHash };
  expect(await api(owner, eb, pb, 'confirmarRevisao', bReview), 200, 'Confirmar B');
  const beta = await exported(await api(owner, eb, pb, 'exportar', bReview), 'Beta Ficticia Homologacao', 'persistida-declaracao-beta.docx', '11222333000262', '11222333000181');
  assert(!beta.includes('Alfa Ficticia'));
  const editada = { ...declaracao, declaracao: { ...declaracao.declaracao, titulo: 'Versao dois' } };
  const v2 = expect(await salvar(operator, ea, pa, da, 1, editada), 200, 'Versao dois').documento;
  assert.equal(v2.versao, 2); assert.equal(v2.revisao, null); assert.equal(v2.revisadoPor, null);
  expect(await api(operator, ea, pa, 'exportar', review), 409, 'Versao anterior nao exporta');
  const race = await Promise.all(['Aba A', 'Aba B'].map(titulo => salvar(operator, ea, pa, da, 2, { ...declaracao, declaracao: { ...declaracao.declaracao, titulo } })));
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
  const winner = race.find(r => r.status === 200).data.documento;
  const reopened = expect(await api(operator, ea, pa, 'abrir', { documentoId: da }), 200, 'Reabrir vencedor').documento;
  assert.equal(reopened.versao, 3); assert.deepEqual(reopened.dados, winner.dados);
  const proposta = { tipo: 'proposta', proposta: { itemIds: [ia, ib], unidades: { [ia]: 'un', [ib]: 'un' }, validade: '60 dias', prazoEntrega: '10 dias', pagamento: '30 dias' } };
  expect(await salvar(operator, ea, pa, dp, 0, proposta), 200, 'Salvar proposta');
  registrarFixture('peca', dp);
  const p = expect(await api(operator, ea, pa, 'preparar', ref(dp, 1)), 200, 'Preparar proposta salva');
  assert(p.previa.texto.includes('Total da proposta: R$ 3,71'));
  const pr = { ...ref(dp, 1), revisado: true, revisaoHash: p.revisaoHash };
  expect(await api(operator, ea, pa, 'confirmarRevisao', pr), 200, 'Confirmar proposta');
  const texto = await exported(await api(operator, ea, pa, 'exportar', pr), 'Alfa Ficticia Homologacao', 'persistida-proposta-alfa.docx', '11222333000181', '11222333000262');
  assert(texto.includes('Total da proposta: R$ 3,71') && !texto.includes('Beta Ficticia'));
  for (const descricao of ['Item decimal QA', 'Item inteiro QA']) assert(texto.includes(descricao), 'Item selecionado no DOCX');
  assert(!texto.includes('Item valido excluido QA'), 'Item valido nao selecionado ausente do DOCX');
  expect(await req('/rest/v1/operacao_itens_resultado?id=eq.' + ib, operator.token, 'PATCH', { valor_unitario_proposta: '2.34' }), 204, 'Preco proposta salva');
  expect(await api(operator, ea, pa, 'exportar', pr), 409, 'Preco invalida proposta salva');
  assert.equal(expect(await api(operator, ea, pa, 'abrir', { documentoId: dp }), 200, 'Revisao antiga').revisaoVigente, false);
  assert(expect(await api(operator, ea, pa, 'preparar', ref(dp, 1)), 200, 'Nova previa salva').previa.texto.includes('Total da proposta: R$ 7,04'));
  expect(await req('/rest/v1/operacao_itens_resultado?id=eq.' + ib, operator.token, 'PATCH', { valor_unitario_proposta: '1.23' }), 204, 'Restaurar preco fixture legado');
  results.push('Kit persistente: salvar/listar/reabrir com novo Auth, idempotencia, versoes, CAS concorrente 200/409, revisao por usuario, RLS/RPC/DML e DOCX A/B/proposta');
  return { da, dp };
}
async function main() {
  assert.equal(process.env.QA_EXECUTAR_REAL, '1', 'Execução real exige QA_EXECUTAR_REAL=1 após liberação do coordenador');
  c = JSON.parse(fs.readFileSync('C:/Users/harre/AppData/Local/LicitaPlena/supabase-homologacao/credenciais-locais.json'));
  secrets.push(c.service, c.anon);
  const execucao = process.env.QA_EXECUCAO || new Date().toISOString().replace(/[:.]/g, '-');
  assert(/^[a-zA-Z0-9_-]+$/.test(execucao), 'Identificador QA inválido');
  evidencias = path.join(__dirname, 'homologacao-real-20261031', execucao);
  fs.mkdirSync(evidencias, { recursive: true });
  fs.writeFileSync(path.join(evidencias, 'execucao-iniciada.json'), JSON.stringify({ data: new Date().toISOString(), base }), { flag: 'wx' });
  fs.writeFileSync(path.join(evidencias, 'fixtures.jsonl'), '', { flag: 'wx' });
  let ok = false;
  let failure;
  try {
    assert.equal(sql('select current_database()'), 'licitaplena_qa_ui_v2');
    const bindings = JSON.parse(execFileSync('docker', ['inspect', 'licitaplena-qa-real-db-1', 'licitaplena-qa-real-auth-1', 'licitaplena-qa-real-rest-1', 'licitaplena-qa-real-storage-1'], { encoding: 'utf8' }));
    for (const container of bindings) for (const published of Object.values(container.NetworkSettings.Ports).filter(Boolean)) for (const binding of published) assert.equal(binding.HostIp, '127.0.0.1');
    baseline = snapshot();
    fs.writeFileSync(path.join(evidencias, 'baseline-dados.json'), JSON.stringify(baseline, null, 2), { flag: 'wx' });
    results.push('PostgreSQL17/Auth/PostgREST16/Storage reais; portas apenas loopback');
    const owner = await makeUser(), other = await makeUser(), operator = await makeUser(), reader = await makeUser();
    const oa = randomUUID(), ob = randomUUID(), ea = randomUUID(), eb = randomUUID(), ec = randomUUID(), pa = randomUUID(), pb = randomUUID(), ia = randomUUID(), ib = randomUUID(), ic = randomUUID(), idExcluido = randomUUID();
    orgs.push(oa, ob);
    sql(`insert into public.operacao_organizacoes(id,nome,owner_id) values('${oa}','QA kit real A','${owner.id}'),('${ob}','QA kit real B','${other.id}');
      insert into public.operacao_empresas(id,organizacao_id,razao_social,cnpj) values('${ea}','${oa}','Alfa Ficticia Homologacao','11222333000181'),('${eb}','${oa}','Beta Ficticia Homologacao','11222333000262'),('${ec}','${ob}','Externa Ficticia Homologacao','11222333000343');
      insert into public.operacao_membros(organizacao_id,usuario_id,papel,empresa_id) values('${oa}','${owner.id}','gestor',null),('${ob}','${other.id}','gestor',null),('${oa}','${operator.id}','operador','${ea}'),('${oa}','${reader.id}','leitura','${ea}');
      insert into public.operacao_processos(id,organizacao_id,empresa_id,numero,orgao,objeto) values('${pa}','${oa}','${ea}','PE QA-001','Orgao Ficticio QA','Materiais ficticios'),('${pb}','${oa}','${eb}','PE QA-002','Orgao Ficticio Beta','Materiais ficticios');
      insert into public.operacao_itens_resultado(id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade,valor_unitario_proposta) values('${ia}','${oa}','${pa}','item','1','Item decimal QA',0.125,0.12),('${ib}','${oa}','${pa}','item','2','Item inteiro QA',3,1.23),('${ic}','${oa}','${pb}','item','1','Item exclusivo Beta',1,10.00),('${idExcluido}','${oa}','${pa}','item','3','Item valido excluido QA',1,999.00);`);
    for (const org of orgs) registrarFixture('organizacao', org);
    expect(await req('/rest/v1/rpc/identificacao_empresa_habilitada', owner.token, 'POST', {}), 200, 'Gate HTTP');
    assert.equal((await req('/rest/v1/rpc/identificacao_empresa_habilitada', owner.token, 'POST', {})).data, true);
    const pending = expect(await api(owner, ea, pa, 'consultar'), 200, 'Consulta sem identificacao');
    assert.equal(pending.identificacao.status, 'pendente');
    assert.equal(pending.itens.find(i => i.id === ia).quantidade, '0.125');
    assert.equal(pending.itens.find(i => i.id === ia).valorUnitario, '0.12');
    assert.equal(pending.itens.find(i => i.id === idExcluido).descricao, 'Item valido excluido QA');
    results.push('Gate real aprovado e projeções numeric::text preservadas pelo PostgREST');
    expect(await api({ token: c.anon }, ea, pa, 'consultar'), 401, 'Anonimo');
    expect(await api(other, ea, pa, 'consultar'), 404, 'Outra organizacao');
    expect(await api(operator, eb, pb, 'consultar'), 404, 'Outro CNPJ do operador');
    expect(await api(reader, ea, pa, 'consultar'), 403, 'Leitor nao gera');
    expect(await api(owner, ea, pb, 'consultar'), 404, 'Processo de outro CNPJ');
    sql(`update public.clientes set status='pendente' where id='${operator.id}'`);
    expect(await api(operator, ea, pa, 'consultar'), 403, 'Cliente pendente');
    sql(`update public.clientes set status='aprovado' where id='${operator.id}'`);
    results.push('Auth e escopo: anonimo, pendente, leitor, outro tenant e CNPJ/processo cruzados bloqueados');
    const data = { endereco: 'Rua Ficticia QA, 123', representante: 'Pessoa Ficticia QA', cargo: 'Administradora' };
    for (const [empresa, razaoSocial, cnpj] of [[ea, 'Alfa Ficticia Homologacao', '11222333000181'], [eb, 'Beta Ficticia Homologacao', '11222333000262']]) expect(await identity(owner, empresa, 'confirmar', { revisado: true, razaoSocial, cnpj, dados: data, proveniencia: [] }), 200, 'Confirmacao manual real');
    const saved = await persistente({ owner, other, operator, reader, ea, eb, pa, pb, ia, ib });
    const declaration = { tipo: 'declaracao', declaracao: { titulo: 'Declaracao ficticia de homologacao', texto: '{{razao_social}} CNPJ {{cnpj}}, representada por {{representante}}, apresenta este exemplo referente a {{numero_edital}} de {{orgao}}.', fonte: 'Modelo ficticio de teste; nao protocolar.' } };
    const da = expect(await api(operator, ea, pa, 'preparar', declaration), 200, 'Declaracao Alfa');
    expect(await api(operator, ea, pa, 'exportar', { ...declaration, revisaoHash: da.revisaoHash }), 422, 'Revisao obrigatoria');
    expect(await api(operator, ea, pa, 'exportar', { ...declaration, revisado: true, revisaoHash: '0'.repeat(64) }), 409, 'Hash adulterado');
    const alfa = await exported(await api(operator, ea, pa, 'exportar', { ...declaration, revisado: true, revisaoHash: da.revisaoHash }), 'Alfa Ficticia Homologacao', 'kit-real-declaracao-alfa-ficticia.docx', '11222333000181', '11222333000262');
    assert(!alfa.includes('Beta Ficticia'));
    const db = expect(await api(owner, eb, pb, 'preparar', declaration), 200, 'Declaracao Beta');
    const beta = await exported(await api(owner, eb, pb, 'exportar', { ...declaration, revisado: true, revisaoHash: db.revisaoHash }), 'Beta Ficticia Homologacao', 'kit-real-declaracao-beta-ficticia.docx', '11222333000262', '11222333000181');
    assert(!beta.includes('Alfa Ficticia'));
    results.push('Declaracoes DOCX reais por CNPJ, revisao obrigatoria e hash adulterado rejeitado');
    const proposal = { tipo: 'proposta', proposta: { itemIds: [ia, ib], unidades: { [ia]: 'un', [ib]: 'un' }, validade: '60 dias', prazoEntrega: '10 dias', pagamento: '30 dias' } };
    const p = expect(await api(operator, ea, pa, 'preparar', proposal), 200, 'Proposta decimal');
    assert(p.previa.texto.includes('Total da proposta: R$ 3,71'));
    const texto = await exported(await api(operator, ea, pa, 'exportar', { ...proposal, revisado: true, revisaoHash: p.revisaoHash }), 'Alfa Ficticia Homologacao', 'kit-real-proposta-alfa-ficticia.docx', '11222333000181', '11222333000262');
    assert(texto.includes('Total da proposta: R$ 3,71'));
    for (const descricao of ['Item decimal QA', 'Item inteiro QA']) assert(texto.includes(descricao), 'Item selecionado no DOCX legado');
    assert(!texto.includes('Item valido excluido QA'), 'Item valido nao selecionado ausente do DOCX legado');
    expect(await api(operator, ea, pa, 'preparar', { ...proposal, proposta: { ...proposal.proposta, itemIds: [ic], unidades: { [ic]: 'un' } } }), 404, 'Item cruzado');
    expect(await req('/rest/v1/operacao_itens_resultado?id=eq.' + ib, operator.token, 'PATCH', { valor_unitario_proposta: '2.34' }), 204, 'Editar preco via RLS');
    expect(await api(operator, ea, pa, 'exportar', { ...proposal, revisado: true, revisaoHash: p.revisaoHash }), 409, 'Preco alterado invalida revisao');
    const p2 = expect(await api(operator, ea, pa, 'preparar', proposal), 200, 'Repreparar');
    assert(p2.previa.texto.includes('Total da proposta: R$ 7,04'));
    results.push('Proposta 0,125 x0,12 +3 x1,23 =3,71; mudanca de preco invalida exportacao');
    const deniedWrite = await req('/rest/v1/operacao_itens_resultado?id=eq.' + ib, reader.token, 'PATCH', { valor_unitario_proposta: '999.00' }, { Prefer: 'return=representation' });
    assert(deniedWrite.status >= 400 || Array.isArray(deniedWrite.data) && deniedWrite.data.length === 0);
    assert.equal(expect(await req('/rest/v1/operacao_itens_resultado?id=eq.' + ib + '&select=valor_unitario_proposta', operator.token), 200, 'Conferir preco')[0].valor_unitario_proposta, 2.34);
    const directRpc = await req('/rest/v1/rpc/confirmar_identificacao_empresa', operator.token, 'POST', { p_empresa: ea, p_usuario: operator.id, p_razao: 'Alfa Ficticia Homologacao', p_cnpj: '11222333000181', p_dados: data, p_proveniencia: [] });
    assert(directRpc.status >= 400);
    results.push('RLS real bloqueia escrita de leitor; RPC de confirmacao exclusiva do backend');
    const pdf = fs.readFileSync(path.join(__dirname, 'fixtures/identificacao-cartao-ficticio.pdf'));
    const uploaded = expect(await identity(operator, ea, 'anexar', { tipo: 'cartao_cnpj', nome: 'cartao-kit-qa.pdf', conteudoBase64: pdf.toString('base64') }), 200, 'Upload real');
    const doc = uploaded.documento; objects.push(doc.arquivo_caminho);
    registrarFixture('documento-origem', doc.id);
    const ext = expect(await identity(operator, ea, 'extrair', { documentoId: doc.id }), 200, 'Extrair PDF real');
    const confirmed = { ...data }, proveniencia = [];
    for (const campo of ['endereco', 'representante', 'cargo']) { const e = ext.evidencias.find(e => e.campo === campo); assert(e); confirmed[campo] = e.valor; proveniencia.push({ documentoId: doc.id, hash: ext.hash, campos: [campo], pagina: e.pagina, trecho: e.trecho }); }
    expect(await identity(operator, ea, 'confirmar', { revisado: true, razaoSocial: 'Alfa Ficticia Homologacao', cnpj: '11222333000181', dados: confirmed, proveniencia }), 200, 'Confirmar fontes reais');
    expect(await api(operator, ea, pa, 'exportar', { ...proposal, revisado: true, revisaoHash: p2.revisaoHash }), 409, 'Identificacao alterada');
    const current = expect(await api(operator, ea, pa, 'preparar', declaration), 200, 'Preparar com fonte');
    const currentSaved = expect(await api(operator, ea, pa, 'preparar', { documentoId: saved.da, versaoEsperada: 3 }), 200, 'Preparar salva com fonte');
    const sourceReview = { documentoId: saved.da, versaoEsperada: 3, revisado: true, revisaoHash: currentSaved.revisaoHash };
    expect(await api(operator, ea, pa, 'confirmarRevisao', sourceReview), 200, 'Revisao salva com fonte');
    const storagePath = '/storage/v1/object/operacao-documentos/' + doc.arquivo_caminho;
    assert((await req('/storage/v1/object/authenticated/operacao-documentos/' + doc.arquivo_caminho, other.token)).status >= 400);
    const bytes = expect(await req('/storage/v1/object/authenticated/operacao-documentos/' + doc.arquivo_caminho, reader.token), 200, 'Leitor pode baixar');
    assert.deepEqual(bytes, pdf);
    const badOverwrite = await req(storagePath, reader.token, 'PUT', pdf, { 'Content-Type': 'application/pdf' });
    assert(badOverwrite.status >= 400 || badOverwrite.data.statusCode >= 400);
    expect(await req(storagePath, operator.token, 'PUT', Buffer.concat([pdf, Buffer.from('\n% fixture alterada')]), { 'Content-Type': 'application/pdf' }), 200, 'Operador substitui fonte');
    expect(await api(operator, ea, pa, 'exportar', { ...declaration, revisado: true, revisaoHash: current.revisaoHash }), 409, 'Fonte alterada bloqueia exportacao');
    expect(await api(operator, ea, pa, 'exportar', sourceReview), 409, 'Fonte alterada bloqueia peca salva');
    assert.equal(expect(await api(operator, ea, pa, 'abrir', { documentoId: saved.da }), 200, 'Fonte invalida revisao salva').revisaoVigente, false);
    results.push('Storage privado real: download permitido por escopo, leitor nao sobrescreve, hash da fonte invalida DOCX');
    expect(await req(storagePath, operator.token, 'PUT', pdf, { 'Content-Type': 'application/pdf' }), 200, 'Restaurar fonte da fixture para UI');
    assert.equal(expect(await api(operator, ea, pa, 'consultar'), 200, 'Cadastro apos restaurar fonte').identificacao.status, 'pendente');
    expect(await api(operator, ea, pa, 'preparar', { documentoId: saved.da, versaoEsperada: 3 }), 422, 'Restaurar bytes nao reconfirma cadastro');
    expect(await identity(operator, ea, 'confirmar', { revisado: true, razaoSocial: 'Alfa Ficticia Homologacao', cnpj: '11222333000181', dados: confirmed, proveniencia }), 200, 'Reconfirmar fonte restaurada para UI');
    assert.equal(expect(await api(operator, ea, pa, 'consultar'), 200, 'Cadastro reconfirmado').identificacao.status, 'confirmado');
    results.push('Restaurar bytes conserva bloqueio; reconfirmacao explicita da origem libera nova preparacao');
    const { verificarUIReal } = require('./homologacao-real-20261031/verificar-ui-real.cjs');
    ui = await verificarUIReal({ base, evidencias, owner, empresas: [{ id: ea, nome: 'Alfa Ficticia Homologacao', cnpj: '11222333000181', processoId: pa }, { id: eb, nome: 'Beta Ficticia Homologacao', cnpj: '11222333000262', processoId: pb }], itemIds: [ia, ib], sanear, registrarFixture });
    results.push(...ui.resultados);
    ok = true;
  } catch (e) {
    failure = e;
  } finally {
    const limpezaErros = [];
    const limpar = async (nome, fn) => { try { await fn(); } catch (e) { limpezaErros.push(nome + ': ' + sanear(e)); } };
    for (const org of orgs) await limpar('Pecas da fixture', async () => {
      const where = escopoLimpeza(org);
      const rows = JSON.parse(sql(`select coalesce(json_agg(d.id),'[]') from public.operacao_kit_documentos d join public.operacao_organizacoes o on o.id=d.organizacao_id where ${where}`));
      for (const id of rows) if (!documentos.includes(id)) documentos.push(id);
      sql(`delete from public.operacao_kit_documentos d using public.operacao_organizacoes o where d.organizacao_id=o.id and ${where}`);
    });
    for (const p of objects) await limpar('Arquivo da fixture', async () => { assert(orgs.some(org => p.startsWith(org + '/')), 'Objeto fora da fixture'); expect(await req('/storage/v1/object/operacao-documentos', c.service, 'DELETE', { prefixes: [p] }), 200, 'Limpeza arquivo QA'); });
    for (const org of orgs) await limpar('Organizacao da fixture', async () => sql(`delete from public.operacao_organizacoes o where ${escopoLimpeza(org)}`));
    for (const user of users) await limpar('Usuario da fixture', async () => expect(await req('/auth/v1/admin/users/' + user, c.service, 'DELETE'), 200, 'Limpeza usuario QA'));
    for (const user of users) await limpar('Ausencia usuario', async () => assert.equal(sql(`select count(*) from auth.users where id='${user}'`), '0'));
    for (const org of orgs) await limpar('Ausencia organizacao', async () => assert.equal(sql(`select count(*) from public.operacao_organizacoes where id='${org}'`), '0'));
    for (const id of documentos) await limpar('Ausencia peca', async () => assert.equal(sql(`select count(*) from public.operacao_kit_documentos where id='${id}'`), '0'));
    for (const p of objects) await limpar('Ausencia arquivo', async () => assert.equal(sql(`select count(*) from storage.objects where bucket_id='operacao-documentos' and name='${p}'`), '0'));
    let preservada = false;
    if (baseline) await limpar('Baseline preservada', async () => { const final = snapshot(); fs.writeFileSync(path.join(evidencias, 'final-dados.json'), JSON.stringify(final, null, 2), { flag: 'wx' }); assert.deepEqual(final, baseline, 'Contagens e hashes preexistentes'); preservada = true; });
    const report = { data: new Date().toISOString(), aprovado: ok && !limpezaErros.length && preservada, results, erro: failure ? sanear(failure) : null, limpezaErros, baselinePreservada: preservada, fixtures: { usuarios: users, organizacoes: orgs, documentos, arquivos: objects }, limites: 'Base ficticia, schema-base reconstruido. Sem producao, SMTP, IA ou coleta. Auth audit logs da fixture podem permanecer; baseline cobre tabelas public, auth.users, storage.objects/buckets.' };
    fs.writeFileSync(path.join(evidencias, 'homologacao-kit-real-local.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report));
    if (!report.aprovado) process.exitCode = 1;
  }
}
if (process.argv.includes('--self-test')) {
  secrets.push('segredo-ficticio');
  assert.equal(sanear(new Error('x segredo-ficticio y')), 'x [privado] y');
  assert.equal(new URL(base).hostname, '127.0.0.1');
  users.push('00000000-0000-4000-8000-000000000001'); orgs.push('00000000-0000-4000-8000-000000000002');
  assert(escopoLimpeza(orgs[0]).includes("o.nome like 'QA kit real %' and o.owner_id in"));
  assert.throws(() => escopoLimpeza('00000000-0000-4000-8000-000000000003'), /IDs desta execução/);
  assert.throws(() => escopoLimpeza("' or true --"), /IDs desta execução/);
  users.push('invalido'); assert.throws(() => escopoLimpeza(orgs[0]), /IDs desta execução/);
  console.log('Self-test offline: origem loopback, sanitização e limpeza somente de IDs próprios aprovados; nenhum segredo ou serviço lido.');
} else main().catch(e => { console.error(sanear(e)); process.exitCode = 1; });
