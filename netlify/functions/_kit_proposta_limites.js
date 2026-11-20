const {falhar}=require('./_empresa_identificacao');
const LIMITES=Object.freeze({itens:1000,rascunhoBytes:524288,envelopeBytes:786432,previaBytes:2000000});
// Mesmo contrato semântico na migração SQL; não depende de espaços de JSONB.
function bytesRascunho(p){return 128+(p.itemIds||[]).length*128+['validade','prazoEntrega','pagamento'].reduce((n,k)=>n+Buffer.byteLength(p[k]||'','utf8'),0)+(p.itemIds||[]).reduce((n,id)=>n+Buffer.byteLength(id,'utf8')+Buffer.byteLength(p.unidades?.[id]||'','utf8'),0);}
function validarBudget(p){if(bytesRascunho(p)>LIMITES.rascunhoBytes)falhar('Rascunho excede o tamanho suportado.',400);}
module.exports={LIMITES,bytesRascunho,validarBudget};
