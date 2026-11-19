// Ambiente de teste local do CRM (Supabase CLI no Docker). Nunca toca o projeto de produção.
//   node ambiente-teste/subir.cjs            -> sobe a pilha, recria o banco do zero, aplica os SQL, roda os testes e o seed
//   node ambiente-teste/subir.cjs --parar    -> para os containers (dados descartados)
// Base = a mesma do ensaio PGlite (docs/qa/integracao-20261118/testar-dezembro.cjs), só que com Auth/Storage reais.
// Depois: 01-aplicar -> 02 -> SQL novos na ordem do roteiro -> testar_*.sql -> 02 de novo -> seed.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const AQUI = __dirname, RAIZ = path.resolve(AQUI, '..');
const SUP = path.join(RAIZ, 'supabase'), QA = path.join(RAIZ, 'docs/qa/integracao-20261118');
const CONTAINER = 'supabase_db_licitaplena-teste';
const CHAVES = path.join(AQUI, 'chaves.local.json');
const NOVOS = ['operacao_itens_proposta.sql', 'operacao_funil_etapas.sql', 'operacao_portal_cliente.sql',
  'operacao_perfil_empresa.sql', 'operacao_exigencias.sql', 'operacao_esteira.sql', 'operacao_kit_modelos.sql'];
const TESTES = ['testar_itens_proposta.sql', 'testar_funil_etapas.sql', 'testar_portal_cliente.sql',
  'testar_perfil_empresa.sql', 'testar_exigencias.sql', 'testar_esteira.sql', 'testar_kit_modelos.sql'];
// Tabelas que o painel/sistema consultam e que produção já tem (fora do ensaio, que só mede o CRM).
const EXTRAS_PAINEL = ['schema_oportunidades.sql', 'schema_dados_mercado.sql', 'dossies_editais.sql', 'comprasgov_resultados.sql'];

const ler = f => fs.readFileSync(path.join(SUP, f), 'utf8');
// Argumentos são constantes deste arquivo (nada vindo de fora); shell só para achar o npx.cmd no Windows.
function supabase(...args) {
  const cmd = `npx --yes supabase@latest ${args.join(' ')}`;
  const r = spawnSync(cmd, { cwd: AQUI, encoding: 'utf8', shell: true, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} falhou:\n${(r.stderr || '') + (r.stdout || '')}`.slice(0, 4000));
  return r;
}
// psql como "postgres" (não superusuário), igual ao SQL Editor do painel do Supabase.
function psql(sql, rotulo) {
  const r = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-F', '|'],
    { input: sql, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`SQL "${rotulo}" falhou:\n${r.stderr}`.slice(0, 4000));
  return r.stdout;
}
function verificar02() {
  const linhas = psql(fs.readFileSync(path.join(QA, '02-verificar.sql'), 'utf8'), '02-verificar').split('\n').filter(l => /^\d+\|.*\|(ok|falha)$/.test(l));
  const falhas = linhas.filter(l => l.endsWith('|falha'));
  if (linhas.length < 70 || falhas.length) throw new Error(`02-verificar: ${linhas.length} itens, falhas:\n${falhas.join('\n')}`);
  return `${linhas.length}/${linhas.length} ok`;
}
function baseProducao() {
  const cat = require(path.join(RAIZ, 'docs/qa/migracoes-capacidade-20261031/catalogo-producao-20261031.json')).catalogo;
  const colunas = t => cat.colunas.filter(c => c.esquema === 'public' && c.tabela === t).sort((a, b) => a.ordem - b.ordem)
    .map(c => `"${c.nome}" ${c.tipo}${c.default === null ? '' : ' default ' + c.default}${c.not_null ? ' not null' : ''}`).join(',');
  const rls = ler('rls_e_limite_de_uso.sql');
  return [`create table public.clientes(${colunas('clientes')}, primary key(id));
    create table public.admins(${colunas('admins')});
    alter table public.clientes enable row level security; alter table public.admins enable row level security;
    create policy clientes_select_proprio on public.clientes for select using (auth.uid() = id);
    create policy clientes_insert_proprio on public.clientes for insert with check (auth.uid() = id);
    create policy clientes_update_proprio on public.clientes for update using (auth.uid() = id);
    create policy admins_select_proprio on public.admins for select using ((auth.jwt() ->> 'email') = email);
    create function public.selecionar_sicaf_para_enriquecimento(integer, text) returns setof text language sql security definer as $$select null::text where false$$;
    insert into storage.buckets(id,name,public) values('operacao-documentos','operacao-documentos',false);`,
  rls.slice(0, rls.indexOf('-- 3) RLS de "clientes"')),
  'grant execute on function public.incrementar_uso(uuid, text) to anon, authenticated;',
  ...['operacao_licitacoes.sql', 'operacao_acompanhamento.sql', 'limite_cnpjs_operacao.sql', 'acesso_empresa_convites.sql',
    'operacao_checklist_edital.sql', 'operacao_kanban_sync.sql', 'operacao_itens_valores_unitarios.sql', 'operacao_itens_marca_modelo.sql', 'fila_dossies.sql'].map(ler),
  ...EXTRAS_PAINEL.map(ler),
  // dados_robo existe em produção sem .sql no repositório (ver CLAUDE.md, "Data flow" tier 3): forma mínima.
  `create table if not exists public.dados_robo(chave text primary key, dado jsonb, atualizado_em timestamptz default now());
   alter table public.dados_robo enable row level security;
   create policy dados_robo_leitura on public.dados_robo for select to authenticated using (true);`,
  FIXTURES_ENSAIO];
}
// Dados fictícios do ensaio (testar-dezembro.cjs): os testar_*.sql (ex.: testar_kit_modelos) contam com eles.
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FIXTURES_ENSAIO = `
  insert into auth.users(id,email) values('${id(101)}','gestor@example.invalid');
  insert into clientes(id,nome,email,status) values('${id(101)}','Pessoa fictícia','gestor@example.invalid','aprovado');
  insert into operacao_organizacoes(id,nome,owner_id) values('${id(1)}','Org fictícia do ensaio','${id(101)}');
  insert into operacao_empresas(id,organizacao_id,razao_social,cnpj) values('${id(11)}','${id(1)}','Empresa fictícia do ensaio','11222333000181');
  insert into operacao_membros(organizacao_id,usuario_id,papel) values('${id(1)}','${id(101)}','gestor');
  insert into operacao_processos(id,organizacao_id,empresa_id,objeto) select ('00000000-0000-4000-8000-0000000000'||n)::uuid,'${id(1)}','${id(11)}','Processo fictício' from unnest(array['21','22','23','24']) n;
  insert into operacao_documentos(id,organizacao_id,empresa_id,tipo,arquivo_caminho) select ('00000000-0000-4000-8000-0000000000'||n)::uuid,'${id(1)}','${id(11)}','Fictício','${id(1)}/${id(11)}/doc'||n||'.pdf' from unnest(array['31','32']) n;
  insert into operacao_itens_resultado(id,organizacao_id,processo_id,identificador) values('${id(41)}','${id(1)}','${id(21)}','1');`;

function esperarDocker() {
  const fim = Date.now() + 5 * 60000;
  while (spawnSync('docker', ['info'], { encoding: 'utf8' }).status !== 0) {
    if (Date.now() > fim) throw new Error('Docker não respondeu em 5 min. Abra o Docker Desktop.');
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},5000)']);
  }
}

function main() {
  if (process.argv.includes('--parar')) { supabase('stop', '--no-backup'); console.log('Ambiente parado.'); return; }
  esperarDocker();
  supabase('start', '-x', 'realtime,studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta');
  // Do zero: banco vazio a cada execução (sem migrations nem seed.sql do CLI).
  supabase('db', 'reset', '--local', '--no-seed');
  const s = JSON.parse(supabase('status', '-o', 'json').stdout.replace(/^[^{]*/, ''));
  if (!/^http:\/\/127\.0\.0\.1:/.test(s.API_URL)) throw new Error('API_URL não é local: ' + s.API_URL);
  const chaves = { API_URL: s.API_URL, PUBLISHABLE_KEY: s.PUBLISHABLE_KEY, ANON_KEY: s.ANON_KEY, SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY };
  fs.writeFileSync(CHAVES, JSON.stringify(chaves, null, 2));
  const log = [];
  baseProducao().forEach((sql, i) => psql(sql, `base ${i}`));
  log.push('base de produção (ensaio + tabelas do painel) aplicada');
  psql(fs.readFileSync(path.join(QA, '01-aplicar.sql'), 'utf8'), '01-aplicar');
  log.push(`01-aplicar.sql; 02 -> ${verificar02()}`);
  for (const f of NOVOS) psql(ler(f), f);
  for (const t of TESTES) psql(ler(t), t);
  log.push(`SQL novos: ${NOVOS.join(', ')}; testes ok: ${TESTES.join(', ')}; 02 -> ${verificar02()}`);
  // Segunda rodada: prova idempotência no Postgres real.
  for (const f of NOVOS) psql(ler(f), f + ' (2ª)');
  log.push(`2ª rodada dos SQL novos; 02 -> ${verificar02()}`);
  require('./seed.cjs').semear(chaves).then(r => {
    log.push(r);
    fs.writeFileSync(path.join(AQUI, 'ultimo-subir.local.txt'), log.join('\n') + '\n');
    console.log(log.map(l => '- ' + l).join('\n') + '\nAMBIENTE PRONTO. Site: node ambiente-teste/servidor.cjs  (http://127.0.0.1:8788)');
  }).catch(e => { console.error('SEED FALHOU:', e.message); process.exit(1); });
}
try { main(); } catch (e) { console.error('SUBIR FALHOU:', e.message); process.exit(1); }
