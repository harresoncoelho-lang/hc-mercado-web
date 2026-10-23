const LIMITES = Object.freeze({ upload: 4*1024*1024, extracao:2*1024*1024, paginas:8 });
function falhar(erro,status=422){const e=new Error(erro);e.status=status;throw e;}
function caminhoPermitido(caminho,org,empresa){return typeof caminho==='string' && caminho.startsWith(`${org}/${empresa}/`) && caminho.split('/').length>=3 && !caminho.split('/').some(p=>!p||p==='.'||p==='..');}
function validarArquivo(nome,base64){
 if(typeof nome!=='string'||nome.length>180||!nome.toLowerCase().endsWith('.pdf'))falhar('Envie um PDF.');
 if(typeof base64!=='string'||base64.length>Math.ceil(LIMITES.upload/3)*4||!base64.length||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))falhar('Arquivo inválido ou maior que 4 MiB.',413);
 const bytes=Buffer.from(base64,'base64');if(bytes.length>LIMITES.upload)falhar('Arquivo maior que 4 MiB.',413);
 if(bytes.subarray(0,5).toString()!=='%PDF-')falhar('Envie um PDF válido.');return bytes;
}
function validarConfirmacao(body,empresa){
 if(body.revisado!==true)falhar('Confirme a revisão dos dados.');
 const normal=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ');
 if(normal(body.razaoSocial)!==normal(empresa.razao_social)||String(body.cnpj||'').replace(/\D/g,'')!==String(empresa.cnpj||'').replace(/\D/g,''))falhar('Os dados divergem do cadastro da empresa. Corrija ou confira o cadastro.',409);
 const dados=body.dados;if(!dados||typeof dados!=='object'||Array.isArray(dados))falhar('Dados inválidos.');
 const limites={endereco:500,representante:180,cargo:120};for(const key of Object.keys(dados))if(!(key in limites))falhar('Campo não permitido.');
 const validados={};for(const [key,max] of Object.entries(limites)){if(typeof dados[key]!=='string'||!dados[key].trim()||dados[key].length>max)falhar(`Confira o campo ${key}.`);validados[key]=normal(dados[key]);}
 const proveniencia=body.proveniencia||[];if(!Array.isArray(proveniencia)||proveniencia.length>3||new Set(proveniencia.map(p=>p?.documentoId)).size>2)falhar('Proveniência inválida.');
 for(const p of proveniencia){if(!p||typeof p.documentoId!=='string'||! /^[a-f0-9]{64}$/i.test(p.hash||'')||!Array.isArray(p.campos)||!p.campos.length||p.campos.some(c=>!(c in limites))||!(p.pagina===null||Number.isInteger(p.pagina)&&p.pagina>=1&&p.pagina<=8)||typeof p.trecho!=='string'||p.trecho.length>1200)falhar('Proveniência inválida.');}
 return {dados:validados,proveniencia};
}
module.exports={LIMITES,falhar,caminhoPermitido,validarArquivo,validarConfirmacao};
