import {validateContext,allowedUrl} from './adapter.mjs';
// Factory não registrada no runtime. Composição/origem devem ser homologadas depois.
export function criarReceptor({origem,caminho,agora=()=>Date.now()}={}){
 let active=null;
 const clear=(tentativaId)=>{if(tentativaId!==undefined&&active?.envelope?.tentativaId!==tentativaId)return;const old=active;active=null;try{old?.port.disconnect();}catch{}};
 const vigente=()=>active&&agora()<active.expires;
 return {
  conectar(port){
   if(active&&!vigente())clear();
   if(active||!origem||!caminho){port.disconnect();return false;}
   const s=port.sender;let u;try{u=new URL(s.url);}catch{port.disconnect();return false;}
   if(u.origin!==origem||u.pathname!==caminho||s.frameId!==0||!Number.isInteger(s.tab?.id)||!s.documentId){port.disconnect();return false;}
   active={port,sourceTab:s.tab.id,sourceDocument:s.documentId,expires:agora()+300000,envelope:null,portal:null};
   port.onDisconnect.addListener(()=>{if(active?.port===port)active=null;});
   port.onMessage.addListener(m=>{
    if(active?.port!==port)return;
    if(!vigente()||active.envelope){clear();return;}
    if(!m||JSON.stringify(m).length>3000||Object.keys(m).sort().join(',')!=='contexto,documentoId,expiraEm,geracao,nonce,revisaoHash,tentativaId,tipo,versao'
      ||m.tipo!=='iniciarLeitura'||!Number.isSafeInteger(m.geracao)||!Number.isSafeInteger(m.versao)||m.versao<1
      ||!/^[a-f0-9-]{36}$/.test(m.tentativaId)||!/^[a-f0-9-]{36}$/.test(m.documentoId)||!/^[a-f0-9]{64}$/.test(m.revisaoHash)||!/^[A-Za-z0-9_-]{43}$/.test(m.nonce)
      ||validateContext(null,m.contexto).status==='esperado_invalido'){clear();return;}
    const expires=Date.parse(m.expiraEm);if(!Number.isFinite(expires)||expires<=agora()||expires>agora()+300000){clear();return;}
    active.expires=expires;active.envelope=structuredClone(m);
   });
   return true;
  },
  obterTentativa(){if(!vigente()){clear();return null;}const m=active.envelope;return m?{tentativaId:m.tentativaId,contexto:structuredClone(m.contexto),documentoId:m.documentoId,versao:m.versao}:null;},
  vincularPortal(tentativaId,tab){if(active?.envelope?.tentativaId!==tentativaId)return false;if(!vigente()||active.envelope?.tentativaId!==tentativaId||!Number.isInteger(tab.id)||!allowedUrl(tab.url)){clear();return false;}active.portal={id:tab.id,url:tab.url};return true;},
  concluir(tentativaId,snapshot,tab){
   if(active?.envelope?.tentativaId!==tentativaId)return false;
   if(!vigente()||active.envelope?.tentativaId!==tentativaId||active.portal?.id!==tab.id||active.portal?.url!==tab.url||snapshot.url!==tab.url){clear();return false;}
   const m=active.envelope,checked=validateContext(snapshot,m.contexto);
   if(checked.status!=='confirmado'||!checked.paginaObservada){clear();return false;}
   // Envelope restrito; não encaminha texto arbitrário, preços ou identidade de conta.
   const clean={url:snapshot.url,headings:[`Pregão Eletrônico N° ${checked.observed.number}/${checked.observed.year}`,`UASG ${checked.observed.uasg}`],supplierLabels:[`CNPJ do fornecedor: ${checked.observed.cnpj}`],notices:[],collectionComplete:true,paginaObservada:{completa:true,itens:checked.paginaObservada.itens}};
   const port=active.port;active=null;
   port.postMessage({tipo:'resultadoLeitura',tentativaId:m.tentativaId,geracao:m.geracao,nonce:m.nonce,snapshot:clean});
   return true;
  },
  cancelar:clear,
 };
}
