const fs=require('fs'),crypto=require('crypto');
const md5=x=>crypto.createHash('md5').update(x).digest('hex');
function decodificar(envelope){
 if(envelope.encoding!=='base64-utf8'||typeof envelope.payloadBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.payloadBase64))throw Error('Envelope inválido');
 const bytes=Buffer.from(envelope.payloadBase64,'base64');
 if(bytes.toString('base64')!==envelope.payloadBase64||bytes.length!==envelope.payloadBytes||md5(bytes)!==envelope.payloadMd5)throw Error('Integridade do payload divergente');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {text,data:JSON.parse(text)};
}
function validar(envelope){
 const {text,data}=decodificar(envelope);
 if(data.destino!=='luguscapasskcsficckf'||data.baselineMd5!=='64c94369bded0ca5721959406a8d5434'||data.definicaoMd5Servidor!==data.baselineMd5||data.serverEncoding!=='UTF8'||typeof data.definicao!=='string'||md5(Buffer.from(data.definicao,'utf8'))!==data.baselineMd5||typeof data.rollbackSql!=='string'||!data.rollbackSql.includes('QA_ESCALA_REVERTIDA'))throw Error('Backup/baseline inválido');
 return {text,data};
}
module.exports={validar,decodificar};
if(require.main===module){
 const [input,prefix]=process.argv.slice(2);if(!input||!prefix)throw Error('Uso: node validar-captura-escala.cjs envelope.json prefixo-novo');
 const result=validar(JSON.parse(fs.readFileSync(input,'utf8')));
 if(fs.existsSync(prefix+'-backup.json')||fs.existsSync(prefix+'-rollback.sql'))throw Error('Destino já existe; preservar evidências');
 fs.writeFileSync(prefix+'-backup.json',result.text,{flag:'wx'});fs.writeFileSync(prefix+'-rollback.sql',result.data.rollbackSql,{flag:'wx'});
 console.log('CAPTURA_VERIFICADA: hash payload, bytes UTF8 e baseline da definição conferidos. SQL não executado.');
}
