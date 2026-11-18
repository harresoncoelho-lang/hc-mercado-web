// Ensaio local do roteiro de banco de 18/11/2026 (PGlite em memória, dados fictícios, sem rede).
//   node testar-aplicar.cjs --gerar   regrava 01-aplicar.sql a partir dos arquivos de supabase/.
//   node testar-aplicar.cjs           confere 01-aplicar.sql contra as fontes e ensaia 01/02 duas vezes.
// PGlite: PGLITE_MODULE_PATH ou o pacote já instalado; nada é baixado por este script.
// Auth/Storage do Supabase são stubs mínimos: não prova dono de storage.objects nem a API real.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const SUP = path.join(__dirname, '../../../supabase');
const APLICAR = path.join(__dirname, '01-aplicar.sql'), VERIFICAR = path.join(__dirname, '02-verificar.sql');
const FONTES = ['identificacao_empresa.sql', 'seguranca_operacao.sql', 'kit_documentos.sql', 'kit_documentos_escala_proposta.sql', 'importacao_item_pncp.sql', 'endurecer_rpc_servidor.sql'];
const REVOKE_USO = 'revoke all on function public.incrementar_uso(uuid, text) from public, anon, authenticated;';
const GRANT_USO = 'grant execute on function public.incrementar_uso(uuid, text) to service_role;';
const POLICY_PNCP = 'create policy origem_pncp_leitura on public.operacao_origens_pncp';
const bruto = nome => fs.readFileSync(path.join(SUP, nome));
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

function gerar() {
  const todas = [...FONTES, 'rls_e_limite_de_uso.sql'];
  let sql = `-- 01-aplicar.sql — gerado por testar-aplicar.cjs --gerar em 2026-11-18. NÃO editar à mão.
-- Projeto Supabase lsqjamqvmrcyrvowndiu. Rodar inteiro no SQL Editor, uma vez, na janela combinada.
-- Junta, nesta ordem, os arquivos de supabase/ abaixo (SHA-256 do arquivo original, bytes brutos):
${todas.map(n => `--   ${sha(bruto(n))}  ${n}`).join('\n')}
-- Ajustes feitos só aqui (os originais não mudam):
--   * begin;/commit; de cada arquivo removidos: tudo roda numa transação só (abaixo).
--   * importacao_item_pncp.sql: "drop policy if exists origem_pncp_leitura" antes do create policy.
--   * rls_e_limite_de_uso.sql: só o revoke de incrementar_uso e o grant da linha seguinte (service_role).
--   * lock_timeout/statement_timeout locais para não travar produção esperando lock.
-- Nenhum arquivo usa CREATE INDEX CONCURRENTLY, VACUUM ou outro comando proibido em transação.
-- Qualquer erro: nada fica gravado. Rode "rollback;" e pare (ver ROTEIRO-BANCO.md).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
`;
  for (const nome of FONTES) {
    let corpo = bruto(nome).toString('utf8').replace(/\r\n/g, '\n');
    const antes = corpo;
    corpo = corpo.replace(/^(begin|commit);[ \t]*$/gim, '-- ($1 do arquivo original removido)');
    assert.equal((antes.match(/^(begin|commit);[ \t]*$/gim) || []).length, nome === 'endurecer_rpc_servidor.sql' ? 0 : 2, `begin/commit inesperado em ${nome}`);
    assert(!/concurrently|^\s*vacuum|^\s*rollback/im.test(corpo), `${nome} tem comando que não roda em transação`);
    if (nome === 'importacao_item_pncp.sql') {
      assert.equal(corpo.split(POLICY_PNCP).length, 2, 'policy origem_pncp_leitura deve aparecer uma vez');
      corpo = corpo.replace(POLICY_PNCP, `-- (ajuste: idempotência)\ndrop policy if exists origem_pncp_leitura on public.operacao_origens_pncp;\n${POLICY_PNCP}`);
    }
    sql += `\n-- ===================== ${nome} =====================\n${corpo.trimEnd()}\n`;
  }
  const rls = bruto('rls_e_limite_de_uso.sql').toString('utf8');
  assert(rls.includes(`${REVOKE_USO}\n${GRANT_USO}`), 'linhas de incrementar_uso mudaram em rls_e_limite_de_uso.sql');
  sql += `\n-- ===================== rls_e_limite_de_uso.sql (só incrementar_uso) =====================
-- Front não chama esta RPC; só netlify/functions/_auth.js, com SUPABASE_SERVICE_ROLE_KEY.
${REVOKE_USO}
${GRANT_USO}

commit;
`;
  return sql;
}

if (process.argv.includes('--gerar')) { fs.writeFileSync(APLICAR, gerar()); console.log('01-aplicar.sql regravado'); process.exit(0); }

function carregarPGlite() {
  const candidatos = [process.env.PGLITE_MODULE_PATH, '@electric-sql/pglite',
    'C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite',
    'C:/Users/harre/AppData/Local/npm-cache/_npx/da5c1b6ea715e8b4/node_modules/@electric-sql/pglite'].filter(Boolean);
  for (const c of candidatos) { try { return require(c).PGlite; } catch { /* próximo */ } }
  throw new Error('PGlite indisponível: defina PGLITE_MODULE_PATH. O ensaio NÃO rodou.');
}

(async () => {
  const aplicar = fs.readFileSync(APLICAR, 'utf8');
  assert.equal(aplicar, gerar(), '01-aplicar.sql não bate com as fontes atuais: rode --gerar e revise');
  const verificar = fs.readFileSync(VERIFICAR, 'utf8');
  assert(verificar.includes(bruto('verificar_kit_prepublicacao.sql').toString('utf8').replace(/\r\n/g, '\n').trim()), '02 deve conter verificar_kit_prepublicacao.sql intacto');
  const PGlite = carregarPGlite();
  const db = new PGlite();
  const log = [];
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  // O último resultado é o do commit; a tabela de itens é o último resultado com a coluna "resultado".
  const linhas02 = async sql => { const rows = (await db.exec(sql)).filter(r => r.rows[0]?.resultado).at(-1)?.rows || []; assert(rows.length > 70, 'tabela de itens do 02 ausente'); return rows; };
  const falhas = rows => rows.filter(r => r.resultado !== 'ok');
  try {
    log.push((await db.query('select version() as v')).rows[0].v.split(' on ')[0]);
    const cat = require('../migracoes-capacidade-20261031/catalogo-producao-20261031.json').catalogo;
    const colunas = t => cat.colunas.filter(c => c.esquema === 'public' && c.tabela === t).sort((a, b) => a.ordem - b.ordem)
      .map(c => `"${c.nome}" ${c.tipo}${c.default === null ? '' : ' default ' + c.default}${c.not_null ? ' not null' : ''}`).join(',');
    // Stubs: papéis/defaults do Supabase, auth, storage, clientes/admins com as colunas do catálogo de produção (31/10).
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
      grant usage on schema public, auth, storage to anon, authenticated, service_role;
      grant all on all tables in schema storage to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      create table public.clientes(${colunas('clientes')}, primary key(id));
      create table public.admins(${colunas('admins')});
      -- Veio do projeto Radar SICAF (sem .sql no repositório); corpo fictício, só a assinatura importa.
      create function public.selecionar_sicaf_para_enriquecimento(integer, text) returns setof text language sql security definer as $$select null::text where false$$;`);
    // Base na ordem em que produção recebeu (MIGRACOES.md e cabeçalhos "executar após").
    const rls = bruto('rls_e_limite_de_uso.sql').toString('utf8');
    // admins de produção não tem coluna id; a seção 3 (policies de clientes/admins) já existe lá e não interessa aqui.
    await db.exec(rls.slice(0, rls.indexOf('-- 3) RLS de "clientes"')));
    await db.exec('grant execute on function public.incrementar_uso(uuid, text) to anon, authenticated;'); // estado do advisor em 17/11
    const BASE = ['operacao_licitacoes.sql', 'operacao_acompanhamento.sql', 'limite_cnpjs_operacao.sql', 'acesso_empresa_convites.sql',
      'operacao_checklist_edital.sql', 'operacao_kanban_sync.sql', 'operacao_itens_valores_unitarios.sql', 'operacao_itens_marca_modelo.sql'];
    for (const f of BASE) await db.exec(bruto(f).toString('utf8'));
    log.push('base: rls_e_limite_de_uso.sql (seções 1-2) + ' + BASE.join(' + '));
    // A base reconstruída precisa ter as mesmas policies (nome e definição) do catálogo de produção de 31/10.
    const pol = (await db.query(`select schemaname esquema, tablename tabela, policyname nome, cmd comando, qual "using", with_check "check", roles::text[] papeis
      from pg_policies where tablename like 'operacao_%' or (schemaname='storage' and tablename='objects') order by 1,2,3`)).rows;
    const polCat = cat.policies.filter(p => p.tabela.startsWith('operacao_') || p.esquema === 'storage')
      .map(p => ({ esquema: p.esquema, tabela: p.tabela, nome: p.nome, comando: p.comando, using: p.using, check: p.check, papeis: p.papeis }))
      .sort((a, b) => (a.esquema + a.tabela + a.nome).localeCompare(b.esquema + b.tabela + b.nome));
    assert.deepEqual(pol, polCat, 'policies da base local divergem do catálogo de produção');
    const fnLocal = new Set((await db.query(`select p.oid::regprocedure::text s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows.map(r => r.s.replace('public.', '')));
    const faltam = cat.funcoes.filter(f => f.esquema === 'public' && !fnLocal.has(f.assinatura)).map(f => f.assinatura);
    assert.deepEqual(faltam, ['criar_cliente_no_cadastro()'], 'funções do catálogo ausentes na base local');
    log.push(`base confere com catálogo de 31/10: ${pol.length} policies iguais; funções públicas iguais exceto criar_cliente_no_cadastro() (trigger de cadastro, fora do escopo)`);

    // Dados fictícios no formato do inventário: gestor único, docs/processos com caminho no escopo.
    const org = id(1), emp = id(11), gestor = id(101);
    await db.query('insert into auth.users values($1,$2)', [gestor, 'gestor@example.invalid']);
    await db.query("insert into clientes(id,nome,email,status) values($1,'Pessoa fictícia','gestor@example.invalid','aprovado')", [gestor]);
    await db.query("insert into operacao_organizacoes(id,nome,owner_id) values($1,'Org fictícia',$2)", [org, gestor]);
    await db.query("insert into operacao_empresas(id,organizacao_id,razao_social,cnpj) values($1,$2,'Empresa fictícia','11222333000181')", [emp, org]);
    await db.query("insert into operacao_membros(organizacao_id,usuario_id,papel) values($1,$2,'gestor')", [org, gestor]);
    for (const n of [21, 22, 23, 24]) await db.query("insert into operacao_processos(id,organizacao_id,empresa_id,objeto) values($1,$2,$3,'Processo fictício')", [id(n), org, emp]);
    for (const n of [31, 32]) await db.query("insert into operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho) values($1,$2,$3,'Fictício',$4)", [id(n), org, emp, `${org}/${emp}/doc${n}.pdf`]);
    await db.query("insert into operacao_itens_resultado(id,organizacao_id,processo_id,identificador) values($1,$2,$3,'1')", [id(41), org, id(21)]);
    for (const n of [31, 32]) await db.query("insert into storage.objects(bucket_id,name) values('operacao-documentos',$1)", [`${org}/${emp}/doc${n}.pdf`]);
    const contar = async () => (await db.query(`select (select count(*) from operacao_documentos)::int d,(select count(*) from operacao_processos)::int p,
      (select count(*) from operacao_itens_resultado)::int i,(select count(*) from operacao_membros)::int m,(select count(*) from storage.objects)::int o`)).rows[0];
    const dadosAntes = await contar();

    // 02 antes de aplicar: o gate do kit precisa recusar.
    await assert.rejects(() => db.exec(verificar), /Kit pré-publicação/);
    await db.exec('rollback');
    log.push('02 antes do 01: recusado pelo gate do kit (esperado)');

    // Erro no fim do 01: nada pode sobrar.
    const comErro = aplicar.replace(/\ncommit;\n$/, () => "\ndo $$begin raise exception 'falha fictícia no fim';end$$;\ncommit;\n");
    assert.notEqual(comErro, aplicar);
    await assert.rejects(() => db.exec(comErro), /falha fictícia no fim/);
    await db.exec('rollback');
    const sobra = (await db.query(`select to_regclass('public.operacao_kit_documentos') k, to_regclass('public.operacao_identificacao_empresa') i,
      to_regprocedure('public.pode_escrever_org_operacao(uuid)') f, (select count(*)::int from pg_policies where policyname like '%\\_escrita') e`)).rows[0];
    assert.deepEqual(sobra, { k: null, i: null, f: null, e: 2 }, 'rollback deixou objetos');
    log.push('01 com erro no fim: rollback completo, base intacta');

    for (const rodada of [1, 2]) {
      await db.exec(aplicar);
      const rows = await linhas02(verificar);
      assert.deepEqual(falhas(rows), [], `rodada ${rodada}: itens em falha`);
      assert.equal((await db.query('select current_setting(\'transaction_read_only\') r')).rows[0].r, 'off');
      log.push(`rodada ${rodada}: 01 aplicado sem erro; 02 → ${rows.length} itens ok, 0 falha`);
    }
    assert.deepEqual(await contar(), dadosAntes, 'dados alterados');
    log.push(`dados preservados: ${JSON.stringify(dadosAntes)}`);

    // 02 enxerga falha: sem uma policy, a linha correspondente vira "falha".
    const interno = verificar.replace(/^begin read only;\s*$/m, '').replace(/^commit;\s*$/m, '');
    await db.exec('begin; drop policy origem_pncp_leitura on public.operacao_origens_pncp;');
    const r = await linhas02(interno);
    await db.exec('rollback');
    assert.deepEqual(falhas(r).map(x => x.item), ['policy public.operacao_origens_pncp.origem_pncp_leitura']);
    log.push('02 com policy removida (em transação desfeita): aponta exatamente a policy em falha');

    // Permissões efetivas de incrementar_uso depois do 01.
    for (const [papel, pode] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
      await db.exec(`set role ${papel}`);
      const ok = await db.query('select public.incrementar_uso($1,$2)', [gestor, 'ensaio']).then(() => true, () => false);
      await db.exec('reset role');
      assert.equal(ok, pode, `incrementar_uso como ${papel}`);
    }
    log.push('incrementar_uso: anon e authenticated negados; service_role executa');
    console.log(log.map(l => '- ' + l).join('\n'));
    console.log('ENSAIO OK');
  } finally { await db.close(); }
})().catch(e => { console.error('ENSAIO FALHOU:', e.message); process.exit(1); });
