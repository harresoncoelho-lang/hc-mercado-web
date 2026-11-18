// Declarações do kit (esteira E11): variáveis do perfil, lote idempotente e logo do cabeçalho.
// LGPD: o CPF do representante só é lido quando algum modelo pede {{cpf_representante}} e nunca vai a log,
// mensagem de erro ou resposta (o lote devolve só metadados das peças).
const {createHash}=require('node:crypto');
const {falhar,tipoCaminhoLogo,validarLogo,lerAte,LOGO}=require('./_empresa_identificacao');
const {obterModelo}=require('../../declaracoes-modelos.js');
const {validarRascunho,documentoPublico}=require('./_kit_documentos_persistencia');
const LOTE_MAX=30;
const MARCADOR='[PREENCHER:';
// Toda variável conhecida; a que ficar sem valor vira marcador visível, nunca some do texto.
const ROTULOS={razao_social:'razão social',cnpj:'CNPJ',endereco:'endereço',representante:'representante',cpf_representante:'CPF do representante',cargo:'cargo',numero_edital:'número do edital',orgao:'órgão',objeto:'objeto',cidade:'cidade',data:'data',porte:'porte',nome_fantasia:'nome fantasia',telefone:'telefone',email:'e-mail',inscricao_estadual:'inscrição estadual',inscricao_municipal:'inscrição municipal'};
// 'demais' não é ME/EPP: fica marcador para o usuário decidir, a declaração não afirma porte errado.
const PORTES={mei:'microempreendedor individual (MEI)',me:'microempresa (ME)',epp:'empresa de pequeno porte (EPP)'};
const sha=t=>createHash('sha256').update(t).digest('hex');
const cpf=c=>/^\d{11}$/.test(c||'')?`${c.slice(0,3)}.${c.slice(3,6)}.${c.slice(6,9)}-${c.slice(9)}`:null;
const cnpj=c=>{const d=String(c||'').replace(/\D/g,'');return d.length===14?`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`:null;};
// Chaves removidas do valor: um valor com "{{x}}" não pode virar variável no preparar.
// eslint-disable-next-line no-control-regex -- limpa controle de texto livre
const limpar=v=>v===null||v===undefined?'':String(v).replace(/[\u0000-\u001f\u007f{}]+/g,' ').replace(/\s+/g,' ').trim();
const MARCA_CPF=/\{\{\s*cpf_representante\s*\}\}/;

function variaveis({empresa,processo,identificacao,perfilEmpresa,objeto}){
 const p=perfilEmpresa||{},d=identificacao||{};
 // cidade e data ficam para o usuário: a data de geração não é a de assinatura.
 return {razao_social:empresa.razao_social,cnpj:cnpj(empresa.cnpj),endereco:d.endereco,representante:d.representante,cargo:d.cargo,
  cpf_representante:cpf(p.cpf_representante),numero_edital:processo.numero,orgao:processo.orgao,objeto,porte:PORTES[p.porte],
  nome_fantasia:p.nome_fantasia,telefone:p.telefone,email:p.email,inscricao_estadual:p.inscricao_estadual,inscricao_municipal:p.inscricao_municipal};
}
function preencherVariaveis(texto,vars){
 return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/g,(todo,nome)=>{if(!Object.hasOwn(ROTULOS,nome))return todo;return limpar(vars[nome])||`[PREENCHER: ${ROTULOS[nome]}]`;});
}
// UUID determinístico por processo + modelo (+ texto para edital/livre): a mesma intenção cai sempre na mesma peça.
function idDeterministico(processoId,modeloCodigo,textoOriginal){
 const h=sha(`kit-declaracao|${processoId}|${modeloCodigo}|${obterModelo(modeloCodigo)?'':sha(textoOriginal)}`);
 return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-${(8|(parseInt(h[16],16)&3)).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}
function validarLote(body){
 if(Object.keys(body).some(k=>!['acao','empresaId','processoId','declaracoes'].includes(k)))falhar('Solicitação inválida.',400);
 const lista=body.declaracoes;
 if(!Array.isArray(lista)||!lista.length||lista.length>LOTE_MAX)falhar(`Envie de 1 a ${LOTE_MAX} declarações por lote.`,400);
 return lista.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.modeloCodigo!=='string')falhar('Declaração do lote inválida.',400);
  const modelo=obterModelo(p.modeloCodigo);
  if(modelo){if(Object.keys(p).length!==1)falhar('Modelo da biblioteca não aceita texto próprio.',400);
   return {modeloCodigo:modelo.codigo,titulo:modelo.titulo,texto:modelo.texto,fonte:`Modelo da biblioteca LicitaPlena ${modelo.codigo} v${modelo.versao} (${modelo.baseLegal}). Revisão jurídica ${modelo.revisaoJuridica}: confira antes de usar.`};}
  if(!['edital','livre'].includes(p.modeloCodigo)||Object.keys(p).some(k=>!['modeloCodigo','titulo','texto','fonte'].includes(k))
   ||typeof p.titulo!=='string'||!p.titulo.trim()||typeof p.texto!=='string'||!p.texto.trim()||(p.fonte!==undefined&&typeof p.fonte!=='string'))falhar('Declaração do lote inválida.',400);
  return {modeloCodigo:p.modeloCodigo,titulo:p.titulo,texto:p.texto,fonte:p.fonte||(p.modeloCodigo==='edital'?'Modelo do próprio edital (texto literal); confira a referência.':'Texto informado pelo usuário; referência não informada.')};
 });
}
// Leitura opcional: tabela ou linha ausente não impede o lote; o campo vira marcador.
const opcional=async promessa=>{try{return (await promessa)?.[0]||null;}catch{return null;}};

async function gerarLote({c,empresa,processo,perfil,store,body}){
 const pedidos=validarLote(body);
 const chaves=pedidos.map(p=>idDeterministico(processo.id,p.modeloCodigo,p.texto));
 if(new Set(chaves).size!==chaves.length)falhar('Declaração repetida no lote.',400);
 const filtro=`empresa_id=eq.${empresa.id}&organizacao_id=eq.${empresa.organizacao_id}`;
 const perfilEmpresa=await opcional(c.rest(`operacao_perfil_empresa?${filtro}&select=nome_fantasia,telefone,email,inscricao_estadual,inscricao_municipal,porte${pedidos.some(p=>MARCA_CPF.test(p.texto))?',cpf_representante':''}`));
 // objeto lido à parte: o select fixo do processo entra no revisaoHash e não muda.
 const objeto=(await opcional(c.rest(`operacao_processos?id=eq.${processo.id}&${filtro}&select=objeto`)))?.objeto;
 const vars=variaveis({empresa,processo,identificacao:perfil&&!perfil.invalidado_em?perfil.dados_confirmados:null,perfilEmpresa,objeto});
 // Valida o lote inteiro antes da primeira escrita.
 const planos=pedidos.map((p,n)=>({documentoId:chaves[n],modeloCodigo:p.modeloCodigo,biblioteca:Boolean(obterModelo(p.modeloCodigo)),
  dados:validarRascunho({acao:'salvar',empresaId:body.empresaId,processoId:body.processoId,documentoId:chaves[n],versaoEsperada:0,tipo:'declaracao',declaracao:{titulo:p.titulo,texto:preencherVariaveis(p.texto,vars),fonte:p.fonte}},[])}));
 const atuais=await store.listar();const criados=[],existentes=[];
 for(const plano of planos){
  const igual=atuais.find(d=>d.id===plano.documentoId||(plano.biblioteca&&d.tipo==='declaracao'&&d.modelo_codigo===plano.modeloCodigo));
  if(igual){existentes.push({documentoId:igual.id,modeloCodigo:plano.modeloCodigo});continue;}
  try{criados.push(documentoPublico(await store.gravarModelo(plano.documentoId,plano.dados,plano.modeloCodigo),false));}
  catch(e){
   // Corrida com outra aba/usuário: a peça já existe com o mesmo id; continua idempotente.
   if(e.status===409){existentes.push({documentoId:plano.documentoId,modeloCodigo:plano.modeloCodigo});continue;}
   if(e.status===404||e.status===400)falhar('Declarações em lote indisponíveis neste ambiente ou rascunho recusado. Confira e tente de novo.',e.status===404?503:400);
   throw e;
  }
 }
 return {criados,existentes};
}

// Logo do perfil para o cabeçalho, lida com o token do usuário (RLS + policy atual do bucket).
// Qualquer falha devolve null e o documento sai sem logo, como antes; quem exporta informa logoAplicada.
async function lerLogo(c,empresa){
 try{
  const p=await opcional(c.rest(`operacao_perfil_empresa?empresa_id=eq.${empresa.id}&organizacao_id=eq.${empresa.organizacao_id}&select=logo_caminho,logo_hash`));
  const tipo=p&&tipoCaminhoLogo(p.logo_caminho,empresa.organizacao_id,empresa.id,p.logo_hash);if(!tipo)return null;
  const bytes=await lerAte(await c.request('/storage/v1/object/authenticated/operacao-documentos/'+p.logo_caminho.split('/').map(encodeURIComponent).join('/')),LOGO.bytes);
  if(sha(bytes)!==p.logo_hash)return null;
  return {bytes,...validarLogo(bytes,tipo)};
 }catch{return null;}
}
module.exports={LOTE_MAX,MARCADOR,ROTULOS,variaveis,preencherVariaveis,idDeterministico,validarLote,gerarLote,lerLogo};
