const {LIMITES}=require('./_empresa_identificacao');
async function extrairDocumento(bytes){
 const manual=aviso=>({modo:'manual',sugestoes:{},evidencias:[],avisos:[aviso]});
 if(bytes.length>LIMITES.extracao)return manual('Arquivo anexado. Preencha manualmente: extração limitada a 2 MiB.');
 if(bytes.subarray(0,5).toString()!=='%PDF-')return manual('Formato sem extração automática. Confira e preencha os dados manualmente.');
 try{
 const paginas=[];
 const pdf=require('pdf-parse/lib/pdf-parse.js');
 const resultado=await pdf(new Uint8Array(bytes),{max:LIMITES.paginas+1,pagerender:async page=>{
 const conteudo=await page.getTextContent();let linha=-1,texto='';for(const item of conteudo.items){const y=item.transform?.[5];if(y!==linha){texto+='\n';linha=y;}texto+=item.str+' ';}paginas.push({pagina:page.pageNumber,texto});return texto;
 }});
 if(resultado.numpages>LIMITES.paginas)return manual('Arquivo anexado. Confira manualmente: documento excede 8 páginas.');
 if(!paginas.some(p=>p.texto.trim().length>30))return manual('PDF sem texto legível. Confira o documento e preencha manualmente.');
 const sugestoes={},evidencias=[];
 const regras={razaoSocial:/NOME EMPRESARIAL\s*[:\n]\s*([^\n]{3,180})/i,endereco:/ENDERE[CÇ]O\s*[:\n]\s*([^\n]{5,500})/i,representante:/REPRESENTANTE LEGAL\s*[:\n]\s*([^\n]{3,180})/i,cargo:/CARGO\s*[:\n]\s*([^\n]{3,120})/i};
 for(const [campo,regex] of Object.entries(regras)){const matches=paginas.flatMap(p=>{return [...p.texto.matchAll(new RegExp(regex.source,'gi'))].map(m=>({campo,pagina:p.pagina,trecho:m[0].trim(),valor:m[1].trim()}));});if(matches.length===1){sugestoes[campo]=matches[0].valor;evidencias.push(matches[0]);}}
 return {modo:'sugestoes',sugestoes,evidencias,avisos:['Sugestões de leitura, sem validação jurídica. Confira todos os campos antes de confirmar.']};
 }catch{return manual('Não foi possível extrair texto deste PDF. O anexo foi preservado; preencha manualmente.');}
}
module.exports={extrairDocumento};
