const { cabecalhosPadrao, exigirUsuarioLogado } = require('./_auth');
const { tokenValido, hashToken, habilitada, rpc } = require('./_decisao_oportunidade');
exports.handler = async event => {
  const responder = (statusCode, body) => ({statusCode,headers:{...cabecalhosPadrao(event),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'},body:JSON.stringify(body)});
  if (event.httpMethod === 'OPTIONS') return responder(204,{});
  if (event.httpMethod === 'GET') return responder(200,{habilitada:habilitada()});
  if (event.httpMethod !== 'POST') return responder(405,{erro:'Método não permitido.'});
  if (!habilitada()) return responder(503,{erro:'Confirmações temporariamente indisponíveis.'});
  if (String(event.body || '').length > 3000) return responder(413,{erro:'Pedido muito grande.'});
  let dados;
  try { dados = JSON.parse(event.body || '{}'); } catch (_) { return responder(400,{erro:'Pedido inválido.'}); }
  try {
    if (dados?.acao === 'listar') {
      const usuario = await exigirUsuarioLogado(event);
      if (!usuario.ok) return responder(usuario.status,{erro:usuario.erro});
      return responder(200,{decisoes:await rpc('listar_decisoes_oportunidade',{p_usuario:usuario.userId})});
    }
    if (!tokenValido(dados?.token) || !['consultar','confirmar'].includes(dados?.acao)) return responder(400,{erro:'Link inválido.'});
    if (dados.acao === 'confirmar' && (dados.confirmado !== true || !['participar','nao_participar'].includes(dados.decisao) || typeof dados.nome !== 'string' || dados.nome.trim().length < 2 || dados.nome.length > 100)) return responder(400,{erro:'Informe seu nome, escolha uma opção e confirme a revisão.'});
    const resultado = await rpc('responder_decisao_oportunidade',{p_hash:hashToken(dados.token),p_decisao:dados.acao === 'confirmar' ? dados.decisao : null,p_nome:dados.acao === 'confirmar' ? dados.nome.trim() : null});
    if (!resultado) return responder(404,{erro:'Link inválido ou expirado. Peça um novo envio ao assessor.'});
    if (resultado.conflito) return responder(409,{erro:'Já existe uma decisão registrada neste link. Fale com o assessor para alterá-la.'});
    return responder(200,resultado);
  } catch (erro) { return responder(erro.status || 503,{erro:'Não foi possível registrar ou consultar agora. Tente novamente.'}); }
};
