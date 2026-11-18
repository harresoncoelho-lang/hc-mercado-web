const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const arquivo = path.join(__dirname, 'testar-worker.cjs');
test('harness isolado existe', () => assert(fs.existsSync(arquivo), 'Falta harness do bundle real'));
test('fixture recusa domínio, método, rota e credencial não declarados', async () => {
  if (!fs.existsSync(arquivo)) return;
  const { criarFixture, ORIGEM, ids } = require(arquivo); const f = criarFixture();
  for (const [url, method, token] of [['https://example.invalid/a','GET','QA_USER'],[ORIGEM+'/auth/v1/user','DELETE','QA_USER'],[ORIGEM+'/rest/v1/nao-autorizada','GET','QA_USER'],[ORIGEM+'/auth/v1/user','GET','REAL_TOKEN_FORBIDDEN']]) {
    assert.equal((await f.outbound(new Request(url, {method, headers:{Authorization:'Bearer '+token}}))).status, 599);
  }
  assert.equal(f.negados.length, 4); assert.equal(f.chamadas.length, 0);
  const r = await f.outbound(new Request(ORIGEM+'/auth/v1/user', {headers:{Authorization:'Bearer QA_USER'}}));
  assert.equal((await r.json()).id, ids.usuario);
});
test('fixture de consulta respeita empresa e organização solicitadas', async () => {
  if (!fs.existsSync(arquivo)) return;
  const {criarFixture, ORIGEM, ids} = require(arquivo); const f=criarFixture();
  const get = async p => (await f.outbound(new Request(ORIGEM+'/rest/v1/'+p,{headers:{Authorization:'Bearer QA_USER'}}))).json();
  assert.equal((await get('operacao_empresas?id=eq.'+ids.empresa)).length,1);
  assert.deepEqual(await get('operacao_empresas?id=eq.'+ids.outraEmpresa),[]);
  assert.deepEqual(await get('operacao_processos?id=eq.'+ids.processo+'&empresa_id=eq.'+ids.outraEmpresa),[]);
});
test('PDF fictício possui texto extraível antes de testar Workers', async () => {
  if (!fs.existsSync(arquivo)) return;
  const { criarFixture, pdfFicticio } = require(arquivo); const bytes=pdfFicticio();
  const {extrairDocumento}=require('../../../netlify/functions/_empresa_documentos');
  const r=await extrairDocumento(bytes); assert.equal(r.modo,'sugestoes');
  assert.equal(r.sugestoes.razaoSocial, criarFixture().empresa.razao_social);
  assert.equal(r.sugestoes.representante,'ANA TESTE');
  assert.equal(r.evidencias.length,4);
});
test('host recusa conexão externa antes de criar socket e restaura a função',()=>{
  const {isolamentoHost}=require(arquivo);const net=require('node:net'),original=net.Socket.prototype.connect;const guard=isolamentoHost();
  try{assert.throws(()=>net.connect(443,'example.invalid'),/externa bloqueada/);assert.throws(()=>require('node:dgram').createSocket('udp4'),/externa bloqueada/);assert.throws(()=>require('node:dns').lookup('example.invalid',()=>{}),/externa bloqueada/);assert.throws(()=>new (require('node:dns').Resolver)().resolve4('example.invalid',()=>{}),/externa bloqueada/);assert.equal(guard.bloqueados.length,4);}finally{guard.restaurar();}
  assert.equal(net.Socket.prototype.connect,original);
});
test('auditoria TCP recusa internet e auxiliar com passthrough',()=>{
  const {auditarConfig,AUXILIAR,ASSETS_RECUSA}=require(arquivo);const config={services:[{name:'core:user:produto',worker:{compatibilityDate:'2025-09-01',compatibilityFlags:['nodejs_compat'],globalOutbound:{name:'router'},bindings:[{name:'ASSETS',service:{name:'core:user:assets-deny'}}]}},{name:'router',worker:{globalOutbound:{name:'core:user:fixture-router'}}},{name:'core:user:fixture-router',worker:{compatibilityFlags:[],modules:[{esModule:AUXILIAR}],globalOutbound:{name:'router'}}},{name:'core:user:assets-deny',worker:{compatibilityFlags:[],modules:[{esModule:ASSETS_RECUSA}],globalOutbound:{name:'core:user:assets-deny'}}}]};
  assert.doesNotThrow(()=>auditarConfig(config));
  const sufixo='\n//# sourceURL='+require('node:url').pathToFileURL(path.join(require('./preparar-cloudflare.cjs').RAIZ,'index.js')).href+'\n';
  config.services[2].worker.modules[0].esModule=AUXILIAR+sufixo;assert.doesNotThrow(()=>auditarConfig(config));
  config.services[2].worker.modules[0].esModule=AUXILIAR+'\nfetch("https://example.invalid")'+sufixo;assert.throws(()=>auditarConfig(config),/Código auxiliar/);
  config.services[2].worker.modules[0].esModule=AUXILIAR;
  delete config.services[2].worker.globalOutbound;assert.throws(()=>auditarConfig(config),/internet|saída explícita/);
  config.services[2].worker.globalOutbound={name:'router'};config.services[2].worker.compatibilityFlags=['connect_pass_through'];assert.throws(()=>auditarConfig(config),/connect_pass_through/);
});
test('opções usam o schema nativo Miniflare 5 sem iniciar runtime',()=>{
  const {opcoesWorker}=require(arquivo);const {CACHE}=require('./preparar-cloudflare.cjs');const {MiniflareOptionsSchema}=require(path.join(CACHE,'miniflare'));const options=opcoesWorker('export default {fetch(){return new Response()}}',false,()=>new Response('{}'));
  assert.doesNotThrow(()=>MiniflareOptionsSchema.parse(options));assert.equal(options.workers[1].dev.outboundService.worker,'fixture-router');assert.deepEqual(options.workers[1].config.compatibilityFlags,[]);
});
test('dispose pendente não impede guarda de encerramento independente',async()=>{
  const {encerrarInstancia}=require(arquivo);let terminou=false;
  await assert.rejects(encerrarInstancia({dispose:()=>new Promise(()=>{})},{encerrarFilhos:async forcar=>{terminou=forcar;}},10),/encerrar/);
  assert.equal(terminou,true);
});
test('ASSETS recusa qualquer URL sem acessar fixtures',async()=>{
  const {ASSETS_RECUSA}=require(arquivo);const {default:asset}=await import('data:text/javascript,'+encodeURIComponent(ASSETS_RECUSA));
  for(const url of ['https://example.invalid/a','https://lsqjamqvmrcyrvowndiu.supabase.co/auth/v1/user'])assert.equal((await asset.fetch(new Request(url))).status,599);
});
