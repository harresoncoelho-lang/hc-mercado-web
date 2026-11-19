const {cabecalhosPadrao,exigirUsuarioLogado}=require('./_auth');
const {falhar,LIMITES,LOGO,ufDoEndereco,validarArquivo,validarConfirmacao,mascararCpf,validarPerfilEmpresa,validarPremissas,validarPremissasRemover,tipoCaminhoLogo,validarLogo,lerAte}=require('./_empresa_identificacao');
const {createHash,randomUUID}=require('node:crypto');
const {carregarContextoIdentificacao,lerCpfRepresentante}=require('./_empresa_identificacao_contexto');
const URL='https://lsqjamqvmrcyrvowndiu.supabase.co';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// ---------- Perfil da empresa (esteira E10): só token do usuário (RLS); CPF e banco nunca vão a log nem a mensagem. ----------
// Sem cpf_representante: o navegador (token do usuário) não tem SELECT nessa coluna; o CPF vem de lerCpfRepresentante.
const COLUNAS_PERFIL='empresa_id,organizacao_id,nome_fantasia,telefone,email,inscricao_estadual,inscricao_municipal,porte,regime_tributario,aliquota_efetiva,tributos_fonte,banco,proposta_padrao,logo_caminho,logo_hash,versao,atualizado_por,atualizado_em,uf_sede';
const COLUNAS_PREMISSA='segmento,uf,tributos_percentual,frete_percentual,garantia_percentual,margem_percentual,margem_minima_percentual,atualizado_em';
// Banco sem operacao_perfil_empresa.sql: o PostgREST responde 404 e request() vira 503 genérico.
const comTabelaPerfil=async promessa=>{try{return await promessa;}catch(e){if(e.status===503)falhar('O perfil da empresa ainda não está disponível neste ambiente.',503);throw e;}};
// A RLS do perfil devolve 0 linhas ao papel leitura e também à empresa sem perfil: o papel desempata.
async function papelNaEmpresa({rest,empresa,userId}){
 const membros=(await rest(`operacao_membros?usuario_id=eq.${userId}&organizacao_id=eq.${empresa.organizacao_id}&select=usuario_id,organizacao_id,empresa_id,papel`)).filter(m=>m.usuario_id===userId&&m.organizacao_id===empresa.organizacao_id&&(m.empresa_id===null||m.empresa_id===empresa.id));
 return membros.some(m=>m.papel==='gestor')?'gestor':membros.some(m=>m.papel==='operador')?'operador':'leitura';
}
const perfilPublicoEmpresa=(p,mostrarCpf,cpf)=>p?{...p,cpf_representante:mostrarCpf?cpf:mascararCpf(cpf)}:null;
const upsert=(c,tabela,conflito,linhas,colunas)=>comTabelaPerfil(c.request(`/rest/v1/${tabela}?on_conflict=${conflito}${colunas?'&select='+colunas:''}`,{method:'POST',headers:{'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(linhas)}).then(r=>r.json()));
const caminhoStorage=caminho=>caminho.split('/').map(encodeURIComponent).join('/');
async function urlLogo(c,perfil){
 if(!perfil?.logo_caminho||!tipoCaminhoLogo(perfil.logo_caminho,c.empresa.organizacao_id,c.empresa.id,perfil.logo_hash))return null;
 // Logo apagada no Storage não impede ler o perfil.
 try{const r=await c.request('/storage/v1/object/sign/operacao-documentos/'+caminhoStorage(perfil.logo_caminho),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});const {signedURL}=await r.json();return typeof signedURL==='string'?URL+'/storage/v1'+signedURL:null;}catch{return null;}
}
const ACOES_PERFIL={
 async lerPerfil(body,c){
  const papel=await papelNaEmpresa(c);if(papel==='leitura')falhar('Seu papel não permite ver os dados do perfil.',403);
  const filtro=`empresa_id=eq.${c.empresa.id}&organizacao_id=eq.${c.empresa.organizacao_id}`;
  const [perfis,premissas]=await comTabelaPerfil(Promise.all([c.rest(`operacao_perfil_empresa?${filtro}&select=${COLUNAS_PERFIL}`),c.rest(`operacao_premissas_empresa?${filtro}&select=${COLUNAS_PREMISSA}&order=segmento,uf`)]));
  const perfil=perfis[0]||null;
  // UF da sede vazia: sugere a do endereço já confirmado na identificação (a tela pré-preenche, o usuário salva).
  const identificada=(c.identificacoes||[]).find(i=>!i.invalidado_em);
  const ufSedeSugerida=perfil?.uf_sede?null:ufDoEndereco(identificada?.dados_confirmados?.endereco);
  const cpf=perfil?await lerCpfRepresentante(c.empresa):null;
  return {papel,perfil:perfilPublicoEmpresa(perfil,body.mostrarCpf===true&&papel==='gestor',cpf),premissas,logoUrl:await urlLogo(c,perfil),ufSedeSugerida};
 },
 async salvarPerfil(body,c){
  if(await papelNaEmpresa(c)==='leitura')falhar('Seu papel não permite alterar o perfil.',403);
  // Valida tudo antes da primeira escrita: perfil e premissas não gravam pela metade por erro de entrada.
  const dados=validarPerfilEmpresa(body.perfil);const premissas=body.premissas===undefined?null:validarPremissas(body.premissas);
  const remover=body.premissasRemover===undefined?[]:validarPremissasRemover(body.premissasRemover);
  const gravar=new Set((premissas||[]).map(p=>p.segmento+'|'+p.uf));
  remover.forEach((p,i)=>{if(gravar.has(p.segmento+'|'+p.uf))falhar('A mesma premissa não pode ser salva e removida.',422,`premissasRemover[${i}]`);});
  const escopo={empresa_id:c.empresa.id,organizacao_id:c.empresa.organizacao_id};
  // O upsert (ON CONFLICT ... EXCLUDED.coluna) exige SELECT nas colunas gravadas, e o navegador não tem SELECT no CPF:
  // o CPF vai num UPDATE à parte, com o mesmo token (a RLS de escrita decide).
  const {cpf_representante:cpfNovo,...semCpf}=dados;
  let [perfil]=await upsert(c,'operacao_perfil_empresa','empresa_id',{...semCpf,...escopo},COLUNAS_PERFIL);
  if(Object.hasOwn(dados,'cpf_representante'))[perfil]=await comTabelaPerfil(c.request(`/rest/v1/operacao_perfil_empresa?empresa_id=eq.${c.empresa.id}&organizacao_id=eq.${c.empresa.organizacao_id}&select=${COLUNAS_PERFIL}`,{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({cpf_representante:cpfNovo})}).then(r=>r.json()));
  // Remove antes do upsert: libera vaga no teto de 50 do gatilho. Token do usuário: a RLS decide.
  const filtro=`empresa_id=eq.${c.empresa.id}&organizacao_id=eq.${c.empresa.organizacao_id}`;
  await comTabelaPerfil(Promise.all(remover.map(p=>c.request(`/rest/v1/operacao_premissas_empresa?${filtro}&segmento=eq.${encodeURIComponent(p.segmento)}&uf=eq.${encodeURIComponent(p.uf)}`,{method:'DELETE'}))));
  const gravadas=premissas?.length?await upsert(c,'operacao_premissas_empresa','empresa_id,segmento,uf',premissas.map(p=>({...p,...escopo}))):[];
  const cpf=Object.hasOwn(dados,'cpf_representante')?dados.cpf_representante:await lerCpfRepresentante(c.empresa);
  return {perfil:perfilPublicoEmpresa(perfil,false,cpf),premissas:gravadas};
 },
 async registrarLogo(body,c){
  if(await papelNaEmpresa(c)==='leitura')falhar('Seu papel não permite alterar o perfil.',403);
  if(typeof body.hash!=='string'||!/^[0-9a-f]{64}$/.test(body.hash))falhar('Hash da logo inválido.',422,'hash');
  const tipo=tipoCaminhoLogo(body.caminho,c.empresa.organizacao_id,c.empresa.id,body.hash);if(!tipo)falhar('Caminho da logo fora da pasta perfil desta empresa.',422,'caminho');
  const bytes=await lerAte(await c.request('/storage/v1/object/authenticated/operacao-documentos/'+caminhoStorage(body.caminho)),LOGO.bytes);
  const img=validarLogo(bytes,tipo);if(hash(bytes)!==body.hash)falhar('O arquivo da logo não confere com o hash informado.',422,'hash');
  const [perfil]=await upsert(c,'operacao_perfil_empresa','empresa_id',{empresa_id:c.empresa.id,organizacao_id:c.empresa.organizacao_id,logo_caminho:body.caminho,logo_hash:body.hash},COLUNAS_PERFIL);
  return {logo:{caminho:perfil.logo_caminho,hash:perfil.logo_hash,tipo:img.tipo,largura:img.largura,altura:img.altura},versao:perfil.versao};
 },
};
exports.handler=async event=>{
 const headers=cabecalhosPadrao(event);const resposta=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return resposta(204,{});
 if(event.httpMethod!=='POST')return resposta(405,{erro:'Método não permitido.'});
 if(process.env.IDENTIFICACAO_EMPRESA_LOCAL!=='1')return resposta(503,{erro:'Identificação da empresa ainda não habilitada neste ambiente.'});
 try{
 const auth=await exigirUsuarioLogado(event);if(!auth.ok)return resposta(auth.status,{erro:auth.erro});
 if(typeof event.body!=='string'||event.body.length>Math.ceil(LIMITES.upload/3)*4+4096)falhar('Solicitação muito grande.',413);
 let body;try{body=JSON.parse(event.body);}catch{falhar('Solicitação inválida.');}
 if(!uuid(body.empresaId))falhar('Empresa inválida.');
 const {empresa,documentos,perfis,documento,baixar,perfilPublico,validarPerfil,request,rest}=await carregarContextoIdentificacao(event,auth.userId,body.empresaId);
 if(Object.hasOwn(ACOES_PERFIL,body.acao))return resposta(200,await ACOES_PERFIL[body.acao](body,{empresa,request,rest,userId:auth.userId,identificacoes:perfis}));
 if(body.acao==='consultar'){
 const perfil=await validarPerfil();
 return resposta(200,{empresa,documentos,perfil:perfilPublico(perfil)});
 }
 if(body.acao==='anexar'){
 if(!['contrato_social','cartao_cnpj'].includes(body.tipo))falhar('Tipo de documento inválido.');const bytes=validarArquivo(body.nome,body.conteudoBase64);
 const nome=body.nome.replace(/[^\p{L}\p{N}._-]/gu,'_');const caminho=`${empresa.organizacao_id}/${empresa.id}/${randomUUID()}-${nome}`;
 await request('/storage/v1/object/operacao-documentos/'+caminho,{method:'POST',headers:{'Content-Type':'application/pdf','x-upsert':'false'},body:bytes});
 try{const r=await request('/rest/v1/operacao_documentos',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({organizacao_id:empresa.organizacao_id,empresa_id:empresa.id,tipo:body.tipo==='contrato_social'?'Contrato social':'Cartão CNPJ',titulo:body.tipo==='contrato_social'?'Contrato social':'Cartão CNPJ',arquivo_nome:body.nome,arquivo_caminho:caminho,criado_por:auth.userId})});return resposta(200,{documento:(await r.json())[0]});}
 catch(e){try{await request('/storage/v1/object/operacao-documentos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[caminho]})});}catch{}throw e;}
 }
 if(body.acao==='extrair'){const d=documento(body.documentoId);const bytes=await baixar(d);const {extrairDocumento}=require('./_empresa_documentos');return resposta(200,{documentoId:d.id,hash:hash(bytes),...await extrairDocumento(bytes)});}
 if(body.acao==='confirmar'){
 const validado=validarConfirmacao(body,empresa);const proveniencia=[];
 for(const p of validado.proveniencia){const d=documento(p.documentoId);const bytes=await baixar(d);if(hash(bytes)!==p.hash)falhar('Documento alterado. Confira novamente.',409);
 const {extrairDocumento}=require('./_empresa_documentos');const extracao=await extrairDocumento(bytes);
 for(const campo of p.campos){const ev=extracao.evidencias.find(e=>e.campo===campo&&e.pagina===p.pagina&&e.trecho===p.trecho&&e.valor===validado.dados[campo]);if(!ev)falhar('A fonte não comprova este campo. Confira e confirme como preenchimento manual.');}
 proveniencia.push({...p,arquivoCaminho:d.arquivo_caminho});}
 const svc=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!svc)falhar('Confirmação indisponível neste ambiente.',503);
 const r=await fetch(URL+'/rest/v1/rpc/confirmar_identificacao_empresa',{method:'POST',headers:{apikey:svc,Authorization:'Bearer '+svc,'Content-Type':'application/json'},body:JSON.stringify({p_empresa:empresa.id,p_usuario:auth.userId,p_razao:empresa.razao_social,p_cnpj:empresa.cnpj,p_dados:validado.dados,p_proveniencia:proveniencia})});if(!r.ok)falhar('Não foi possível confirmar. Confira o cadastro e os documentos.',409);
 const p=await r.json();return resposta(200,{empresa,perfil:perfilPublico(Array.isArray(p)?p[0]:p)});
 }
 falhar('Ação inválida.');
 }catch(e){return resposta(e.status||503,{erro:e.status?e.message:'Serviço temporariamente indisponível. Tente novamente.',...(e.status&&e.campo?{campo:e.campo}:{})});}
};
