# ComprasNet Legado — Fase 1 (coleta ampla) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coletar o histórico de licitações do módulo Legado do Compras.gov.br
(2015-2026) e gravar num repositório GitHub dedicado, servido depois via
jsDelivr — sem tocar no Supabase (só um cursor de progresso pequeno) e sem
mexer no painel ainda.

**Architecture:** Robô Node.js standalone (`scripts/coletar_comprasnet_legado.js`),
rodando via GitHub Actions com cron diário, escreve em dois tipos de arquivo
(`licitacoes/{ano}.json`, `uasgs/{codigoUasg}.json`) num segundo repositório
GitHub via chamadas diretas à API REST de Contents do GitHub (sem SDK, sem
`git clone` — mesmo estilo de `fetch()` cru já usado em `scripts/supabase_dados.js`).
Progresso entre execuções (qual ano/página já foi varrido) e o cache de
UASG→UF ficam no Supabase (`dados_robo`), reaproveitando os helpers que já
existem.

**Tech Stack:** Node.js 20 (mesmo runtime dos outros robôs), `fetch()` nativo,
sem dependências novas no `package.json`.

**Spec:** `docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md`

## Global Constraints

- Endpoint fonte: `https://dadosabertos.compras.gov.br/modulo-legado/1_consultarLicitacao` — sem autenticação.
- Parâmetros obrigatórios: `data_publicacao_inicial`/`data_publicacao_final`, formato `YYYY-MM-DD`, janela máxima de 365 dias por chamada.
- `tamanhoPagina`: mínimo 10, máximo 500 (confirmado por teste real — a API rejeita valores fora desse intervalo com HTTP 400).
- Janela de coleta: anos 2015 até o ano corrente.
- Endpoint UASG: `https://dadosabertos.compras.gov.br/modulo-uasg/1_consultarUasg`, parâmetro `statusUasg=true` obrigatório, mesmos limites de paginação.
- Nenhuma dependência nova em `package.json` — só `fetch()` nativo do Node 20.
- Nenhuma escrita na tabela `contratos` do Supabase — só blobs pequenos em `dados_robo` (chaves `comprasnet_uasg` e `comprasnet_progresso`).
- Esta Fase 1 **não** inclui: busca de vencedor (Fase 2), nem qualquer mudança em `painel.html`/`netlify.toml` — isso é escopo de um plano futuro.
- **Guarda de escopo obrigatória** (pedido explícito do Harreson, já que o
  repositório de dados é público): todo objeto escrito no repositório de
  dados passa por `validarCamposPermitidos()` contra uma allowlist
  explícita (`CAMPOS_PERMITIDOS_LICITACAO`/`CAMPOS_PERMITIDOS_LICITACAO_UASG`)
  antes de qualquer `escreverArquivoJson()` — nunca um spread/cópia crua do
  objeto de origem. Ver Task 4.

---

## Task 1: Repositório de dados + credenciais (pré-requisito manual)

Este task não tem "código" pra escrever — é configuração que precisa
acontecer antes de qualquer script rodar de verdade. Documentado aqui como
task porque bloqueia o Task 2.

**Files:** nenhum arquivo neste repositório é criado/modificado neste task.

**Interfaces:**
- Produces: um token (`DADOS_HISTORICOS_TOKEN`) disponível como secret do
  GitHub Actions no repo `hc-mercado-web`, e um repositório novo e vazio
  pra receber os dados.

- [ ] **Passo 1: Confirmar nome e criar o repositório**

Perguntar ao usuário se pode criar (ou pedir que ele mesmo crie) um
repositório novo, vazio, sob a conta `harresoncoelho-lang`, nome sugerido
`hc-licitacoes-dados-historicos` (pode ser outro nome, é só uma sugestão).

**Privado, não público** — decisão do Harreson em 2026-08-20, enquanto uma
tensão entre o Decreto 8.777/2016 (permite reuso irrestrito, só exige
crédito de fonte) e a licença Creative Commons Atribuição-SemDerivações
(CC BY-ND) que aparece no rodapé de gov.br/compras não for esclarecida.
Isso não trava esta Fase 1 (o robô só escreve no repositório via API,
funciona igual em repo privado ou público) — mas **significa que o
jsDelivr não vai conseguir servir esses arquivos** quando chegar a hora de
consumir os dados no painel (jsDelivr só serve repositório público). Isso é
um problema pra resolver no plano da Fase 2 (ou reabrir o repositório como
público depois que a questão de licença for esclarecida), não agora.

O README inicial do repositório deve creditar a fonte dos dados — o
Decreto 8.777/2016 (Política de Dados Abertos do Poder Executivo Federal)
exige atribuição como única condição de reuso — algo como:

> Dados coletados a partir da API pública de dados abertos do
> Compras.gov.br (`dadosabertos.compras.gov.br`), mantida pelo Ministério
> da Gestão e da Inovação em Serviços Públicos. Uso sob a Política de
> Dados Abertos do Poder Executivo Federal (Decreto nº 8.777/2016).

- [ ] **Passo 2: Gerar um Personal Access Token com escopo de escrita**

No GitHub: Settings → Developer settings → Personal access tokens →
Fine-grained tokens → gerar um token com acesso só ao repositório criado no
Passo 1, permissão "Contents: Read and write".

- [ ] **Passo 3: Registrar o token como secret no repositório do site**

No repositório `hc-mercado-web`: Settings → Secrets and variables →
Actions → New repository secret → nome `DADOS_HISTORICOS_TOKEN`, valor o
token do Passo 2.

- [ ] **Passo 4: Verificar acesso com uma chamada manual**

```bash
curl -X PUT "https://api.github.com/repos/harresoncoelho-lang/hc-licitacoes-dados-historicos/contents/README.md" \
  -H "Authorization: Bearer SEU_TOKEN_AQUI" \
  -H "Accept: application/vnd.github+json" \
  -d '{"message":"Primeiro commit","content":"IyBoYy1saWNpdGFjb2VzLWRhZG9zLWhpc3Rvcmljb3M="}'
```

Expected: resposta HTTP 201 com o conteúdo do commit criado. Isso confirma
que o token tem permissão de escrita antes de qualquer script depender
disso.

---

## Task 2: Helper de leitura/escrita no repositório de dados

**Files:**
- Create: `scripts/github_dados_historicos.js`
- Test: execução manual (não há framework de testes automatizados neste
  projeto — todo robô existente é verificado com `node --check` +
  execução manual real, ver `scripts/coletar_sistema_s_am.js` como
  precedente)

**Interfaces:**
- Consumes: `process.env.DADOS_HISTORICOS_TOKEN`, `process.env.REPO_DADOS_HISTORICOS` (formato `"dono/repo"`, default `"harresoncoelho-lang/hc-licitacoes-dados-historicos"`)
- Produces:
  - `async function lerArquivoJson(caminho)` → `Promise<{ conteudo: any, sha: string } | { conteudo: null, sha: null }>`
  - `async function escreverArquivoJson(caminho, objeto, mensagemCommit)` → `Promise<void>`

- [ ] **Step 1: Escrever o módulo**

```js
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
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check scripts/github_dados_historicos.js`
Expected: nenhuma saída (sintaxe ok).

- [ ] **Step 3: Testar manualmente contra o repositório real (round-trip)**

Criar um arquivo temporário de teste (fora do repositório do projeto, ex:
na pasta scratchpad) e rodar:

```js
// teste-github-dados.js (arquivo temporário, não commitar)
process.env.DADOS_HISTORICOS_TOKEN = "SEU_TOKEN_AQUI";
const { lerArquivoJson, escreverArquivoJson } = require("/caminho/absoluto/para/scripts/github_dados_historicos.js");

(async () => {
  await escreverArquivoJson("teste/roundtrip.json", { ok: true, quando: new Date().toISOString() }, "Teste de round-trip");
  const { conteudo } = await lerArquivoJson("teste/roundtrip.json");
  console.log("Lido de volta:", conteudo);
  if (!conteudo || conteudo.ok !== true) throw new Error("Round-trip falhou");
  console.log("OK: round-trip funcionou.");
})();
```

Run: `node teste-github-dados.js`
Expected: imprime `Lido de volta: { ok: true, quando: '...' }` seguido de
`OK: round-trip funcionou.` — confirma que escrita e leitura funcionam
contra o repositório real antes de depender disso no robô principal.
Apagar o arquivo `teste-github-dados.js` e o arquivo `teste/roundtrip.json`
no repositório de dados depois (não fazem parte do produto final).

- [ ] **Step 4: Commit**

```bash
git add scripts/github_dados_historicos.js
git commit -m "Adiciona helper de leitura/escrita no repositório de dados históricos (GitHub Contents API)"
```

---

## Task 3: Cache de UASG → UF/Município

**Files:**
- Create: `scripts/comprasnet_uasg_cache.js`

**Interfaces:**
- Consumes: `buscarBlob(tabela, chave)`, `salvarBlob(tabela, chave, dado)` de `scripts/supabase_dados.js` (já existem, assinatura: `buscarBlob("dados_robo", "comprasnet_uasg")` retorna o `dado` jsonb ou `null`; `salvarBlob("dados_robo", "comprasnet_uasg", objeto)` grava)
- Produces: `async function obterMapaUasg()` → `Promise<Map<string, { uf: string, municipio: string, nomeUasg: string }>>`

- [ ] **Step 1: Escrever o módulo**

```js
// scripts/comprasnet_uasg_cache.js
// Cache de UASG -> UF/Município, usado pra resolver o campo "uasg" (só o
// código numérico) das licitações do módulo Legado em UF/município reais.
// UASGs raramente mudam, então o cache só é refeito se tiver mais de 7 dias
// — evita gastar orçamento de execução do robô com isso todo dia.
// Ver docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md.

const { buscarBlob, salvarBlob } = require("./supabase_dados");

const IDADE_MAXIMA_CACHE_DIAS = 7;
const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-uasg/1_consultarUasg";

async function fetchComRetentativa(url, tentativas = 2, timeoutMs = 20000) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) {
        console.log(`[uasg-cache] HTTP ${resp.status} em ${url}`);
        if (i === tentativas - 1) return null;
        continue;
      }
      return await resp.json();
    } catch (e) {
      console.log(`[uasg-cache] Falha em ${url}: ${String((e && e.message) || e)}`);
      if (i === tentativas - 1) return null;
    }
  }
  return null;
}

async function buscarTodasAsUasgs() {
  const todas = [];
  let pagina = 1;
  for (;;) {
    const url = `${BASE_URL}?pagina=${pagina}&tamanhoPagina=500&statusUasg=true`;
    const dados = await fetchComRetentativa(url);
    if (!dados || !Array.isArray(dados.resultado)) break;
    todas.push(...dados.resultado);
    if (pagina >= (dados.totalPaginas || 1)) break;
    pagina += 1;
  }
  return todas;
}

// Retorna um Map codigoUasg (string) -> { uf, municipio, nomeUasg }. Rebusca a
// tabela inteira de UASGs só se o cache salvo no Supabase não existir ou tiver
// mais de IDADE_MAXIMA_CACHE_DIAS dias; senão reaproveita o que já tem.
async function obterMapaUasg() {
  const cache = await buscarBlob("dados_robo", "comprasnet_uasg");
  const idadeDias = cache && cache.atualizadoEm
    ? (Date.now() - new Date(cache.atualizadoEm).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;

  let lista;
  if (cache && Array.isArray(cache.uasgs) && idadeDias <= IDADE_MAXIMA_CACHE_DIAS) {
    lista = cache.uasgs;
    console.log(`[uasg-cache] Reaproveitando cache com ${lista.length} UASG(s), ${idadeDias.toFixed(1)} dia(s) de idade.`);
  } else {
    console.log("[uasg-cache] Cache ausente ou velho — rebuscando tabela completa de UASGs...");
    const brutas = await buscarTodasAsUasgs();
    lista = brutas.map((u) => ({
      codigoUasg: String(u.codigoUasg),
      uf: u.siglaUf || "",
      municipio: u.nomeMunicipioIbge || "",
      nomeUasg: u.nomeUasg || "",
    }));
    await salvarBlob("dados_robo", "comprasnet_uasg", { atualizadoEm: new Date().toISOString(), uasgs: lista });
    console.log(`[uasg-cache] Gravado cache novo com ${lista.length} UASG(s).`);
  }

  const mapa = new Map();
  for (const u of lista) mapa.set(u.codigoUasg, { uf: u.uf, municipio: u.municipio, nomeUasg: u.nomeUasg });
  return mapa;
}

module.exports = { obterMapaUasg };
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check scripts/comprasnet_uasg_cache.js`
Expected: nenhuma saída.

- [ ] **Step 3: Testar manualmente contra o Supabase e a API real**

```bash
SUPABASE_SERVICE_ROLE_KEY=sua_chave node -e "
const { obterMapaUasg } = require('./scripts/comprasnet_uasg_cache');
obterMapaUasg().then((mapa) => {
  console.log('Total de UASGs no mapa:', mapa.size);
  console.log('Exemplo (UASG 160194):', mapa.get('160194'));
});
"
```

Expected: imprime um total de UASGs na casa de milhares, e o exemplo da
UASG `160194` mostra `{ uf: 'PR', municipio: '...', nomeUasg: 'COMANDO 7 REGIAO MILITAR/7 DIV DE EXERCITO' }`
(valores reais confirmados durante a pesquisa desta spec). Rodar o mesmo
comando de novo logo em seguida deve imprimir "Reaproveitando cache" no
log (não rebuscar a API de novo).

- [ ] **Step 4: Commit**

```bash
git add scripts/comprasnet_uasg_cache.js
git commit -m "Adiciona cache de UASG->UF/Município pro robô do ComprasNet Legado"
```

---

## Task 4: Robô principal de coleta (`coletar_comprasnet_legado.js`)

**Files:**
- Create: `scripts/coletar_comprasnet_legado.js`

**Interfaces:**
- Consumes:
  - `obterMapaUasg()` de `scripts/comprasnet_uasg_cache.js` (Task 3)
  - `lerArquivoJson(caminho)`, `escreverArquivoJson(caminho, objeto, mensagem)` de `scripts/github_dados_historicos.js` (Task 2)
  - `buscarBlob(tabela, chave)`, `salvarBlob(tabela, chave, dado)` de `scripts/supabase_dados.js`
- Produces: nenhuma outra parte do código depende deste script pra rodar (é
  o ponto de entrada do workflow) — mas exporta
  `{ validarCamposPermitidos, CAMPOS_PERMITIDOS_LICITACAO }` especificamente
  pro teste isolado da guarda de escopo no Step 3 deste task. Grava em
  `licitacoes/{ano}.json` e `uasgs/{codigoUasg}.json` no repositório de
  dados, formato:
  ```
  // licitacoes/{ano}.json
  {
    atualizadoEm: string (ISO),
    ano: number,
    registros: Array<{
      idCompra: string, numeroProcesso: string, uasg: string, uf: string,
      municipio: string, modalidade: number, nomeModalidade: string,
      numeroAviso: string, situacaoAviso: string, objeto: string,
      valorEstimado: number|null, valorHomologado: number|null,
      dataPublicacao: string|null, dataAberturaProposta: string|null,
    }>
  }
  // uasgs/{codigoUasg}.json
  {
    atualizadoEm: string (ISO),
    codigoUasg: string, uf: string, municipio: string, nomeUasg: string,
    licitacoes: Array<{ idCompra: string, ano: number, objeto: string, situacaoAviso: string, valorEstimado: number|null, valorHomologado: number|null, dataPublicacao: string|null }>
  }
  ```

- [ ] **Step 1: Escrever o script**

```js
// scripts/coletar_comprasnet_legado.js
// Robô de coleta ampla (Fase 1) do módulo Legado do Compras.gov.br —
// histórico de licitações federais sob a Lei 8.666/93, de 2015 até o ano
// corrente. Não busca vencedor ainda (isso é a Fase 2, robô separado
// enriquecer_comprasnet_legado.js). Grava no repositório de dados
// histórico dedicado (ver scripts/github_dados_historicos.js), não no
// Supabase — só um cursor de progresso pequeno fica no Supabase.
//
// Uso: node scripts/coletar_comprasnet_legado.js
// Variáveis de ambiente:
//   DADOS_HISTORICOS_TOKEN (obrigatória) - token de escrita no repo de dados
//   SUPABASE_SERVICE_ROLE_KEY (obrigatória) - pro cursor de progresso e cache de UASG
//   LIMITE_MINUTOS=12 - orçamento de tempo total do robô
//   ANO_INICIAL=2015 - primeiro ano da janela de coleta

const { obterMapaUasg } = require("./comprasnet_uasg_cache");
const { lerArquivoJson, escreverArquivoJson } = require("./github_dados_historicos");
const { buscarBlob, salvarBlob } = require("./supabase_dados");

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "12");
const ANO_INICIAL = parseInt(process.env.ANO_INICIAL || "2015", 10);
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}

const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-legado/1_consultarLicitacao";

async function fetchComRetentativa(url, tentativas = 2, timeoutMs = 25000) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) {
        console.log(`[comprasnet-legado] HTTP ${resp.status} em ${url}`);
        if (i === tentativas - 1) return null;
        continue;
      }
      return await resp.json();
    } catch (e) {
      console.log(`[comprasnet-legado] Falha em ${url}: ${String((e && e.message) || e)}`);
      if (i === tentativas - 1) return null;
    }
  }
  return null;
}

// Guarda de escopo: o repositório de dados históricos é PÚBLICO. Esta lista é
// a única fonte da verdade de quais campos podem ir pra lá — qualquer objeto
// que vá ser escrito no repositório passa por validarCamposPermitidos()
// antes. Isso é uma garantia estrutural (falha alto e cedo se algum campo
// fora do escopo da spec aparecer), não só "cuidado" ao escrever o código —
// pedido explícito do Harreson antes do primeiro push de dados reais.
const CAMPOS_PERMITIDOS_LICITACAO = [
  "idCompra", "numeroProcesso", "uasg", "uf", "municipio", "modalidade",
  "nomeModalidade", "numeroAviso", "situacaoAviso", "objeto",
  "valorEstimado", "valorHomologado", "dataPublicacao", "dataAberturaProposta",
];

function validarCamposPermitidos(objeto, camposPermitidos, rotulo) {
  const chavesExtras = Object.keys(objeto).filter((k) => !camposPermitidos.includes(k));
  if (chavesExtras.length > 0) {
    throw new Error(
      `[guarda-escopo] ${rotulo} contém campo(s) fora do escopo definido na spec ` +
      `(docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md): ` +
      `${chavesExtras.join(", ")}. Bloqueado de propósito — este repositório é público.`
    );
  }
}

function normalizarLicitacao(r, mapaUasg) {
  const uasg = r.uasg != null ? String(r.uasg) : "";
  const infoUasg = uasg ? mapaUasg.get(uasg) : null;
  const registro = {
    idCompra: r.id_compra || "",
    numeroProcesso: r.numero_processo || "",
    uasg,
    uf: (infoUasg && infoUasg.uf) || "",
    municipio: (infoUasg && infoUasg.municipio) || "",
    modalidade: r.modalidade != null ? r.modalidade : null,
    nomeModalidade: r.nome_modalidade || "",
    numeroAviso: r.numero_aviso != null ? String(r.numero_aviso) : "",
    situacaoAviso: r.situacao_aviso || "",
    objeto: r.objeto || "",
    valorEstimado: r.valor_estimado_total != null ? Number(r.valor_estimado_total) : null,
    valorHomologado: r.valor_homologado_total != null ? Number(r.valor_homologado_total) : null,
    dataPublicacao: r.data_publicacao || null,
    dataAberturaProposta: r.data_abertura_proposta || null,
  };
  validarCamposPermitidos(registro, CAMPOS_PERMITIDOS_LICITACAO, "Registro de licitação");
  return registro;
}

async function coletarAno(ano, paginaInicial, mapaUasg) {
  const novasPorRegistro = [];
  let pagina = paginaInicial;
  let totalPaginas = 1;
  let interrompidoPorTempo = false;

  while (pagina <= totalPaginas) {
    if (tempoRestanteMs() < 8000) { interrompidoPorTempo = true; break; }
    const url = `${BASE_URL}?pagina=${pagina}&tamanhoPagina=500&data_publicacao_inicial=${ano}-01-01&data_publicacao_final=${ano}-12-31`;
    const dados = await fetchComRetentativa(url);
    if (!dados) { interrompidoPorTempo = true; break; }
    totalPaginas = dados.totalPaginas || 1;
    for (const r of dados.resultado || []) {
      novasPorRegistro.push(normalizarLicitacao(r, mapaUasg));
    }
    pagina += 1;
  }

  return { registros: novasPorRegistro, proximaPagina: pagina, totalPaginas, interrompidoPorTempo };
}

async function gravarAno(ano, novosRegistros) {
  const { conteudo: existente } = await lerArquivoJson(`licitacoes/${ano}.json`);
  const mapa = new Map();
  for (const r of (existente && existente.registros) || []) mapa.set(r.idCompra, r);
  for (const r of novosRegistros) if (r.idCompra) mapa.set(r.idCompra, r);
  const registros = Array.from(mapa.values());
  await escreverArquivoJson(
    `licitacoes/${ano}.json`,
    { atualizadoEm: new Date().toISOString(), ano, registros },
    `Atualiza licitações de ${ano} (${registros.length} registro(s))`
  );
  return registros.length;
}

const CAMPOS_PERMITIDOS_LICITACAO_UASG = [
  "idCompra", "ano", "objeto", "situacaoAviso", "valorEstimado", "valorHomologado", "dataPublicacao",
];

async function gravarUasgsAfetadas(ano, novosRegistros, mapaUasg) {
  const porUasg = new Map();
  for (const r of novosRegistros) {
    if (!r.uasg) continue;
    if (!porUasg.has(r.uasg)) porUasg.set(r.uasg, []);
    porUasg.get(r.uasg).push(r);
  }
  let arquivosAtualizados = 0;
  for (const [uasg, registrosDaUasg] of porUasg) {
    const caminho = `uasgs/${uasg}.json`;
    const { conteudo: existente } = await lerArquivoJson(caminho);
    const mapa = new Map();
    for (const l of (existente && existente.licitacoes) || []) mapa.set(l.idCompra, l);
    for (const r of registrosDaUasg) {
      const registroUasg = {
        idCompra: r.idCompra,
        ano,
        objeto: r.objeto,
        situacaoAviso: r.situacaoAviso,
        valorEstimado: r.valorEstimado,
        valorHomologado: r.valorHomologado,
        dataPublicacao: r.dataPublicacao,
      };
      validarCamposPermitidos(registroUasg, CAMPOS_PERMITIDOS_LICITACAO_UASG, "Registro de licitação (arquivo de UASG)");
      mapa.set(r.idCompra, registroUasg);
    }
    const infoUasg = mapaUasg.get(uasg) || {};
    await escreverArquivoJson(
      caminho,
      {
        atualizadoEm: new Date().toISOString(),
        codigoUasg: uasg,
        uf: infoUasg.uf || "",
        municipio: infoUasg.municipio || "",
        nomeUasg: infoUasg.nomeUasg || "",
        licitacoes: Array.from(mapa.values()),
      },
      `Atualiza licitações da UASG ${uasg}`
    );
    arquivosAtualizados += 1;
  }
  return arquivosAtualizados;
}

async function main() {
  console.log(`Iniciando coleta ComprasNet Legado (Fase 1). Orçamento: ${LIMITE_MINUTOS} min.`);

  const mapaUasg = await obterMapaUasg();

  const progresso = (await buscarBlob("dados_robo", "comprasnet_progresso")) || {
    anoAtual: ANO_INICIAL,
    paginaAtual: 1,
    anosCompletos: [],
  };

  const anoFinal = new Date().getFullYear();
  let { anoAtual, paginaAtual, anosCompletos } = progresso;
  if (anoAtual > anoFinal) { anoAtual = ANO_INICIAL; paginaAtual = 1; anosCompletos = []; }

  let totalNovosNesteRun = 0;
  let totalUasgsAtualizadas = 0;

  while (anoAtual <= anoFinal && tempoRestanteMs() > 8000) {
    console.log(`[comprasnet-legado] Varrendo ano ${anoAtual}, a partir da página ${paginaAtual}...`);
    const { registros, proximaPagina, totalPaginas, interrompidoPorTempo } = await coletarAno(anoAtual, paginaAtual, mapaUasg);

    if (registros.length > 0) {
      const totalNoAno = await gravarAno(anoAtual, registros);
      const uasgsAtualizadas = await gravarUasgsAfetadas(anoAtual, registros, mapaUasg);
      totalNovosNesteRun += registros.length;
      totalUasgsAtualizadas += uasgsAtualizadas;
      console.log(`[comprasnet-legado] Ano ${anoAtual}: +${registros.length} registro(s) coletado(s) neste run, ${totalNoAno} no total do ano, ${uasgsAtualizadas} arquivo(s) de UASG atualizado(s).`);
    }

    if (interrompidoPorTempo) {
      paginaAtual = proximaPagina;
      break;
    }

    // Ano completo: avança pro próximo.
    anosCompletos.push(anoAtual);
    anoAtual += 1;
    paginaAtual = 1;
  }

  await salvarBlob("dados_robo", "comprasnet_progresso", { anoAtual, paginaAtual, anosCompletos });

  console.log(
    `Coleta finalizada. ${totalNovosNesteRun} registro(s) coletado(s) neste run, ` +
    `${totalUasgsAtualizadas} arquivo(s) de UASG atualizado(s). ` +
    `Progresso salvo: ano ${anoAtual}, página ${paginaAtual}.`
  );

  if (totalNovosNesteRun === 0 && anosCompletos.length === 0) {
    console.log("AVISO: nenhum registro coletado nesta execução — verifique se a API mudou ou se o orçamento de tempo é suficiente.");
  }
}

// require.main === module: só roda main() quando o script é executado
// diretamente (node scripts/coletar_comprasnet_legado.js ou via workflow) —
// não quando é importado como módulo (Task 4, Step 3, teste isolado da
// guarda de escopo), senão o teste dispararia uma coleta real sem querer.
if (require.main === module) {
  main().catch((e) => {
    console.error("Erro fatal no robô de coleta do ComprasNet Legado:", e);
    process.exit(1);
  });
}

module.exports = { validarCamposPermitidos, CAMPOS_PERMITIDOS_LICITACAO };
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check scripts/coletar_comprasnet_legado.js`
Expected: nenhuma saída.

- [ ] **Step 3: Testar a guarda de escopo isoladamente**

Confirma que `validarCamposPermitidos` bloqueia campo fora do escopo, antes
de rodar contra a API real — pedido explícito do Harreson, já que o
repositório de dados é público:

```bash
node -e "
const m = require('./scripts/coletar_comprasnet_legado.js');
try {
  // Este teste só funciona se o script exportar validarCamposPermitidos
  // e CAMPOS_PERMITIDOS_LICITACAO pra teste (ver nota abaixo).
  m.validarCamposPermitidos({ idCompra: '1', clienteEmail: 'vazou@teste.com' }, m.CAMPOS_PERMITIDOS_LICITACAO, 'Teste');
  console.error('FALHOU: deveria ter lançado erro pro campo clienteEmail fora do escopo');
  process.exit(1);
} catch (e) {
  if (String(e.message).includes('clienteEmail')) {
    console.log('OK: guarda de escopo bloqueou campo fora da lista permitida.');
  } else {
    console.error('FALHOU: erro inesperado:', e);
    process.exit(1);
  }
}
"
```

Nota de implementação: pra esse teste funcionar, `module.exports` do script
precisa incluir `{ validarCamposPermitidos, CAMPOS_PERMITIDOS_LICITACAO }`
além do `main()` já chamado no fim do arquivo (exportar não muda o
comportamento do script quando rodado diretamente via
`node scripts/coletar_comprasnet_legado.js`, só expõe essas duas coisas pra
esse teste manual).

Expected: imprime `OK: guarda de escopo bloqueou campo fora da lista
permitida.`

- [ ] **Step 4: Rodar manualmente contra a API real, escopo pequeno**

Antes de rodar contra 2015-2026 inteiro (que pode levar várias execuções),
testar com uma janela pequena primeiro pra validar o fluxo — temporariamente
forçar `ANO_INICIAL` igual ao ano corrente e `LIMITE_MINUTOS` baixo:

```bash
DADOS_HISTORICOS_TOKEN=seu_token SUPABASE_SERVICE_ROLE_KEY=sua_chave \
  ANO_INICIAL=2024 LIMITE_MINUTOS=3 \
  node scripts/coletar_comprasnet_legado.js
```

Expected: log mostrando "Varrendo ano 2024, a partir da página 1...",
seguido de "+N registro(s) coletado(s)..." e "Coleta finalizada." — sem
erro fatal. Depois, conferir no repositório de dados
(`https://github.com/harresoncoelho-lang/hc-licitacoes-dados-historicos`)
que `licitacoes/2024.json` foi criado/atualizado com registros reais, e
pelo menos um arquivo em `uasgs/` também.

Depois do teste, resetar o progresso pra rodar a janela completa de
verdade: apagar a chave `comprasnet_progresso` do Supabase (ou simplesmente
rodar sem as variáveis `ANO_INICIAL`/`LIMITE_MINUTOS` sobrescritas — o
script usa os defaults `2015`/`12` normalmente).

- [ ] **Step 5: Commit**

```bash
git add scripts/coletar_comprasnet_legado.js
git commit -m "Adiciona robô de coleta ampla (Fase 1) do ComprasNet Legado"
```

---

## Task 5: Workflow do GitHub Actions

**Files:**
- Create: `.github/workflows/coletar-comprasnet-legado.yml`

**Interfaces:**
- Consumes: `scripts/coletar_comprasnet_legado.js` (Task 4), secrets `DADOS_HISTORICOS_TOKEN` e `SUPABASE_SERVICE_ROLE_KEY` já configurados no repositório (Task 1)

- [ ] **Step 1: Escrever o workflow**

```yaml
name: Coletar ComprasNet Legado (Fase 1)

on:
  schedule:
    # 12:00 UTC = 09:00 no horário de Brasília — depois dos outros robôs
    - cron: "0 12 * * *"
  workflow_dispatch: {}

permissions:
  contents: read

jobs:
  coletar:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout do repositório
        uses: actions/checkout@v4

      - name: Configurar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Rodar robô de coleta ComprasNet Legado
        env:
          DADOS_HISTORICOS_TOKEN: ${{ secrets.DADOS_HISTORICOS_TOKEN }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: node scripts/coletar_comprasnet_legado.js
```

Nota: `permissions: contents: read` (não `write`) porque este workflow não
grava nada no repositório `hc-mercado-web` — só lê o código e escreve no
repositório de dados externo, via o token separado
`DADOS_HISTORICOS_TOKEN`. Diferente de `atualizar-dados.yml`, que precisa
de `write` porque commita direto neste repositório.

- [ ] **Step 2: Validar estrutura do YAML**

Este projeto não usa um linter de YAML separado pros workflows existentes
— a validação real acontece no primeiro `workflow_dispatch` (Step 3
abaixo). Antes disso, conferir visualmente que a indentação e as chaves
(`on`, `permissions`, `jobs`) batem estrutural e literalmente com
`.github/workflows/coletar-sistema-s-am.yml`, que já roda em produção.

- [ ] **Step 3: Disparar manualmente e conferir no GitHub Actions**

Depois do push (Step 4 abaixo), ir em Actions → "Coletar ComprasNet Legado
(Fase 1)" → "Run workflow" (workflow_dispatch) e acompanhar o log —
confirma que os secrets estão configurados certo e o job roda até o fim
sem erro.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/coletar-comprasnet-legado.yml
git commit -m "Adiciona workflow de coleta diária do ComprasNet Legado (Fase 1)"
```

---

## Self-Review (checklist já aplicado ao escrever este plano)

**Cobertura da spec (Fase 1):**
- Cache de UASG → Task 3. ✓
- Coleta paginada de Licitação, janela 2015-ano corrente, formato de data
  `YYYY-MM-DD`, `tamanhoPagina` 10-500 → Task 4. ✓
- Progresso persistente entre execuções (fila) → Task 4 (`dados_robo/comprasnet_progresso`). ✓
- Escrita em `licitacoes/{ano}.json` e `uasgs/{codigoUasg}.json` no
  repositório de dados dedicado → Task 2 + Task 4. ✓
- Workflow com cron + `workflow_dispatch`, orçamento de tempo → Task 5. ✓
- Fase 2 (vencedor) e integração no painel: **fora de escopo deste plano**,
  por decisão explícita do usuário — ficam pro próximo plano.

**Placeholders**: nenhum "TBD"/"a definir" restante nos tasks de código —
Task 1 é deliberadamente manual (não tem código pra "preencher depois").

**Consistência de tipos**: `obterMapaUasg()` retorna `Map<string, {uf, municipio, nomeUasg}>`
em Task 3, consumido exatamente assim em Task 4 (`mapaUasg.get(uasg)`).
`lerArquivoJson`/`escreverArquivoJson` de Task 2 usados com a mesma
assinatura em Task 4. `buscarBlob`/`salvarBlob` usados com a assinatura
real de `scripts/supabase_dados.js` (confirmada por leitura do código-fonte
existente, não suposta).
