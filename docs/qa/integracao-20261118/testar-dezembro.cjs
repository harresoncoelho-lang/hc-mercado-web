// Ensaio local dos SQL de dezembro (PGlite em memória, dados fictícios, sem rede).
//   node testar-dezembro.cjs
// Mesma base de testar-aplicar.cjs (produção de 31/10), depois 01-aplicar.sql, depois
// operacao_itens_proposta.sql + operacao_funil_etapas.sql + operacao_portal_cliente.sql + operacao_perfil_empresa.sql
// + operacao_exigencias.sql + operacao_esteira.sql + operacao_kit_modelos.sql + importacao_item_pncp_numero_int32.sql
// + operacao_itens_numero_ordem.sql duas vezes, com os testes SQL e o 02 a cada rodada.
// Auth/Storage do Supabase são stubs mínimos: não prova a API HTTP nem o dono de storage.objects.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const SUP = path.join(__dirname, '../../../supabase');
const ler = nome => fs.readFileSync(path.join(SUP, nome), 'utf8');
const APLICAR = fs.readFileSync(path.join(__dirname, '01-aplicar.sql'), 'utf8');
const VERIFICAR = fs.readFileSync(path.join(__dirname, '02-verificar.sql'), 'utf8');
const NOVOS = ['operacao_itens_proposta.sql', 'operacao_funil_etapas.sql', 'operacao_portal_cliente.sql',
  'operacao_perfil_empresa.sql', 'operacao_exigencias.sql', 'operacao_esteira.sql', 'operacao_kit_modelos.sql',
  'importacao_item_pncp_numero_int32.sql', 'operacao_itens_numero_ordem.sql', 'operacao_catalogo_produtos.sql'];
const TESTES = ['testar_itens_proposta.sql', 'testar_funil_etapas.sql', 'testar_portal_cliente.sql',
  'testar_perfil_empresa.sql', 'testar_exigencias.sql', 'testar_esteira.sql', 'testar_kit_modelos.sql', 'testar_itens_numero_ordem.sql', 'testar_catalogo_produtos.sql'];

function carregarPGlite() {
  const candidatos = [process.env.PGLITE_MODULE_PATH, '@electric-sql/pglite',
    'C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite',
    'C:/Users/harre/AppData/Local/npm-cache/_npx/da5c1b6ea715e8b4/node_modules/@electric-sql/pglite'].filter(Boolean);
  for (const c of candidatos) { try { return require(c).PGlite; } catch { /* próximo */ } }
  throw new Error('PGlite indisponível: defina PGLITE_MODULE_PATH. O ensaio NÃO rodou.');
}

(async () => {
  const db = new (carregarPGlite())();
  const log = [];
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const verificar02 = async () => {
    const rows = (await db.exec(VERIFICAR)).filter(r => r.rows[0]?.resultado).at(-1)?.rows || [];
    assert(rows.length > 70, 'tabela de itens do 02 ausente');
    assert.deepEqual(rows.filter(r => r.resultado !== 'ok'), [], '02 com itens em falha');
    return `${rows.filter(r => r.resultado === 'ok').length}/${rows.length} ok`;
  };
  const rodarTeste = async nome => {
    try { await db.exec(ler(nome)); } catch (e) { await db.exec("rollback"); throw new Error(`${nome}: ${e.message} ${e.where || ""}`); }
  };
  // Gate de identificação avaliado como o gestor fictício (precisa de auth.uid()).
  const gate = async () => (await db.exec(`begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${id(101)}',true);
    select public.identificacao_empresa_habilitada() as g; rollback;`)).find(r => r.rows[0] && 'g' in r.rows[0]).rows[0].g;
  try {
    log.push((await db.query('select version() as v')).rows[0].v.split(' on ')[0]);
    const cat = require('../migracoes-capacidade-20261031/catalogo-producao-20261031.json').catalogo;
    const colunas = t => cat.colunas.filter(c => c.esquema === 'public' && c.tabela === t).sort((a, b) => a.ordem - b.ordem)
      .map(c => `"${c.nome}" ${c.tipo}${c.default === null ? '' : ' default ' + c.default}${c.not_null ? ' not null' : ''}`).join(',');
    // Mesmos stubs e base de testar-aplicar.cjs.
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
      create function public.selecionar_sicaf_para_enriquecimento(integer, text) returns setof text language sql security definer as $$select null::text where false$$;
      insert into storage.buckets values('operacao-documentos','operacao-documentos',false);`);
    const rls = ler('rls_e_limite_de_uso.sql');
    await db.exec(rls.slice(0, rls.indexOf('-- 3) RLS de "clientes"')));
    await db.exec('grant execute on function public.incrementar_uso(uuid, text) to anon, authenticated;');
    for (const f of ['operacao_licitacoes.sql', 'operacao_acompanhamento.sql', 'limite_cnpjs_operacao.sql', 'acesso_empresa_convites.sql',
      'operacao_checklist_edital.sql', 'operacao_kanban_sync.sql', 'operacao_itens_valores_unitarios.sql', 'operacao_itens_marca_modelo.sql', 'fila_dossies.sql']) await db.exec(ler(f));
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
    log.push('base: igual a testar-aplicar.cjs + bucket operacao-documentos privado');

    await db.exec(APLICAR);
    log.push(`01-aplicar.sql aplicado; 02 → ${await verificar02()}`);
    const gateAntes = await gate();
    assert.equal(gateAntes, true, 'gate de identificação deveria abrir antes dos SQL novos');

    // Item importado antes de operacao_itens_proposta.sql existir: o preenchimento inicial deve alcançá-lo.
    await db.exec(`insert into operacao_itens_resultado(id,organizacao_id,processo_id,identificador,marca,valor_unitario_proposta,atualizado_em)
        values('${id(42)}','${org}','${id(22)}','5','Marca antiga',9.99,'2020-01-01');
      insert into operacao_origens_pncp(item_id,organizacao_id,processo_id,empresa_id,compra,numero_item,url,hash_aplicado,hash_atual,estado)
        values('${id(42)}','${org}','${id(22)}','${emp}','11222333000181-1-9/2026',5,'https://pncp.example.invalid','${'a'.repeat(64)}','${'a'.repeat(64)}','importado');
      insert into operacao_observacoes_pncp(item_id,hash,snapshot,observado_em) values
        ('${id(42)}','${'a'.repeat(64)}','{"item":{"unidade":"CX"},"raw":{"catalogoCodigoItem":"111"}}','2026-01-01'),
        ('${id(42)}','${'b'.repeat(64)}','{"item":{"unidade":"PCT"},"raw":{"catalogoCodigoItem":"222"}}','2026-02-01');`);
    const contar = async () => (await db.query(`select (select count(*) from operacao_documentos)::int d,(select count(*) from operacao_processos)::int p,
      (select count(*) from operacao_itens_resultado)::int i,(select count(*) from operacao_membros)::int m`)).rows[0];
    const dadosAntes = await contar();
    // Peça do kit criada antes de operacao_kit_modelos.sql: tem de continuar no formato 1 (proposta antiga).
    await db.query(`insert into operacao_kit_documentos(id,organizacao_id,empresa_id,processo_id,tipo,dados,criado_por,atualizado_por,atualizado_em)
      values($1,$2,$3,$4,'proposta','{"proposta":{}}',$5,$5,'2020-01-01')`, [id(901), org, emp, id(21), gestor]);

    for (const rodada of [1, 2]) {
      for (const f of NOVOS) await db.exec(ler(f));
      if (rodada === 1) {
        const r = (await db.query(`select unidade,codigo_catalogo,marca,valor_unitario_proposta::text v,atualizado_em=timestamptz '2020-01-01' intacto from operacao_itens_resultado where id=$1`, [id(42)])).rows[0];
        assert.deepEqual(r, { unidade: 'PCT', codigo_catalogo: '222', marca: 'Marca antiga', v: '9.99', intacto: true }, 'preenchimento inicial');
        const o = (await db.query(`select numero_ordem::text n from operacao_itens_resultado where id=$1`, [id(42)])).rows[0];
        assert.deepEqual(o, { n: '5' }, 'numero_ordem do item existente');
        log.push('preenchimento de itens existentes: observação mais recente (PCT/222); marca, oferta e atualizado_em intactos; numero_ordem=5');
        const k = (await db.query(`select formato,modelo_codigo,atualizado_em=timestamptz '2020-01-01' intacto from operacao_kit_documentos where id=$1`, [id(901)])).rows[0];
        assert.deepEqual(k, { formato: 1, modelo_codigo: null, intacto: true }, 'peça antiga do kit');
        log.push('peça do kit anterior: formato 1, sem modelo, atualizado_em intacto');
      }
      for (const t of TESTES) await rodarTeste(t);
      log.push(`rodada ${rodada}: ${NOVOS.join(' + ')} aplicados; ${TESTES.join(' e ')} ok; 02 → ${await verificar02()}`);
    }
    assert.deepEqual(await contar(), dadosAntes, 'dados alterados');
    log.push(`dados preservados: ${JSON.stringify(dadosAntes)}`);
    assert.equal(await gate(), gateAntes, 'gate de identificação mudou com os SQL novos');
    log.push('identificacao_empresa_habilitada(): true antes e depois dos SQL novos');

    // Erro no fim de um SQL novo: nada pode sobrar (transação única).
    const db2Falha = ler('operacao_funil_etapas.sql').replace(/\ncommit;/, () => "\ndo $$begin raise exception 'falha fictícia';end$$;\ncommit;");
    await db.exec('drop table operacao_funil_etapas cascade');
    await assert.rejects(() => db.exec(db2Falha), /falha fictícia/);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('public.operacao_funil_etapas') t")).rows[0].t, null, 'rollback deixou a tabela');
    log.push('operacao_funil_etapas.sql com erro no fim: rollback completo');
    console.log(log.map(l => '- ' + l).join('\n'));
    console.log('ENSAIO DEZEMBRO OK');
  } finally { await db.close(); }
})().catch(e => { console.error('ENSAIO DEZEMBRO FALHOU:', e.message); process.exit(1); });
