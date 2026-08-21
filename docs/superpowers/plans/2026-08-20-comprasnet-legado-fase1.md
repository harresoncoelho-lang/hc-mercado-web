# ComprasNet Legado — Fase 1 (coleta ampla) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coletar o histórico de licitações do módulo Legado do Compras.gov.br
(2015-2026) e gravar num repositório GitHub dedicado, servido depois via
jsDelivr — sem tocar no Supabase (só um cursor de progresso pequeno) e sem
mexer no painel ainda.

**Architecture:** Robô Node.js standalone (`scripts/coletar_comprasnet_legado.js`),
rodando via GitHub Actions com cron diário. O workflow clona o repositório de
dados dedicado localmente (`git clone --depth 1`, em `/tmp`) antes do robô
rodar; o robô só lê/escreve arquivos locais com `fs.promises`
(`licitacoes/{ano}.json`, `uasgs/{codigoUasg}.json`), nenhuma chamada HTTP ao
GitHub. Um passo final do workflow faz commit único + push de tudo que mudou
— mesmo padrão já usado em produção por `atualizar-dados.yml:73-96`. (Não é
mais a API de Contents do GitHub arquivo por arquivo — essa abordagem foi
descartada depois de aprovada; ver a nota de correção no Task 2.) Progresso
entre execuções (qual ano/página já foi varrido) e o cache de UASG→UF ficam
no Supabase (`dados_robo`), reaproveitando os helpers que já existem.

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
- **Guarda de escopo obrigatória** (pedido explícito do Harreson — o
  repositório de dados é privado hoje e potencialmente público no futuro, e
  a guarda vale nos dois casos): todo objeto escrito no repositório de
  dados passa por `validarCamposPermitidos()` contra uma allowlist
  explícita (`CAMPOS_PERMITIDOS_LICITACAO`/`CAMPOS_PERMITIDOS_LICITACAO_UASG`)
  antes de qualquer `escreverJsonLocal()` — nunca um spread/cópia crua do
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

## Task 2: ~~Helper de leitura/escrita no repositório de dados~~ (removido — ver nota de correção)

> **Correção pós-revisão final (2026-08-21):** Este task originalmente
> criava `scripts/github_dados_historicos.js`, um helper que lia/escrevia no
> repositório de dados arquivo por arquivo via API REST de Contents do
> GitHub. A revisão final de branch da Fase 1 encontrou três problemas
> fatais nesse caminho, todos com a mesma raiz:
>
> - `licitacoes/{ano}.json` passa de ~1 MB já no primeiro run, e acima disso
>   a API devolve `content: ""` — `JSON.parse("")` lança e quebra leitura E
>   escrita daquele ano pra sempre (a escrita também precisa ler o sha
>   antes);
> - milhares de pares leitura-pro-sha + escrita por execução batem no rate
>   limit secundário do GitHub em minutos, sem nenhum retry/backoff;
> - a fase de escrita não tinha orçamento de tempo próprio, então o job
>   podia ser morto pelo `timeout-minutes` do workflow antes de salvar o
>   cursor de progresso.
>
> `scripts/github_dados_historicos.js` foi removido do repositório (nenhum
> consumidor restante). Em seu lugar, o workflow (Task 5) clona o
> repositório de dados localmente (`git clone --depth 1`, mesmo padrão já em
> produção em `atualizar-dados.yml:73-96`) antes do robô rodar; o robô lê e
> escreve arquivos locais em `DADOS_HISTORICOS_DIR` com `fs.promises` (ver
> Task 4, funções `lerJsonLocal`/`escreverJsonLocal`), e um passo final do
> workflow commita e envia tudo de uma vez. Sem teto de ~1 MB por leitura,
> sem chamada HTTP por arquivo, sem controle de sha — o `git` detecta a
> mudança sozinho. Arquivo local ausente equivale ao antigo 404 (retorna
> `null`, não é erro).
>
> Esta mudança arquitetural saiu no commit `9763a6f`, junto com dois outros
> ajustes carregados pro Task 4: `coletarAno` começa `totalPaginas` em
> `Infinity` (não `1`), porque ao retomar de um cursor com
> `paginaInicial > 1` — o caso normal a partir da segunda execução — o laço
> nem entrava, travando cada ano no que a primeira execução tivesse
> alcançado, pra sempre; e `gravarUasgsAfetadas` ignora UASG não numérica
> antes de interpolar no caminho do arquivo (o valor vem de dado externo da
> API, e entra sem validação num path de escrita em disco).

---

## Task 3: Cache de UASG → UF/Município

**Files:**
- Create: `scripts/comprasnet_uasg_cache.js`

**Interfaces:**
- Consumes: `buscarBlob(tabela, chave)`, `salvarBlob(tabela, chave, dado)` de `scripts/supabase_dados.js` (já existem, assinatura: `buscarBlob("dados_robo", "comprasnet_uasg")` retorna o `dado` jsonb ou `null`; `salvarBlob("dados_robo", "comprasnet_uasg", objeto)` grava)
- Produces: `async function obterMapaUasg()` → `Promise<Map<string, { uf: string, municipio: string, nomeUasg: string }>>`

> **Correção pós-revisão final (2026-08-21):** o bloco abaixo já reflete
> dois ajustes feitos depois da primeira escrita deste task, os dois em
> `obterMapaUasg()`: (1) `buscarTodasAsUasgs()` agora informa se a
> paginação terminou completa ou foi interrompida por falha de rede
> (`{ registros, completo }`) — antes, uma falha no meio da paginação
> sobrescrevia silenciosamente o cache anterior com uma lista parcial; (2)
> quando a busca fica incompleta E não há nenhum cache anterior pra usar de
> fallback (primeira execução, ou primeira depois dos 7 dias de validade),
> a função agora lança erro em vez de seguir com um mapa vazio — um mapa
> vazio faria o robô gravar `uf`/`município` em branco pra toda licitação
> coletada naquela execução, permanentemente (o robô só varre pra frente,
> nunca revisita ano/página já processados). Essa chamada acontece antes do
> `try`/`finally` de `main()` em `coletar_comprasnet_legado.js`, então o
> erro aborta a execução sem gravar nada e sem mexer no cursor de
> progresso — a próxima execução agendada tenta de novo.

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

// Retorna { registros, completo }: completo=false sinaliza que a paginação
// foi interrompida por falha de rede no meio — o chamador precisa saber
// disso pra não tratar uma lista parcial como se fosse a tabela inteira.
async function buscarTodasAsUasgs() {
  const todas = [];
  let pagina = 1;
  let completo = false;
  for (;;) {
    const url = `${BASE_URL}?pagina=${pagina}&tamanhoPagina=500&statusUasg=true`;
    const dados = await fetchComRetentativa(url);
    if (!dados || !Array.isArray(dados.resultado)) break;
    todas.push(...dados.resultado);
    if (pagina >= (dados.totalPaginas || 1)) {
      completo = true;
      break;
    }
    pagina += 1;
  }
  return { registros: todas, completo };
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
    const { registros: brutas, completo } = await buscarTodasAsUasgs();

    if (completo) {
      lista = brutas.map((u) => ({
        codigoUasg: String(u.codigoUasg),
        uf: u.siglaUf || "",
        municipio: u.nomeMunicipioIbge || "",
        nomeUasg: u.nomeUasg || "",
      }));
      await salvarBlob("dados_robo", "comprasnet_uasg", { atualizadoEm: new Date().toISOString(), uasgs: lista });
      console.log(`[uasg-cache] Gravado cache novo com ${lista.length} UASG(s).`);
    } else {
      console.log("[uasg-cache] Coleta incompleta (falha de rede) — mantendo cache anterior, se houver.");
      if (cache && Array.isArray(cache.uasgs)) {
        lista = cache.uasgs;
      } else {
        // Sem cache anterior pra cair de volta: um mapa vazio faria toda
        // licitação coletada nesta execução gravar uf/município em branco
        // PERMANENTEMENTE (o robô só varre pra frente, nunca revisita ano/
        // página já processados). Melhor abortar a execução inteira agora —
        // chamado antes do try/finally de main(), então nada é escrito e o
        // cursor de progresso não avança; a próxima execução agendada tenta
        // de novo, sem dado nenhum perdido ou corrompido.
        throw new Error(
          "[uasg-cache] Busca inicial da tabela de UASGs falhou (rede) e não há " +
          "cache anterior no Supabase pra usar como fallback — abortando esta " +
          "execução pra não gravar licitações com uf/município em branco pra " +
          "sempre. A próxima execução agendada tenta de novo."
        );
      }
    }
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
  - `process.env.DADOS_HISTORICOS_DIR` — caminho do clone local do
    repositório de dados históricos, preparado pelo workflow (Task 5) antes
    deste script rodar (ver nota de correção no Task 2 — não é mais o
    helper `scripts/github_dados_historicos.js`, removido)
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
// enriquecer_comprasnet_legado.js).
//
// Grava em ARQUIVOS LOCAIS dentro de um clone do repositório de dados
// históricos dedicado (não no Supabase — só um cursor de progresso pequeno
// fica no Supabase). O clone, o commit e o push são feitos pelo workflow
// (.github/workflows/coletar-comprasnet-legado.yml), no mesmo padrão do
// passo "Publicar dados privados no painel interno" de
// .github/workflows/atualizar-dados.yml. Este script só lê/escreve arquivos
// em DADOS_HISTORICOS_DIR — nenhuma chamada HTTP ao GitHub. Isso evita de
// uma vez: o teto de ~1 MB da API de Contents pra leitura, o rate limit
// secundário de milhares de escritas arquivo a arquivo, e o controle de sha.
//
// Uso: node scripts/coletar_comprasnet_legado.js
// Variáveis de ambiente:
//   DADOS_HISTORICOS_DIR (obrigatória) - caminho do clone local do repositório
//     de dados históricos (o workflow clona em /tmp/dados-historicos-comprasnet)
//   SUPABASE_SERVICE_ROLE_KEY (obrigatória) - pro cursor de progresso e cache de UASG
//   LIMITE_MINUTOS=12 - orçamento de tempo total do robô
//   ANO_INICIAL=2015 - primeiro ano da janela de coleta

const fs = require("fs");
const path = require("path");
const { obterMapaUasg } = require("./comprasnet_uasg_cache");
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

// --- I/O no clone local do repositório de dados históricos -----------------
// Só arquivo local: leitura/escrita são praticamente instantâneas e não
// precisam de orçamento de tempo próprio (o único orçamento que importa é o
// das chamadas à API do Compras.gov.br, checado no laço de coleta).

function dirDados() {
  const dir = process.env.DADOS_HISTORICOS_DIR;
  if (!dir) {
    throw new Error(
      "DADOS_HISTORICOS_DIR não configurada. Ela deve apontar pro clone local do " +
      "repositório de dados históricos — o workflow " +
      ".github/workflows/coletar-comprasnet-legado.yml clona o repositório antes " +
      "de rodar este script e depois commita/envia o que foi escrito aqui."
    );
  }
  return dir;
}

// Lê um JSON do clone local. Retorna null se o arquivo ainda não existir —
// não é erro, é o caso normal na primeira vez que um ano/UASG é gravado
// (equivalente ao antigo 404 da API de Contents). Também retorna null se o
// conteúdo não for JSON válido (arquivo truncado por alguma escrita
// anterior interrompida) em vez de lançar: um JSON.parse não tratado aqui
// travaria a leitura E a escrita daquele arquivo pra sempre — exatamente o
// tipo de corrupção permanente que motivou trocar a API de Contents pelo
// clone local. Tratar como "ausente" deixa a próxima gravação bem-sucedida
// sobrescrever o arquivo corrompido.
async function lerJsonLocal(caminhoRelativo) {
  const caminhoAbsoluto = path.join(dirDados(), caminhoRelativo);
  let texto;
  try {
    texto = await fs.promises.readFile(caminhoAbsoluto, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  if (!texto.trim()) return null;
  try {
    return JSON.parse(texto);
  } catch (e) {
    console.log(`[comprasnet-legado] AVISO: ${caminhoRelativo} está corrompido (JSON inválido) — tratando como ausente. ${String((e && e.message) || e)}`);
    return null;
  }
}

// Escreve em arquivo temporário e faz rename por cima do arquivo final.
// rename() é atômico no mesmo filesystem (o clone inteiro fica em
// /tmp/dados-historicos-comprasnet) — se o job for morto no meio (SIGKILL
// por timeout-minutes), o arquivo final nunca fica truncado: ou continua
// com o conteúdo antigo inteiro, ou já tem o conteúdo novo inteiro.
async function escreverJsonLocal(caminhoRelativo, objeto) {
  const caminhoAbsoluto = path.join(dirDados(), caminhoRelativo);
  await fs.promises.mkdir(path.dirname(caminhoAbsoluto), { recursive: true });
  const caminhoTemporario = `${caminhoAbsoluto}.tmp-${process.pid}`;
  await fs.promises.writeFile(caminhoTemporario, JSON.stringify(objeto), "utf8");
  await fs.promises.rename(caminhoTemporario, caminhoAbsoluto);
}

// Guarda de escopo: o repositório de dados históricos é privado hoje, e
// potencialmente público no futuro (a decisão depende de uma tensão de
// licença ainda não resolvida — ver a "Atualização 2026-08-20" em
// docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md).
// A guarda vale nos dois casos: esta lista é a única fonte da verdade de
// quais campos podem ir pra lá — qualquer objeto que vá ser escrito no
// repositório passa por validarCamposPermitidos() antes. Isso é uma garantia
// estrutural (falha alto e cedo se algum campo fora do escopo da spec
// aparecer), não só "cuidado" ao escrever o código — pedido explícito do
// Harreson antes do primeiro push de dados reais.
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
      `${chavesExtras.join(", ")}. Bloqueado de propósito — este repositório é ` +
      `privado hoje, mas pode virar público, e a lista de campos vale nos dois casos.`
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
  // Infinity, não 1: quando o robô retoma de um cursor salvo (paginaInicial > 1,
  // o caso normal a partir da segunda execução), começar com totalPaginas = 1
  // fazia a condição do laço ser falsa logo na entrada — nenhuma requisição era
  // feita, a função devolvia lista vazia e o main() tratava o ano como completo.
  // A primeira resposta da API corrige o valor real logo abaixo.
  let totalPaginas = Infinity;
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
  const caminho = `licitacoes/${ano}.json`;
  const existente = await lerJsonLocal(caminho);
  const mapa = new Map();
  for (const r of (existente && existente.registros) || []) mapa.set(r.idCompra, r);
  for (const r of novosRegistros) if (r.idCompra) mapa.set(r.idCompra, r);
  const registros = Array.from(mapa.values());
  await escreverJsonLocal(caminho, { atualizadoEm: new Date().toISOString(), ano, registros });
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
    // uasg vem de dado externo (String(r.uasg) da API) e é interpolado num
    // caminho de arquivo — só valor numérico entra, pra um valor inesperado
    // não conseguir escapar do diretório uasgs/.
    if (!/^\d+$/.test(uasg)) {
      console.log(`[comprasnet-legado] UASG ignorada por formato inesperado: ${JSON.stringify(uasg)}`);
      continue;
    }
    const caminho = `uasgs/${uasg}.json`;
    const existente = await lerJsonLocal(caminho);
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
    await escreverJsonLocal(caminho, {
      atualizadoEm: new Date().toISOString(),
      codigoUasg: uasg,
      uf: infoUasg.uf || "",
      municipio: infoUasg.municipio || "",
      nomeUasg: infoUasg.nomeUasg || "",
      licitacoes: Array.from(mapa.values()),
    });
    arquivosAtualizados += 1;
  }
  return arquivosAtualizados;
}

async function main() {
  console.log(`Iniciando coleta ComprasNet Legado (Fase 1). Orçamento: ${LIMITE_MINUTOS} min.`);

  // Falha cedo (antes de gastar o orçamento coletando) se o diretório do
  // clone não estiver configurado/existente.
  const dir = dirDados();
  if (!fs.existsSync(dir)) {
    throw new Error(`DADOS_HISTORICOS_DIR aponta pra um diretório inexistente: ${dir}`);
  }
  console.log(`[comprasnet-legado] Gravando no clone local: ${dir}`);

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

  // try/finally: qualquer exceção não tratada na fase de coleta/escrita
  // (erro de rede na API do Compras.gov.br, erro de escrita em disco) precisa
  // deixar o cursor de progresso salvo do jeito que estava — senão o robô
  // perde o progresso do run inteiro ao ser interrompido no meio, e recomeça
  // do zero na próxima execução. O único jeito de ainda perder progresso é o
  // SIGKILL do timeout-minutes do workflow (que não roda o finally); contra
  // isso vale a margem entre o orçamento interno (12 min) e o teto do
  // workflow (20 min), mesma lógica de atualizar-dados.yml.
  try {
    while (anoAtual <= anoFinal && tempoRestanteMs() > 8000) {
      console.log(`[comprasnet-legado] Varrendo ano ${anoAtual}, a partir da página ${paginaAtual}...`);
      const { registros, proximaPagina, interrompidoPorTempo } = await coletarAno(anoAtual, paginaAtual, mapaUasg);

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
  } finally {
    await salvarBlob("dados_robo", "comprasnet_progresso", { anoAtual, paginaAtual, anosCompletos });
  }

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
de rodar contra a API real — pedido explícito do Harreson (repositório de
dados privado hoje, potencialmente público no futuro; a guarda vale nos dois
casos):

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

Como o script agora só lê/escreve em `DADOS_HISTORICOS_DIR` (nenhuma
chamada HTTP ao GitHub — ver nota de correção no Task 2), o teste manual
precisa de um clone local próprio primeiro:

```bash
rm -rf /tmp/teste-dados-historicos
git clone --depth 1 "https://harresoncoelho-lang:SEU_TOKEN_AQUI@github.com/harresoncoelho-lang/hc-licitacoes-dados-historicos.git" /tmp/teste-dados-historicos
```

Antes de rodar contra 2015-2026 inteiro (que pode levar várias execuções),
testar com uma janela pequena primeiro pra validar o fluxo — temporariamente
forçar `ANO_INICIAL` igual ao ano corrente e `LIMITE_MINUTOS` baixo:

```bash
DADOS_HISTORICOS_DIR=/tmp/teste-dados-historicos SUPABASE_SERVICE_ROLE_KEY=sua_chave \
  ANO_INICIAL=2024 LIMITE_MINUTOS=3 \
  node scripts/coletar_comprasnet_legado.js
```

Expected: log mostrando "Gravando no clone local: /tmp/teste-dados-historicos",
"Varrendo ano 2024, a partir da página 1...", seguido de "+N registro(s)
coletado(s)..." e "Coleta finalizada." — sem erro fatal. Depois, conferir
em `/tmp/teste-dados-historicos` que `licitacoes/2024.json` foi
criado/atualizado com registros reais, e pelo menos um arquivo em `uasgs/`
também — e então commitar/enviar esse clone manualmente (`git add . && git
commit && git push`) pra confirmar que os dados aparecem no repositório
real, já que este script não faz mais o push sozinho (isso é papel do
workflow, Task 5).

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
- Produces: `DADOS_HISTORICOS_DIR` (clone local do repositório de dados,
  passado pro robô — ver Task 4)

> **Correção pós-revisão final (2026-08-21):** a versão original deste
> workflow só rodava o robô (que escrevia via API de Contents do GitHub).
> Com a mudança de arquitetura descrita na nota de correção do Task 2, o
> workflow ganhou dois passos novos: clonar o repositório de dados antes de
> rodar o robô, e commitar/enviar o clone depois. `timeout-minutes` subiu de
> 15 para 20 pra caber os três passos com folga (a folga entre o orçamento
> interno do robô, `LIMITE_MINUTOS=12`, e o teto do job é o que protege o
> cursor de progresso de um SIGKILL por timeout).
>
> **Segunda correção (mesma data, mesma revisão):** o `git push` final não
> tinha retry nem guarda contra execução concorrente. Como o robô já salva
> o cursor de progresso no Supabase antes desse passo rodar (try/finally em
> `main()`, Task 4), um push que falhasse (rede instável, ou duas execuções
> escrevendo ao mesmo tempo por falta de guarda de concorrência) deixava a
> próxima execução partir do cursor avançado sem que os dados coletados
> nesta rodada jamais chegassem ao repositório — buraco silencioso no
> histórico. Dois ajustes: `concurrency` no nível do workflow (enfileira em
> vez de rodar em paralelo) e retry com `fetch`+`rebase` no push, falhando
> o job só depois de esgotar as tentativas.

- [ ] **Step 1: Escrever o workflow**

```yaml
name: Coletar ComprasNet Legado (Fase 1)

on:
  schedule:
    # 12:00 UTC = 09:00 no horário de Brasília — depois dos outros robôs
    - cron: "0 12 * * *"
  workflow_dispatch: {}

# cancel-in-progress: false (nunca cancelar, só enfileirar): duas execuções
# escrevendo ao mesmo tempo no mesmo clone/push é a causa mais provável de
# um push falhar por causa de mudança concorrente no repositório remoto — e
# cancelar uma execução em andamento no meio de uma coleta descartaria
# trabalho já feito. Enfileirar é mais seguro que as duas rodarem juntas.
concurrency:
  group: coletar-comprasnet-legado
  cancel-in-progress: false

# contents: read (não write) porque este workflow não grava nada no
# repositório hc-mercado-web — só lê o código. A escrita acontece no
# repositório de dados históricos, separado, via o token DADOS_HISTORICOS_TOKEN
# usado no clone/push abaixo.
permissions:
  contents: read

jobs:
  coletar:
    runs-on: ubuntu-latest
    # 20 min = clone do repositório de dados + orçamento interno do robô
    # (LIMITE_MINUTOS=12) + commit/push. A folga entre 12 e 20 é o que protege
    # o cursor de progresso de um SIGKILL por timeout do job.
    timeout-minutes: 20
    steps:
      - name: Checkout do repositório
        uses: actions/checkout@v4

      - name: Configurar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      # Mesmo padrão do passo "Publicar dados privados no painel interno" de
      # .github/workflows/atualizar-dados.yml: clone raso do repositório de
      # dados privado, o robô escreve arquivos locais nele, e o passo final
      # commita e envia tudo de uma vez. Evita o teto de ~1 MB por arquivo e o
      # rate limit secundário da API de Contents do GitHub.
      - name: Clonar repositório de dados históricos
        env:
          DADOS_HISTORICOS_TOKEN: ${{ secrets.DADOS_HISTORICOS_TOKEN }}
        run: |
          set -e
          if [ -z "$DADOS_HISTORICOS_TOKEN" ]; then
            echo "DADOS_HISTORICOS_TOKEN não configurado — impossível coletar."
            exit 1
          fi
          rm -rf /tmp/dados-historicos-comprasnet
          git clone --depth 1 "https://harresoncoelho-lang:${DADOS_HISTORICOS_TOKEN}@github.com/harresoncoelho-lang/hc-licitacoes-dados-historicos.git" /tmp/dados-historicos-comprasnet

      - name: Rodar robô de coleta ComprasNet Legado
        env:
          DADOS_HISTORICOS_DIR: /tmp/dados-historicos-comprasnet
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: node scripts/coletar_comprasnet_legado.js

      # if: always() de propósito: se o robô morrer no meio (exceção ou
      # timeout do job), o cursor de progresso já pode ter avançado, então o
      # que ele alcançou a gravar em disco precisa ser enviado mesmo assim —
      # senão abre um buraco no histórico. Reenviar registro repetido é
      # inofensivo (dedup por idCompra na leitura/merge).
      #
      # O push tem retry com fetch+rebase: o cursor de progresso no Supabase
      # já foi salvo pelo robô ANTES deste passo rodar (ver
      # scripts/coletar_comprasnet_legado.js, try/finally em main()) — se o
      # push falhar de vez (rede instável, conflito) sem nenhuma tentativa
      # de recuperação, os dados coletados nesta execução nunca chegam ao
      # repositório, mas a próxima execução já parte do cursor avançado e
      # nunca revisita essas páginas: buraco silencioso no histórico. Falhar
      # o job (exit 1) depois de esgotar as tentativas ainda é a saída certa
      # — só depois de tentar mesmo se recuperar sozinho primeiro.
      - name: Commitar e enviar dados históricos
        if: always()
        env:
          DADOS_HISTORICOS_TOKEN: ${{ secrets.DADOS_HISTORICOS_TOKEN }}
        run: |
          set -e
          if [ ! -d /tmp/dados-historicos-comprasnet/.git ]; then
            echo "Clone do repositório de dados não existe — nada a enviar."
            exit 0
          fi
          cd /tmp/dados-historicos-comprasnet
          git config user.name "hc-licitacoes-bot"
          git config user.email "actions@github.com"
          git add .
          if git diff --cached --quiet; then
            echo "Nenhuma mudança nos dados históricos hoje."
            exit 0
          fi
          git commit -m "Atualização automática ComprasNet Legado - $(date -u +'%Y-%m-%d %H:%M UTC')"

          REMOTE="https://harresoncoelho-lang:${DADOS_HISTORICOS_TOKEN}@github.com/harresoncoelho-lang/hc-licitacoes-dados-historicos.git"
          sucesso=0
          for tentativa in 1 2 3 4 5; do
            if git push "$REMOTE" HEAD:main; then
              sucesso=1
              break
            fi
            echo "git push falhou (tentativa $tentativa/5)."
            if [ "$tentativa" -lt 5 ]; then
              sleep 10
              git fetch "$REMOTE" main
              git rebase FETCH_HEAD || git rebase --abort
            fi
          done
          if [ "$sucesso" -ne 1 ]; then
            echo "ERRO: falha ao enviar dados históricos após 5 tentativas. O cursor de progresso no Supabase já avançou — a próxima execução vai pular as páginas coletadas nesta rodada sem re-tentar. Investigar manualmente (o clone falho fica em /tmp, perdido ao fim do job) e considerar resetar dados_robo/comprasnet_progresso se for o caso."
            exit 1
          fi
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
  repositório de dados dedicado → Task 4 (I/O local em `DADOS_HISTORICOS_DIR`)
  + Task 5 (clone/commit/push no workflow). Task 2 original (helper via API
  de Contents do GitHub) foi removido — ver nota de correção nele. ✓
- Workflow com cron + `workflow_dispatch`, orçamento de tempo → Task 5. ✓
- Fase 2 (vencedor) e integração no painel: **fora de escopo deste plano**,
  por decisão explícita do usuário — ficam pro próximo plano.

**Placeholders**: nenhum "TBD"/"a definir" restante nos tasks de código —
Task 1 é deliberadamente manual (não tem código pra "preencher depois").

**Consistência de tipos**: `obterMapaUasg()` retorna `Map<string, {uf, municipio, nomeUasg}>`
em Task 3, consumido exatamente assim em Task 4 (`mapaUasg.get(uasg)`).
`lerJsonLocal`/`escreverJsonLocal` (Task 4, locais ao próprio script — não
mais um helper separado em Task 2) usados de forma consistente em
`gravarAno`/`gravarUasgsAfetadas`. `buscarBlob`/`salvarBlob` usados com a
assinatura real de `scripts/supabase_dados.js` (confirmada por leitura do
código-fonte existente, não suposta).
