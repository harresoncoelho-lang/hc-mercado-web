// Catálogo do sistema CRM: empresas e processos que o usuário logado pode abrir.
// Versão de produção da descoberta QA (docs/qa/qa-real-isolado/descoberta-contextos.cjs), sem allowlist:
// - Só usuário logado (exigirUsuarioLogado) e com cadastro aprovado (clientes.status), igual ao login.html.
// - Lê tudo com o token do PRÓPRIO usuário: a RLS é a barreira final. Sem chave de serviço, então nunca
//   enxerga dado de outra organização mesmo que a regra abaixo tenha falha.
// - Mesma regra de vínculo da descoberta e de criar-processo: membro gestor/operador da organização,
//   com empresa_id nulo (toda a organização) ou igual à empresa.
// - Falha fechado se a fonte devolver o máximo de linhas, em vez de entregar lista truncada.
// - Processo arquivado não entra (status 'arquivado', mesmo valor do painel.html).
// - Devolve os campos de exibição (número, objeto, status, prazo) para o Hoje montar a lista com uma requisição só;
//   o controlador confirma o processo no kit-documentos (acao consultar) só quando o usuário o abre.
// - Certidões vencidas ou vencendo em até 30 dias e prazos/agenda dos próximos 7 dias, contados pelo dia de Brasília,
//   com o mesmo token e o mesmo vínculo. Falha (ou limite de linhas) num desses blocos devolve o bloco como null,
//   nunca lista truncada, e não derruba o catálogo.
// - Sanções vigentes (CEIS/CNEP, tabela sancoes_empresas) das empresas autorizadas, pelo CNPJ: mesma regra de bloco.
//   Tabela ausente (SQL ainda não aplicado) omite o bloco em vez de mostrar erro.
const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const {sancoesDoCnpj,textoSancao}=require('../../sancoes-ui.js');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON='sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PAPEIS_ACESSO=['gestor','operador'];
const MAX_LINHAS=1000;
const emLista=ids=>'('+ids.join(',')+')';
const uuid=v=>typeof v==='string'&&UUID.test(v);
// Exibição: sempre string, com teto (mesmos limites do cadastro de processo para número e objeto).
const texto=(v,max)=>typeof v==='string'?v.slice(0,max):'';
// Brasília é UTC-3 fixo (sem horário de verão desde 2019), mesma conta do painel.html (diaBrasilia).
const MS_DIA=864e5,FUSO_BR=-3*36e5,DIAS_CERTIDAO=30,DIAS_PRAZO=7;
const diaBrasilia=ms=>Math.floor((ms+FUSO_BR)/MS_DIA);
// vencimento de documento é coluna date (AAAA-MM-DD). Vencido (<0), até 30 dias ou fora (null).
function situacaoCertidao(vencimento,hoje){
 if(typeof vencimento!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(vencimento))return null;
 const dias=Math.floor(Date.parse(vencimento+'T00:00:00Z')/MS_DIA)-hoje;
 if(!Number.isFinite(dias)||dias>DIAS_CERTIDAO)return null;
 return {dias,situacao:dias<0?'vencido':'vencendo'};
}
// vencimento de prazo/agenda é timestamptz. Dias de 0 (hoje) a 7 no calendário de Brasília; fora disso, null.
function diasDoPrazo(vencimento,hoje){
 const ms=typeof vencimento==='string'?Date.parse(vencimento):NaN;
 if(!Number.isFinite(ms))return null;
 const dias=diaBrasilia(ms)-hoje;
 return dias>=0&&dias<=DIAS_PRAZO?dias:null;
}

// Sanções vigentes por empresa: [{empresaId,cadastro,tipo,dataFim,texto}], null em falha, undefined se a tabela não existe.
async function blocoSancoes(empresas,ler,hojeIso){
 const cnpjs=[...new Set(empresas.map(e=>String(e.cnpj||'').replace(/\D/g,'')).filter(c=>c.length===14))];
 if(!cnpjs.length)return [];
 let linhas;
 try{linhas=await ler(`sancoes_empresas?cnpj=in.${emLista(cnpjs)}&fora_da_lista=eq.false&select=cadastro,cnpj,tipo_sancao,data_inicio,data_fim,fora_da_lista&order=data_fim.desc.nullsfirst`);}
 catch(e){return e.status===404?undefined:null;}
 return empresas.flatMap(e=>sancoesDoCnpj(linhas,e.cnpj,hojeIso).vigentes.map(s=>({empresaId:e.id,cadastro:s.cadastro,tipo:texto(s.tipo_sancao,300),dataFim:s.data_fim||null,texto:textoSancao(s,hojeIso)})))
  .sort((a,b)=>a.cadastro.localeCompare(b.cadastro)); // CEIS (impede contratar) antes de CNEP
}

exports.handler=async event=>{
 // no-store: a resposta é o catálogo privado do usuário e não pode ficar em cache intermediário.
 const headers={...cabecalhosPadrao(event),'Cache-Control':'no-store'};
 const resposta=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return resposta(204,{});
 if(event.httpMethod!=='GET')return resposta(405,{erro:'Método não permitido.'});
 try{
  const auth=await exigirUsuarioLogado(event);if(!auth.ok)return resposta(auth.status,{erro:auth.erro});
  const userId=auth.userId;
  if(!uuid(userId))return resposta(401,{erro:'Sessão inválida.'});
  const token=event.headers?.authorization||event.headers?.Authorization||'';
  const ler=async caminho=>{
   const r=await fetch(URL+'/rest/v1/'+caminho,{headers:{apikey:ANON,Authorization:token,Accept:'application/json'},signal:globalThis.AbortSignal.timeout(10000)});
   if(!r.ok)throw Object.assign(Error('leitura'),{status:r.status});
   const dados=await r.json();
   if(!Array.isArray(dados)||dados.length>=MAX_LINHAS)throw Error('Resposta de descoberta inválida ou incompleta');
   return dados;
  };

  const clientes=await ler(`clientes?id=eq.${userId}&select=status`);
  if(clientes[0]?.status!=='aprovado')return resposta(403,{erro:'Acesso não autorizado.'});

  const membros=(await ler(`operacao_membros?usuario_id=eq.${userId}&papel=in.${emLista(PAPEIS_ACESSO)}&select=usuario_id,organizacao_id,empresa_id,papel`))
   .filter(m=>m&&m.usuario_id===userId&&PAPEIS_ACESSO.includes(m.papel)&&uuid(m.organizacao_id));
  const vazio={userId,empresas:[],contextos:[],certidoes:[],prazos:[]};
  const organizacoes=[...new Set(membros.map(m=>m.organizacao_id))];
  if(!organizacoes.length)return resposta(200,vazio);

  const empresas=(await ler(`operacao_empresas?organizacao_id=in.${emLista(organizacoes)}&ativo=eq.true&select=id,organizacao_id,razao_social,cnpj&order=razao_social`))
   .filter(e=>e&&uuid(e.id)&&membros.some(m=>m.organizacao_id===e.organizacao_id&&(m.empresa_id===null||m.empresa_id===e.id)));
  if(!empresas.length)return resposta(200,vazio);
  const porId=new Map(empresas.map(e=>[e.id,e]));

  const processos=await ler(`operacao_processos?empresa_id=in.${emLista([...porId.keys()])}&status=neq.arquivado&select=id,empresa_id,organizacao_id,numero,objeto,status,data_sessao&order=criado_em.desc`);
  // Processo só entra se a empresa autorizada e a organização baterem; linha extra da fonte nunca entra.
  const contextos=processos.filter(p=>p&&uuid(p.id)&&p.status!=='arquivado'&&porId.get(p.empresa_id)?.organizacao_id===p.organizacao_id)
   .map(p=>({empresaId:p.empresa_id,processoId:p.id,numero:texto(p.numero,60),objeto:texto(p.objeto,500),status:texto(p.status,40),prazo:texto(p.data_sessao,40)}));
  const hoje=diaBrasilia(Date.now());
  const inicio=new Date(hoje*MS_DIA-FUSO_BR).toISOString(),fim=new Date((hoje+DIAS_PRAZO+1)*MS_DIA-FUSO_BR).toISOString();
  const limiteCertidao=new Date((hoje+DIAS_CERTIDAO)*MS_DIA).toISOString().slice(0,10);
  const bloco=async fn=>{try{return await fn();}catch{return null;}};
  const empresaOk=(empresaId,org)=>porId.get(empresaId)?.organizacao_id===org;
  const certidoes=await bloco(async()=>(await ler(`operacao_documentos?empresa_id=in.${emLista([...porId.keys()])}&vencimento=lte.${limiteCertidao}&select=id,empresa_id,organizacao_id,tipo,titulo,vencimento&order=vencimento`))
   .filter(d=>d&&uuid(d.id)&&empresaOk(d.empresa_id,d.organizacao_id))
   .flatMap(d=>{const s=situacaoCertidao(d.vencimento,hoje);return s?[{empresaId:d.empresa_id,tipo:texto(d.tipo,120),titulo:texto(d.titulo,200),vencimento:d.vencimento,...s}]:[];}));
  const porProcesso=new Map(contextos.map(c=>[c.processoId,c]));
  const janela=`vencimento=gte.${inicio}&vencimento=lt.${fim}&concluido_em=is.null&order=vencimento`;
  const prazos=await bloco(async()=>{
   const doProcesso=(await ler(`operacao_prazos_processo?organizacao_id=in.${emLista(organizacoes)}&${janela}&select=id,organizacao_id,processo_id,categoria,titulo,vencimento,concluido_em`))
    .filter(p=>p&&uuid(p.id)&&!p.concluido_em&&porProcesso.has(p.processo_id)&&empresaOk(porProcesso.get(p.processo_id).empresaId,p.organizacao_id))
    .map(p=>({id:p.id,origem:'processo',empresaId:porProcesso.get(p.processo_id).empresaId,processoId:p.processo_id,categoria:texto(p.categoria,40),titulo:texto(p.titulo,200),vencimento:p.vencimento,dias:diasDoPrazo(p.vencimento,hoje)}));
   // Agenda sem empresa vale para a organização inteira: só aparece para quem é membro da organização toda.
   const daAgenda=(await ler(`operacao_agenda?organizacao_id=in.${emLista(organizacoes)}&${janela}&select=id,organizacao_id,empresa_id,categoria,titulo,vencimento,concluido_em`))
    .filter(a=>a&&uuid(a.id)&&!a.concluido_em&&(a.empresa_id===null?membros.some(m=>m.organizacao_id===a.organizacao_id&&m.empresa_id===null):empresaOk(a.empresa_id,a.organizacao_id)))
    .map(a=>({id:a.id,origem:'agenda',empresaId:a.empresa_id,processoId:null,categoria:texto(a.categoria,40),titulo:texto(a.titulo,200),vencimento:a.vencimento,dias:diasDoPrazo(a.vencimento,hoje)}));
   return [...doProcesso,...daAgenda].filter(p=>p.dias!==null).sort((a,b)=>Date.parse(a.vencimento)-Date.parse(b.vencimento));
  });
  const sancoes=await blocoSancoes(empresas,ler,new Date(hoje*MS_DIA).toISOString().slice(0,10));
  return resposta(200,{userId,...(sancoes===undefined?{}:{sancoes}),empresas:empresas.map(e=>({empresaId:e.id,razaoSocial:typeof e.razao_social==='string'?e.razao_social:''})),contextos,certidoes,prazos});
 }catch{
  return resposta(503,{erro:'Não foi possível carregar suas empresas agora. Tente de novo em instantes.'});
 }
};
exports.situacaoCertidao=situacaoCertidao;
exports.diasDoPrazo=diasDoPrazo;
exports.diaBrasilia=diaBrasilia;
