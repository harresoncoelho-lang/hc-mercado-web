const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {handler}=require('../empresa-identificacao');
const {cpfValido,validarPerfilEmpresa,validarPremissas,dimensoesImagem,ufDoEndereco}=require('../_empresa_identificacao');
const ids={empresa:'11111111-1111-1111-1111-111111111111',org:'44444444-4444-4444-4444-444444444444',outra:'55555555-5555-5555-5555-555555555555'};
const CPF='52998224725';const BANCO={banco:'Banco QA 341',agencia:'9876',conta:'54321-0',pix:'chave-pix-qa@exemplo.com',favorecido:'Favorecido QA'};
const sha=b=>createHash('sha256').update(b).digest('hex');
function png(w,h,extra=0){const b=Buffer.alloc(33+extra);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12,'latin1');b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;}
function jpeg(w,h){const app=Buffer.from([0xff,0xe0,0,16,...Buffer.from('JFIF\0'),1,1,0,0,1,0,1,0,0]);const sof=Buffer.alloc(19);sof.set([0xff,0xc0,0,17,8]);sof.writeUInt16BE(h,5);sof.writeUInt16BE(w,7);return Buffer.concat([Buffer.from([0xff,0xd8]),app,sof,Buffer.from([0xff,0xd9])]);}
function fixture(t,changes={}){
 const state={papel:'gestor',perfil:{empresa_id:ids.empresa,organizacao_id:ids.org,nome_fantasia:'QA',cpf_representante:CPF,banco:BANCO,proposta_padrao:{},logo_caminho:null,logo_hash:null,versao:3},premissas:[{segmento:'*',uf:'*',margem_percentual:20,margem_minima_percentual:10}],semTabela:false,objeto:null,escritas:[],...changes};
 t.mock.method(global,'fetch',async(url,op={})=>{
  assert.equal(op.headers.Authorization,'Bearer QA');let data;
  if(state.semTabela&&/operacao_(perfil|premissas)_empresa/.test(url))return new Response(JSON.stringify({code:'PGRST205',message:'Could not find the table'}),{status:404});
  if(url.includes('/auth/v1/user'))data={id:'usuario'};
  else if(url.includes('/clientes?'))data=[{status:'aprovado'}];
  else if(url.includes('/rpc/identificacao_empresa_habilitada'))data=true;
  else if(url.includes('/operacao_empresas?'))data=[{id:ids.empresa,organizacao_id:ids.org,razao_social:'Empresa QA',cnpj:'11222333000181'}];
  else if(url.includes('/operacao_identificacao_empresa?'))data=state.identificacao||[];
  else if(url.includes('/operacao_documentos?'))data=[];
  else if(url.includes('/operacao_membros?'))data=[{usuario_id:'usuario',organizacao_id:ids.org,empresa_id:null,papel:state.papel}];
  else if(url.includes('/operacao_perfil_empresa')){
   if(op.method==='POST'){const row=JSON.parse(op.body);state.escritas.push(['perfil',row]);state.perfil={...state.perfil,...row,versao:(state.perfil?.versao||0)+1};data=[state.perfil];}
   else data=state.papel==='leitura'||!state.perfil?[]:[state.perfil];
  }
  else if(url.includes('/operacao_premissas_empresa')){if(op.method==='DELETE'){state.escritas.push(['remover',decodeURIComponent(url.split('?')[1])]);data=[];}else if(op.method==='POST'){const rows=JSON.parse(op.body);state.escritas.push(['premissas',rows]);data=rows;}else data=state.premissas;}
  else if(url.includes('/storage/v1/object/sign/')){state.assinou=JSON.parse(op.body);data={signedURL:'/object/sign/operacao-documentos/x?token=t'};}
  else if(url.includes('/storage/v1/object/authenticated/')){if(!state.objeto)return new Response('{}',{status:400});return new Response(state.objeto);}
  else throw new Error('URL inesperada '+url);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 });
 const old=process.env.IDENTIFICACAO_EMPRESA_LOCAL;process.env.IDENTIFICACAO_EMPRESA_LOCAL='1';t.after(()=>{if(old===undefined)delete process.env.IDENTIFICACAO_EMPRESA_LOCAL;else process.env.IDENTIFICACAO_EMPRESA_LOCAL=old;});
 const run=async body=>{const r=await handler({httpMethod:'POST',headers:{authorization:'Bearer QA'},body:JSON.stringify({empresaId:ids.empresa,...body})});return {...r,json:JSON.parse(r.body)};};
 return {state,run};
}
const caminhoLogo=(h,ext='png',empresa=ids.empresa,pasta='perfil')=>`${ids.org}/${empresa}/${pasta}/logo-${h}.${ext}`;

test('lerPerfil mascara o CPF; só gestor com mostrarCpf vê completo; devolve premissas e URL curta da logo',async t=>{
 const f=fixture(t);
 const r=await f.run({acao:'lerPerfil'});assert.equal(r.statusCode,200);
 assert.equal(r.json.perfil.cpf_representante,'***.***.***-25');assert.equal(r.json.premissas.length,1);assert.equal(r.json.logoUrl,null);
 assert.equal((await f.run({acao:'lerPerfil',mostrarCpf:true})).json.perfil.cpf_representante,CPF);
 f.state.papel='operador';assert.equal((await f.run({acao:'lerPerfil',mostrarCpf:true})).json.perfil.cpf_representante,'***.***.***-25');
 const h='a'.repeat(64);f.state.perfil={...f.state.perfil,logo_caminho:caminhoLogo(h),logo_hash:h};
 const l=await f.run({acao:'lerPerfil'});assert.match(l.json.logoUrl,/\/storage\/v1\/object\/sign\/operacao-documentos\/x\?token=t$/);assert.deepEqual(f.state.assinou,{expiresIn:300});
 f.state.perfil=null;const vazio=await f.run({acao:'lerPerfil'});assert.equal(vazio.statusCode,200);assert.equal(vazio.json.perfil,null);
});
test('papel leitura recebe 403 ao ler e ao salvar',async t=>{
 const f=fixture(t,{papel:'leitura'});
 const r=await f.run({acao:'lerPerfil'});assert.equal(r.statusCode,403);assert.equal(r.json.erro,'Seu papel não permite ver os dados do perfil.');
 assert.equal((await f.run({acao:'salvarPerfil',perfil:{nome_fantasia:'X'}})).statusCode,403);
 assert.equal((await f.run({acao:'registrarLogo',caminho:caminhoLogo('a'.repeat(64)),hash:'a'.repeat(64)})).statusCode,403);
 assert.equal(f.state.escritas.length,0);
});
test('banco sem a tabela do perfil responde 503 amigável',async t=>{
 const f=fixture(t,{semTabela:true});
 for(const body of [{acao:'lerPerfil'},{acao:'salvarPerfil',perfil:{nome_fantasia:'X'}}]){const r=await f.run(body);assert.equal(r.statusCode,503);assert.match(r.json.erro,/perfil da empresa ainda não está disponível/);}
});
test('salvarPerfil grava perfil e premissas normalizados em um upsert cada',async t=>{
 const f=fixture(t);
 const r=await f.run({acao:'salvarPerfil',perfil:{nome_fantasia:' Loja  QA ',telefone:'(92) 3333-4444',email:'QA@Exemplo.com',inscricao_estadual:'ISENTO',inscricao_municipal:'12345',porte:'epp',regime_tributario:'simples',aliquota_efetiva:'6,5',cpf_representante:'529.982.247-25',banco:BANCO,proposta_padrao:{validade:'60 dias',pagamento:'30 dias',prazo_entrega:'10 dias'}},premissas:[{segmento:' Informática ',uf:'am',margem_percentual:25,margem_minima_percentual:'10'},{}]});
 assert.equal(r.statusCode,200);assert.equal(r.json.perfil.cpf_representante,'***.***.***-25');
 const [[,perfil],[,premissas]]=f.state.escritas;
 assert.equal(perfil.nome_fantasia,'Loja QA');assert.equal(perfil.email,'qa@exemplo.com');assert.equal(perfil.aliquota_efetiva,6.5);assert.equal(perfil.cpf_representante,CPF);assert.equal(perfil.empresa_id,ids.empresa);assert.equal(perfil.organizacao_id,ids.org);
 assert.deepEqual(premissas.map(p=>[p.segmento,p.uf,p.margem_minima_percentual]),[['informática','AM',10],['*','*',null]]);
 assert.equal(premissas[0].empresa_id,ids.empresa);assert.equal(r.json.premissas.length,2);
});
test('cada validação do perfil responde 422 com o campo e não grava',async t=>{
 const f=fixture(t);
 const casos=[
  [{porte:'grande'},'porte'],[{regime_tributario:'lucro'},'regime_tributario'],[{aliquota_efetiva:100},'aliquota_efetiva'],[{aliquota_efetiva:-1},'aliquota_efetiva'],[{aliquota_efetiva:'abc'},'aliquota_efetiva'],
  [{cpf_representante:'123'},'cpf_representante'],[{cpf_representante:'52998224724'},'cpf_representante'],[{cpf_representante:'11111111111'},'cpf_representante'],
  [{email:'sem-arroba'},'email'],[{telefone:'12'},'telefone'],[{telefone:'abcdefghijk'},'telefone'],
  [{inscricao_estadual:'9'.repeat(31)},'inscricao_estadual'],[{inscricao_municipal:'9'.repeat(31)},'inscricao_municipal'],
  [{banco:{...BANCO,cvv:'123'}},'banco'],[{banco:{conta:'9'.repeat(121)}},'banco.conta'],[{banco:{pix:42}},'banco.pix'],[{banco:'texto'},'banco'],
  [{proposta_padrao:{validade:'30',garantia:'x'}},'proposta_padrao'],[{logo_caminho:'x'},'perfil'],
 ];
 for(const [perfil,campo] of casos){const r=await f.run({acao:'salvarPerfil',perfil});assert.equal(r.statusCode,422,JSON.stringify(perfil));assert.equal(r.json.campo,campo,JSON.stringify(perfil));}
 assert.equal((await f.run({acao:'salvarPerfil'})).json.campo,'perfil');
 assert.equal(f.state.escritas.length,0);
 assert.equal(cpfValido(CPF),true);assert.equal(cpfValido('52998224715'),false);
 assert.deepEqual(validarPerfilEmpresa({tributos_fonte:'',proposta_padrao:null,banco:null}),{tributos_fonte:'manual',proposta_padrao:{},banco:null});
});
test('premissas inválidas respondem 422 antes de gravar o perfil',async t=>{
 const f=fixture(t);
 const casos=[
  ['x','premissas'],[Array(51).fill({}),'premissas'],[[{uf:'AMZ'}],'premissas[0].uf'],[[{segmento:'a'.repeat(81)}],'premissas[0].segmento'],
  [[{margem_percentual:10,margem_minima_percentual:15}],'premissas[0].margem_minima_percentual'],[[{margem_minima_percentual:5}],'premissas[0].margem_minima_percentual'],
  [[{frete_percentual:101}],'premissas[0].frete_percentual'],[[{segmento:'A',uf:'am'},{segmento:'a',uf:'AM'}],'premissas[1]'],[[{custo:1}],'premissas[0]'],
 ];
 for(const [premissas,campo] of casos){const r=await f.run({acao:'salvarPerfil',perfil:{nome_fantasia:'QA'},premissas});assert.equal(r.statusCode,422);assert.equal(r.json.campo,campo);}
 assert.equal(f.state.escritas.length,0);assert.deepEqual(validarPremissas([]),[]);
});
test('logo inválida responde 422 e não grava',async t=>{
 const f=fixture(t);
 const tentar=async(objeto,{h=sha(objeto),caminho=caminhoLogo(h)}={})=>{f.state.objeto=objeto;return f.run({acao:'registrarLogo',caminho,hash:h});};
 const gif=Buffer.from('GIF89a'+'\0'.repeat(30));
 let r=await tentar(gif);assert.equal(r.statusCode,422);assert.equal(r.json.campo,'logo');
 r=await tentar(png(100,100,512*1024));assert.equal(r.statusCode,422);assert.match(r.json.erro,/512 KB/);
 r=await tentar(png(2001,100));assert.equal(r.statusCode,422);assert.match(r.json.erro,/2000 px/);
 const j=jpeg(100,2400);r=await tentar(j,{h:sha(j),caminho:caminhoLogo(sha(j),'jpg')});assert.equal(r.statusCode,422);assert.match(r.json.erro,/2000 px/);
 const p=png(100,100);r=await tentar(p,{h:'b'.repeat(64),caminho:caminhoLogo('b'.repeat(64))});assert.equal(r.statusCode,422);assert.equal(r.json.campo,'hash');
 r=await tentar(p,{h:sha(p),caminho:caminhoLogo(sha(p),'jpg')});assert.equal(r.statusCode,422);assert.equal(r.json.campo,'logo');
 for(const caminho of [caminhoLogo(sha(p),'png',ids.outra),caminhoLogo(sha(p),'png',ids.empresa,'docs'),`${ids.org}/${ids.empresa}/perfil/../logo-${sha(p)}.png`,caminhoLogo('c'.repeat(64)),`${ids.org}/${ids.empresa}/perfil/x/logo-${sha(p)}.png`]){
  r=await tentar(p,{caminho});assert.equal(r.statusCode,422,caminho);assert.equal(r.json.campo,'caminho');
 }
 assert.equal((await f.run({acao:'registrarLogo',caminho:caminhoLogo('x'),hash:'X'})).json.campo,'hash');
 assert.equal(f.state.escritas.length,0);
});
test('logo PNG e JPEG válidas gravam caminho e hash',async t=>{
 const f=fixture(t);
 for(const [img,ext] of [[png(2000,800),'png'],[jpeg(640,480),'jpeg']]){
  f.state.objeto=img;const h=sha(img);const r=await f.run({acao:'registrarLogo',caminho:caminhoLogo(h,ext),hash:h});
  assert.equal(r.statusCode,200);assert.equal(r.json.logo.hash,h);assert.equal(f.state.escritas.at(-1)[1].logo_caminho,caminhoLogo(h,ext));assert.deepEqual(Object.keys(f.state.escritas.at(-1)[1]).sort(),['empresa_id','logo_caminho','logo_hash','organizacao_id']);
 }
 assert.deepEqual(dimensoesImagem(jpeg(640,480)),{tipo:'image/jpeg',largura:640,altura:480});
});
test('LGPD: CPF e banco nunca aparecem em console.* nem em mensagens de erro',async t=>{
 const saida=[];for(const m of ['log','info','warn','error','debug'])t.mock.method(console,m,(...a)=>saida.push(a.map(String).join(' ')));
 const f=fixture(t);const respostas=[];
 const sensiveis=[CPF,'52998224724',...Object.values(BANCO),'9'.repeat(121)];
 respostas.push(await f.run({acao:'salvarPerfil',perfil:{cpf_representante:'529.982.247-24',banco:BANCO}}));
 respostas.push(await f.run({acao:'salvarPerfil',perfil:{cpf_representante:CPF,banco:{...BANCO,conta:'9'.repeat(121)}}}));
 respostas.push(await f.run({acao:'salvarPerfil',perfil:{cpf_representante:CPF,banco:BANCO,[CPF]:'x'}}));
 respostas.push(await f.run({acao:'salvarPerfil',perfil:{cpf_representante:CPF,banco:BANCO},premissas:[{segmento:CPF,uf:BANCO.conta}]}));
 f.state.semTabela=true;respostas.push(await f.run({acao:'salvarPerfil',perfil:{cpf_representante:CPF,banco:BANCO}}));
 f.state.semTabela=false;t.mock.method(global,'fetch',async()=>{throw new Error('falha de rede com '+CPF);});
 respostas.push(await f.run({acao:'salvarPerfil',perfil:{cpf_representante:CPF,banco:BANCO}}));
 assert.ok(respostas.every(r=>r.statusCode>=400));
 const texto=saida.join('\n')+respostas.map(r=>r.body).join('\n');
 for(const s of sensiveis)assert.equal(texto.includes(s),false,'vazou um valor sensível');
});
test('salvarPerfil remove premissas pelo segmento e UF, com escopo da empresa e antes do upsert',async t=>{
 const f=fixture(t);
 const r=await f.run({acao:'salvarPerfil',perfil:{},premissas:[{}],premissasRemover:[{segmento:' Limpeza, Geral ',uf:'am'},{segmento:'obras'}]});
 assert.equal(r.statusCode,200);
 assert.deepEqual(f.state.escritas.map(e=>e[0]),['perfil','remover','remover','premissas']);
 assert.equal(f.state.escritas[1][1],`empresa_id=eq.${ids.empresa}&organizacao_id=eq.${ids.org}&segmento=eq.limpeza, geral&uf=eq.AM`);
 assert.match(f.state.escritas[2][1],/&segmento=eq\.obras&uf=eq\.\*$/);
});
test('premissasRemover inválido responde 422 e não grava nada; Padrão nunca é removida',async t=>{
 const f=fixture(t);
 const casos=[
  [{premissasRemover:[{}]},'premissasRemover[0]'],[{premissasRemover:[{segmento:'*',uf:'*'}]},'premissasRemover[0]'],
  [{premissasRemover:'x'},'premissasRemover'],[{premissasRemover:Array(51).fill({segmento:'a'})},'premissasRemover'],
  [{premissasRemover:[{uf:'AMZ'}]},'premissasRemover[0].uf'],[{premissasRemover:[{segmento:'a',margem_percentual:1}]},'premissasRemover[0]'],
  [{premissasRemover:[{segmento:'a'},{segmento:'A'}]},'premissasRemover[1]'],
  [{premissas:[{segmento:'obras',uf:'PA'}],premissasRemover:[{segmento:'Obras',uf:'pa'}]},'premissasRemover[0]'],
 ];
 for(const [extra,campo] of casos){const r=await f.run({acao:'salvarPerfil',perfil:{},...extra});assert.equal(r.statusCode,422,JSON.stringify(extra));assert.equal(r.json.campo,campo,JSON.stringify(extra));}
 assert.equal(f.state.escritas.length,0);
});
test('uf_sede: salva normalizada, recusa fora da lista e sugere a UF do endereço confirmado só quando vazia',async t=>{
 assert.deepEqual(validarPerfilEmpresa({uf_sede:' am '}),{uf_sede:'AM'});
 assert.deepEqual(validarPerfilEmpresa({uf_sede:''}),{uf_sede:null});
 for(const v of ['XX','AMZ',12,'A M'])assert.throws(()=>validarPerfilEmpresa({uf_sede:v}),e=>e.status===422&&e.campo==='uf_sede'&&!e.message.includes(String(v)));
 assert.equal(ufDoEndereco('Rua das Flores, 10, Centro, Manaus/AM, CEP 69000-000'),'AM');
 assert.equal(ufDoEndereco('AV BRASIL 100 SALA 2 CENTRO BELEM - PA 66000-000'),'PA');
 assert.equal(ufDoEndereco('Rua de Souza, 10, Centro, Manaus, am'),'AM');
 assert.equal(ufDoEndereco('Rua de Souza, 10, Centro'),null);
 assert.equal(ufDoEndereco(null),null);
 const f=fixture(t);
 const s=await f.run({acao:'salvarPerfil',perfil:{uf_sede:'pa'}});assert.equal(s.statusCode,200);
 assert.equal(f.state.escritas[0][1].uf_sede,'PA');
 assert.equal((await f.run({acao:'lerPerfil'})).json.perfil.uf_sede,'PA');
 assert.equal((await f.run({acao:'salvarPerfil',perfil:{uf_sede:'ZZ'}})).json.campo,'uf_sede');
 // Sem UF salva: sugere a do endereço confirmado; identificação invalidada não sugere.
 f.state.perfil={...f.state.perfil,uf_sede:null};
 f.state.identificacao=[{dados_confirmados:{endereco:'Rua X, 1, Manaus/AM'},proveniencia:[],invalidado_em:null}];
 assert.equal((await f.run({acao:'lerPerfil'})).json.ufSedeSugerida,'AM');
 f.state.identificacao[0].invalidado_em='2026-11-01T00:00:00Z';
 assert.equal((await f.run({acao:'lerPerfil'})).json.ufSedeSugerida,null);
 f.state.identificacao[0].invalidado_em=null;f.state.perfil.uf_sede='PA';
 assert.equal((await f.run({acao:'lerPerfil'})).json.ufSedeSugerida,null);
});
