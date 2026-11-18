// Preparador único deste destino e destes inventários. Não conecta nem executa SQL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const dir = __dirname;
const anterior = path.resolve(dir, '../../migracoes-capacidade-20261031');
const sha = valor => crypto.createHash('sha256').update(valor).digest('hex');
const id = valor => '"' + valor.replaceAll('"','""') + '"';
const lit = valor => "'" + String(valor).replaceAll("'","''") + "'";
const json = valor => lit(JSON.stringify(valor)) + '::jsonb';
const nome = r => r.esquema + '.' + id(r.tabela || r.nome);
const insumos = {};
function ler(arquivo, esperado) {
 const bruto = fs.readFileSync(arquivo);
 assert.equal(sha(bruto), esperado, 'Insumo mudou: ' + path.basename(arquivo));
 insumos[path.basename(arquivo)] = esperado;
 return JSON.parse(bruto.toString('utf8').replace(/^\uFEFF/,''));
}
const origem = ler(path.join(anterior,'catalogo-producao-20261031.json'),'cd708621a042125e408774128e7927c8cea3ebc9e16fcc30bd084f5f782d71aa');
const baseline = ler(path.join(dir,'baseline-destino.json'),'13b0042d98f3348023cc7cbcd00fc4ec325402234811e5a6679ff524d986280e');
const destino = ler(path.join(dir,'catalogo-destino-vazio.json'),'d0a2910b2f9a62e9df3796c1392cb656acc06ea88404d166c511d18e279017fd');
const helpers = ler(path.join(dir,'helpers-producao.json'),'9936a2bc47d92ef57ccf01e54f6636c4f2b8f4adc27b2bf757573fb83a6f2882');
const robo = ler(path.join(dir,'dados-robo-esquema-producao.json'),'cc5dad90ee5bd01d5df97e925a34e2dece9f63f10bd4f2ac2abebf644d0885c1');
for (const item of [origem,baseline,destino,helpers,robo]) assert.equal(item.read_only,'on');
assert.equal(baseline.projeto_esperado,'luguscapasskcsficckf');
assert.equal(baseline.organizacao_esperada,'vhmjospwgiryrnrndkpd');
assert.equal(baseline.server_version_num,'170011');
assert.equal(destino.hash_catalogo_md5,'785cf53d0d88df117eff15085f879018');
assert.equal(baseline.executor,'postgres');
assert.deepEqual(baseline.public_relacoes,[]); assert.deepEqual(baseline.public_funcoes,[]);
assert.deepEqual(destino.catalogo.policies,[]);
assert.equal(robo.catalogo.relacao.nome,'dados_robo'); assert.deepEqual(robo.catalogo.triggers,[]);
const c = origem.catalogo, d = destino.catalogo, r = robo.catalogo;
const tabelas = [...c.relacoes.filter(x=>x.esquema==='public'),r.relacao];
assert.equal(tabelas.length,19);
assert(tabelas.every(x=>x.tipo==='r' && x.dono==='postgres' && !x.force_rls && !x.opcoes));
const colunas = [...c.colunas.filter(x=>x.esquema==='public'),...r.colunas.map(x=>({...x,esquema:'public',tabela:'dados_robo'}))];
assert(colunas.every(x=>!x.identity && !x.generated && !x.acl));
const constraints = [...c.constraints.filter(x=>x.esquema==='public'),...r.constraints.map(x=>({...x,esquema:'public',tabela:'dados_robo',validada:true,deferivel:false,adiada:false}))];
assert(constraints.every(x=>x.validada && ['p','u','c','f'].includes(x.tipo)));
const indices = [...c.indices.filter(x=>x.esquema==='public'),...r.indices.map(x=>({...x,esquema:'public',tabela:'dados_robo',unico:true,pronto:true,valido:true,primario:true}))];
const funcoes = [...c.funcoes.filter(x=>x.esquema==='public' && x.definicao),...helpers.catalogo.funcoes.map(x=>({...x,assinatura:x.solicitada.slice(7),configuracao:x.configuracao_funcao}))];
assert.equal(new Set(funcoes.map(x=>x.assinatura)).size,funcoes.length);
assert.equal(funcoes.length,22); assert(funcoes.every(x=>x.dono==='postgres' && x.definicao.startsWith('CREATE OR REPLACE FUNCTION public.')));
assert.equal(funcoes.find(x=>x.nome==='criar_cliente_no_cadastro').hash_corpo_md5,c.funcoes.find(x=>x.nome==='criar_cliente_no_cadastro').hash_corpo_md5);
const ordem = ['admin_tem_permissao','eh_membro_operacao','tem_vinculo_operacao','pode_acessar_empresa_operacao','pode_acessar_processo_operacao','acesso_arquivo_operacao','eh_owner_admin_operacao','limite_cnpjs_operacao'];
funcoes.sort((a,b)=>(ordem.includes(a.nome)?ordem.indexOf(a.nome):99)-(ordem.includes(b.nome)?ordem.indexOf(b.nome):99));
const policies = [...c.policies.filter(x=>x.esquema==='public'||x.esquema==='storage'&&x.tabela==='objects'),...r.policies.map(x=>({...x,esquema:'public',tabela:'dados_robo'}))];
const triggers = c.triggers.filter(x=>x.esquema==='public'||x.esquema==='auth'&&x.nome==='on_auth_user_created');
assert.equal(triggers.length,3); assert(triggers.every(x=>x.habilitado==='O'));
const aclTabelas = [...c.acl_relacoes.filter(x=>x.esquema==='public'),...r.acl_relacao.map(x=>({...x,esquema:'public',objeto:'dados_robo'}))];
const aclFuncoes = [...c.acl_funcoes.filter(x=>x.esquema==='public'&&x.objeto!=='criar_cliente_no_cadastro()'),...helpers.catalogo.acl_funcoes.map(x=>({...x,esquema:'public',objeto:x.assinatura.slice(7)}))].map(({assinatura,...x})=>x);
assert([...aclTabelas,...aclFuncoes].every(x=>x.concedente==='postgres'&&['postgres','PUBLIC','anon','authenticated','service_role'].includes(x.papel)));
const consulta = fs.readFileSync(path.join(anterior,'01-catalogo-readonly.sql'),'utf8');
assert.equal(sha(consulta),'7234ddc5a239aac1152ca70fa1322086b586465fef6f5406bec3a7d17f9d2ce3');
const cte = consulta.slice(consulta.indexOf('with\n'),consulta.indexOf("select jsonb_build_object('versao_consulta'"));
const posCte = cte.replace("c.relname in ('clientes','admins')","c.relname in ('clientes','admins','dados_robo')")
 .replace("tablename in ('clientes','admins')","tablename in ('clientes','admins','dados_robo')")
 .replace("'consultar_limite_cnpjs_cliente'))","'consultar_limite_cnpjs_cliente','admin_tem_permissao'))");
assert.notEqual(posCte,cte); assert(posCte.includes("'admins','dados_robo'")); assert(posCte.includes("'admin_tem_permissao'"));
assert(posCte.includes("tablename in ('clientes','admins','dados_robo')"));
const comandos = [];
for (const tabela of tabelas) {
 const cols = colunas.filter(x=>x.tabela===tabela.nome).sort((a,b)=>a.ordem-b.ordem);
 comandos.push(`CREATE TABLE ${nome(tabela)} (\n${cols.map(x=>` ${id(x.nome)} ${x.tipo}${x.default===null?'':' DEFAULT '+x.default}${x.not_null?' NOT NULL':''}`).join(',\n')}\n);`);
 if (tabela.rls) comandos.push(`ALTER TABLE ${nome(tabela)} ENABLE ROW LEVEL SECURITY;`);
}
for (const tipo of ['p','u','c','f']) for (const constraint of constraints.filter(x=>x.tipo===tipo)) comandos.push(`ALTER TABLE ${nome(constraint)} ADD CONSTRAINT ${id(constraint.nome)} ${constraint.definicao};`);
for (const indice of indices) if (!constraints.some(x=>x.tabela===indice.tabela&&x.nome===indice.nome&&['p','u'].includes(x.tipo))) comandos.push(indice.definicao+';');
for (const funcao of funcoes) comandos.push(funcao.definicao.replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION').trimEnd()+';');
for (const tabela of tabelas) {
 comandos.push(`REVOKE ALL ON TABLE ${nome(tabela)} FROM PUBLIC,anon,authenticated,service_role;`);
 for (const a of aclTabelas.filter(x=>x.objeto===tabela.nome&&x.papel!=='postgres')) comandos.push(`GRANT ${a.privilegio} ON TABLE ${nome(tabela)} TO ${a.papel==='PUBLIC'?'PUBLIC':id(a.papel)}${a.grant_option?' WITH GRANT OPTION':''};`);
}
for (const funcao of funcoes) {
 comandos.push(`REVOKE ALL ON FUNCTION public.${funcao.assinatura} FROM PUBLIC,anon,authenticated,service_role;`);
 for (const a of aclFuncoes.filter(x=>x.objeto===funcao.assinatura&&x.papel!=='postgres')) comandos.push(`GRANT ${a.privilegio} ON FUNCTION public.${funcao.assinatura} TO ${a.papel==='PUBLIC'?'PUBLIC':id(a.papel)}${a.grant_option?' WITH GRANT OPTION':''};`);
}
for (const p of policies) comandos.push(`CREATE POLICY ${id(p.nome)} ON ${nome(p)} AS ${p.permissiva} FOR ${p.comando} TO ${p.papeis.map(x=>x==='public'?'PUBLIC':id(x)).join(',')}${p.using===null?'':' USING ('+p.using+')'}${p.check===null?'':' WITH CHECK ('+p.check+')'};`);
for (const trigger of triggers) comandos.push(trigger.definicao+';');
const esperado = {
 colunas:[...d.colunas,...colunas], constraints:[...d.constraints,...constraints], indices:[...d.indices,...indices],
 policies, triggers:[...d.triggers,...triggers], acl_relacoes:[...d.acl_relacoes,...aclTabelas],
 acl_funcoes:[...d.acl_funcoes,...aclFuncoes], defaults_acl:d.defaults_acl,papeis:d.papeis,membros_papeis:d.membros_papeis,schemas:d.schemas
};
const relacoesEsperadas = [...d.relacoes,...tabelas.map(x=>({...x,opcoes:x.opcoes??null}))].map(({acl,...x})=>x);
const funcoesEsperadas = [...d.funcoes,...funcoes].map(x=>({esquema:x.esquema,assinatura:x.assinatura,dono:x.dono,retorno:x.retorno,security_definer:x.security_definer,strict:x.strict,volatilidade:x.volatilidade,configuracao:x.configuracao,hash_corpo_md5:x.hash_corpo_md5}));
const comparacoes = Object.entries(esperado).map(([secao,valor])=>` if jsonb_array_length(observado->${lit(secao)})<>${valor.length} or not (observado->${lit(secao)}) @> (esperado->${lit(secao)}) or not (esperado->${lit(secao)}) @> (observado->${lit(secao)}) then raise exception ${lit('Bootstrap divergente: '+secao)};end if;`).join('\n');
const gate = `do $verificar_bootstrap$
declare observado jsonb; relacoes jsonb; funcoes jsonb; tabela text; possui_linhas boolean;
 esperado jsonb := ${json({...esperado,relacoes:relacoesEsperadas,funcoes:funcoesEsperadas})};
begin
 ${posCte}
 select corpo into observado from catalogo;
${comparacoes}
 select jsonb_agg(x-'acl') into relacoes from jsonb_array_elements(observado->'relacoes') x;
 if jsonb_array_length(relacoes)<>${relacoesEsperadas.length} or not relacoes @> (esperado->'relacoes') or not (esperado->'relacoes') @> relacoes then raise exception 'Bootstrap divergente: relações/RLS';end if;
 select jsonb_agg(jsonb_build_object('esquema',x->'esquema','assinatura',x->'assinatura','dono',x->'dono','retorno',x->'retorno','security_definer',x->'security_definer','strict',x->'strict','volatilidade',x->'volatilidade','configuracao',x->'configuracao','hash_corpo_md5',x->'hash_corpo_md5')) into funcoes from jsonb_array_elements(observado->'funcoes') x;
 if jsonb_array_length(funcoes)<>${funcoesEsperadas.length} or not funcoes @> (esperado->'funcoes') or not (esperado->'funcoes') @> funcoes then raise exception 'Bootstrap divergente: funções/corpos';end if;
 for tabela in select unnest(array[${tabelas.map(x=>lit(x.nome)).join(',')}]::text[]) loop
  execute format('select exists(select 1 from public.%I)',tabela) into possui_linhas;
  if possui_linhas then raise exception 'Bootstrap deve terminar sem dados em tabelas públicas';end if;
 end loop;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) or exists(select 1 from storage.buckets) then raise exception 'Serviços gerenciados receberam dados inesperados';end if;
end
$verificar_bootstrap$;
select 'BOOTSTRAP_PREKIT_STAGING_OK' as resultado;
`;
const sql = `-- CANDIDATO STAGING; REVISÃO INDEPENDENTE ANTES DE APLICAR.
-- Único alvo: luguscapasskcsficckf / organização vhmjospwgiryrnrndkpd (Free).
-- Conferir a URL/identidade da conexão; rótulo em SQL não prova project_ref.
-- Nenhum dado copiado. Não executar em produção ou reaplicar após commit.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;
lock table auth.users,storage.objects,storage.buckets in access exclusive mode;
do $pre_bootstrap$
declare observado jsonb;
begin
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('server_version_num')<>'170011' then raise exception 'Executor/banco/versão fora do staging aprovado';end if;
 ${cte}
 select corpo into observado from catalogo;
 if md5(observado::text)<>'785cf53d0d88df117eff15085f879018' then raise exception 'Catálogo vazio de staging divergente; abortar sem contornar guarda';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')) or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')) then raise exception 'Schema public não está vazio';end if;
 if exists(select 1 from auth.users) or exists(select 1 from storage.objects) or exists(select 1 from storage.buckets) then raise exception 'Destino já contém dados de Auth/Storage';end if;
end
$pre_bootstrap$;

${comandos.join('\n\n')}

${gate}
notify pgrst,'reload schema';
commit;
`;
const pos = `-- Executar no mesmo staging após o bootstrap; somente leitura.
begin read only;
set local statement_timeout='30s';
set local lock_timeout='2s';
set local search_path=pg_catalog,public;
${gate}
commit;
`;
const manifesto = {estado:'candidato local, não aplicado',projeto:'luguscapasskcsficckf',organizacao:'vhmjospwgiryrnrndkpd',postgresDestino:'17.11',postgresOrigem:'17.6',catalogoDestinoMd5:destino.hash_catalogo_md5,insumos,bootstrapSha256:sha(sql),verificacaoSha256:sha(pos),tabelas:tabelas.map(x=>x.nome),funcoes:funcoes.map(x=>x.assinatura),policies:policies.map(x=>[x.esquema,x.tabela,x.nome].join('.')),triggers:triggers.map(x=>[x.esquema,x.tabela,x.nome].join('.')),dadosCopiados:false,defaultsRolesSchemasGerenciadosAlterados:false,limites:['Bootstrap do recorte, não restauração completa de produção.','Criar trigger da aplicação em auth.users não altera os corpos de Auth gerenciados.','Nenhum bucket/usuário/documento criado; fixtures virão depois.','O delta de produção permanece intacto; ainda não há variante de ensaio.']};
assert.deepEqual(process.argv.slice(2),['--emitir'], 'Usar somente --emitir; o script nunca aplica SQL');
const arquivos = {'01-bootstrap-prekit-staging-v2.sql':sql,'02-verificar-bootstrap-somente-leitura-v2.sql':pos,'bootstrap-manifesto-v2.json':JSON.stringify(manifesto,null,2)+'\n'};
for (const nomeArquivo of Object.keys(arquivos)) assert(!fs.existsSync(path.join(dir,nomeArquivo)),'Não sobrescrever '+nomeArquivo);
for (const [nomeArquivo,conteudo] of Object.entries(arquivos)) fs.writeFileSync(path.join(dir,nomeArquivo),conteudo,{flag:'wx'});
console.log(JSON.stringify({preparado:true,sqlExecutado:false,bootstrapSha256:manifesto.bootstrapSha256,tabelas:tabelas.length,funcoes:funcoes.length}));
