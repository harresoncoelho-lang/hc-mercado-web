// Executa somente o bundle local revisado. Auth, REST e Storage abaixo são fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {RAIZ, SAIDAS, CACHE, conferirProtegidos} = require('./preparar-cloudflare.cjs');
const ORIGEM = 'https://lsqjamqvmrcyrvowndiu.supabase.co';
const SITE = 'https://licitaplena.com.br';
const ids = Object.freeze({usuario:'10000000-0000-0000-0000-000000000001',empresa:'20000000-0000-0000-0000-000000000001',outraEmpresa:'20000000-0000-0000-0000-000000000002',org:'30000000-0000-0000-0000-000000000001',processo:'40000000-0000-0000-0000-000000000001',item1:'50000000-0000-0000-0000-000000000001',item2:'50000000-0000-0000-0000-000000000002',item3:'50000000-0000-0000-0000-000000000003',pdf:'60000000-0000-0000-0000-000000000001',proposta:'70000000-0000-0000-0000-000000000001',declaracao:'70000000-0000-0000-0000-000000000002'});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const escrever = (p,v) => fs.writeFileSync(p,JSON.stringify(v,null,2),{flag:'wx'});
const AUXILIAR='export default {fetch(request,env){if(request.method==="CONNECT")return new Response("CONNECT bloqueado",{status:405});return env.FIXTURES.fetch(request)}}';
const ASSETS_RECUSA='export default {fetch(){return new Response("ASSETS bloqueado no QA",{status:599})}}';
function opcoesWorker(contents,habilitado,outbound,log) {
  const manifest=texto=>({mainModule:'index.js',modules:{'index.js':{type:'esm',contents:texto}}});
  return {host:'127.0.0.1',port:0,cf:false,log,telemetry:{enabled:false},workers:[
    {config:{name:'produto',compatibilityDate:'2025-09-01',compatibilityFlags:['nodejs_compat'],manifest:manifest(contents),env:{IDENTIFICACAO_EMPRESA_LOCAL:{type:'text',value:habilitado?'1':'0'},SUPABASE_SERVICE_ROLE_KEY:{type:'text',value:'QA_SERVICE'},ASSETS:{type:'worker',worker:'assets-deny'}}},dev:{cacheAPI:false,unsafeRegisterWorker:false,outboundService:{type:'worker',worker:'fixture-router'}}},
    {config:{name:'fixture-router',compatibilityDate:'2025-09-01',compatibilityFlags:[],manifest:manifest(AUXILIAR),env:{FIXTURES:{type:'fetcher',handler:outbound}}},dev:{cacheAPI:false,unsafeRegisterWorker:false,outboundService:{type:'worker',worker:'fixture-router'}}},
    {config:{name:'assets-deny',compatibilityDate:'2025-09-01',compatibilityFlags:[],manifest:manifest(ASSETS_RECUSA),env:{}},dev:{cacheAPI:false,unsafeRegisterWorker:false,outboundService:{type:'worker',worker:'assets-deny'}}}
  ]};
}
function pdfFicticio() {
  const linhas=['NOME EMPRESARIAL: EMPRESA FICTICIA QA LTDA','ENDERECO: RUA DE TESTES 100','REPRESENTANTE LEGAL: ANA TESTE','CARGO: SOCIA'];
  const stream='BT /F1 12 Tf 50 760 Td '+linhas.map((v,i)=>(i?'0 -24 Td ':'')+'('+v+') Tj').join('\n')+' ET';
  const objetos=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream'];
  let texto='%PDF-1.4\n';const offsets=[0];
  objetos.forEach((obj,i)=>{offsets.push(Buffer.byteLength(texto));texto+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(texto);texto+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(texto);
}
function criarFixture() {
  const empresa={id:ids.empresa,organizacao_id:ids.org,razao_social:'EMPRESA FICTICIA QA LTDA',cnpj:'11222333000181'};
  const processo={id:ids.processo,empresa_id:ids.empresa,organizacao_id:ids.org,numero:'QA-001/2026',orgao:'ORGAO FICTICIO QA',documentos_exigidos:['Declaração de teste'],atualizado_em:'2026-10-31T00:00:00Z'};
  const itens=[[ids.item1,'Fracao QA','0.125','0.12'],[ids.item2,'Material QA','3','1.23'],[ids.item3,'NAO SELECIONADO','1','900.00']].map(([id,descricao,quantidade,preco],i)=>({id,organizacao_id:ids.org,processo_id:ids.processo,tipo:'item',identificador:String(i+1),descricao,quantidade,valor_unitario_proposta:preco,marca:'QA',modelo:'Ficticio',atualizado_em:'2026-10-31T00:00:00Z'}));
  const caminho=`${ids.org}/${ids.empresa}/ficticio.pdf`;
  const documento={id:ids.pdf,empresa_id:ids.empresa,organizacao_id:ids.org,tipo:'Cartão CNPJ',titulo:'PDF fictício',arquivo_nome:'ficticio.pdf',arquivo_caminho:caminho,criado_em:'2026-10-31T00:00:00Z'};
  const f={empresa,processo,itens,perfil:null,kit:[],aprovado:true,gate:true,papel:'operador',chamadas:[],negados:[],pdf:pdfFicticio()};
  const filtrar=(rows,q)=>rows.filter(r=>['id','usuario_id','empresa_id','organizacao_id','processo_id'].every(k=>!q.has(k)||q.get(k)==='eq.'+r[k]));
  const negar=(u,m,motivo)=>{f.negados.push({origem:u.origin,caminho:u.pathname,metodo:m,motivo});return json({erro:'Saída não declarada bloqueada pela fixture'},599);};
  f.outbound=async request=>{
    const u=new URL(request.url),p=u.pathname,m=request.method,token=request.headers.get('authorization');
    if(u.origin!==ORIGEM)return negar(u,m,'origem');
    const servico=['/rest/v1/rpc/gravar_kit_documento','/rest/v1/rpc/confirmar_identificacao_empresa'].includes(p);
    if(token!=='Bearer '+(servico?'QA_SERVICE':'QA_USER'))return negar(u,m,'credencial');
    const tabelas={clientes:[{id:ids.usuario,status:f.aprovado?'aprovado':'pendente'}],operacao_empresas:[empresa],operacao_identificacao_empresa:f.perfil?[f.perfil]:[],operacao_documentos:[documento],operacao_membros:[{usuario_id:ids.usuario,organizacao_id:ids.org,empresa_id:ids.empresa,papel:f.papel}],operacao_processos:[processo],operacao_itens_resultado:itens,operacao_kit_documentos:f.kit};
    const tabela=p.startsWith('/rest/v1/')?p.slice(9):'';
    let data;
    if(m==='GET'&&p==='/auth/v1/user')data={id:ids.usuario,email:'qa@example.invalid'};
    else if(m==='GET'&&Object.hasOwn(tabelas,tabela))data=filtrar(tabelas[tabela],u.searchParams);
    else if(m==='GET'&&p==='/storage/v1/object/authenticated/operacao-documentos/'+caminho){f.chamadas.push({metodo:m,caminho:p});return new Response(f.pdf,{headers:{'Content-Type':'application/pdf','Content-Length':String(f.pdf.length)}});}
    else if(m==='POST'&&p==='/rest/v1/rpc/identificacao_empresa_habilitada'){assert.deepEqual(await request.json(),{});data=f.gate;}
    else if(m==='POST'&&p==='/rest/v1/rpc/confirmar_identificacao_empresa'){
      const b=await request.json();assert.equal(b.p_empresa,ids.empresa);assert.equal(b.p_usuario,ids.usuario);assert.equal(b.p_cnpj,empresa.cnpj);assert.equal(b.p_razao,empresa.razao_social);
      f.perfil={empresa_id:ids.empresa,organizacao_id:ids.org,versao:(f.perfil?.versao||0)+1,confirmado_em:'2026-10-31T00:00:00Z',confirmado_por:ids.usuario,dados_confirmados:b.p_dados,proveniencia:b.p_proveniencia};data=f.perfil;
    } else if(m==='POST'&&p==='/rest/v1/rpc/gravar_kit_documento'){
      const b=await request.json();assert.equal(b.p_empresa,ids.empresa);assert.equal(b.p_organizacao,ids.org);assert.equal(b.p_processo,ids.processo);assert.equal(b.p_usuario,ids.usuario);
      let d=f.kit.find(x=>x.id===b.p_documento);
      if(b.p_acao==='salvar'&&b.p_versao===0&&!d){d={id:b.p_documento,empresa_id:b.p_empresa,organizacao_id:b.p_organizacao,processo_id:b.p_processo,tipo:b.p_tipo,dados:b.p_dados,versao:1,criado_por:b.p_usuario,atualizado_por:b.p_usuario,criado_em:'2026-10-31T00:00:00Z',atualizado_em:'2026-10-31T00:00:00Z'};f.kit.push(d);}
      else if(!d||d.versao!==b.p_versao||d.tipo!==b.p_tipo)return json({},409);
      else if(b.p_acao==='confirmarRevisao')Object.assign(d,{revisao_hash:b.p_hash,revisao_previa:b.p_previa,revisao_versao:d.versao,revisado_por:b.p_usuario,revisado_em:'2026-10-31T00:00:00Z'});
      else if(b.p_acao==='salvar')Object.assign(d,{dados:b.p_dados,versao:d.versao+1,revisao_hash:null,revisao_previa:null,revisao_versao:null,revisado_por:null,revisado_em:null});
      else return negar(u,m,'ação RPC');data=d;
    } else return negar(u,m,'rota/método');
    f.chamadas.push({metodo:m,caminho:p});return json(data);
  };
  return f;
}
function auditarConfig(config) {
  const servicos=new Map(config.services.map(s=>[s.name,s]));const caminhos=[];
  for(const [nome,codigo] of [['fixture-router',AUXILIAR],['assets-deny',ASSETS_RECUSA]]){const auxiliar=servicos.get('core:user:'+nome)?.worker;assert(auxiliar,'Auxiliar QA ausente');assert.deepEqual(auxiliar.compatibilityFlags||[],[],'Auxiliar não pode habilitar connect_pass_through');assert.equal(auxiliar.modules?.length,1);const sufixo='\n//# sourceURL='+require('node:url').pathToFileURL(path.join(RAIZ,'index.js')).href+'\n';assert([codigo,codigo+sufixo].includes(auxiliar.modules[0].esModule),'Código auxiliar divergente');}
  const conferir=nome=>{const visitados=[];for(;;){assert(nome&&nome!=='internet','Caminho TCP chega a internet ou não tem saída explícita');assert(!visitados.includes(nome),'Ciclo de saída inesperado');visitados.push(nome);const s=servicos.get(nome);assert(s?.worker,'Saída precisa ser Worker QA declarado');if(['core:user:fixture-router','core:user:assets-deny'].includes(nome)){caminhos.push({servicos:visitados,barreira:'Worker auxiliar sem connect_pass_through; CONNECT HTTP recusado'});return;}nome=s.worker.globalOutbound?.name;}};
  for(const nome of ['core:user:produto','core:user:fixture-router','core:user:assets-deny'])conferir(servicos.get(nome)?.worker?.globalOutbound?.name);
  const produto=servicos.get('core:user:produto').worker;assert.equal(produto.compatibilityDate,'2025-09-01');assert.deepEqual(produto.compatibilityFlags,['nodejs_compat']);
  const assets=produto.bindings.find(b=>b.name==='ASSETS');assert.equal(assets?.service?.name,'core:user:assets-deny','ASSETS deve apontar à recusa literal isolada');conferir(assets.service.name);
  return {caminhosTCP:caminhos,semInternet:true};
}
async function encerrarInstancia(instance,guard,prazo=5000) {
  let timer;try{await Promise.race([Promise.resolve().then(()=>instance?.dispose()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo limite para encerrar Miniflare')),prazo);})]);}
  catch(e){await guard.encerrarFilhos(true);throw e;}
  finally{clearTimeout(timer);}
}
function isolamentoHost({antesDeSpawn}={}) {
  // Workerd usa sockets locais para comunicar com Miniflare. Nenhum outro destino é aceito.
  const net=require('node:net'),cp=require('node:child_process');const originalConnect=net.Socket.prototype.connect,originalSpawn=cp.spawn;
  const bloqueados=[],filhos=[],handles=[],restauracoes=[];let encerrando=false;
  const negar=tipo=>{bloqueados.push({tipo});throw new Error('Conexão externa bloqueada no host QA');};
  const substituir=(alvo,nome,valor)=>{const antes=alvo[nome];alvo[nome]=valor;restauracoes.push(()=>{alvo[nome]=antes;});};
  substituir(require('node:dgram'),'createSocket',()=>negar('UDP'));
  const dns=require('node:dns');const local=host=>{if(!['localhost','127.0.0.1','::1'].includes(host))return negar('DNS');return {address:host==='::1'?'::1':'127.0.0.1',family:host==='::1'?6:4};};
  for(const alvo of [dns,dns.promises,dns.Resolver.prototype,dns.promises.Resolver.prototype])for(const nome of Object.getOwnPropertyNames(alvo))if(/^(?:lookup|resolve|reverse)/.test(nome)&&typeof alvo[nome]==='function')substituir(alvo,nome,()=>negar('DNS'));
  dns.lookup=(host,opts,callback)=>{const addr=local(host);const cb=typeof opts==='function'?opts:callback;process.nextTick(()=>opts?.all?cb(null,[addr]):cb(null,addr.address,addr.family));};
  dns.promises.lookup=async(host,opts)=>{const addr=local(host);return opts?.all?[addr]:addr;};
  net.Socket.prototype.connect=function(...args){
    const a=Array.isArray(args[0])?args[0]:args;const opt=typeof a[0]==='object'?a[0]:{port:a[0],host:typeof a[1]==='string'?a[1]:'localhost'};
    if(opt.path||!['127.0.0.1','::1','localhost'].includes(opt.host||'localhost')){bloqueados.push({tipo:'socket',host:String(opt.host||''),porta:opt.port||null});throw new Error('Conexão externa bloqueada no host QA');}
    return originalConnect.apply(this,args);
  };
  cp.spawn=function(exe,args,opts){assert(!encerrando,'Encerramento impede novo subprocesso');assert(/^workerd(?:\.exe)?$/i.test(path.basename(exe)),'Somente workerd local pode iniciar');assert.equal(typeof antesDeSpawn,'function','Runtime precisa de auditoria da configuração antes de iniciar');antesDeSpawn();const child=originalSpawn.call(this,exe,args,{...opts,windowsHide:true});const info={pid:child.pid||null,binario:path.basename(exe),encerrado:false};filhos.push(info);handles.push({child,info});child.once('exit',(code,signal)=>Object.assign(info,{encerrado:true,exitCode:code,signal}));child.once('error',()=>{info.erro=true;});return child;};
  require('node:module').syncBuiltinESMExports();
  return {bloqueados,filhos,async encerrarFilhos(forcar=false){if(forcar)encerrando=true;for(const {child,info} of handles){if(info.encerrado||!child.pid)continue;await new Promise((resolve,reject)=>{const matar=()=>{info.encerramentoForcado=true;child.kill();};const timer=setTimeout(()=>reject(new Error('Filho próprio não encerrou após kill')),4000);const killTimer=setTimeout(matar,forcar?0:2000);child.once('exit',()=>{clearTimeout(timer);clearTimeout(killTimer);resolve();});});}},restaurar(){net.Socket.prototype.connect=originalConnect;cp.spawn=originalSpawn;restauracoes.reverse().forEach(fn=>fn());require('node:module').syncBuiltinESMExports();}};
}
async function executar(rodada,inspecionar=false,execucao=inspecionar?'preflight-config':'runtime') {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rodada),'Rodada inválida');
  const pasta=path.join(SAIDAS,rodada),worker=path.join(pasta,'worker/index.js');
  const manifesto=JSON.parse(fs.readFileSync(path.join(pasta,'manifesto-worker.json'),'utf8'));
  assert.equal(sha(fs.readFileSync(worker)),manifesto.find(x=>x.arquivo==='index.js')?.sha256,'Bundle mudou');
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(execucao),'Nome de execução inválido');const destino=path.join(pasta,execucao);assert(!fs.existsSync(destino),'Já tem evidência; não sobrescrever');fs.mkdirSync(destino);
  const protegido=conferirProtegidos();const checks=[],f=criarFixture();let erro=null,atual=null,configPath=null;const configOriginal=process.env.MINIFLARE_WORKERD_CONFIG_DEBUG;
  const isolamento=isolamentoHost({antesDeSpawn(){const config=JSON.parse(fs.readFileSync(configPath,'utf8'));escrever(configPath+'.auditoria.json',auditarConfig(config));if(inspecionar)throw new Error('CONFIGURACAO_INSPECIONADA_SEM_WORKERD');}});
  const registrar=(nome,dados={})=>{checks.push({nome,...dados});escrever(path.join(destino,String(checks.length).padStart(2,'0')+'.json'),checks.at(-1));};
  escrever(path.join(destino,'inicio.json'),{utc:new Date().toISOString(),bundleSha256:manifesto[0].sha256,auth:'fixture fictícia, sem servidor Supabase',banco:'fixture em memória; não valida SQL/RLS reais',storage:'PDF fictício em memória',outbound:'auxiliar QA sem connect_pass_through e CONNECT HTTP recusado; ASSETS recusa literal; host só loopback e sem DNS/UDP',inspecionar,scriptSha256:sha(fs.readFileSync(__filename))});
  const limite=setTimeout(async()=>{try{await isolamento.encerrarFilhos(true);escrever(path.join(destino,'watchdog.json'),{erro:'Limite de 120 segundos excedido',filhos:isolamento.filhos});}finally{process.exit(1);}},120000);limite.unref();
  try {
    const pkg=JSON.parse(fs.readFileSync(path.join(CACHE,'miniflare/package.json'),'utf8'));assert.equal(pkg.version,'5.20261012.1-beta');
    const {Miniflare,Log,LogLevel}=require(path.join(CACHE,'miniflare'));
    const iniciar=async habilitado=>{configPath=path.join(destino,habilitado?'config-on.json':'config-off.json');assert(!fs.existsSync(configPath));process.env.MINIFLARE_WORKERD_CONFIG_DEBUG=configPath;atual=new Miniflare(opcoesWorker(fs.readFileSync(worker,'utf8'),habilitado,f.outbound,new Log(LogLevel.ERROR)));await atual.ready;};
    const chamar=async(rota,body,esperado,token=true)=>{
      assert(['empresa-identificacao','kit-documentos'].includes(rota),'Handler fora do escopo');
      const r=await atual.dispatchFetch(SITE+'/api/'+rota,{method:'POST',headers:{'Content-Type':'application/json',Origin:SITE,...(token?{Authorization:'Bearer QA_USER'}:{})},body:JSON.stringify(body)});
      const texto=await r.text();assert.equal(r.status,esperado,rota+'/'+body.acao+': '+texto.slice(0,240));assert.match(r.headers.get('content-type')||'',/application\/json/);return JSON.parse(texto);
    };
    const kit={empresaId:ids.empresa,processoId:ids.processo};const cadastro={empresaId:ids.empresa};
    await iniciar(false);
    for(const rota of ['empresa-identificacao','kit-documentos'])await chamar(rota,{...kit,acao:'consultar'},503);
    assert.equal(f.chamadas.length,0);registrar('Dois handlers retornam 503 com módulo desabilitado, sem saída externa');await encerrarInstancia(atual,isolamento);atual=null;
    await iniciar(true);
    for(const rota of ['empresa-identificacao','kit-documentos'])await chamar(rota,{...kit,acao:'consultar'},401,false);
    assert.equal(f.chamadas.length,0);registrar('Dois handlers retornam 401 sem sessão, sem consultar Auth');
    f.aprovado=false;for(const rota of ['empresa-identificacao','kit-documentos'])await chamar(rota,{...kit,acao:'consultar'},403);f.aprovado=true;registrar('Dois handlers recusam usuário não aprovado');
    f.gate=false;await chamar('empresa-identificacao',{...cadastro,acao:'consultar'},503);f.gate=true;registrar('Gate de isolamento fechado recusa cadastro');
    f.papel='leitura';await chamar('kit-documentos',{...kit,acao:'consultar'},403);f.papel='operador';registrar('Papel de leitura não prepara proposta');
    for(const rota of ['empresa-identificacao','kit-documentos'])await chamar(rota,{...kit,empresaId:ids.outraEmpresa,acao:'consultar'},404);registrar('CNPJ/empresa fora da fixture do usuário fica indisponível');
    const c=await chamar('empresa-identificacao',{...cadastro,acao:'consultar'},200);assert.equal(c.empresa.cnpj,f.empresa.cnpj);assert.equal(c.perfil,null);registrar('Cadastro entrega identidade do CNPJ esperado');
    const x=await chamar('empresa-identificacao',{...cadastro,acao:'extrair',documentoId:ids.pdf},200);assert.equal(x.modo,'sugestoes','Fallback manual não comprova parser no Worker');assert.equal(x.sugestoes.razaoSocial,f.empresa.razao_social);assert.equal(x.evidencias.length,4);assert.equal(x.hash,sha(f.pdf));registrar('Parser do bundle lê PDF fictício com quatro evidências');
    const confirmar={...cadastro,acao:'confirmar',revisado:true,razaoSocial:f.empresa.razao_social,cnpj:f.empresa.cnpj,dados:{endereco:'RUA DE TESTES 100',representante:'ANA TESTE',cargo:'SOCIA'},proveniencia:[]};
    await chamar('empresa-identificacao',{...confirmar,cnpj:'99999999000199'},409);
    assert.equal((await chamar('empresa-identificacao',confirmar,200)).perfil.status,'confirmado');registrar('Confirmação rejeita CNPJ divergente e salva dados fictícios revisados');
    const consulta=await chamar('kit-documentos',{...kit,acao:'consultar'},200);assert.equal(consulta.identificacao.status,'confirmado');assert.equal(consulta.itens.length,3);registrar('Kit consulta perfil confirmado e itens do processo');
    const proposta={itemIds:[ids.item1,ids.item2],unidades:{[ids.item1]:'un',[ids.item2]:'un'},validade:'30 dias',prazoEntrega:'10 dias',pagamento:'30 dias'};
    const propostas=[{id:ids.proposta,tipo:'proposta',proposta},{id:ids.declaracao,tipo:'declaracao',declaracao:{titulo:'Declaração fictícia QA',texto:'{{razao_social}}, CNPJ {{cnpj}}, representada por {{representante}}, declara ciência do edital {{numero_edital}}.',fonte:'Modelo fictício QA'}}];
    const Zip=require(path.join(RAIZ,'node_modules/adm-zip'));
    for(const p of propostas){
      const {id,...draft}=p;const target={...kit,documentoId:id,versaoEsperada:1};
      const salvo=await chamar('kit-documentos',{...target,...draft,acao:'salvar',versaoEsperada:0},200);assert.equal(salvo.documento.empresaId,ids.empresa);assert.equal(salvo.documento.versao,1);
      assert.equal((await chamar('kit-documentos',{...target,acao:'abrir'},200)).revisaoVigente,false);
      const pre=await chamar('kit-documentos',{...target,acao:'preparar'},200);assert.match(pre.previa.texto,/11222333000181/);assert.match(pre.previa.texto,/ANA TESTE/);
      if(p.tipo==='proposta'){assert.match(pre.previa.texto,/Total da proposta: R\$ 3,71/);assert.match(pre.previa.texto,/Total: R\$ 0,02/);assert(!pre.previa.texto.includes('NAO SELECIONADO'));}
      const reviewed={...target,revisaoHash:pre.revisaoHash,revisado:true};
      await chamar('kit-documentos',{...reviewed,acao:'exportar'},409);
      await chamar('kit-documentos',{...reviewed,acao:'confirmarRevisao',revisado:false},422);
      await chamar('kit-documentos',{...reviewed,acao:'confirmarRevisao'},200);
      assert.equal((await chamar('kit-documentos',{...target,acao:'abrir'},200)).revisaoVigente,true);
      const exp=await chamar('kit-documentos',{...reviewed,acao:'exportar'},200);assert.equal(exp.mime,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const bytes=Buffer.from(exp.arquivoBase64,'base64');assert.equal(bytes.subarray(0,2).toString(),'PK');const zip=new Zip(bytes);assert(zip.test());const xml=zip.readAsText('word/document.xml');assert.match(xml,/11222333000181/);assert.match(xml,/ANA TESTE/);if(p.tipo==='proposta'){assert.match(xml,/3,71/);assert(!xml.includes('NAO SELECIONADO'));}
      fs.writeFileSync(path.join(destino,p.tipo+'-ficticia.docx'),bytes,{flag:'wx'});registrar(p.tipo+': salvar, reabrir, mostrar prévia, revisar e exportar DOCX',{bytes:bytes.length,sha256:sha(bytes)});
      if(p.tipo==='proposta'){f.itens[0].valor_unitario_proposta='0.20';await chamar('kit-documentos',{...reviewed,acao:'exportar'},409);f.itens[0].valor_unitario_proposta='0.12';registrar('Preço alterado invalida revisão anterior da proposta');}
    }
    assert.equal((await chamar('kit-documentos',{...kit,acao:'listar'},200)).documentos.length,2);registrar('Lista contém duas peças persistidas na fixture do mesmo CNPJ');
    assert.equal(f.negados.length,0);assert.equal(isolamento.bloqueados.length,0);assert.deepEqual(conferirProtegidos(),protegido);assert.equal(sha(fs.readFileSync(worker)),manifesto[0].sha256);
  } catch(e){erro={nome:e.name,mensagem:e.message,stack:e.stack};}
  finally {
    if(atual){try{await encerrarInstancia(atual,isolamento);}catch(e){erro ||= {nome:e.name,mensagem:'Falha ao encerrar Miniflare: '+e.message};}}
    // O evento exit pode ser entregue no próximo giro após dispose.
    await new Promise(resolve=>setImmediate(resolve));await isolamento.encerrarFilhos();await new Promise(resolve=>setImmediate(resolve));isolamento.restaurar();clearTimeout(limite);
    if(configOriginal===undefined)delete process.env.MINIFLARE_WORKERD_CONFIG_DEBUG;else process.env.MINIFLARE_WORKERD_CONFIG_DEBUG=configOriginal;
    if(isolamento.filhos.some(x=>!x.encerrado))erro ||= {nome:'ProcessoNaoEncerrado',mensagem:'Há filho workerd sem evento de encerramento'};
    escrever(path.join(destino,'resultado.json'),{utc:new Date().toISOString(),ok:!erro,erro,checks:checks.length,fixtures:true,naoValidaSQLReal:true,chamadas:f.chamadas,saidasNaoDeclaradas:f.negados,hostBloqueados:isolamento.bloqueados,filhos:isolamento.filhos,protegidos:conferirProtegidos().length});
  }
  if(erro)throw new Error(erro.mensagem);return {destino,checks:checks.length,fixtures:true,publicado:false};
}
module.exports={criarFixture,pdfFicticio,isolamentoHost,auditarConfig,encerrarInstancia,opcoesWorker,AUXILIAR,ASSETS_RECUSA,ORIGEM,ids,executar};
if(require.main===module){const args=process.argv.slice(2);try{assert.equal(args.shift(),'--rodada');const rodada=args.shift();let inspecionar=false,execucao;while(args.length){const opt=args.shift();if(opt==='--inspecionar'&&!inspecionar)inspecionar=true;else if(opt==='--execucao'&&execucao===undefined)execucao=args.shift();else throw new Error('Argumento inválido');}executar(rodada,inspecionar,execucao).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});}catch(e){console.error('Uso: --rodada rodada-compilada-revisada [--execucao nome-novo] [--inspecionar]');process.exitCode=1;}}
