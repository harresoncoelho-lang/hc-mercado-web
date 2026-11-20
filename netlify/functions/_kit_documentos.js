const {LIMITES,validarBudget}=require('./_kit_proposta_limites');
const {ordemItem}=require('./_kit_proposta_itens');
const {createHash}=require('node:crypto');
const {falhar}=require('./_empresa_identificacao');
const {montarDocx}=require('./gerar-checklist');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function pendente(mensagem){const e=new Error('Confira as pendências antes de gerar.');e.status=422;e.pendencias=[mensagem];throw e;}
function texto(valor,rotulo,max=500){
 if(typeof valor!=='string'||!valor.trim()||valor.length>max||Array.from(valor).some(c=>{const n=c.codePointAt(0);return !(n===9||n===10||n===13||n>=32&&n<=0xd7ff||n>=0xe000&&n<=0xfffd||n>=0x10000&&n<=0x10ffff);}))pendente(`Confira ${rotulo}.`);
 return valor;
}
function decimal(valor,escala){
 // numeric chega como texto via alias ::text no REST, evitando perda binária.
 if(typeof valor!=='string'||!new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${escala}})?$`).test(valor))pendente('Valor decimal inválido.');
 const [inteiro,fracao='']=valor.split('.');const n=BigInt(inteiro+fracao.padEnd(escala,'0'));
 if(n<=0n||n>999999999999999n)pendente('Valor fora do limite ou igual a zero.');return n;
}
function totalItem(q,p){const n=(decimal(q,3)*decimal(p,2)+500n)/1000n;if(n>999999999999999n)pendente('Total excede o limite.');return n;}
const dinheiro=n=>`${String(n/100n).replace(/\B(?=(\d{3})+$)/g,'.')},${String(n%100n).padStart(2,'0')}`;
// numeric(…,3) chega como texto: inteiro sem casas ("200"), fração só com as casas usadas ("2,5"); "200,000" parecia duzentos mil.
const quantidade=q=>{const [i,f='']=q.split('.');const c=f.replace(/0+$/,'');return c?`${i},${c}`:i;};
// Valor por extenso (proposta formato 2): centavos em BigInt, só aritmética inteira.
const UNIDADES=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const DEZENAS=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const CENTENAS=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
const ESCALAS=[null,null,['milhão','milhões'],['bilhão','bilhões'],['trilhão','trilhões']];
function ate999(n){
 if(n===100)return 'cem';
 const c=Math.floor(n/100),r=n%100,partes=[];
 if(c)partes.push(CENTENAS[c]);
 if(r)partes.push(r<20?UNIDADES[r]:DEZENAS[Math.floor(r/10)]+(r%10?` e ${UNIDADES[r%10]}`:''));
 return partes.join(' e ');
}
function inteiroPorExtenso(n){
 const grupos=[];for(let i=0;n>0n;i++,n/=1000n)grupos.push([Number(n%1000n),i]);
 if(grupos.length>ESCALAS.length)throw new RangeError('Valor acima do suportado.');
 const ativos=grupos.filter(([v])=>v).reverse();
 return ativos.map(([v,i],k)=>{
  const palavra=i===0?ate999(v):i===1?(v===1?'mil':`${ate999(v)} mil`):`${ate999(v)} ${ESCALAS[i][v===1?0:1]}`;
  // "e" só antes do último grupo quando ele é < 100 ou centena redonda: "mil e um", "mil e duzentos", "mil duzentos e trinta".
  return k>0&&k===ativos.length-1&&(v<100||v%100===0)?`e ${palavra}`:palavra;
 }).join(' ');
}
function valorPorExtenso(centavos){
 const n=BigInt(centavos);if(n<0n)throw new RangeError('Valor negativo.');
 if(n===0n)return 'zero reais';
 const reais=n/100n,cent=Number(n%100n),partes=[];
 // Milhão/bilhão/trilhão redondo leva "de": "um milhão de reais".
 if(reais)partes.push(`${inteiroPorExtenso(reais)} ${reais%1000000n===0n?'de ':''}${reais===1n?'real':'reais'}`);
 if(cent)partes.push(`${ate999(cent)} ${cent===1?'centavo':'centavos'}`);
 return partes.join(' e ');
}
function canonico(v){if(Array.isArray(v))return v.map(canonico);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonico(v[k])]));return v;}
const CPF_PREVIA='[CPF do representante]';
function declaracao(empresa,processo,dados,body,fontes){
 let titulo,conteudo,campos;
 const d=body.declaracao||{};titulo=texto(d.titulo,'título',180);const modelo=texto(d.texto,'texto da declaração',20000);
 const variaveis={razao_social:empresa.razao_social,cnpj:empresa.cnpj,endereco:dados.endereco,representante:dados.representante,cargo:dados.cargo,numero_edital:processo.numero,orgao:processo.orgao};
 // LGPD: o CPF só entra no texto exportado; prévia e revisaoHash cobrem o marcador.
 const montar=cpf=>modelo.replace(/{{([\s\S]*?)}}/g,(_,v)=>{if(v==='cpf_representante')return cpf;if(!Object.hasOwn(variaveis,v))pendente('Variável desconhecida na declaração.');return variaveis[v];});
 conteudo=montar(CPF_PREVIA);
 if(conteudo.includes('{{')||conteudo.includes('}}'))pendente('Variável inválida na declaração.');
 const fonte=d.fonte==null||d.fonte===''?'':texto(d.fonte,'fonte',1000);fontes.push(fonte?`Referência informada pelo usuário (não verificada): ${fonte}`:'Modelo informado pelo usuário; referência não informada.');campos={titulo,modelo,fonte};

 return {titulo,conteudo,campos,itens:[],comCpf:modelo.includes('{{cpf_representante}}')?montar:null};
}
function proposta(ctx,body,fontes){
 let titulo,conteudo,campos;const itens=[];
 titulo='Proposta de materiais';const p=body.proposta||{};const ids=p.itemIds;
 if(!Array.isArray(ids)||ids.length<1||ids.length>LIMITES.itens||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)pendente('Selecione de 1 a 1000 itens sem duplicatas; o tamanho total também é limitado.');
 campos={validade:texto(p.validade,'validade'),prazoEntrega:texto(p.prazoEntrega,'prazo de entrega'),pagamento:texto(p.pagamento,'pagamento'),unidades:{}};
 validarBudget(p); const indice=new Map(ctx.itens.map(i=>[i.id,i])); let total=0n;const linhas=[],tabela=[];
 for(const id of [...ids].sort()){
 const i=indice.get(id);if(!i)falhar('Item indisponível.',404);if(i.tipo!=='item')pendente('Lote agregado requer detalhamento em itens individuais.');
 const unidade=texto(p.unidades?.[id],'unidade informada por item',40);campos.unidades[id]=unidade;
 texto(i.descricao,'descrição do item',10000);texto(i.identificador,'identificador do item',180);
 for(const c of ['marca','modelo'])if(i[c]!=null&&i[c]!=='')texto(i[c],c,500);
 const subtotal=totalItem(i.quantidade,i.valor_unitario_proposta);total+=subtotal;if(total>999999999999999n)pendente('Total excede o limite.');itens.push(i);
 tabela.push([i.identificador,i.descricao,quantidade(i.quantidade),unidade,`${i.marca||'não informada'} / ${i.modelo||'não informado'}`,dinheiro(decimal(i.valor_unitario_proposta,2)),dinheiro(subtotal)]);
 linhas.push(`Item ${i.identificador}: ${i.descricao}\nQuantidade: ${quantidade(i.quantidade)} | Unidade informada pelo usuário: ${unidade}\nMarca: ${i.marca||'não informada'} | Modelo: ${i.modelo||'não informado'}\nUnitário ofertado: R$ ${dinheiro(decimal(i.valor_unitario_proposta,2))} | Total: R$ ${dinheiro(subtotal)}`);
 }
 const rodape=`Total da proposta: R$ ${dinheiro(total)}\nValidade: ${campos.validade}\nPrazo de entrega: ${campos.prazoEntrega}\nPagamento: ${campos.pagamento}`;
 conteudo=`${linhas.join('\n\n')}\n\n${rodape}`;
 fontes.push('Descrição, quantidade e preço ofertado: itens persistidos do processo. Unidade e condições informadas pelo usuário.');

 // Extenso só no rodapé da tabela (formato 2); prévia e revisaoHash continuam sem ele.
 // Tabela (fora do hash) pela ordem do número do item; a prévia mantém a ordem por id para não invalidar revisões.
 tabela.sort((a,b)=>ordemItem({identificador:a[0],id:''},{identificador:b[0],id:''}));
 return {titulo,conteudo,campos,itens,tabela,rodape:rodape.replace('\n',` (${valorPorExtenso(total)})\n`)};
}
function preparar(ctx,body){
 const {empresa,processo,perfil}=ctx;
 if(!perfil||perfil.invalidado_em)pendente('Confirme a identificação empresarial no cadastro.');
 const dados=perfil.dados_confirmados||{};
 for(const campo of ['endereco','representante','cargo'])texto(dados[campo],campo);
 texto(empresa.razao_social,'razão social');if(!/^\d{14}$/.test(String(empresa.cnpj||'').replace(/\D/g,'')))pendente('Confira o CNPJ no cadastro.');
 texto(processo.numero,'número do edital');texto(processo.orgao,'órgão');
 const identidade=`${empresa.razao_social}\nCNPJ: ${empresa.cnpj}\nEndereço: ${dados.endereco}\nRepresentante: ${dados.representante}\nCargo: ${dados.cargo}\nEdital: ${processo.numero}\nÓrgão: ${processo.orgao}`;
 let titulo,conteudo,campos,itens=[],tabela,rodape,comCpf;const fontes=['Identificação empresarial confirmada; confira os dados e o edital.'];
 if(!['declaracao','proposta'].includes(body.tipo))pendente('Selecione o tipo de documento.');
 ({titulo,conteudo,campos,itens,tabela,rodape,comCpf}=body.tipo==='declaracao'?declaracao(empresa,processo,dados,body,fontes):proposta(ctx,body,fontes));
 const previa={texto:`${titulo}\n\n${identidade}\n\n${conteudo}`,fontes};
 texto(previa.texto,'conteúdo final',1000000);
 if(body.tipo==='proposta'&&Buffer.byteLength(previa.texto,'utf8')>LIMITES.previaBytes)pendente('Prévia excede o tamanho suportado. Reduza a seleção sem perder o rascunho.');
 const revisaoHash=createHash('sha256').update(JSON.stringify(canonico({userId:ctx.userId,empresa,processo,perfil,itens,campos,tipo:body.tipo,previa}))).digest('hex');
 // tabela: o mesmo conteúdo da prévia (que entra no hash), só arrumado em linhas para a proposta formato 2; o total por extenso deriva do total já coberto pelo hash.
 // CNPJ com máscara só no arquivo (como o extenso): prévia e revisaoHash seguem com o CNPJ cru, então peças já revisadas continuam válidas.
 const mascararCnpj=mascaraCnpj(empresa.cnpj);
 return {previa,revisaoHash,titulo,mascararCnpj,...(comCpf?{textoComCpf:cpf=>`${titulo}\n\n${identidade}\n\n${comCpf(cpf)}`}:{}),...(tabela?{tabela:{antes:mascararCnpj(`${titulo}\n\n${identidade}`),linhas:tabela,depois:rodape}}:{})};
}
// Troca o CNPJ cru da empresa (14 dígitos isolados) por 00.000.000/0000-00; CNPJ já formatado fica como está.
function mascaraCnpj(cnpj){
 const d=String(cnpj||'');if(!/^\d{14}$/.test(d))return t=>t;
 const fmt=`${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`,re=new RegExp(`(?<!\\d)${d}(?!\\d)`,'g');
 return t=>t.replace(re,fmt);
}
// Texto do DOCX: a prévia, ou o texto com o CPF lido na hora; null = a peça pede CPF e o perfil não tem.
function textoFinal(resultado,cpf){const m=resultado.mascararCnpj||(t=>t);if(!resultado.textoComCpf)return m(resultado.previa.texto);return cpf?m(resultado.textoComCpf(cpf)):null;}
// Tabela só quando a peça persistida nasceu no formato 2; sem logo nem formato, o DOCX sai como antes.
function docx(resultado,{formato=1,logo=null,paginas}={}){return montarDocx({}, {}, {texto:resultado.previa.texto,preservarLinhas:true,tituloNegrito:true},resultado.titulo,{logo,tabela:formato===2?resultado.tabela:null,paginas});}
module.exports={quantidade,valorPorExtenso,uuid,decimal,totalItem,dinheiro,preparar,docx,pendente,textoFinal,CPF_PREVIA};

