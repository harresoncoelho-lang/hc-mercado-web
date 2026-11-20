import {criarReceptor} from './ponte-receptor.mjs';
// Estado deliberadamente efêmero: término do worker exige nova tentativa no SaaS.
export function criarWorkerLeitura({runtime,origem,caminho}) {
 const receptor=criarReceptor({origem,caminho});let popup=null;
 runtime.onConnectExternal.addListener(port=>{if(port.name!=='licitaplena-leitura-v1'){port.disconnect();return;}receptor.conectar(port);});
 runtime.onConnect.addListener(port=>{
  if(popup||port.name!=='licitaplena-leitura-popup'||port.sender?.id!==runtime.id||port.sender?.url!==runtime.getURL('popup.html')){port.disconnect();return;}
  const session={port,tentativa:null};popup=session;
  const close=()=>{if(popup!==session)return;if(session.tentativa)receptor.cancelar(session.tentativa);popup=null;port.disconnect();};
  port.onDisconnect.addListener(close);
  port.onMessage.addListener(m=>{
   if(popup!==session)return;
   try {
   const fields={obterTentativa:['acao','id'],vincularPortal:['acao','id','tab','tentativaId'],concluir:['acao','id','snapshot','tab','tentativaId'],cancelar:['acao','id','tentativaId']};
   if(!m||!Number.isSafeInteger(m.id)||m.id<1||!fields[m.acao]||Object.keys(m).sort().join()!==fields[m.acao].sort().join()||JSON.stringify(m).length>30000){close();return;}
   let value;
   if(m.acao==='obterTentativa'){
    value=receptor.obterTentativa();
    if(session.tentativa&&value?.tentativaId!==session.tentativa){close();return;}
    session.tentativa=value?.tentativaId??null;
   }else{
    if(!session.tentativa||m.tentativaId!==session.tentativa){port.postMessage({id:m.id,value:m.acao==='cancelar'});return;}
    if(m.acao==='cancelar'){receptor.cancelar(m.tentativaId);session.tentativa=null;value=true;}
    else{
     if(!m.tab||Object.keys(m.tab).sort().join()!=='id,url'||!Number.isInteger(m.tab.id)||typeof m.tab.url!=='string'){close();return;}
     value=m.acao==='vincularPortal'?receptor.vincularPortal(m.tentativaId,m.tab):receptor.concluir(m.tentativaId,m.snapshot,m.tab);
     if(m.acao==='concluir')session.tentativa=null;
    }
   }
   port.postMessage({id:m.id,value});
   }catch{close();}
  });
 });
}
