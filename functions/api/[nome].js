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

const ROTAS = {
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
  headers: { "Content-Type": "application/json" },
});

export async function onRequest(context) {
  const nome = String(context.params.nome || "");
  if (!Object.hasOwn(ROTAS, nome)) return json404();
  copiarEnvParaProcess(context.env);
  const modulo = ROTAS[nome];
  const handler = (modulo.default || modulo).handler || modulo.handler;
  return executarHandler(handler, context.request, { cacheControlPadrao: CACHE_PADRAO[nome] });
}
