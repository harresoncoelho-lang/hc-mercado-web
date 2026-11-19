const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const AdmZip=require('adm-zip');
const {handler}=require('../kit-documentos');
const {montarDocx}=require('../gerar-checklist');
const {preencherVariaveis,variaveis,idDeterministico,escaparChaves,preencherLacunas}=require('../_kit_declaracoes');
const ids={empresa:'11111111-1111-1111-1111-111111111111',processo:'22222222-2222-2222-2222-222222222222',item:'33333333-3333-3333-3333-333333333333',org:'44444444-4444-4444-4444-444444444444',doc:'55555555-5555-5555-5555-555555555555'};
const CPF='52998224725';
// PNG mínimo: assinatura + IHDR 300x100 (só o cabeçalho é lido).
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13]),Buffer.from('IHDR'),Buffer.from([0,0,1,0x2c,0,0,0,100,8,6,0,0,0])]);
const sha=b=>createHash('sha256').update(b).digest('hex');
function projetar(url,rows){const sel=new URL(url).searchParams.get('select');if(!sel)return rows;const campos=sel.split(',').map(c=>c.split(':')[0]);return rows.map(r=>Object.fromEntries(campos.filter(c=>c in r).map(c=>[c,r[c]])));}
function fixture(t,changes={}){
 const logoCaminho=`${ids.org}/${ids.empresa}/perfil/logo-${sha(PNG)}.png`;
 const state={empresa:{id:ids.empresa,organizacao_id:ids.org,razao_social:'Empresa QA',cnpj:'11222333000181'},
  perfil:{empresa_id:ids.empresa,organizacao_id:ids.org,versao:1,confirmado_em:'2026-10-27',dados_confirmados:{endereco:'Rua QA, 1',representante:'Ana',cargo:'Sócia'},proveniencia:[]},
  perfilEmpresa:{nome_fantasia:'QA',telefone:'(92) 3333-4444',email:'qa@example.invalid',inscricao_estadual:null,inscricao_municipal:'123',porte:'me',cpf_representante:CPF,logo_caminho:logoCaminho,logo_hash:sha(PNG)},
  membro:{usuario_id:'usuario',organizacao_id:ids.org,empresa_id:ids.empresa,papel:'operador'},
  processo:{id:ids.processo,organizacao_id:ids.org,empresa_id:ids.empresa,numero:'90001/2026',orgao:'Órgão QA',documentos_exigidos:[],objeto:'Material de expediente'},
  itens:[{id:ids.item,organizacao_id:ids.org,processo_id:ids.processo,tipo:'item',identificador:'1',descricao:'Caneta',quantidade:'2.000',valor_unitario_proposta:'1.25'}],
  kit:[],userId:'usuario',selectsPerfil:[],logo:PNG,...changes};
 t.mock.method(global,'fetch',async(url,op={})=>{
  assert.equal(op.headers.Authorization,url.includes('/rpc/gravar_kit')?'Bearer QA_SERVICE':'Bearer QA');let data;
  if(url.includes('/auth/v1/user'))data={id:state.userId};
  else if(url.includes('/rpc/gravar_kit_declaracao_modelo')){
   if(state.semSql)return new Response('{}',{status:404});
   const p=JSON.parse(op.body);let d=state.kit.find(d=>d.id===p.p_documento);
   if(!d){d={id:p.p_documento,empresa_id:p.p_empresa,processo_id:p.p_processo,organizacao_id:p.p_organizacao,tipo:'declaracao',dados:p.p_dados,versao:1,criado_por:p.p_usuario,atualizado_por:p.p_usuario,criado_em:'2026-11-18',atualizado_em:'2026-11-18',revisao_hash:null,modelo_codigo:p.p_modelo,formato:2};state.kit.push(d);}
   else if(d.criado_por!==p.p_usuario||JSON.stringify(d.dados)!==JSON.stringify(p.p_dados)||d.versao!==1)return new Response('{}',{status:409});
   data=d;
  }
  else if(url.includes('/rpc/gravar_kit_documento')){
   const p=JSON.parse(op.body);let d=state.kit.find(d=>d.id===p.p_documento);
   if(p.p_acao==='salvar'&&p.p_versao===0&&!d){d={id:p.p_documento,empresa_id:p.p_empresa,processo_id:p.p_processo,organizacao_id:p.p_organizacao,tipo:p.p_tipo,dados:p.p_dados,versao:1,criado_por:p.p_usuario,atualizado_por:p.p_usuario,criado_em:'2026-11-18',atualizado_em:'2026-11-18',revisao_hash:null};state.kit.push(d);}
   else if(!d||d.versao!==p.p_versao)return new Response('{}',{status:409});
   else if(p.p_acao==='confirmarRevisao')Object.assign(d,{revisao_hash:p.p_hash,revisao_previa:p.p_previa,revisado_por:p.p_usuario,revisado_em:'2026-11-18',revisao_versao:d.versao});
   data=d;
  }
  else if(url.includes('/operacao_kit_documentos?')){const q=new URL(url).searchParams;data=state.kit.filter(d=>['id','empresa_id','organizacao_id','processo_id'].every(k=>!q.has(k)||q.get(k)==='eq.'+d[k]));}
  else if(url.includes('/rpc/identificacao_empresa_habilitada'))data=true;
  else if(url.includes('/clientes?'))data=[{status:'aprovado'}];
  else if(url.includes('/operacao_empresas?'))data=[state.empresa];
  else if(url.includes('/operacao_membros?'))data=[state.membro];
  else if(url.includes('/operacao_identificacao_empresa?'))data=[state.perfil];
  else if(url.includes('/operacao_documentos?'))data=[];
  else if(url.includes('/operacao_perfil_empresa?')){state.selectsPerfil.push(new URL(url).searchParams.get('select'));if(state.semPerfil)return new Response('{}',{status:404});data=projetar(url,[state.perfilEmpresa]);}
  else if(url.includes('/operacao_processos?'))data=projetar(url,[state.processo]);
  else if(url.includes('/operacao_origens_pncp?'))return new Response('[]',{headers:{'Content-Range':'*/0','Preference-Applied':'count=exact'}});
  else if(url.includes('/operacao_itens_resultado?')){const q=new URL(url).searchParams;data=projetar(url,state.itens.filter(i=>!q.get('id')?.startsWith('in.(')||q.get('id').slice(4,-1).split(',').includes(i.id)));}
  else if(url.includes('/storage/v1/object/authenticated/operacao-documentos/'+state.perfilEmpresa.logo_caminho))return new Response(state.logo,{headers:{'content-length':String(state.logo.length)}});
  else throw new Error('URL inesperada '+url);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 });
 for(const [k,v] of [['IDENTIFICACAO_EMPRESA_LOCAL','1'],['SUPABASE_SERVICE_ROLE_KEY','QA_SERVICE']]){const old=process.env[k];process.env[k]=v;t.after(()=>{if(old===undefined)delete process.env[k];else process.env[k]=old;});}
 const run=async patch=>{const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer QA'},body:JSON.stringify({empresaId:ids.empresa,processoId:ids.processo,...patch})});return {...r,json:JSON.parse(r.body)};};
 return {state,run};
}
const lote=declaracoes=>({acao:'gerarDeclaracoesLote',declaracoes});
const zipDe=b64=>new AdmZip(Buffer.from(b64,'base64'));
// Prepara e confirma a revisão de uma peça já salva.
async function revisar(f,documentoId){const p=await f.run({acao:'preparar',documentoId,versaoEsperada:1});assert.equal(p.statusCode,200,JSON.stringify(p.json));return f.run({acao:'confirmarRevisao',documentoId,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});}

test('variáveis do perfil preenchem o modelo; sem valor vira [PREENCHER: campo]; CPF fica marcador',()=>{
 const vars=variaveis({empresa:{razao_social:'Empresa {{cnpj}} QA',cnpj:'11222333000181'},processo:{numero:'1/2026',orgao:null},identificacao:{endereco:'Rua 1',representante:'Ana',cargo:'Sócia'},perfilEmpresa:{porte:'epp',cpf_representante:CPF,telefone:'(92) 3333-4444'},objeto:''});
 const t=preencherVariaveis('{{razao_social}}|{{cnpj}}|{{ cpf_representante }}|{{porte}}|{{orgao}}|{{objeto}}|{{cidade}}|{{data}}|{{email}}|{{telefone}}|{{desconhecida}}',vars);
 assert.equal(t,'Empresa cnpj QA|11.222.333/0001-81|{{cpf_representante}}|empresa de pequeno porte (EPP)|[PREENCHER: órgão]|[PREENCHER: objeto]|[PREENCHER: cidade]|[PREENCHER: data]|[PREENCHER: e-mail]|(92) 3333-4444|{{desconhecida}}');
 assert.match(preencherVariaveis('{{porte}}',variaveis({empresa:{},processo:{},perfilEmpresa:{porte:'demais'}})),/^\[PREENCHER: porte\]$/);
 assert.match(preencherVariaveis('{{cnpj}}',variaveis({empresa:{cnpj:'123'},processo:{}})),/PREENCHER: CNPJ/);
 // Texto do edital não puxa variável: chaves duplas viram "{ {" / "} }".
 assert.equal(escaparChaves('a {{cpf_representante}} b {{{x}}}'),'a { {cpf_representante} } b { { {x} } }');
 assert.doesNotMatch(escaparChaves('{{{{a}}}}'),/\{\{|\}\}/);
});

test('lote grava rascunhos com modelo, é idempotente por processo+modelo e CPF não vaza para logs nem resposta',async t=>{
 const f=fixture(t);const logs=[];for(const m of ['log','info','warn','error','debug'])t.mock.method(console,m,(...a)=>logs.push(a.map(String).join(' ')));
 const pedido=lote([{modeloCodigo:'HAB_ART63_I'},{modeloCodigo:'ME_EPP_ENQUADRAMENTO'},{modeloCodigo:'edital',titulo:'Anexo III',texto:'DECLARAÇÃO I\nDeclaramos para o edital.'}]);
 const r=await f.run(pedido);assert.equal(r.statusCode,200,r.body);
 assert.equal(r.json.criados.length,3);assert.equal(r.json.existentes.length,0);
 assert.deepEqual(r.json.criados.map(d=>d.modeloCodigo),['HAB_ART63_I','ME_EPP_ENQUADRAMENTO','edital']);
 assert.ok(r.json.criados.every(d=>d.dados===undefined&&d.revisadoPor===null));
 const art63=f.state.kit[0].dados.declaracao;
 assert.match(art63.texto,/^Empresa QA, inscrita no CNPJ sob o nº 11\.222\.333\/0001-81, com sede em Rua QA, 1, neste ato representada por Ana, Sócia, inscrito\(a\) no CPF sob o nº \{\{cpf_representante\}\}, para fins de participação no processo licitatório nº 90001\/2026, promovido por Órgão QA, cujo objeto é Material de expediente/);
 assert.match(art63.texto,/\[PREENCHER: cidade\], \[PREENCHER: data\]/);assert.doesNotMatch(art63.texto.replace('{{cpf_representante}}',''),/\{\{|\b____\b/);
 assert.match(f.state.kit[1].dados.declaracao.texto,/condição de microempresa \(ME\)/);
 assert.equal(f.state.kit[2].dados.declaracao.texto,'DECLARAÇÃO I\nDeclaramos para o edital.');
 assert.ok(!f.state.selectsPerfil.some(s=>s.includes('cpf')),'lote não lê CPF');
 // Reenvio (mesmo ou outro usuário): nada novo é gravado.
 const again=await f.run(pedido);assert.equal(again.statusCode,200);assert.equal(again.json.criados.length,0);assert.equal(again.json.existentes.length,3);assert.equal(f.state.kit.length,3);
 f.state.userId='outro';f.state.membro.usuario_id='outro';
 assert.equal((await f.run(lote([{modeloCodigo:'HAB_ART63_I'}]))).json.existentes[0].documentoId,f.state.kit[0].id);assert.equal(f.state.kit.length,3);
 // Corrida: o id determinístico já existe com dados de outra pessoa → 409 do banco vira "existente".
 f.state.kit=f.state.kit.filter(d=>d.modelo_codigo!=='TRAB_MENOR');
 f.state.kit.push({id:idDeterministico(ids.processo,'TRAB_MENOR'),tipo:'declaracao',dados:{},versao:2,criado_por:'usuario',empresa_id:'x',processo_id:'x',organizacao_id:'x'});
 const corrida=await f.run(lote([{modeloCodigo:'TRAB_MENOR'}]));assert.equal(corrida.statusCode,200);assert.equal(corrida.json.existentes.length,1);
 const tudo=JSON.stringify([r.json,again.json,corrida.json,f.state.kit])+logs.join('\n');
 assert.ok(!tudo.includes(CPF)&&!tudo.includes('529.982.247-25'),'CPF fora do rascunho, da resposta e dos logs');
});

test('lote nunca lê CPF e texto do edital não puxa variável; limite de 30, duplicata e campos forjados são recusados sem gravar',async t=>{
 const f=fixture(t);
 const sem=await f.run(lote([{modeloCodigo:'edital',titulo:'Modelo do edital',texto:'Declaro que {{razao_social}}, CPF {{cpf_representante}}, atende.'}]));
 assert.equal(sem.statusCode,200);assert.ok(!f.state.selectsPerfil[0].includes('cpf'));assert.equal(f.state.kit[0].dados.declaracao.texto,'Declaro que { {razao_social} }, CPF { {cpf_representante} }, atende.');
 const trinta=Array.from({length:30},(_,n)=>({modeloCodigo:'livre',titulo:`D${n}`,texto:`Texto ${n}`}));
 assert.equal((await f.run(lote(trinta))).json.criados.length,30);
 f.state.kit=[];
 for(const pedido of [lote([...trinta,{modeloCodigo:'livre',titulo:'x',texto:'y'}]),lote([]),lote([{modeloCodigo:'HAB_ART63_I'},{modeloCodigo:'HAB_ART63_I'}]),lote([{modeloCodigo:'HAB_ART63_I',texto:'forjado'}]),lote([{modeloCodigo:'NAO_EXISTE'}]),lote([{modeloCodigo:'edital',titulo:'x',texto:' '}]),{...lote([{modeloCodigo:'HAB_ART63_I'}]),documentoId:ids.doc}])
  assert.equal((await f.run(pedido)).statusCode,400);
 assert.equal(f.state.kit.length,0);
 f.state.semSql=true;assert.equal((await f.run(lote([{modeloCodigo:'HAB_ART63_I'}]))).statusCode,503);
 // Sem a tabela do perfil, o lote sai com marcadores em vez de falhar; o CPF segue como marcador.
 delete f.state.semSql;f.state.semPerfil=true;assert.equal((await f.run(lote([{modeloCodigo:'TRAB_MENOR'}]))).statusCode,200);assert.match(f.state.kit[0].dados.declaracao.texto,/\{\{cpf_representante\}\}/);
});

test('marcador [PREENCHER] aparece na prévia mas bloqueia revisão',async t=>{
 const f=fixture(t);await f.run(lote([{modeloCodigo:'HAB_ART63_I'}]));const id=f.state.kit[0].id;
 const p=await f.run({acao:'preparar',documentoId:id,versaoEsperada:1});assert.equal(p.statusCode,200);assert.match(p.json.previa.texto,/\[PREENCHER: cidade\]/);
 const c=await f.run({acao:'confirmarRevisao',documentoId:id,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(c.statusCode,422);assert.match(c.json.pendencias[0],/PREENCHER/);
});

test('exportação em um DOCX só leva as declarações revisadas por quem exporta, com a logo no cabeçalho',async t=>{
 const f=fixture(t);
 await f.run(lote([{modeloCodigo:'livre',titulo:'Revisada A',texto:'Declaro A por {{razao_social}}.'},{modeloCodigo:'livre',titulo:'Sem revisão',texto:'NAO_REVISADA_B'},{modeloCodigo:'livre',titulo:'Revisada C',texto:'Declaro C.'}]));
 const [a,b,c]=f.state.kit.map(d=>d.id);
 assert.equal((await f.run({acao:'exportarDeclaracoes'})).statusCode,422);
 assert.equal((await revisar(f,a)).statusCode,200);assert.equal((await revisar(f,c)).statusCode,200);
 const x=await f.run({acao:'exportarDeclaracoes'});assert.equal(x.statusCode,200,x.body);
 assert.deepEqual(x.json.incluidas,[a,c]);assert.deepEqual(x.json.ignoradas,[{documentoId:b,motivo:'nao_revisada'}]);assert.equal(x.json.logoAplicada,true);
 const zip=zipDe(x.json.arquivoBase64),doc=zip.readAsText('word/document.xml');
 assert.match(doc,/Declaro A por \{ \{razao_social\} \}\./);assert.match(doc,/Declaro C\./);assert.doesNotMatch(doc,/NAO_REVISADA_B/);
 assert.equal((doc.match(/w:type="page"/g)||[]).length,1);
 assert.ok(zip.getEntry('word/media/logo.png').getData().equals(PNG));
 // Seleção explícita: a não revisada continua fora; revisão de outro usuário não vale para quem exporta.
 const so=await f.run({acao:'exportarDeclaracoes',documentoIds:[b,c]});assert.deepEqual(so.json.incluidas,[c]);
 assert.equal((await f.run({acao:'exportarDeclaracoes',documentoIds:[b]})).statusCode,422);
 assert.equal((await f.run({acao:'exportarDeclaracoes',documentoIds:[ids.doc]})).statusCode,404);
 assert.equal((await f.run({acao:'exportarDeclaracoes',documentoIds:Array(31).fill(a)})).statusCode,400);
 f.state.userId='outro';f.state.membro.usuario_id='outro';assert.equal((await f.run({acao:'exportarDeclaracoes'})).statusCode,422);
 f.state.userId='usuario';f.state.membro.usuario_id='usuario';
 // Perfil mudou depois da revisão: a peça deixa de ser vigente e sai da exportação.
 assert.equal((await f.run({acao:'exportarDeclaracoes',documentoIds:[a]})).statusCode,200);
 f.state.perfil.dados_confirmados.representante='Bia';const mudou=await f.run({acao:'exportarDeclaracoes',documentoIds:[a]});
 assert.equal(mudou.statusCode,422);assert.deepEqual(mudou.json.ignoradas,[{documentoId:a,motivo:'nao_revisada'}]);
});

test('CPF: rascunho, prévia e revisão guardam só o marcador; a exportação leva o CPF lido na hora',async t=>{
 const f=fixture(t);
 const s=await f.run({acao:'salvar',documentoId:ids.doc,versaoEsperada:0,tipo:'declaracao',declaracao:{titulo:'Declaração QA',texto:'Eu, {{representante}}, CPF {{cpf_representante}}, declaro.'}});assert.equal(s.statusCode,200,s.body);
 const p=await f.run({acao:'preparar',documentoId:ids.doc,versaoEsperada:1});assert.equal(p.statusCode,200,p.body);
 assert.match(p.json.previa.texto,/Eu, Ana, CPF \[CPF do representante\], declaro\./);
 const c=await f.run({acao:'confirmarRevisao',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(c.statusCode,200,c.body);
 const semCpf=x=>!JSON.stringify(x).includes(CPF)&&!JSON.stringify(x).includes('529.982.247-25');
 assert.ok(semCpf(f.state.kit)&&semCpf(p.json)&&semCpf(c.json),'rascunho, revisao_previa e respostas sem CPF');
 assert.ok(!f.state.selectsPerfil.some(x=>x.includes('cpf')),'CPF não lido antes da exportação');
 const um=await f.run({acao:'exportar',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(um.statusCode,200,um.body);
 assert.match(zipDe(um.json.arquivoBase64).readAsText('word/document.xml'),/Eu, Ana, CPF 529\.982\.247-25, declaro\./);
 const lote=await f.run({acao:'exportarDeclaracoes'});assert.equal(lote.statusCode,200,lote.body);assert.deepEqual(lote.json.incluidas,[ids.doc]);
 assert.match(zipDe(lote.json.arquivoBase64).readAsText('word/document.xml'),/CPF 529\.982\.247-25/);
 assert.ok(f.state.selectsPerfil.includes('cpf_representante'));assert.ok(semCpf(f.state.kit),'exportar não grava o CPF');
 // CPF apagado no Perfil: some das exportações seguintes, sem nova revisão.
 f.state.perfilEmpresa.cpf_representante=null;
 const sem=await f.run({acao:'exportar',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});
 assert.equal(sem.statusCode,409);assert.match(sem.json.erro,/CPF do representante no Perfil/);
 const loteSem=await f.run({acao:'exportarDeclaracoes'});assert.equal(loteSem.statusCode,422);assert.deepEqual(loteSem.json.ignoradas,[{documentoId:ids.doc,motivo:'campos_pendentes'}]);
});

test('logo inválida ou com hash divergente: documento sai sem logo, como antes',async t=>{
 const f=fixture(t);await f.run(lote([{modeloCodigo:'livre',titulo:'A',texto:'Declaro A.'}]));await revisar(f,f.state.kit[0].id);
 f.state.logo=Buffer.from('nao e png');
 const x=await f.run({acao:'exportarDeclaracoes'});assert.equal(x.statusCode,200);assert.equal(x.json.logoAplicada,false);
 const zip=zipDe(x.json.arquivoBase64);assert.equal(zip.getEntry('word/media/logo.png'),null);assert.equal(zip.getEntry('word/header1.xml'),null);
});

test('montarDocx: com logo cria mídia, cabeçalho e relações; sem logo o pacote é o de hoje',()=>{
 const minuta={texto:'Linha 1\nLinha 2',preservarLinhas:true};
 const sem=new AdmZip(montarDocx({}, {}, minuta,'T'));
 assert.deepEqual(sem.getEntries().map(e=>e.entryName).sort(),['[Content_Types].xml','_rels/.rels','docProps/app.xml','docProps/core.xml','word/_rels/document.xml.rels','word/document.xml','word/styles.xml']);
 assert.doesNotMatch(sem.readAsText('word/document.xml'),/headerReference|xmlns:r=/);
 const com=new AdmZip(montarDocx({}, {}, minuta,'T',{logo:{bytes:PNG,tipo:'image/png',largura:300,altura:100}}));
 assert.ok(com.getEntry('word/media/logo.png').getData().equals(PNG));
 assert.match(com.readAsText('word/_rels/document.xml.rels'),/Id="rId2" Type="[^"]+\/header" Target="header1.xml"/);
 assert.match(com.readAsText('word/_rels/header1.xml.rels'),/Id="rIdLogo" Type="[^"]+\/image" Target="media\/logo.png"/);
 assert.match(com.readAsText('word/header1.xml'),/r:embed="rIdLogo"/);assert.match(com.readAsText('word/header1.xml'),/cx="1440000" cy="480000"/);
 assert.match(com.readAsText('word/document.xml'),/<w:headerReference w:type="default" r:id="rId2"\/>/);
 assert.match(com.readAsText('[Content_Types].xml'),/Extension="png" ContentType="image\/png".*\/word\/header1.xml/);
 const jpg=new AdmZip(montarDocx({}, {}, minuta,'T',{logo:{bytes:Buffer.from([0xff,0xd8]),tipo:'image/jpeg',largura:10,altura:10}}));assert.ok(jpg.getEntry('word/media/logo.jpeg'));
 // Corpo igual com e sem logo.
 const corpo=z=>z.readAsText('word/document.xml').replace(/<w:sectPr>.*$/,'').replace(/^.*<w:body>/,'');assert.equal(corpo(com),corpo(sem));
});

test('proposta em tabela só para peça nova (formato 2); peça antiga continua em texto corrido',async t=>{
 const f=fixture(t);const proposta={itemIds:[ids.item],unidades:{[ids.item]:'un'},validade:'30 dias',prazoEntrega:'10 dias',pagamento:'À vista'};
 assert.equal((await f.run({acao:'salvar',documentoId:ids.doc,versaoEsperada:0,tipo:'proposta',proposta})).statusCode,200);
 const exportar=async()=>{const p=await f.run({acao:'preparar',documentoId:ids.doc,versaoEsperada:1});await f.run({acao:'confirmarRevisao',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});const x=await f.run({acao:'exportar',documentoId:ids.doc,versaoEsperada:1,revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(x.statusCode,200,x.body);return {doc:zipDe(x.json.arquivoBase64).readAsText('word/document.xml'),previa:p.json.previa.texto,hash:p.json.revisaoHash};};
 const antigo=await exportar();
 assert.doesNotMatch(antigo.doc,/<w:tblHeader\/>|Marca \/ modelo/);assert.match(antigo.doc,/Unitário ofertado: R\$ 1,25/);
 // Formato 1 fixo: "Item <id>: <descrição>" com espaço (regressão B4).
 assert.match(antigo.previa,/\nItem 1: Caneta\nQuantidade: 2,000 \| Unidade informada pelo usuário: un\nMarca: não informada \| Modelo: não informado\nUnitário ofertado: R\$ 1,25 \| Total: R\$ 2,50\n/);
 f.state.kit[0].formato=2;f.state.kit[0].revisao_hash=null;
 const novo=await exportar();
 assert.match(novo.doc,/<w:tblHeader\/>/);assert.match(novo.doc,/Marca \/ modelo/);assert.match(novo.doc,/>Caneta</);assert.match(novo.doc,/>2,50</);assert.match(novo.doc,/Total da proposta: R\$ 2,50/);
 // Prévia e hash não mudam com o formato (revisões antigas continuam valendo).
 assert.equal(novo.previa,antigo.previa);assert.equal(novo.hash,antigo.hash);
 const lista=await f.run({acao:'listar'});assert.equal(lista.json.documentos[0].formato,2);assert.equal(lista.json.documentos[0].modeloCodigo,null);
});
test('lacunas do modelo do edital: rótulo inequívoco vira variável, o resto vira [PREENCHER: campo]; CPF só o do representante e como marcador',()=>{
 const t=preencherLacunas(escaparChaves('A empresa [nome da empresa], inscrita no CNPJ sob o nº ________, com sede em (endereço completo), neste ato representada por seu representante legal ________, portador do CPF nº ________, cargo: ____.'));
 assert.equal(t,'A empresa {{razao_social}}, inscrita no CNPJ sob o nº {{cnpj}}, com sede em {{endereco}}, neste ato representada por seu representante legal {{representante}}, portador do CPF nº {{cpf_representante}}, cargo: {{cargo}}.');
 assert.equal(preencherLacunas('Razão Social: ______\nCNPJ/MF: ______\n[CNPJ]'),'Razão Social: {{razao_social}}\nCNPJ/MF: {{cnpj}}\n{{cnpj}}');
 // Negativos: ambíguo, CPF de terceiro, palavra colada, assinatura e lacuna sem rótulo.
 assert.equal(preencherLacunas('CNPJ/CPF nº ______'),'CNPJ/CPF nº [PREENCHER: campo]');
 assert.equal(preencherLacunas('Nome do parente: ______ CPF: ______ Grau: ______'),'Nome do parente: [PREENCHER: campo] CPF: [PREENCHER: campo] Grau: [PREENCHER: campo]');
 assert.equal(preencherLacunas('encargo ______'),'encargo [PREENCHER: campo]');
 assert.equal(preencherLacunas('RG nº ______, data ____'),'RG nº [PREENCHER: campo], data [PREENCHER: campo]');
 assert.equal(preencherLacunas('______________________\nAssinatura: ________'),'______________________\nAssinatura: ________');
 assert.equal(preencherLacunas('Texto sem lacuna (razão social do contratado é exigida).'),'Texto sem lacuna (razão social do contratado é exigida).');
 // Chave plantada no edital continua escapada: a lacuna não reabre variável.
 assert.equal(preencherLacunas(escaparChaves('{{cpf_representante}} ___')),'{ {cpf_representante} } [PREENCHER: campo]');
});
test('lote: modelo do edital ganha os dados da empresa nas lacunas; texto livre não',async t=>{
 const f=fixture(t);
 const r=await f.run(lote([{modeloCodigo:'edital',titulo:'Anexo III',texto:'A empresa ________, inscrita no CNPJ sob o nº ________, representada por seu representante legal ______, CPF nº ______, declara.',fonte:'Modelo do próprio edital (texto literal): Edital (#1), pág. 30. Confira com o original.'},
  {modeloCodigo:'livre',titulo:'Livre',texto:'Razão Social: ______'}]));
 assert.equal(r.statusCode,200,r.body);
 const [edital,livre]=f.state.kit.map(d=>d.dados.declaracao);
 assert.equal(edital.texto,'A empresa [PREENCHER: campo], inscrita no CNPJ sob o nº 11.222.333/0001-81, representada por seu representante legal Ana, CPF nº {{cpf_representante}}, declara.');
 assert.equal(edital.fonte,'Modelo do próprio edital (texto literal): Edital (#1), pág. 30. Confira com o original.');
 assert.equal(livre.texto,'Razão Social: ______');
 assert.ok(!JSON.stringify(f.state.kit).includes('529.982.247-25'));
});
