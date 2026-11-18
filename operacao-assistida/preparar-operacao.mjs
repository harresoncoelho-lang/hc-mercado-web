import {propostaParaLote} from './proposta-para-lote.mjs';
const bloqueado=motivo=>({valido:false,motivo,lote:null,writeAuthorized:false,portalAuthorizationRequired:true});
// Leitor fornecido pela composição servidor; nunca por payload, env ou estado do navegador.
// Hoje não existe produtor real do vínculo Compras.gov: ausência permanece bloqueada.
export function prepararOperacao(abertura,contextoKit,evidencia){
 if(!evidencia||evidencia.tipo!=='portal'||evidencia.vigente!==true)return bloqueado('vinculo_portal_indisponivel');
 return propostaParaLote(abertura,evidencia.snapshot,{contextoKit,vinculo:evidencia.vinculo,catalogo:evidencia.catalogo,mapeamento:evidencia.mapeamento});
}
