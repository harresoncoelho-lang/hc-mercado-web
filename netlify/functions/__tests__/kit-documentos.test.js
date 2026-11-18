const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {handler}=require('../kit-documentos');
const ids={empresa:'11111111-1111-1111-1111-111111111111',processo:'22222222-2222-2222-2222-222222222222',item:'33333333-3333-3333-3333-333333333333',org:'44444444-4444-4444-4444-444444444444'};
function fixture(t,changes={}){
 const empresa={id:ids.empresa,organizacao_id:ids.org,razao_social:'Empresa QA',cnpj:'11222333000181'};
 const perfil={empresa_id:ids.empresa,organizacao_id:ids.org,versao:1,confirmado_em:'2026-10-27',dados_confirmados:{endereco:'Rua QA',representante:'Ana',cargo:'Sócia'},proveniencia:[]};
 const state={empresa,perfil,gate:true,aprovado:true,membro:{usuario_id:'usuario',organizacao_id:ids.org,empresa_id:ids.empresa,papel:'operador'},processo:{id:ids.processo,organizacao_id:ids.org,empresa_id:ids.empresa,numero:'1',orgao:'Órgão',documentos_exigidos:['Declaração']},itens:[{id:ids.item,organizacao_id:ids.org,processo_id:ids.processo,tipo:'item',identificador:'1',descricao:'Material',quantidade:'2.000',valor_unitario_proposta:'1.25'}],documentos:[],...changes};
 state.kit=[];state.userId='usuario';
 const calls=[];t.mock.method(global,'fetch',async(url,op={})=>{calls.push([url,op]);assert.equal(op.headers.Authorization,url.includes('/rpc/gravar_kit_documento')?'Bearer QA_SERVICE':'Bearer QA');let data;
 if(url.includes('/auth/v1/user'))data={id:state.userId};
 else if(url.includes('/rpc/gravar_kit_documento')){
 const p=JSON.parse(op.body);let d=state.kit.find(d=>d.id===p.p_documento);
 if(state.rpcStatus)return new Response('{}',{status:state.rpcStatus});
 if(p.p_acao==='salvar'&&p.p_versao===0&&!d){d={id:p.p_documento,empresa_id:p.p_empresa,processo_id:p.p_processo,organizacao_id:p.p_organizacao,tipo:p.p_tipo,dados:p.p_dados,versao:1,criado_por:p.p_usuario,atualizado_por:p.p_usuario,criado_em:'2026-10-30',atualizado_em:'2026-10-30',revisao_hash:null};state.kit.push(d);}
 else if(p.p_acao==='salvar'&&p.p_versao===0&&d.versao===1&&d.criado_por===p.p_usuario&&JSON.stringify(d.dados)===JSON.stringify(p.p_dados)){/* Retentativa recupera a mesma peça. */}
 else if(!d||d.versao!==p.p_versao||d.tipo!==p.p_tipo||d.empresa_id!==p.p_empresa||d.processo_id!==p.p_processo)return new Response('{}',{status:409});
 else if(p.p_acao==='salvar')Object.assign(d,{dados:p.p_dados,versao:d.versao+1,revisao_hash:null,revisao_previa:null,revisado_por:null,revisado_em:null,revisao_versao:null});
 else Object.assign(d,{revisao_hash:p.p_hash,revisao_previa:p.p_previa,revisado_por:p.p_usuario,revisado_em:'2026-10-30',revisao_versao:d.versao});
 data=d;
 }
 else if(url.includes('/operacao_kit_documentos?')){const q=new URL(url).searchParams;data=state.kit.filter(d=>['id','empresa_id','organizacao_id','processo_id'].every(k=>!q.has(k)||q.get(k)==='eq.'+d[k]));}
 else if(url.includes('/rpc/identificacao_empresa_habilitada'))data=state.gate;
 else if(url.includes('/clientes?'))data=[{status:state.aprovado?'aprovado':'pendente'}];
 else if(url.includes('/operacao_empresas?'))data=state.empresa?[state.empresa]:[];
 else if(url.includes('/operacao_membros?'))data=state.membro?[state.membro]:[];
 else if(url.includes('/operacao_identificacao_empresa?'))data=state.perfil?[state.perfil]:[];
 else if(url.includes('/operacao_documentos?'))data=state.documentos;
 else if(url.includes('/operacao_processos?'))data=state.processo?[state.processo]:[];
 else if(url.includes('/operacao_origens_pncp?')){const records=state.originState?[{item_id:ids.item,organizacao_id:ids.org,processo_id:ids.processo,estado:state.originState}]:[];return new Response(JSON.stringify(records),{headers:{'Content-Range':records.length?'0-0/1':'*/0','Preference-Applied':'count=exact'}});}
 else if(url.includes('/operacao_itens_resultado?')){assert.match(url,/quantidade:quantidade::text/);const q=new URL(url).searchParams;data=state.itens;const sel=q.get('id');if(sel?.startsWith('in.('))data=data.filter(i=>sel.slice(4,-1).split(',').includes(i.id));if(sel?.startsWith('gt.'))data=data.filter(i=>i.id>sel.slice(3));if(op.headers.Prefer==='count=exact'){const total=data.length;data=data.slice(0,Number(q.get('limit')));return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Content-Range':data.length?`0-${data.length-1}/${total}`:'*/0','Preference-Applied':'count=exact'}});}}
 else if(url.includes('/storage/'))return new Response(Buffer.from('%PDF-1.4\n'));
 else throw new Error('URL inesperada '+url);
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 });
 const old=process.env.IDENTIFICACAO_EMPRESA_LOCAL;process.env.IDENTIFICACAO_EMPRESA_LOCAL='1';t.after(()=>{if(old===undefined)delete process.env.IDENTIFICACAO_EMPRESA_LOCAL;else process.env.IDENTIFICACAO_EMPRESA_LOCAL=old;});
 const service=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='QA_SERVICE';t.after(()=>{if(service===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=service;});
 const body={acao:'preparar',empresaId:ids.empresa,processoId:ids.processo,tipo:'proposta',proposta:{itemIds:[ids.item],unidades:{[ids.item]:'un'},validade:'30 dias',prazoEntrega:'10 dias',pagamento:'À vista'}};
 const run=async patch=>{const payload={...body,...patch};if(payload.tipo==='declaracao')delete payload.proposta;const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer QA'},body:JSON.stringify(payload)});return {...r,json:JSON.parse(r.body)};};
 return {state,body,run,calls};
}
test('sessão ausente e ambiente fechado não geram documentos',async t=>{
 const f=fixture(t);assert.equal((await handler({httpMethod:'POST',headers:{},body:'{}'})).statusCode,401);
 process.env.IDENTIFICACAO_EMPRESA_LOCAL='0';assert.equal((await f.run()).statusCode,503);
});

test('rascunhos incompletos salvam, reabrem e coexistem; criação é idempotente',async t=>{
 const f=fixture(t,{perfil:null});const draft={acao:'salvar',documentoId:ids.item,versaoEsperada:0,tipo:'declaracao',declaracao:{titulo:'Primeira',texto:'',fonte:''}};
 const s=await f.run(draft);assert.equal(s.statusCode,200);assert.equal(s.json.documento.versao,1);
 assert.equal((await f.run(draft)).json.documento.id,ids.item);assert.equal(f.state.kit.length,1);
 assert.equal((await f.run({...draft,declaracao:{...draft.declaracao,titulo:'Outra intenção'}})).statusCode,409);
 assert.equal((await f.run({...draft,documentoId:ids.org})).statusCode,200);
 const list=await f.run({acao:'listar'});assert.equal(list.statusCode,200);assert.equal(list.json.documentos.length,2);assert.equal(list.json.documentos[0].dados,undefined);
 const open=await f.run({acao:'abrir',documentoId:ids.item});assert.equal(open.statusCode,200);assert.deepEqual(open.json.documento.dados,{declaracao:draft.declaracao});assert.equal(open.json.revisaoVigente,false);
 assert.equal((await f.run({acao:'preparar',documentoId:ids.item,versaoEsperada:1})).statusCode,422);
});

test('persistência rejeita campos forjados, referências cruzadas e conflitos sem sobrescrever',async t=>{
 const f=fixture(t);const draft={acao:'salvar',documentoId:ids.item,versaoEsperada:0};
 for(const proposta of [{...f.body.proposta,valorUnitario:'0.01'},{...f.body.proposta,itemIds:[ids.org]},{...f.body.proposta,unidades:{[ids.org]:'un'}},{...f.body.proposta,itemIds:[ids.item,ids.item]}])assert.ok([400,404].includes((await f.run({...draft,proposta})).statusCode));
 for(const patch of [{versaoEsperada:-1},{versaoEsperada:1.5},{documentoId:'x'},{revisadoPor:'intruso'},{empresa:{nome:'Intrusa'}}])assert.equal((await f.run({...draft,...patch})).statusCode,400);
 assert.equal((await f.run(draft)).statusCode,200);const newer=await f.run({...draft,versaoEsperada:1,proposta:{...f.body.proposta,validade:'60 dias'}});assert.equal(newer.json.documento.versao,2);
 assert.equal((await f.run({...draft,versaoEsperada:1})).statusCode,409);assert.equal(f.state.kit[0].dados.proposta.validade,'60 dias');
 assert.equal((await f.run({...draft,versaoEsperada:2,tipo:'declaracao',declaracao:{titulo:'x'}})).statusCode,409);
 f.state.rpcStatus=409;assert.equal((await f.run({...draft,versaoEsperada:2})).statusCode,409);delete f.state.rpcStatus;
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;assert.equal((await f.run({...draft,versaoEsperada:2})).statusCode,503);
});

test('peça persistida exige confirmação própria; preço, perfil, fontes e usuário invalidam revisão',async t=>{
 const f=fixture(t);const target={documentoId:ids.item,versaoEsperada:1};assert.equal((await f.run({acao:'salvar',...target,versaoEsperada:0})).statusCode,200);
 const p=await f.run({...target,proposta:{}});assert.equal(p.statusCode,200);assert.match(p.json.previa.texto,/2,50/);
 assert.equal((await f.run({acao:'exportar',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);
 assert.equal((await f.run({acao:'confirmarRevisao',...target,revisaoHash:p.json.revisaoHash})).statusCode,422);
 const confirm=await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(confirm.statusCode,200);assert.equal(confirm.json.documento.revisao.revisadoPor,'usuario');
 assert.equal((await f.run({acao:'abrir',documentoId:ids.item})).json.revisaoVigente,true);
 const x=await f.run({acao:'exportar',...target,revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(x.statusCode,200);assert.equal(Buffer.from(x.json.arquivoBase64,'base64').subarray(0,2).toString(),'PK');
 const original=JSON.parse(JSON.stringify(f.state));
 for(const change of [()=>{f.state.itens[0].valor_unitario_proposta='2.00';},()=>{f.state.perfil.dados_confirmados.cargo='Diretor';},()=>{f.state.perfil.invalidado_em='agora';},()=>{f.state.userId='outro';f.state.membro.usuario_id='outro';}]){
 change();assert.equal((await f.run({acao:'exportar',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);Object.assign(f.state,JSON.parse(JSON.stringify(original)));
 }
 assert.equal((await f.run({acao:'salvar',...target})).statusCode,200);assert.equal(f.state.kit[0].revisao_hash,null);
 assert.equal((await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);
});

test('persistência aplica autorização a listar, abrir, salvar e confirmar',async t=>{
 const f=fixture(t);
 for(const acao of ['listar','abrir','salvar','confirmarRevisao']){
 f.state.aprovado=false;assert.equal((await f.run({acao,documentoId:ids.item,versaoEsperada:0})).statusCode,403);f.state.aprovado=true;
 f.state.membro.papel='leitura';assert.equal((await f.run({acao,documentoId:ids.item,versaoEsperada:0})).statusCode,403);f.state.membro.papel='operador';
 }
 assert.equal((await f.run({acao:'abrir',documentoId:ids.org})).statusCode,404);
 f.state.kit=[{id:ids.item,empresa_id:ids.org,organizacao_id:ids.org,processo_id:ids.processo}];assert.equal((await f.run({acao:'abrir',documentoId:ids.item})).statusCode,404);
});

test('cada peça e cada operador confirmam revisão própria; reabrir preserva histórico',async t=>{
 const f=fixture(t);const target={documentoId:ids.item,versaoEsperada:1};
 for(const documentoId of [ids.item,ids.org])assert.equal((await f.run({acao:'salvar',documentoId,versaoEsperada:0})).statusCode,200);
 const p=await f.run(target);await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:p.json.revisaoHash});
 assert.equal((await f.run({acao:'exportar',...target,documentoId:ids.org,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);
 f.state.userId='outro';f.state.membro.usuario_id='outro';
 const open=await f.run({acao:'abrir',documentoId:ids.item});assert.equal(open.json.revisaoVigente,false);assert.equal(open.json.documento.revisao.revisadoPor,'usuario');
 const other=await f.run(target);assert.notEqual(other.json.revisaoHash,p.json.revisaoHash);
 assert.equal((await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:p.json.revisaoHash,revisadoPor:'usuario'})).statusCode,409);
 const confirmed=await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:other.json.revisaoHash,revisadoPor:'usuario'});assert.equal(confirmed.json.documento.revisao.revisadoPor,'outro');
 assert.equal((await f.run({acao:'exportar',...target,revisado:true,revisaoHash:other.json.revisaoHash})).statusCode,200);
 assert.equal((await f.run({acao:'salvar',documentoId:ids.org,versaoEsperada:1})).statusCode,200);
 assert.equal((await f.run({acao:'exportar',...target,revisado:true,revisaoHash:other.json.revisaoHash})).statusCode,200);
});

test('hash persistido vincula a revisão à peça e à versão mesmo com conteúdo idêntico',async t=>{
 const f=fixture(t);
 for(const documentoId of [ids.item,ids.org])await f.run({acao:'salvar',documentoId,versaoEsperada:0});
 const first=await f.run({documentoId:ids.item,versaoEsperada:1});const second=await f.run({documentoId:ids.org,versaoEsperada:1});
 assert.equal(first.json.previa.texto,second.json.previa.texto);assert.notEqual(first.json.revisaoHash,second.json.revisaoHash);
 assert.equal((await f.run({acao:'confirmarRevisao',documentoId:ids.org,versaoEsperada:1,revisado:true,revisaoHash:first.json.revisaoHash})).statusCode,409);
 await f.run({acao:'salvar',documentoId:ids.item,versaoEsperada:1});const next=await f.run({documentoId:ids.item,versaoEsperada:2});
 assert.equal(first.json.previa.texto,next.json.previa.texto);assert.notEqual(first.json.revisaoHash,next.json.revisaoHash);
 assert.equal((await f.run({acao:'confirmarRevisao',documentoId:ids.item,versaoEsperada:2,revisado:true,revisaoHash:first.json.revisaoHash})).statusCode,409);
});

test('fonte PDF alterada torna revisão persistida obsoleta e bloqueia exportação',async t=>{
 const f=fixture(t);const caminho=ids.org+'/'+ids.empresa+'/doc.pdf';
 f.state.documentos=[{id:'doc',empresa_id:ids.empresa,organizacao_id:ids.org,arquivo_caminho:caminho}];
 f.state.perfil.proveniencia=[{documentoId:'doc',arquivoCaminho:caminho,hash:createHash('sha256').update('%PDF-1.4\n').digest('hex'),campos:['endereco'],pagina:1,trecho:'Rua QA'}];
 const target={documentoId:ids.item,versaoEsperada:1};await f.run({acao:'salvar',...target,versaoEsperada:0});const p=await f.run(target);
 assert.equal((await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 f.state.documentos[0].arquivo_caminho=caminho+'.substituido';
 assert.equal((await f.run({acao:'exportar',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);
 const open=await f.run({acao:'abrir',documentoId:ids.item});assert.equal(open.statusCode,200);assert.equal(open.json.revisaoVigente,false);assert.equal(open.json.documento.versao,1);
});

test('salvar valida limites e estrutura sem exigir campos completos',async t=>{
 const f=fixture(t);const draft={acao:'salvar',documentoId:ids.item,versaoEsperada:0,tipo:'declaracao'};
 for(const declaracao of [null,[],{titulo:12},{titulo:'x'.repeat(181)},{texto:'x'.repeat(20001)},{fonte:'x'.repeat(1001)},{texto:'\u0001'},{texto:'\ud800'},{revisadoPor:'intruso'}])assert.equal((await f.run({...draft,declaracao})).statusCode,400);
 assert.equal((await f.run({...draft,declaracao:{titulo:'',texto:'\n\t',fonte:''}})).statusCode,200);
 assert.equal((await f.run({acao:'preparar',documentoId:ids.item,versaoEsperada:1})).statusCode,422);
 for(const proposta of [null,[],{itemIds:null},{itemIds:[12]},{itemIds:[],unidades:[]},{validade:'x'.repeat(501)},{itemIds:[ids.item],unidades:{[ids.item]:'x'.repeat(41)}}])assert.equal((await f.run({acao:'salvar',documentoId:ids.org,versaoEsperada:0,proposta})).statusCode,400);
 assert.equal((await f.run({acao:'salvar',documentoId:ids.org,versaoEsperada:0,proposta:{}})).statusCode,200);
});
test('consulta, preparação e exportação revalidam dados; hash obsoleto falha',async t=>{
 const f=fixture(t);const c=await f.run({acao:'consultar'});assert.equal(c.statusCode,200);assert.deepEqual(c.json.requisitos,['Declaração']);
 const p=await f.run();assert.equal(p.statusCode,200);assert.match(p.json.previa.texto,/2,50/);
 const x=await f.run({acao:'exportar',revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(x.statusCode,200);assert.equal(Buffer.from(x.json.arquivoBase64,'base64').subarray(0,2).toString(),'PK');
 f.state.itens[0].descricao='Alterado';assert.equal((await f.run({acao:'exportar',revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);
 assert.equal((await f.run({acao:'exportar',revisaoHash:p.json.revisaoHash})).statusCode,422);
});
test('papel, aprovação, empresa e referências cruzadas falham fechadas',async t=>{
 const f=fixture(t);
 for(const patch of [{membro:{...f.state.membro,papel:'leitura'}},{membro:{...f.state.membro,empresa_id:ids.item}},{membro:{...f.state.membro,organizacao_id:ids.item}},{aprovado:false}]){
 const saved={...f.state};Object.assign(f.state,patch);assert.equal((await f.run()).statusCode,403);Object.assign(f.state,saved);
 }
 f.state.processo.empresa_id=ids.item;assert.equal((await f.run()).statusCode,404);f.state.processo.empresa_id=ids.empresa;
 f.state.itens[0].processo_id=ids.empresa;assert.equal((await f.run()).statusCode,404);
});
test('gate, identificação ausente/invalidada e PDF substituído bloqueiam exportação',async t=>{
 const f=fixture(t);const preparado=await f.run();f.state.perfil.invalidado_em='agora';assert.equal((await f.run({acao:'exportar',revisado:true,revisaoHash:preparado.json.revisaoHash})).statusCode,409);delete f.state.perfil.invalidado_em;
 f.state.gate=false;assert.equal((await f.run()).statusCode,503);f.state.gate=true;
 const perfil=f.state.perfil;f.state.perfil=null;assert.equal((await f.run()).statusCode,422);f.state.perfil={...perfil,invalidado_em:'agora'};assert.equal((await f.run()).statusCode,422);
 const caminho=ids.org+'/'+ids.empresa+'/doc.pdf';f.state.documentos=[{id:'doc',empresa_id:ids.empresa,organizacao_id:ids.org,arquivo_caminho:caminho}];
 f.state.perfil={...perfil,proveniencia:[{documentoId:'doc',arquivoCaminho:caminho,hash:createHash('sha256').update('outro').digest('hex'),campos:['endereco'],pagina:1,trecho:'Rua QA'}]};assert.equal((await f.run()).statusCode,422);
});
test('perfil incompleto vira pendência; cliente não substitui cadastro ou preços',async t=>{
 const f=fixture(t);f.state.perfil.proveniencia=null;const c=await f.run({acao:'consultar'});assert.equal(c.statusCode,200);assert.ok(c.json.pendencias.length);
 f.state.perfil.proveniencia=[];const p=await f.run({empresa:{razaoSocial:'Intrusa'},itens:[{valorUnitario:'0.01'}]});assert.equal(p.statusCode,200);assert.match(p.json.previa.texto,/Empresa QA/);assert.doesNotMatch(p.json.previa.texto,/Intrusa/);assert.match(p.json.previa.texto,/2,50/);
 assert.equal((await f.run({proposta:{...f.body.proposta,itemIds:[ids.processo]}})).statusCode,404);
});
test('PDF válido tem hash rechecado a cada exportação e referências de outra empresa bloqueiam',async t=>{
 const f=fixture(t);const caminho=ids.org+'/'+ids.empresa+'/doc.pdf';
 f.state.documentos=[{id:'doc',empresa_id:ids.empresa,organizacao_id:ids.org,arquivo_caminho:caminho}];
 f.state.perfil.proveniencia=[{documentoId:'doc',arquivoCaminho:caminho,hash:createHash('sha256').update('%PDF-1.4\n').digest('hex'),campos:['endereco'],pagina:1,trecho:'Rua QA'}];
 const p=await f.run();assert.equal(p.statusCode,200);const x=await f.run({acao:'exportar',revisado:true,revisaoHash:p.json.revisaoHash});assert.equal(x.statusCode,200);assert.equal(f.calls.filter(([url])=>url.includes('/storage/')).length,2);
 f.state.documentos[0].empresa_id=ids.item;assert.equal((await f.run()).statusCode,422);
});
test('escala 1000 salva prepara revisa exporta e lote final alterado invalida',async t=>{
 const f=fixture(t);const itens=Array.from({length:1000},(_,i)=>({...f.state.itens[0],id:`33333333-3333-3333-3333-${String(i+1).padStart(12,'0')}`,identificador:String(i+1)}));f.state.itens=itens;
 const proposta={...f.body.proposta,itemIds:itens.map(i=>i.id),unidades:Object.fromEntries(itens.map(i=>[i.id,'un']))};
 const documentoId='77777777-7777-7777-7777-777777777777';
 assert.equal((await f.run({acao:'salvar',documentoId,versaoEsperada:0,proposta})).statusCode,200);
 const target={documentoId,versaoEsperada:1};const p=await f.run({...target,acao:'preparar'});assert.equal(p.statusCode,200);assert.match(p.json.previa.texto,/Item 1000:/);
 assert.equal((await f.run({...target,acao:'confirmarRevisao',revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 assert.equal((await f.run({...target,acao:'exportar',revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 itens[999].descricao='Alteração final';assert.equal((await f.run({...target,acao:'exportar',revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,409);
 const q=await f.run({acao:'consultar',itensPaginados:true});assert.equal(q.json.itens.length,100);assert.equal(q.json.paginacaoItens.hasMore,true);
 assert.equal((await f.run({acao:'consultar'})).statusCode,409);
});

test('abrir peça revisada após retificação preserva rascunho mas não declara revisão vigente',async t=>{
 const f=fixture(t);const before=process.env.IMPORTACAO_PNCP_LOCAL;process.env.IMPORTACAO_PNCP_LOCAL='1';t.after(()=>{if(before===undefined)delete process.env.IMPORTACAO_PNCP_LOCAL;else process.env.IMPORTACAO_PNCP_LOCAL=before;});
 const documentoId='77777777-7777-7777-7777-777777777777';assert.equal((await f.run({acao:'salvar',documentoId,versaoEsperada:0})).statusCode,200);
 const target={documentoId,versaoEsperada:1},p=await f.run({...target,acao:'preparar'});assert.equal(p.statusCode,200);
 assert.equal((await f.run({...target,acao:'confirmarRevisao',revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 f.state.originState='fonte_alterada';const opened=await f.run({...target,acao:'abrir'});assert.equal(opened.statusCode,200);assert.equal(opened.json.revisaoVigente,false);assert.equal(opened.json.itensNaoVerificados,true);assert.equal(opened.json.documento.dados.proposta.itemIds[0],ids.item);
});
