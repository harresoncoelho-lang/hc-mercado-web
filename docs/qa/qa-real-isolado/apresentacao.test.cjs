const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {criarServidor}=require('./servidor.cjs');
const {preparar,QA}=require('./isolamento.cjs');
const raiz=path.resolve(__dirname,'..','..','..');
function get(port,route,headers={}){return new Promise((resolve,reject)=>{const r=http.request({agent:false,hostname:'127.0.0.1',port,path:route,method:'GET',headers:{origin:`http://127.0.0.1:${port}`,...headers}},s=>{let text='';s.on('data',b=>text+=b);s.on('end',()=>resolve({status:s.statusCode,text,headers:s.headers}));});r.on('error',reject);r.end();});}
function subir(t){
 const copia=preparar({authUrl:QA,restUrl:QA,storageUrl:QA,publicKey:'sb_publishable_qa_ficticia'});
 const s=criarServidor({copia,serviceKey:'SERVICE-SECRETA',emailsPermitidos:['qa@example.invalid'],contextos:[{empresaId:'11111111-1111-1111-1111-111111111111',processoId:'22222222-2222-2222-2222-222222222222'}],fetchImpl:async()=>Response.json({id:'qa'})});
 return new Promise(r=>s.listen(0,'127.0.0.1',()=>{t.after(()=>new Promise(f=>s.close(f)));r(s.address().port)}));
}
test('apresentação do harness: folha própria, IDs e rotas preservados, sem recurso externo',async t=>{
 const port=await subir(t);
 const pagina=await get(port,'/');
 assert.equal(pagina.status,200);
 assert.match(pagina.text,/href="\/qa-apresentacao\.css"/);
 assert.match(pagina.text,/href="\/kit-documentos\.css"/);
 for(const id of ['cenario','exemplo','tema','fechar','abrir','kit','identificacao','qa-login','qa-status','qa-ia','qa-ia-resultado'])assert.match(pagina.text,new RegExp(`id="${id}"`),`falta #${id}`);
 assert.match(pagina.text,/<script src="\/demo\.js"><\/script>/);
 assert.match(pagina.text,/<script src="\/kit-documentos-ui\.js"><\/script>/);
 assert.match(pagina.text,/Harness QA isolado\. Login real somente no projeto de homologação/);
 assert.doesNotMatch(pagina.text,/senha|TOKEN-PRIVADO|SERVICE-SECRETA/);
 assert.doesNotMatch(pagina.text,/https?:\/\/(?!127\.0\.0\.1)/);
 const folha=await get(port,'/qa-apresentacao.css');
 assert.equal(folha.status,200);
 assert.match(folha.headers['content-type'],/text\/css/);
 assert.doesNotMatch(folha.text,/url\(|@import|https?:\/\//);
 assert.match(folha.text,/\.tema-claro\{/);
 assert.match(folha.text,/@media \(max-width:600px\)/);
 assert.match(folha.text,/min-height:44px/);
});
test('estáticos existentes da apresentação continuam servidos e a folha da prévia referencia só origem local',async t=>{
 const port=await subir(t);
 for(const r of ['/kit-documentos.css','/kit-documentos-ui.js','/operacao-identificacao.css'])assert.equal((await get(port,r)).status,200,r);
 const conteudo=fs.readFileSync(path.join(raiz,'docs','qa','kit-documentos-preview.html'),'utf8');
 assert.doesNotMatch(conteudo,/<script[^>]+https?:\/\//);
 assert.doesNotMatch(conteudo,/<link[^>]+https?:\/\//);
});
