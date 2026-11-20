// Compara evidências já capturadas; não conecta nem executa SQL.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const insumos={};
const ler=(nome,hash)=>{const texto=fs.readFileSync(path.join(__dirname,nome),'utf8');insumos[nome]=sha(texto);if(hash)assert.equal(sha(texto),hash);return JSON.parse(texto);};
const pre=ler('catalogo-prekit-staging.json','5c607e56e58e7aa7b67d16baee150f26ff05e2b599809645777a12f6af51b9ad');
const pos=ler('catalogo-posdelta-staging.json','7d81af6a57cd1b7a6f57ab33f6f25c984443c472edeb0a4e8ed7c3ae869b0cf7');
const privilegios=ler('posdelta-privilegios-reais.json','baa5519cc6c0337551634597c339774045e48d9d4a101af2add3fb2a66cfb9fb');
const antes=ler('preflight-antes-delta.json');
const aposRejeicao=ler('preflight-apos-rejeicao-original.json');
const rejeicao=ler('delta-original-rejeitado.json');
const rollback=ler('delta-ensaio-rollback.json');
const aplicacao=ler('delta-aplicacao.json');
const manifesto=ler('delta-staging-manifesto.json');
let checks=0;
const igual=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
igual(pre.hash_catalogo_md5,'8abc338413ff0c60770d3aea1c3413d1');
igual(pos.hash_catalogo_md5,'830899ecee2a58d23beec619b4963fed');
for(const inventario of [pre,pos]){igual(inventario.read_only,'on');igual(inventario.server_version,'17.11');}
igual(rejeicao.projeto,'luguscapasskcsficckf');igual(rejeicao.sha256,manifesto.originalSha256);
igual(rejeicao.erro.includes('P0001: Catálogo divergente: abortado sem alteração. Capture novo inventário e revise o delta'),true);
for(const evidencia of [antes,aposRejeicao,rollback.resultadoFinalVisivel]) {
 igual(evidencia.resultado,'PREKIT_STAGING_CONFIRMADO');igual(evidencia.catalogo_md5,pre.hash_catalogo_md5);
 igual(evidencia.read_only,'on');igual(evidencia.tabelas_publicas_vazias,19);
 igual(evidencia.usuarios_auth,0);igual(evidencia.objetos_storage,0);igual(evidencia.bucket,antes.bucket);
}
igual(rollback.projeto,'luguscapasskcsficckf');igual(rollback.sqlSha256,manifesto.arquivos['04-ensaiar-delta-com-rollback-staging.sql']);
igual(aplicacao.projeto,'luguscapasskcsficckf');igual(aplicacao.resultado,'KIT_PREPUBLICACAO_OK');
igual(aplicacao.sqlSha256,manifesto.arquivos['03-delta-operacional-staging.sql']);igual(aplicacao.sqlComparadoIntegralmente,true);
igual(privilegios.resultado,'DELTA_STAGING_GATES_OK');igual(privilegios.read_only,'on');
igual(privilegios.tabelas_publicas_vazias,21);igual(privilegios.usuarios_auth,0);igual(privilegios.objetos_storage,0);igual(privilegios.bucket,antes.bucket);
const c=pre.catalogo,d=pos.catalogo;
const chave=x=>[x.esquema,x.tabela,x.nome,x.assinatura].join('.');
const preservados=[];
const acrescimos={};
const aclAlteradas=['bootstrap_operacao','eh_membro_operacao'];
for(const secao of ['colunas','indices','funcoes','relacoes','triggers','constraints']) {
 const antesMap=new Map(c[secao].map(x=>[chave(x),x]));
 const depoisMap=new Map(d[secao].map(x=>[chave(x),x]));
 igual(antesMap.size,c[secao].length);igual(depoisMap.size,d[secao].length);
 for(const [k,objeto] of antesMap) {
  const depois=depoisMap.get(k);assert(depois,'Objeto anterior ausente: '+secao+':'+k);
  if(secao==='funcoes'&&objeto.esquema==='public'&&aclAlteradas.includes(objeto.nome)) {
   const {acl:aclAntes,...antesSemAcl}=objeto;const {acl:aclDepois,...depoisSemAcl}=depois;
   igual(antesSemAcl,depoisSemAcl,'Só ACL pode mudar: '+k);igual(aclAntes===aclDepois,false);
  } else {igual(depois,objeto,'Objeto anterior mudou: '+secao+':'+k);preservados.push({secao,objeto:k});}
 }
 acrescimos[secao]=d[secao].filter(x=>!antesMap.has(chave(x))).map(chave);
}
igual(acrescimos.relacoes.sort(),['public..operacao_identificacao_empresa.','public..operacao_kit_documentos.']);
igual(acrescimos.funcoes.length,12);
for(const secao of ['defaults_acl','papeis','membros_papeis','schemas']) igual(d[secao],c[secao],'Seção global alterada: '+secao);
const tabelaExistente=new Set(c.relacoes.map(x=>x.esquema+'.'+x.nome));
igual(d.acl_relacoes.filter(x=>tabelaExistente.has(x.esquema+'.'+x.objeto)),c.acl_relacoes,'ACLs das relações existentes');
const funcoesExistentes=new Set(c.funcoes.map(x=>x.esquema+'.'+x.assinatura));
const aclEsperadas=c.acl_funcoes.filter(x=>!(x.esquema==='public'&&['bootstrap_operacao()','eh_membro_operacao(uuid)'].includes(x.objeto)&&['PUBLIC','anon'].includes(x.papel)));
igual(d.acl_funcoes.filter(x=>funcoesExistentes.has(x.esquema+'.'+x.objeto)),aclEsperadas,'ACLs anteriores: só retirar PUBLIC/anon dos dois helpers');
const removidas=c.acl_funcoes.filter(x=>!aclEsperadas.includes(x));igual(removidas.length,4);
const sql=fs.readFileSync(path.join(__dirname,'../../migracoes-capacidade-20261031/02-delta-operacional.sql'),'utf8');
igual(sha(sql),manifesto.originalSha256);
const politicaLiteral=/if politicas is distinct from '((?:[^']|'')*)'::jsonb/.exec(sql);assert(politicaLiteral);
const politicasEsperadas=JSON.parse(politicaLiteral[1].replaceAll("''","'"));
const noGate=x=>x.esquema==='storage'&&x.tabela==='objects'||x.esquema==='public'&&x.tabela.startsWith('operacao_')&&!['operacao_identificacao_empresa','operacao_kit_documentos'].includes(x.tabela);
igual(d.policies.filter(noGate),politicasEsperadas,'Policies operacionais devem coincidir com o gate original');
const foraGate=x=>!noGate(x)&&!['operacao_identificacao_empresa','operacao_kit_documentos'].includes(x.tabela);
igual(d.policies.filter(foraGate),c.policies.filter(foraGate),'Policies preexistentes fora do delta');
igual(d.policies.filter(x=>['operacao_identificacao_empresa','operacao_kit_documentos'].includes(x.tabela)).map(x=>x.nome).sort(),['identificacao_empresa_leitura','operacao_kit_documentos_select_empresa']);
igual(privilegios.privilegios_tabelas.length,54);
igual(new Set(privilegios.privilegios_tabelas.map(x=>[x.papel,x.tabela,x.privilegio].join(':'))).size,54);
for(const p of privilegios.privilegios_tabelas) {
 const permitido=p.papel!=='anon'&&(p.tabela==='public.operacao_kit_documentos'?p.privilegio==='SELECT':p.papel==='authenticated'?p.privilegio==='SELECT':p.privilegio!=='SELECT WITH GRANT OPTION');
 igual(p.permitido,permitido,'Privilégio efetivo divergente: '+JSON.stringify(p));
}
igual(privilegios.execucao_funcoes.length,18);
igual(new Set(privilegios.execucao_funcoes.map(x=>x.papel+':'+x.funcao)).size,18);
for(const p of privilegios.execucao_funcoes) igual(p.execute,p.papel==='service_role'&&/^public\.(confirmar_identificacao_empresa|gravar_kit_documento)\(/.test(p.funcao),'EXECUTE divergente: '+JSON.stringify(p));
const resultado={aprovado:true,checks,sqlExecutadoPorEsteComparador:false,insumos,antesMd5:pre.hash_catalogo_md5,depoisMd5:pos.hash_catalogo_md5,objetosAnterioresPreservados:preservados.length,preservados,acrescimos,aclHelpersRemovidas:removidas,
 dados:{tabelasAnterioresVazias:19,tabelasDepoisVazias:21,usuariosAuth:0,objetosStorage:0,bucket:antes.bucket},privilegiosVerificados:{tabelas:54,funcoes:18},
 limites:['Preservação de fixture vazia e metadados do recorte; nenhum dado de produção foi copiado.','dados_robo e admin_tem_permissao não integram o catálogo original; vazio de dados_robo foi checado nos gates.','Rollback de DDL não comprova restauração de backup.','Sem emissão JWT, login, rotas HTTP, upload ou isolamento por CNPJ com linhas reais.','Editor mostrou a última consulta do ensaio; retorno pós-rollback e sucesso integral estão arquivados.']};
const saida=path.join(__dirname,'comparacao-pre-posdelta-staging.json');assert(!fs.existsSync(saida),'Não sobrescrever evidência');
fs.writeFileSync(saida,JSON.stringify(resultado,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({aprovado:true,checks,objetosPreservados:preservados.length,acrescimos:Object.fromEntries(Object.entries(acrescimos).map(([k,v])=>[k,v.length])),privilegios:resultado.privilegiosVerificados}));
