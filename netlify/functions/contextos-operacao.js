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
const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON='sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PAPEIS_ACESSO=['gestor','operador'];
const MAX_LINHAS=1000;
const emLista=ids=>'('+ids.join(',')+')';
const uuid=v=>typeof v==='string'&&UUID.test(v);
// Exibição: sempre string, com teto (mesmos limites do cadastro de processo para número e objeto).
const texto=(v,max)=>typeof v==='string'?v.slice(0,max):'';

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
  const vazio={userId,empresas:[],contextos:[]};
  const organizacoes=[...new Set(membros.map(m=>m.organizacao_id))];
  if(!organizacoes.length)return resposta(200,vazio);

  const empresas=(await ler(`operacao_empresas?organizacao_id=in.${emLista(organizacoes)}&ativo=eq.true&select=id,organizacao_id,razao_social&order=razao_social`))
   .filter(e=>e&&uuid(e.id)&&membros.some(m=>m.organizacao_id===e.organizacao_id&&(m.empresa_id===null||m.empresa_id===e.id)));
  if(!empresas.length)return resposta(200,vazio);
  const porId=new Map(empresas.map(e=>[e.id,e]));

  const processos=await ler(`operacao_processos?empresa_id=in.${emLista([...porId.keys()])}&status=neq.arquivado&select=id,empresa_id,organizacao_id,numero,objeto,status,data_sessao&order=criado_em.desc`);
  // Processo só entra se a empresa autorizada e a organização baterem; linha extra da fonte nunca entra.
  const contextos=processos.filter(p=>p&&uuid(p.id)&&p.status!=='arquivado'&&porId.get(p.empresa_id)?.organizacao_id===p.organizacao_id)
   .map(p=>({empresaId:p.empresa_id,processoId:p.id,numero:texto(p.numero,60),objeto:texto(p.objeto,500),status:texto(p.status,40),prazo:texto(p.data_sessao,40)}));
  return resposta(200,{userId,empresas:empresas.map(e=>({empresaId:e.id,razaoSocial:typeof e.razao_social==='string'?e.razao_social:''})),contextos});
 }catch{
  return resposta(503,{erro:'Não foi possível carregar suas empresas agora. Tente de novo em instantes.'});
 }
};
