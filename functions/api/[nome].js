import * as importacaoPncp from "../../netlify/functions/importar-item-pncp.js";
import * as vinculoCompraPortal from "../../netlify/functions/vinculo-compra-portal.js";
// Rota única do Cloudflare Pages Functions: /api/<nome> -> handler Netlify de mesmo nome.
//
// Por quê: o site saiu do Netlify (conta suspensa) para o Cloudflare Pages gratuito, e o front-end
// chama /api/*. A lógica continua em netlify/functions/ (também usada pelo Netlify, que reescreve
// /api/* para /.netlify/functions/*); aqui só há o roteamento por allowlist explícita.
//
// Limite do plano gratuito: 10 ms de CPU por requisição (esperar fetch não conta), 50 subrequests.
// Os imports são estáticos de propósito: o bundle (~16 MB, quase tudo pdf-parse) é avaliado na
// inicialização do isolate, que tem o próprio limite de 1 s, e não dentro da requisição. Com import()
// dinâmico a avaliação desses módulos entraria no orçamento de 10 ms da primeira chamada.
//
// ia-resumo-background fica de fora de propósito: é função de background do Netlify e o front-end
// não a alcança mais (o dossiê migrou para o robô do GitHub Actions).
import { executarHandler } from "../../netlify/functions/_adaptador_cloudflare.js";
import * as m0 from "../../netlify/functions/admin-excluir-cliente.js";
import * as m1 from "../../netlify/functions/comprasgov-marca.js";
import * as m2 from "../../netlify/functions/comprasgov-marcas-produto.js";
import * as m3 from "../../netlify/functions/comprasgov-precos.js";
import * as m4 from "../../netlify/functions/convenios-publico.js";
import * as m5 from "../../netlify/functions/despesas-fornecedor.js";
import * as m6 from "../../netlify/functions/enviar-resumo-edital.js";
import * as m7 from "../../netlify/functions/gerar-checklist.js";
import * as m8 from "../../netlify/functions/lib/ia-edital.js";
import * as m9 from "../../netlify/functions/pncp-arquivos.js";
import * as m10 from "../../netlify/functions/pncp-baixar.js";
import * as m11 from "../../netlify/functions/pncp-detalhe.js";
import * as m12 from "../../netlify/functions/pncp-itens.js";
import * as m13 from "../../netlify/functions/pncp-proxy.js";
import * as m14 from "../../netlify/functions/sancoes.js";
import * as m15 from "../../netlify/functions/enviar-duvida.js";

import * as m16 from "../../netlify/functions/empresa-identificacao.js";
import * as m17 from "../../netlify/functions/decisao-oportunidade.js";
import * as m18 from "../../netlify/functions/kit-documentos.js";
// Sistema CRM (/sistema): cadastro de processo e catálogo de empresas/processos do usuário.
import * as m19 from "../../netlify/functions/criar-processo.js";
import * as m20 from "../../netlify/functions/contextos-operacao.js";
// Busca pública da landing (sem login; só colunas públicas, até 6 linhas, cache curto).
import * as m21 from "../../netlify/functions/busca-publica.js";
// Portal do cliente: página pública (sem login, desligada sem PORTAL_CLIENTE_LIGADO=1) e gestão dos links (logado).
import * as m22 from "../../netlify/functions/portal-cliente.js";
import * as m23 from "../../netlify/functions/portal-cliente-links.js";
// Licitação anterior avulsa (Inteligência de Mercado): logado, cota diária, até 36 chamadas a fontes públicas.
import * as m24 from "../../netlify/functions/licitacao-anterior.js";
// Sanções CEIS/CNEP de um CNPJ (logado; lê a tabela sancoes_empresas com a sessão do usuário, cache curto).
import * as m25 from "../../netlify/functions/sancoes-cnpj.js";
// Pregão gravado pela extensão (dado público lido na aba do usuário): logado; POST grava, GET lê.
import * as pregaoGravado from "../../netlify/functions/pregao-gravado.js";
// Lote de proposta para a extensão preencher o cadastro (só leitura, logado e aprovado).
import * as propostaLote from "../../netlify/functions/proposta-lote.js";
// Diagnóstico da extensão (só estrutura da página do portal, sem valores nem CPF): logado, 20/dia.
import * as extensaoDiagnostico from "../../netlify/functions/extensao-diagnostico.js";
// Prospecção (Inteligência de Mercado): logado, lê prospeccao_itens com a sessão do usuário (1 subrequisição).
import * as m26 from "../../netlify/functions/prospeccao.js";
// Análise por CNPJ (Analisar concorrente): logado, cota diária, ~27 subrequisições; o pesado fica na fila do robô.
import * as analiseCnpj from "../../netlify/functions/analise-cnpj.js";
// Monte minha busca com IA (Encontrar Licitações): logado, 10 usos/dia, 1 chamada à IA; nada é gravado.
import * as monteBuscaIa from "../../netlify/functions/monte-busca-ia.js";
// Conferência CBS/IBS com a calculadora oficial da Receita (logado; 2 subrequisições, falha fechada).
import * as conferirCbsIbs from "../../netlify/functions/conferir-cbs-ibs.js";

const ROTAS = {
  "vinculo-compra-portal": vinculoCompraPortal,
  "importar-item-pncp": importacaoPncp,
  "kit-documentos": m18,
  "criar-processo": m19,
  "contextos-operacao": m20,
  "busca-publica": m21,
  "portal-cliente": m22,
  "portal-cliente-links": m23,
  "licitacao-anterior": m24,
  "sancoes-cnpj": m25,
  "pregao-gravado": pregaoGravado,
  "proposta-lote": propostaLote,
  "extensao-diagnostico": extensaoDiagnostico,
  prospeccao: m26,
  "analise-cnpj": analiseCnpj,
  "monte-busca-ia": monteBuscaIa,
  "conferir-cbs-ibs": conferirCbsIbs,
  "decisao-oportunidade": m17,
  "empresa-identificacao": m16,
  "admin-excluir-cliente": m0,
  "comprasgov-marca": m1,
  "comprasgov-marcas-produto": m2,
  "comprasgov-precos": m3,
  "convenios-publico": m4,
  "despesas-fornecedor": m5,
  "enviar-duvida": m15,
  "enviar-resumo-edital": m6,
  "gerar-checklist": m7,
  // m8 é o handler CommonJS (lib/ia-edital.js), não o .mjs: o wrapper withLambda depende do runtime do Netlify.
  "ia-edital": m8,
  "pncp-arquivos": m9,
  "pncp-baixar": m10,
  "pncp-detalhe": m11,
  "pncp-itens": m12,
  "pncp-proxy": m13,
  sancoes: m14,
};

// Mesma regra do netlify.toml para a prévia pública da landing (vale só se o handler não definir).
const CACHE_PADRAO = {
  "convenios-publico": "public, max-age=300, stale-while-revalidate=3600",
};

// Os handlers leem process.env dentro da função (exceto GROQ_MODEL, lido na avaliação do módulo, que
// agora ocorre antes da primeira requisição: ali depende do nodejs_compat_populate_process_env, ativo
// com compatibility_date >= 2025-04-01, e cai no modelo padrão se o process.env estiver vazio). No
// Pages as variáveis chegam em context.env; copiar a cada chamada garante os demais valores. Só
// strings: bindings (KV, etc.) não são variáveis de texto.
function copiarEnvParaProcess(env) {
  for (const [chave, valor] of Object.entries(env || {})) {
    if (typeof valor === "string") process.env[chave] = valor;
  }
}

const json404 = () => new Response(JSON.stringify({ erro: "Função não encontrada." }), {
  status: 404,
  headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
});

export async function onRequest(context) {
  const nome = String(context.params.nome || "");
  if (!Object.hasOwn(ROTAS, nome)) return json404();
  copiarEnvParaProcess(context.env);
  const modulo = ROTAS[nome];
  const handler = (modulo.default || modulo).handler || modulo.handler;
  return executarHandler(handler, context.request, { cacheControlPadrao: CACHE_PADRAO[nome] });
}
