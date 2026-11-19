import {createHash,createPublicKey} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {arquivosDaExtensao} from './empacotar-extensao.mjs';
const source=new URL('../extensao-leitura/',import.meta.url);
export async function empacotarQA(config,destino){
 if(!config||Object.keys(config).sort().join()!=='caminho,extensionId,origem,publicKey')throw Error('Configuração QA incompleta');
 const {origem,caminho,extensionId,publicKey}=config;let origin;
 try{origin=new URL(origem);}catch{throw Error('Origem inválida');}
 if(origin.protocol!=='https:'||origin.origin!==origem||origin.username||origin.password||origem.includes('*')||!/^\/[A-Za-z0-9/_-]+\.html$/.test(caminho))throw Error('Origem/caminho devem ser exatos');
 if(typeof publicKey!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)||!/^[a-p]{32}$/.test(extensionId))throw Error('Chave pública/ID obrigatórios');
 const der=Buffer.from(publicKey,'base64');const parsed=createPublicKey({key:der,format:'der',type:'spki'}).export({format:'der',type:'spki'});
 if(!der.equals(parsed)||der.toString('base64')!==publicKey)throw Error('Chave pública não canônica');
 const derived=createHash('sha256').update(der).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 if(derived!==extensionId)throw Error('ID não corresponde à chave pública');
 if(typeof destino!=='string'||!path.isAbsolute(destino))throw Error('Destino novo absoluto obrigatório');
 const manifest=JSON.parse(await readFile(new URL('manifest.json',source),'utf8'));
 manifest.background={service_worker:'worker-qa.mjs',type:'module'};manifest.key=publicKey;manifest.externally_connectable={matches:[origem+caminho]};manifest.optional_host_permissions=[...(manifest.optional_host_permissions||[]),'http://127.0.0.1/*']; // site do ambiente-teste só no pacote QA
 // Mesma descoberta do pacote de produção (empacotar-extensao.mjs) + o que só o worker QA importa.
 const files=[...new Set([...(await arquivosDaExtensao()).arquivos,'ponte-receptor.mjs','ponte-worker.mjs'])];
 const content=await Promise.all(files.map(async file=>[file,await readFile(new URL(file,source))]));
 // Toda configuração e leitura validada antes da primeira escrita. Nunca sobrescreve destino.
 await mkdir(destino);
 for(const[file,body]of content)await writeFile(path.join(destino,file),body,{flag:'wx'});
 await writeFile(path.join(destino,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 await writeFile(path.join(destino,'worker-qa.mjs'),`import './acompanhar-worker.mjs';
import {criarWorkerLeitura} from './ponte-worker.mjs';\ncriarWorkerLeitura({runtime:chrome.runtime,origem:${JSON.stringify(origem)},caminho:${JSON.stringify(caminho)}});\n`,{flag:'wx'});
 return {destino,extensionId,instalado:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [, ,configFile,destino]=process.argv;if(!configFile||!destino)throw Error('Uso: node scripts/empacotar-extensao-leitura-qa.mjs config.json destino-absoluto-novo');
 await empacotarQA(JSON.parse(await readFile(configFile,'utf8')),destino);
}
