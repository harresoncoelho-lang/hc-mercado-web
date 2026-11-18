const LIMITES = Object.freeze({ upload: 4*1024*1024, extracao:2*1024*1024, paginas:8 });
// campo vai para a resposta 422; é sempre o nome do campo, nunca o valor (LGPD: CPF e banco).
function falhar(erro,status=422,campo){const e=new Error(erro);e.status=status;if(campo)e.campo=campo;throw e;}
function caminhoPermitido(caminho,org,empresa){return typeof caminho==='string' && caminho.startsWith(`${org}/${empresa}/`) && caminho.split('/').length>=3 && !caminho.split('/').some(p=>!p||p==='.'||p==='..');}
function validarArquivo(nome,base64){
 if(typeof nome!=='string'||nome.length>180||!nome.toLowerCase().endsWith('.pdf'))falhar('Envie um PDF.');
 if(typeof base64!=='string'||base64.length>Math.ceil(LIMITES.upload/3)*4||!base64.length||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))falhar('Arquivo inválido ou maior que 4 MiB.',413);
 const bytes=Buffer.from(base64,'base64');if(bytes.length>LIMITES.upload)falhar('Arquivo maior que 4 MiB.',413);
 if(bytes.subarray(0,5).toString()!=='%PDF-')falhar('Envie um PDF válido.');return bytes;
}
function validarConfirmacao(body,empresa){
 if(body.revisado!==true)falhar('Confirme a revisão dos dados.');
 const normal=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,' ');
 if(normal(body.razaoSocial)!==normal(empresa.razao_social)||String(body.cnpj||'').replace(/\D/g,'')!==String(empresa.cnpj||'').replace(/\D/g,''))falhar('Os dados divergem do cadastro da empresa. Corrija ou confira o cadastro.',409);
 const dados=body.dados;if(!dados||typeof dados!=='object'||Array.isArray(dados))falhar('Dados inválidos.');
 const limites={endereco:500,representante:180,cargo:120};for(const key of Object.keys(dados))if(!(key in limites))falhar('Campo não permitido.');
 const validados={};for(const [key,max] of Object.entries(limites)){if(typeof dados[key]!=='string'||!dados[key].trim()||dados[key].length>max)falhar(`Confira o campo ${key}.`);validados[key]=normal(dados[key]);}
 const proveniencia=body.proveniencia||[];if(!Array.isArray(proveniencia)||proveniencia.length>3||new Set(proveniencia.map(p=>p?.documentoId)).size>2)falhar('Proveniência inválida.');
 for(const p of proveniencia){if(!p||typeof p.documentoId!=='string'||! /^[a-f0-9]{64}$/i.test(p.hash||'')||!Array.isArray(p.campos)||!p.campos.length||p.campos.some(c=>!(c in limites))||!(p.pagina===null||Number.isInteger(p.pagina)&&p.pagina>=1&&p.pagina<=8)||typeof p.trecho!=='string'||p.trecho.length>1200)falhar('Proveniência inválida.');}
 return {dados:validados,proveniencia};
}
// ---------- Perfil da empresa (esteira E10). Mensagens nunca repetem o valor recebido (LGPD). ----------
const PORTES=['mei','me','epp','demais'];const REGIMES=['mei','simples','presumido','real'];
const PERCENTUAIS_PREMISSA=['tributos_percentual','frete_percentual','garantia_percentual','margem_percentual','margem_minima_percentual'];
const LOGO=Object.freeze({bytes:512*1024,px:2000});
const normal=s=>s.normalize('NFKC').trim().replace(/\s+/g,' ');
const vazio=v=>v===null||v===undefined||v==='';
const texto=(max,min=1)=>(v,c)=>{if(typeof v!=='string'||normal(v).length<min||normal(v).length>max)falhar(`Confira o campo ${c}.`,422,c);return normal(v);};
const lista=opcoes=>(v,c)=>{if(!opcoes.includes(v))falhar(`Escolha um valor válido para ${c}.`,422,c);return v;};
function percentual(v,c,max){const n=typeof v==='string'?Number(v.trim().replace(',','.')):v;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)falhar(`${c} deve ficar entre 0 e ${String(max).replace('.',',')}.`,422,c);return Math.round(n*1000)/1000;}
function cpfValido(c){if(!/^\d{11}$/.test(c)||/^(\d)\1{10}$/.test(c))return false;for(const n of [9,10]){let soma=0;for(let i=0;i<n;i++)soma+=Number(c[i])*(n+1-i);if((soma*10%11)%10!==Number(c[n]))return false;}return true;}
const mascararCpf=c=>c?`***.***.***-${String(c).slice(-2)}`:null;
function objetoCurto(v,c,chaves,max){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!chaves.includes(k)))falhar(`Confira o campo ${c}.`,422,c);
 const out={};for(const k of chaves)if(!vazio(v[k]))out[k]=texto(max)(v[k],`${c}.${k}`);return out;
}
const VALIDADORES={
 nome_fantasia:texto(180),inscricao_estadual:texto(30),inscricao_municipal:texto(30),tributos_fonte:texto(40),
 telefone:(v,c)=>{const s=texto(30,8)(v,c);const d=s.replace(/\D/g,'').length;if(!/^[0-9()+\-.\s]+$/.test(s)||d<10||d>13)falhar('Telefone inválido.',422,c);return s;},
 email:(v,c)=>{const s=texto(254)(v,c).toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))falhar('E-mail inválido.',422,c);return s;},
 porte:lista(PORTES),regime_tributario:lista(REGIMES),
 aliquota_efetiva:(v,c)=>percentual(v,c,99.999),
 cpf_representante:(v,c)=>{const d=typeof v==='string'?v.replace(/[.\-\s]/g,''):'';if(!cpfValido(d))falhar('CPF inválido. Confira os dígitos.',422,c);return d;},
 banco:(v,c)=>objetoCurto(v,c,['banco','agencia','conta','pix','favorecido'],120),
 proposta_padrao:(v,c)=>objetoCurto(v,c,['validade','pagamento','prazo_entrega'],200),
};
// Colunas NOT NULL: vazio volta ao default do banco.
const PADRAO_SE_VAZIO={tributos_fonte:'manual',proposta_padrao:{}};
function validarPerfilEmpresa(perfil){
 if(!perfil||typeof perfil!=='object'||Array.isArray(perfil))falhar('Perfil inválido.',422,'perfil');
 const dados={};
 for(const [k,v] of Object.entries(perfil)){
  // Chave desconhecida não é ecoada: pode ser qualquer texto vindo do navegador.
  if(!Object.hasOwn(VALIDADORES,k))falhar('Campo não permitido no perfil.',422,'perfil');
  dados[k]=vazio(v)?(PADRAO_SE_VAZIO[k]??null):VALIDADORES[k](v,k);
 }
 return dados;
}
function validarPremissas(premissas){
 if(!Array.isArray(premissas)||premissas.length>50)falhar('Envie até 50 premissas.',422,'premissas');
 const vistas=new Set();
 return premissas.map((p,i)=>{
  const c=`premissas[${i}]`;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['segmento','uf',...PERCENTUAIS_PREMISSA].includes(k)))falhar('Premissa inválida.',422,c);
  const segmento=vazio(p.segmento)?'*':typeof p.segmento==='string'?normal(p.segmento).toLowerCase():'';
  if(!segmento||segmento.length>80)falhar('Segmento inválido.',422,`${c}.segmento`);
  const uf=vazio(p.uf)?'*':typeof p.uf==='string'?p.uf.trim().toUpperCase():'';
  if(uf!=='*'&&!/^[A-Z]{2}$/.test(uf))falhar('UF inválida.',422,`${c}.uf`);
  if(vistas.has(segmento+'|'+uf))falhar('Premissa repetida para o mesmo segmento e UF.',422,c);vistas.add(segmento+'|'+uf);
  const linha={segmento,uf};for(const k of PERCENTUAIS_PREMISSA)linha[k]=vazio(p[k])?null:percentual(p[k],`${c}.${k}`,100);
  if(linha.margem_minima_percentual!==null&&(linha.margem_percentual===null||linha.margem_minima_percentual>linha.margem_percentual))falhar('A margem mínima não pode passar da margem.',422,`${c}.margem_minima_percentual`);
  return linha;
 });
}
// Logo: {org}/{empresa}/perfil/logo-<sha256>.<png|jpg|jpeg>; devolve o tipo que o conteúdo precisa ter.
function tipoCaminhoLogo(caminho,org,empresa,hash){
 if(!caminhoPermitido(caminho,org,empresa))return null;const partes=caminho.split('/');
 const m=partes.length===4&&partes[2]==='perfil'&&/^logo-([0-9a-f]{64})\.(png|jpe?g)$/.exec(partes[3]);
 return m&&m[1]===hash?(m[2]==='png'?'image/png':'image/jpeg'):null;
}
// Lê só o cabeçalho (IHDR do PNG ou SOFn do JPEG): sem biblioteca de imagem.
function dimensoesImagem(b){
 if(b.length>=24&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))&&b.toString('latin1',12,16)==='IHDR')return {tipo:'image/png',largura:b.readUInt32BE(16),altura:b.readUInt32BE(20)};
 if(b.length<4||b[0]!==0xff||b[1]!==0xd8||b[2]!==0xff)return null;
 for(let i=2;i+3<b.length;){
  if(b[i]!==0xff){i++;continue;}const m=b[i+1];
  if(m===0xff){i++;continue;}if(m===0x01||(m>=0xd0&&m<=0xd8)){i+=2;continue;}if(m===0xd9||m===0xda)return null;
  if(m>=0xc0&&m<=0xcf&&![0xc4,0xc8,0xcc].includes(m))return i+9<=b.length?{tipo:'image/jpeg',altura:b.readUInt16BE(i+5),largura:b.readUInt16BE(i+7)}:null;
  i+=2+b.readUInt16BE(i+2);
 }
 return null;
}
function validarLogo(bytes,tipoEsperado){
 if(bytes.length>LOGO.bytes)falhar('A logo deve ter no máximo 512 KB.',422,'logo');
 const img=dimensoesImagem(bytes);if(!img||img.tipo!==tipoEsperado)falhar('Envie a logo em PNG ou JPEG válido.',422,'logo');
 if(!img.largura||!img.altura||img.largura>LOGO.px||img.altura>LOGO.px)falhar('A logo deve ter no máximo 2000 px de largura e de altura.',422,'logo');
 return img;
}
module.exports={LIMITES,LOGO,falhar,caminhoPermitido,validarArquivo,validarConfirmacao,cpfValido,mascararCpf,validarPerfilEmpresa,validarPremissas,tipoCaminhoLogo,dimensoesImagem,validarLogo};
