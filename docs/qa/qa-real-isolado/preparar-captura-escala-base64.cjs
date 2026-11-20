const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir=__dirname,sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const source=fs.readFileSync(path.join(dir,'ATO-ESCALA-00-CAPTURAR.sql'),'utf8');
const old=JSON.parse(fs.readFileSync(path.join(dir,'ATO-ESCALA-manifesto.json')));
if(sha(source)!==old.arquivos.find(x=>x.arquivo==='ATO-ESCALA-00-CAPTURAR.sql').sha256)throw Error('Ato original divergente');
const start=source.indexOf("select jsonb_build_object('destino'"),end=source.lastIndexOf('\nrollback;');
if(start<0||end<0)throw Error('Formato não reconhecido');
const query=source.slice(start,end).trim().replace(/;$/,'').replace("'definicao',pg_get_functiondef(p.oid)","'definicaoMd5Servidor',md5(pg_get_functiondef(p.oid)),'serverEncoding',current_setting('server_encoding'),'searchPath',current_setting('search_path'),'definicao',pg_get_functiondef(p.oid)");
const sql=source.slice(0,start)+`-- Transporte verificável: JSON integral em base64 UTF8; sem normalizar definição.
with captura as (${query}), payload as (select backup_rpc_escala::text as texto from captura)
select jsonb_build_object('encoding','base64-utf8','payloadBase64',replace(encode(convert_to(texto,'UTF8'),'base64'),chr(10),''),'payloadMd5',md5(convert_to(texto,'UTF8')),'payloadBytes',octet_length(convert_to(texto,'UTF8'))) as captura_verificavel from payload;
rollback;
`;
fs.writeFileSync(path.join(dir,'ATO-ESCALA-00B-CAPTURAR-BASE64.sql'),sql);
fs.writeFileSync(path.join(dir,'ATO-ESCALA-00B-manifesto.json'),JSON.stringify({executado:false,destino:old.destino,originalSha256:sha(source),arquivo:'ATO-ESCALA-00B-CAPTURAR-BASE64.sql',sha256:sha(sql)},null,2)+'\n');
console.log(sha(sql));
