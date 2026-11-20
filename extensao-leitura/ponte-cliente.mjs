export function criarClienteLeitura(runtime,{timeoutMs=10000}={}) {
 let port=null,closed=false,sequence=0;const pending=new Map();
 const fechar=()=>{if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Canal de leitura encerrado. Reinicie a tentativa.'));}pending.clear();try{port?.disconnect();}catch{}};
 const request=(acao,args={})=>new Promise((resolve,reject)=>{
  if(closed){reject(Error('Canal encerrado'));return;}
  if(!port){
   try{port=runtime.connect({name:'licitaplena-leitura-popup'});}catch{fechar();reject(Error('Canal indisponível'));return;}
   port.onDisconnect.addListener(fechar);
   port.onMessage.addListener(m=>{if(closed)return;const p=pending.get(m?.id);if(!p)return;if(Object.keys(m).sort().join()!=='id,value'){fechar();return;}pending.delete(m.id);clearTimeout(p.timer);p.resolve(m.value);});
  }
  const id=++sequence;pending.set(id,{resolve,reject,timer:setTimeout(fechar,timeoutMs)});
  try{port.postMessage({id,acao,...args});}catch{fechar();}
 });
 const tab=t=>({id:t.id,url:t.url});
 return {obterTentativa:()=>request('obterTentativa'),vincularPortal:(tentativaId,t)=>request('vincularPortal',{tentativaId,tab:tab(t)}),concluir:(tentativaId,snapshot,t)=>request('concluir',{tentativaId,snapshot,tab:tab(t)}),cancelar:tentativaId=>request('cancelar',{tentativaId}),fechar};
}
