const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {handler}=require('../kit-documentos');
const planilha=require('../../../planilha-itens.js');
// O mock devolve só as colunas pedidas no select, como o PostgREST: assim o hash prova que o select do kit não mudou.
function projetar(url,rows){const sel=new URL(url).searchParams.get('select');if(!sel)return rows;const campos=sel.split(/,(?![^(]*\))/).map(c=>c.split(':')[0].replace(/\(.*$/,''));return rows.map(r=>Object.fromEntries(campos.filter(c=>c in r).map(c=>[c,r[c]])));}
const ids={empresa:'11111111-1111-1111-1111-111111111111',processo:'22222222-2222-2222-2222-222222222222',item:'33333333-3333-3333-3333-333333333333',org:'44444444-4444-4444-4444-444444444444'};
function fixture(t,changes={}){
 const empresa={id:ids.empresa,organizacao_id:ids.org,razao_social:'Empresa QA',cnpj:'11222333000181'};
 const perfil={empresa_id:ids.empresa,organizacao_id:ids.org,versao:1,confirmado_em:'2026-10-27',dados_confirmados:{endereco:'Rua QA',representante:'Ana',cargo:'Sócia'},proveniencia:[]};
 const state={empresa,perfil,gate:true,aprovado:true,membro:{usuario_id:'usuario',organizacao_id:ids.org,empresa_id:ids.empresa,papel:'operador'},processo:{id:ids.processo,organizacao_id:ids.org,empresa_id:ids.empresa,numero:'1',orgao:'Órgão',documentos_exigidos:['Declaração']},itens:[{id:ids.item,organizacao_id:ids.org,processo_id:ids.processo,tipo:'item',identificador:'1',descricao:'Material',quantidade:'2.000',valor_unitario_proposta:'1.25'}],documentos:[],...changes};
 state.kit=[];state.userId='usuario';state.posts=[];state.origens=state.origens||[];
 const calls=[];t.mock.method(global,'fetch',async(url,op={})=>{calls.push([url,op]);assert.equal(op.headers.Authorization,url.includes('/rpc/gravar_kit_documento')?'Bearer QA_SERVICE':'Bearer QA');let data;
 if(state.semColunas&&/custo_unitario|margem_minima|preco_referencia/.test(url+(op.body||'')))return new Response(JSON.stringify({code:'42703',message:'column does not exist'}),{status:400});
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
 else if(url.includes('/operacao_processos?')){if(op.method==='PATCH'&&state.processo)Object.assign(state.processo,JSON.parse(op.body));data=projetar(url,state.processo?[state.processo]:[]);}
 else if(url.includes('/operacao_origens_pncp?')){const records=state.originState?[{item_id:ids.item,organizacao_id:ids.org,processo_id:ids.processo,estado:state.originState}]:[];return new Response(JSON.stringify(records),{headers:{'Content-Range':records.length?'0-0/1':'*/0','Preference-Applied':'count=exact'}});}
 else if(url.includes('/operacao_itens_resultado?')){assert.match(url,/quantidade:quantidade::text/);const q=new URL(url).searchParams;data=state.itens.filter(i=>['id','processo_id','organizacao_id','tipo'].every(k=>!q.get(k)?.startsWith('eq.')||q.get(k)==='eq.'+(i[k]??'item')));
 if(op.method==='PATCH'){const g=/valor_unitario_proposta\.gte\.([\d.]+)/.exec(q.get('or')||'');const m=/valor_unitario_minimo\.lte\.([\d.]+)/.exec(q.get('or')||'');data=data.filter(i=>(!g||i.valor_unitario_proposta==null||Number(i.valor_unitario_proposta)>=Number(g[1]))&&(!m||i.valor_unitario_minimo==null||Number(i.valor_unitario_minimo)<=Number(m[1])));for(const i of data)Object.assign(i,JSON.parse(op.body));return new Response(JSON.stringify(projetar(url,data)));}
 if(op.method==='POST'){const rows=JSON.parse(op.body);state.posts.push({url,op,rows});const out=rows.map(r=>{const i=state.itens.find(i=>i.processo_id===r.processo_id&&(i.tipo||'item')===r.tipo&&i.identificador===r.identificador);if(i)return Object.assign(i,r);state.itens.push({...r});return r;});return new Response(JSON.stringify(projetar(url,out)));}
 data=data.map(i=>({...i,operacao_origens_pncp:state.origens.includes(i.id)?[{item_id:i.id}]:[]}));const sel=q.get('id');if(sel?.startsWith('in.('))data=data.filter(i=>sel.slice(4,-1).split(',').includes(i.id));if(sel?.startsWith('gt.'))data=data.filter(i=>i.id>sel.slice(3));data=projetar(url,data);if(op.headers.Prefer==='count=exact'){const total=data.length;if(q.get('limit'))data=data.slice(0,Number(q.get('limit')));return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Content-Range':data.length?`0-${data.length-1}/${total}`:'*/0','Preference-Applied':'count=exact'}});}}
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

const outro='55555555-5555-5555-5555-555555555555';
const csv=linhas=>'﻿'+[planilha.COLUNAS.join(';'),...linhas].join('\r\n')+'\r\n';
const patches=f=>f.calls.filter(([,op])=>op.method==='PATCH');
test('custo, mínimo, referência e premissas gravam sem atualizado_em e sem invalidar a proposta revisada',async t=>{
 const f=fixture(t);const target={documentoId:ids.item,versaoEsperada:1};
 await f.run({acao:'salvar',...target,versaoEsperada:0});const p=await f.run(target);
 assert.equal((await f.run({acao:'confirmarRevisao',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 const preco=await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:'0.80',valorUnitarioMinimo:'1.10'});
 assert.equal(preco.statusCode,200);assert.equal(preco.json.item.custoUnitario,'0.80');assert.equal(preco.json.item.valorUnitarioMinimo,'1.10');
 assert.deepEqual(Object.keys(JSON.parse(patches(f)[0][1].body)).sort(),['custo_unitario','valor_unitario_minimo']);
 const ref=await f.run({acao:'salvarReferencia',itemId:ids.item,preco:'1.2345',em:'2026-11-18T10:00:00Z'});
 assert.equal(ref.statusCode,200);assert.equal(ref.json.item.precoReferencia,'1.2345');
 const prem=await f.run({acao:'salvarPremissas',tributos:'10',garantia:'0',margem:'25.5',margemMinima:'12.000',frete:'150.00'});
 assert.equal(prem.statusCode,200);assert.deepEqual(prem.json.premissas,{tributos:'10',garantia:'0',margem:'25.5',margemMinima:'12.000',frete:'150.00'});
 assert.equal(patches(f).length,3);for(const [,op] of patches(f))assert.doesNotMatch(op.body,/atualizado_em/);
 assert.equal((await f.run(target)).json.revisaoHash,p.json.revisaoHash);
 assert.equal((await f.run({acao:'abrir',documentoId:ids.item})).json.revisaoVigente,true);
 assert.equal((await f.run({acao:'exportar',...target,revisado:true,revisaoHash:p.json.revisaoHash})).statusCode,200);
 const lista=await f.run({acao:'listarItens'});assert.equal(lista.json.precoDisponivel,true);assert.equal(lista.json.itens[0].precoReferencia,'1.2345');
});
test('preço, referência e premissas validam regra, formato e escopo',async t=>{
 const f=fixture(t);f.state.itens.push({...f.state.itens[0],id:outro,processo_id:ids.empresa,identificador:'9'});
 assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:null,valorUnitarioMinimo:'1.26'})).statusCode,422);
 for(const patch of [{custoUnitario:'-1',valorUnitarioMinimo:null},{custoUnitario:'1,00',valorUnitarioMinimo:null},{custoUnitario:1,valorUnitarioMinimo:null},{custoUnitario:null},{itemId:'x',custoUnitario:null,valorUnitarioMinimo:null}])assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,...patch})).statusCode,400);
 assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:null,valorUnitarioMinimo:'1.25'})).statusCode,200);
 assert.equal((await f.run({acao:'salvarPrecoItem',itemId:outro,custoUnitario:'1.00',valorUnitarioMinimo:null})).statusCode,404);
 assert.equal((await f.run({acao:'salvarReferencia',itemId:outro,preco:'1.00',em:'2026-11-18T10:00:00Z'})).statusCode,404);
 assert.equal(f.state.itens[1].custo_unitario,undefined);assert.equal(f.state.itens[1].preco_referencia,undefined);
 for(const patch of [{preco:'1.00',em:null},{preco:'1.00',em:'ontem'},{preco:'1.00',em:'2999-01-01T00:00:00Z'},{preco:'0',em:'2026-11-18T10:00:00Z'}])assert.equal((await f.run({acao:'salvarReferencia',itemId:ids.item,...patch})).statusCode,400);
 const base={tributos:null,garantia:null,margem:'10',margemMinima:'5',frete:null};
 assert.equal((await f.run({acao:'salvarPremissas',...base,margemMinima:'10.001'})).statusCode,422);
 assert.equal((await f.run({acao:'salvarPremissas',...base,margem:null})).statusCode,422);
 for(const patch of [{tributos:'100'},{garantia:'1.2345'},{frete:'-1'},{margem:10}])assert.equal((await f.run({acao:'salvarPremissas',...base,...patch})).statusCode,400);
 const semFrete={...base};delete semFrete.frete;assert.equal((await f.run({acao:'salvarPremissas',...semFrete})).statusCode,400);
 assert.equal((await f.run({acao:'salvarPremissas',...base,tributos:'99.999'})).statusCode,200);
 f.state.membro.papel='leitura';assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:null,valorUnitarioMinimo:null})).statusCode,403);
});
test('editar item abaixo do preço mínimo é recusado; mínimo antigo inválido não trava o custo',async t=>{
 const f=fixture(t);const item=v=>({acao:'salvarItem',modo:'editar',item:{id:ids.item,identificador:'1',descricao:'Material',quantidade:'2',valorUnitario:v}});
 assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:null,valorUnitarioMinimo:'1.20'})).statusCode,200);
 const abaixo=await f.run(item('1.19'));assert.equal(abaixo.statusCode,422);
 assert.equal(abaixo.json.erro,'O valor ofertado R$ 1,19 está abaixo do seu preço mínimo R$ 1,20. Ajuste o valor ou o mínimo.');
 assert.equal(f.state.itens[0].valor_unitario_proposta,'1.25');
 assert.equal((await f.run(item('1.20'))).statusCode,200);assert.equal(f.state.itens[0].valor_unitario_proposta,'1.20');
 // Estado antigo (gravado antes da regra): valor 1.10 com mínimo 1.20. Custo grava e avisa; mínimo novo acima do valor segue recusado.
 f.state.itens[0].valor_unitario_proposta='1.10';
 const custo=await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:'0.50',valorUnitarioMinimo:'1.20'});
 assert.equal(custo.statusCode,200);assert.equal(f.state.itens[0].custo_unitario,'0.50');assert.match(custo.json.aviso,/R\$ 1,10 está abaixo do seu preço mínimo R\$ 1,20/);
 assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:'0.50',valorUnitarioMinimo:'1.30'})).statusCode,422);
 assert.equal((await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:'0.60',valorUnitarioMinimo:'1.00'})).json.aviso,undefined);
 // Banco sem a coluna do mínimo: edição segue sem a conferência.
 f.state.semColunas=true;assert.equal((await f.run(item('0.90'))).statusCode,200);
});
test('importarPlanilha grava em 1 POST com on_conflict, mesmas chaves e atualizado_em só quando muda a proposta',async t=>{
 const f=fixture(t,{origens:[ids.item]});const antigo='2026-01-01T00:00:00.000Z';
 f.state.itens[0].atualizado_em=antigo;f.state.itens.push({id:outro,organizacao_id:ids.org,processo_id:ids.processo,tipo:'item',identificador:'2',descricao:'Outro',quantidade:'1.000',valor_unitario_proposta:'3.00',atualizado_em:antigo});
 const r=await f.run({acao:'importarPlanilha',texto:csv(['1;;;;;;;;1,00','2;Nome novo;;;;;;Fab;','3;Item novo;5;un;2,00;Marca;;;'])});
 assert.equal(r.statusCode,200);assert.equal(r.json.gravados,3);assert.deepEqual(r.json.resumo,{novo:1,alterado:2,sem_mudanca:0,erro:0});
 assert.equal(f.state.posts.length,1);const {url,op,rows}=f.state.posts[0];
 assert.match(url,/on_conflict=processo_id,tipo,identificador/);assert.equal(op.headers.Prefer,'resolution=merge-duplicates,return=representation');
 const chaves=JSON.stringify(Object.keys(rows[0]).sort());for(const row of rows)assert.equal(JSON.stringify(Object.keys(row).sort()),chaves);
 const por=Object.fromEntries(rows.map(x=>[x.identificador,x]));
 assert.equal(por['1'].atualizado_em,antigo);assert.equal(por['1'].valor_unitario_minimo,'1');assert.equal(por['1'].id,ids.item);assert.equal(por['1'].descricao,'Material');
 assert.notEqual(por['2'].atualizado_em,antigo);assert.equal(por['2'].fabricante,'Fab');assert.equal(por['2'].id,outro);
 assert.ok(require('../_kit_documentos').uuid(por['3'].id));assert.notEqual(por['3'].id,ids.item);
 for(const row of rows){assert.equal(row.organizacao_id,ids.org);assert.equal(row.processo_id,ids.processo);assert.equal(row.tipo,'item');}
 const sem=await f.run({acao:'importarPlanilha',texto:csv(['1;;;;;;;;1,00'])});assert.equal(sem.statusCode,200);assert.equal(sem.json.gravados,0);assert.equal(f.state.posts.length,1);
});
test('importarPlanilha é tudo ou nada: erro de linha e item PNCP protegido respondem 422 sem POST',async t=>{
 const f=fixture(t,{origens:[ids.item]});
 const linha=await f.run({acao:'importarPlanilha',texto:csv(['3;Novo;abc;;2,00;;;;','4;Válido;1;;1,00;;;;'])});
 assert.equal(linha.statusCode,422);assert.ok(linha.json.erros.some(e=>/^Linha 2 \(item 3\)/.test(e)));
 const pncp=await f.run({acao:'importarPlanilha',texto:csv(['1;Outra descrição;;;;;;;'])});
 assert.equal(pncp.statusCode,422);assert.match(pncp.json.erros[0],/PNCP/);
 assert.equal((await f.run({acao:'importarPlanilha',texto:csv(['1;;;;;;;;9,00'])})).statusCode,422);
 assert.equal((await f.run({acao:'importarPlanilha',texto:'item;descricao\r\n1;x\r\n'})).statusCode,422);
 assert.equal((await f.run({acao:'importarPlanilha',texto:csv([])})).statusCode,422);
 assert.equal(f.state.posts.length,0);assert.equal(f.state.itens[0].descricao,'Material');
});
test('banco sem as colunas novas: listagem cai no select antigo e ações novas respondem 503',async t=>{
 const f=fixture(t,{semColunas:true});
 const c=await f.run({acao:'consultar'});assert.equal(c.statusCode,200);assert.equal(c.json.precoDisponivel,false);assert.equal(c.json.itens[0].valorUnitario,'1.25');
 const l=await f.run({acao:'listarItens'});assert.equal(l.statusCode,200);assert.equal(l.json.precoDisponivel,false);
 for(const body of [{acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:'1.00',valorUnitarioMinimo:null},{acao:'salvarReferencia',itemId:ids.item,preco:'1.00',em:'2026-11-18T10:00:00Z'},{acao:'salvarPremissas',tributos:null,garantia:null,margem:null,margemMinima:null,frete:null},{acao:'importarPlanilha',texto:csv(['1;;;;;;;;1,00'])}]){
  const r=await f.run(body);assert.equal(r.statusCode,503);assert.match(r.json.erro,/ainda não estão disponíveis/);
 }
 assert.equal(f.state.posts.length,0);
});
test('lerPremissas devolve as premissas do processo por GET próprio; sem permissão é 403 e banco antigo 503',async t=>{
 const f=fixture(t);Object.assign(f.state.processo,{tributos_percentual:'8.500',garantia_percentual:'0',margem_percentual:'22',margem_minima_percentual:'8',frete:'150.00'});
 const r=await f.run({acao:'lerPremissas'});
 assert.equal(r.statusCode,200);assert.deepEqual(r.json.premissas,{tributos:'8.500',garantia:'0',margem:'22',margemMinima:'8',frete:'150.00'});
 assert.equal(patches(f).length,0);
 const get=f.calls.map(([u])=>u).filter(u=>/margem_minima_percentual/.test(u));
 assert.equal(get.length,1);assert.match(get[0],new RegExp(`id=eq\\.${ids.processo}&empresa_id=eq\\.${ids.empresa}&organizacao_id=eq\\.${ids.org}&`));
 // O select do carregarEscopo (que entra no hash) não ganhou as colunas de premissa.
 assert.ok(f.calls.some(([u])=>u.endsWith('select=id,empresa_id,organizacao_id,numero,orgao,sistema,url_origem,documentos_exigidos,atualizado_em')));
 f.state.membro.papel='leitura';const negado=await f.run({acao:'lerPremissas'});
 assert.equal(negado.statusCode,403);assert.equal(negado.json.premissas,undefined);
 f.state.membro=null;assert.equal((await f.run({acao:'lerPremissas'})).statusCode,403);
 const antigo=fixture(t,{semColunas:true});const r503=await antigo.run({acao:'lerPremissas'});
 assert.equal(r503.statusCode,503);assert.match(r503.json.erro,/ainda não estão disponíveis/);
});
test('listagem marca origemPncp por item pelo embed, sem mudar o select do kit',async t=>{
 const f=fixture(t,{origens:[ids.item]});f.state.itens.push({...f.state.itens[0],id:outro,identificador:'2'});
 for(const acao of ['listarItens','consultar']){
  const r=await f.run({acao,itensPaginados:true});assert.equal(r.statusCode,200);
  assert.deepEqual(r.json.itens.map(i=>[i.id,i.origemPncp]),[[ids.item,true],[outro,false]]);
 }
 const lista=f.calls.map(([u])=>u).filter(u=>u.includes('/operacao_itens_resultado?')&&u.includes('order=numero_ordem.asc.nullslast,id.asc&limit='));
 assert.ok(lista.length&&lista.every(u=>u.includes('operacao_origens_pncp(item_id)')));
 const antigo=fixture(t,{semColunas:true,origens:[ids.item]});
 const r=await antigo.run({acao:'listarItens'});assert.equal(r.json.precoDisponivel,false);assert.equal(r.json.itens[0].origemPncp,false);
});
test('regressão: hash do kit igual antes e depois de lerPremissas, listagem com origem e preços; select fixo intacto',async t=>{
 const {selectLista}=require('../_kit_proposta_itens');
 assert.equal(selectLista.split(',').slice(0,11).join(','),'id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade:quantidade::text,valor_unitario_proposta:valor_unitario_proposta::text,marca,modelo,atualizado_em');
 const f=fixture(t,{origens:[ids.item]});const antes=(await f.run({})).json.revisaoHash;assert.match(antes,/^[a-f0-9]{64}$/);
 await f.run({acao:'lerPremissas'});await f.run({acao:'listarItens'});
 await f.run({acao:'salvarPremissas',tributos:'8.5',garantia:null,margem:'22',margemMinima:'8',frete:'10.00'});
 await f.run({acao:'salvarPrecoItem',itemId:ids.item,custoUnitario:'0.50',valorUnitarioMinimo:'1.00'});
 assert.equal((await f.run({})).json.revisaoHash,antes);
 const doHash=f.calls.map(([u])=>u).filter(u=>u.includes('/operacao_itens_resultado?')&&u.includes('id=in.('));
 assert.ok(doHash.length);for(const u of doHash){const sel=new URL(u).searchParams.get('select');assert.equal(sel,'id,organizacao_id,processo_id,tipo,identificador,descricao,quantidade:quantidade::text,valor_unitario_proposta:valor_unitario_proposta::text,marca,modelo,atualizado_em');}
});
