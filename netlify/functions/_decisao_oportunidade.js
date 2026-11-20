const { randomBytes, createHash } = require('node:crypto');
const BASE = 'https://lsqjamqvmrcyrvowndiu.supabase.co/rest/v1';
const tokenValido = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const habilitada = () => process.env.DECISAO_CLIENTE_ATIVA === '1' && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
function falhar(status, mensagem) { const erro = new Error(mensagem); erro.status = status; throw erro; }
async function rpc(nome, body) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) falhar(503,'Confirmações temporariamente indisponíveis.');
  const r = await fetch(`${BASE}/rpc/${nome}`, { method:'POST', headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'}, body:JSON.stringify(body), signal:globalThis.AbortSignal.timeout(8000) });
  if (!r.ok) falhar(503,'Não foi possível consultar ou registrar a decisão agora.');
  return r.json();
}
async function criarSolicitacao(usuarioId, empresaId, destino, edital) {
  if (!habilitada()) falhar(503,'A confirmação do cliente ainda não está disponível. Desmarque a solicitação para enviar apenas o resumo.');
  if (!/^[a-f0-9-]{36}$/i.test(empresaId || '') || !/^[0-9]{14}-[0-9]-[0-9]+\/[0-9]{4}$/.test(edital?.numeroControlePNCP || '')) falhar(400,'Selecione uma empresa e uma licitação identificada para solicitar a decisão.');
  const token = randomBytes(32).toString('hex');
  const resultado = await rpc('criar_decisao_oportunidade', {p_usuario:usuarioId,p_empresa:empresaId,p_destino:destino,p_edital:edital.numeroControlePNCP,p_objeto:String(edital.objeto || '').slice(0,1000),p_hash:hashToken(token)});
  if (!resultado?.ok) falhar(403,'Sem permissão para solicitar decisão nesta empresa.');
  return token;
}
function blocoDecisao(token) {
  if (!tokenValido(token)) return '';
  const url = `https://licitaplena.com.br/responder-oportunidade.html#token=${token}`;
  return `<div style="margin-top:24px;padding:18px;border:1px solid #dce5f0;background:#f8fafc;"><h3 style="color:#102d56;margin:0 0 12px;">Deseja participar desta oportunidade?</h3><a href="${url}&amp;escolha=participar" style="display:inline-block;margin:0 8px 8px 0;padding:12px 18px;background:#2255e0;color:white;border-radius:7px;text-decoration:none;">Quero participar</a><a href="${url}&amp;escolha=nao_participar" style="display:inline-block;padding:12px 18px;background:#e8efff;color:#071b70;border-radius:7px;text-decoration:none;">Não quero participar</a><p style="font-size:12px;color:#52627d;">Confirme sua escolha na página seguinte. Este link é individual, válido por 7 dias. A decisão será informada ao assessor; não realiza inscrição no pregão.</p></div>`;
}
async function marcarEnvio(token, usuarioId, status) {
  if (!token) return;
  try { await rpc('marcar_envio_decisao',{p_hash:hashToken(token),p_usuario:usuarioId,p_status:status}); }
  catch (_) { /* Permanece preparado, exibido como envio não confirmado; não reenviar e-mail já aceito. */ }
}
module.exports = { tokenValido, hashToken, habilitada, rpc, criarSolicitacao, blocoDecisao, marcarEnvio, falhar };
