// Netlify Function: prévia pública (sem login) de "Convênios e Emendas Federais" pra
// landing page (index.html). Lê só a chave "convenios" da tabela public.dados_robo (o
// mesmo blob que scripts/coletar_convenios.js grava e que painel.html lê autenticado) e
// devolve um resumo mínimo — total de registros + os 5 mais recentes. Sem filtros, sem
// paginação, sem os campos internos do blob completo (dataInicial/dataFinal/parcial etc.).
//
// Por quê uma function em vez de liberar SELECT público (RLS) na tabela: dados_robo também
// guarda chaves que não deveriam ficar públicas (ex: "editais_vistos", histórico de envio
// do boletim por cliente). Ler aqui do lado do servidor com a Service Role Key mantém o
// controle de exatamente o que sai pro público, sem abrir a tabela inteira. Segue o mesmo
// padrão de "proxy sem autenticação, sem custo" de pncp-itens.js (Access-Control-Allow-Origin
// "*", já que não chama nenhuma API paga/cotada — só lê nosso próprio Supabase).
//
// Uso: GET /.netlify/functions/convenios-publico
const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_RECENTES = 5;

exports.handler = async () => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    // Dado só muda uma vez por dia (robô roda via cron) — cache curto no CDN evita bater
    // no Supabase a cada visita da landing page.
    "Cache-Control": "public, max-age=300",
  };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    // Fail-open com resposta vazia (mesmo espírito de verificarLimiteDiario em _auth.js):
    // melhor a seção da landing ficar sem dado agora do que a function derrubar com 500.
    return { statusCode: 200, headers, body: JSON.stringify({ total: 0, atualizadoEm: null, recentes: [] }) };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/dados_robo?chave=eq.convenios&select=dado`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ total: 0, atualizadoEm: null, recentes: [] }) };
    }
    const linhas = await resp.json();
    const blob = linhas.length > 0 ? linhas[0].dado : null;
    const registros = (blob && Array.isArray(blob.registros)) ? blob.registros : [];

    const recentes = [...registros]
      .sort((a, b) => new Date(b.dataPublicacao || 0) - new Date(a.dataPublicacao || 0))
      .slice(0, LIMITE_RECENTES)
      .map((r) => ({
        orgao: r.orgao || "Órgão não informado",
        valor: Number(r.valor || 0),
        uf: r.uf || "",
        dataPublicacao: r.dataPublicacao || null,
      }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        total: registros.length,
        atualizadoEm: (blob && blob.atualizadoEm) || null,
        recentes,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers, body: JSON.stringify({ total: 0, atualizadoEm: null, recentes: [] }) };
  }
};
