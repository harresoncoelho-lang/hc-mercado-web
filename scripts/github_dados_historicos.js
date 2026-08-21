// scripts/github_dados_historicos.js
// Helper pra ler/escrever arquivos JSON no repositório dedicado de dados
// históricos (ver docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md).
// Usa a API REST de Contents do GitHub direto via fetch() — sem SDK, sem
// git clone, mesmo estilo de scripts/supabase_dados.js. O repositório de
// dados é público e separado do hc-mercado-web de propósito: commits aqui
// não disparam rebuild do site no Netlify.

function repoDados() {
  return process.env.REPO_DADOS_HISTORICOS || "harresoncoelho-lang/hc-licitacoes-dados-historicos";
}

function token() {
  const t = process.env.DADOS_HISTORICOS_TOKEN;
  if (!t) {
    throw new Error(
      "DADOS_HISTORICOS_TOKEN não configurada. Defina essa variável de ambiente " +
      "(no GitHub Actions: Settings > Secrets and variables > Actions) com um " +
      "Personal Access Token com permissão de escrita no repositório de dados históricos."
    );
  }
  return t;
}

async function apiFetch(caminho, opcoes = {}) {
  const resp = await fetch(`https://api.github.com/repos/${repoDados()}/contents/${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    },
  });
  return resp;
}

// Lê um arquivo JSON do repositório de dados. Retorna { conteudo: null, sha: null }
// se o arquivo ainda não existir (404) — não é erro, é o caso normal na primeira
// vez que um ano/UASG é gravado.
async function lerArquivoJson(caminho) {
  const resp = await apiFetch(caminho);
  if (resp.status === 404) return { conteudo: null, sha: null };
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`GitHub Contents API GET ${caminho} -> HTTP ${resp.status}: ${texto.slice(0, 300)}`);
  }
  const dados = await resp.json();
  const conteudo = JSON.parse(Buffer.from(dados.content, "base64").toString("utf8"));
  return { conteudo, sha: dados.sha };
}

// Escreve (cria ou atualiza) um arquivo JSON no repositório de dados. Busca o sha
// atual primeiro quando o arquivo já existe — a API do GitHub exige o sha antigo
// pra confirmar que não estamos sobrescrevendo uma mudança concorrente.
async function escreverArquivoJson(caminho, objeto, mensagemCommit) {
  const { sha } = await lerArquivoJson(caminho);
  const conteudoBase64 = Buffer.from(JSON.stringify(objeto), "utf8").toString("base64");
  const corpo = { message: mensagemCommit, content: conteudoBase64 };
  if (sha) corpo.sha = sha;
  const resp = await apiFetch(caminho, { method: "PUT", body: JSON.stringify(corpo) });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => "");
    throw new Error(`GitHub Contents API PUT ${caminho} -> HTTP ${resp.status}: ${texto.slice(0, 300)}`);
  }
}

module.exports = { lerArquivoJson, escreverArquivoJson };
