# Migrar oportunidades_abertas + boletim/{UF} pro Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de comitar `data/oportunidades_abertas.json` (~14,6 MB) e `data/boletim/{UF}.json` (~6,7 MB, 27 arquivos) no git a cada execução do robô — hoje isso soma ~23 MB/dia e dispara um deploy completo no Netlify por commit. Os registros passam a morar na tabela `oportunidades_abertas` do Supabase; só um metadado pequeno (`data/oportunidades_meta.json`) continua versionado.

**Architecture:** Mesmo padrão já usado por `contratos`/`mercado_atas` (ver `supabase/schema_dados_mercado.sql` e `scripts/supabase_dados.js`): uma linha por registro (`chave text primary key`, colunas indexadas pra filtro + `dado jsonb` com o registro inteiro), RLS `select` só pra `authenticated`, escrita só via `SUPABASE_SERVICE_ROLE_KEY` (robô). `scripts/atualizar_dados.js` hidrata do Supabase antes de coletar (como já faz com contratos), sincroniza depois. `painel.html` troca `fetch("data/oportunidades_abertas.json")` / `fetch("data/boletim/{UF}.json")` por uma consulta ao cliente Supabase (anon key), preservando o formato `{registros: [...]}` que o resto do código já espera — zero mudança nas funções consumidoras (`gerarBoletim`, `mesclarComCacheRobo`, filtros do Diagnóstico etc.).

**Tech Stack:** Node.js (robô), Supabase Postgres + PostgREST, supabase-js (cliente já carregado em `painel.html`), `node --test` (suíte existente).

**Spec:** Este documento é a própria spec — não há spec separado. Decisões de design (o que migra, o que fica local, o que muda em cada arquivo) foram levantadas lendo o código atual; cada uma está justificada inline nas tarefas abaixo.

## Global Constraints

- Preservar exatamente o padrão já estabelecido em `supabase/schema_dados_mercado.sql` / `scripts/supabase_dados.js` (RLS `authenticated`-only pra leitura, sem policy de escrita, `SUPABASE_SERVICE_ROLE_KEY` só no robô).
- Nenhuma função consumidora em `painel.html` (`gerarBoletim`, `mesclarComCacheRobo`, `combinarResultadosDoBoletim`, filtros do Diagnóstico de Mercado/Oportunidades) muda de assinatura ou de shape de retorno — só a fonte dos dados muda.
- `scripts/preparar_dossies_editais.js` continua lendo `data/oportunidades_abertas.json` local (ver Achado #1 abaixo) — não é reescrito.
- Toda tabela nova segue nomenclatura `snake_case` já usada nas tabelas irmãs.
- `npm run verify` (via `node --test` + lint) precisa passar 100% ao final — o worktree isolado desta implementação parte de um baseline limpo (185/185 testes, ver Achado #3), sem exceções conhecidas.

## Achados que mudam o escopo literal do pedido (leia antes de implementar)

1. **`admin.html` não usa nenhum destes dois arquivos hoje** (`grep -in "oportunidad|boletim" admin.html` não bate em nada — a única coisa relacionada a "boletim" lá é `logs_boletim`, tabela do e-mail diário do `boletim_editais.py`, já Supabase e sem relação com este arquivo). Não há tarefa de `admin.html` neste plano porque não há o que mudar. Se havia uma tela específica em mente, avise que ela não existe ainda no código atual.
2. **`scripts/preparar_dossies_editais.js` continua lendo um arquivo local** `data/oportunidades_abertas.json` (`scripts/preparar_dossies_editais.js:120`), no mesmo job/workspace do GitHub Actions, logo depois de `atualizar_dados.js` rodar. Isso é o MESMO padrão que `contratos_recentes.json`/`mercado_segmentos.json` já usam hoje (gitignored, mas escritos localmente pra scripts do mesmo job reaproveitarem — ver comentário em `.gitignore`). "Gravar no Supabase em vez de escrever em `data/`" é interpretado aqui como "parar de **comitar**" (que é o que gera o deploy), não "parar de escrever o arquivo local temporário" — reescrever `preparar_dossies_editais.js` pra consultar Supabase direto seria um segundo objetivo (reduzir 1 leitura de Supabase por execução) não pedido e fora do escopo de custo de deploy. Sinalizando por transparência; se você quiser mesmo assim, é uma tarefa à parte pequena.
3. **As 2 falhas vistas no checkout principal eram de WIP não commitado, não deste repositório.** O worktree isolado desta implementação (`git worktree` a partir de `main`) roda `npm run verify` limpo: **185/185 testes passam, 0 falhas** — baseline confirmado antes da Task 1. As falhas vistas antes vinham de edições não commitadas em `painel.html` (`bolAtualizacao`/`precisaAtualizarBoletim`, um retry ao vivo do boletim ainda em progresso) e em `scripts/atualizar_dados.js` (uma mudança de janela de recência em `ufsPendentesDeAtualizacao`) que outra sessão deixou no checkout principal sem commitar — o pedido explícito foi "deixa como estão", então elas não entram nesta branch. Todas as tarefas abaixo (incluindo os testes citados) devem terminar 100% verdes, sem exceção.
4. **`data/convenios.json`, `data/editais_vistos.json`, `data/sistema_s_am.json` ainda estão versionados no git** apesar do CLAUDE.md dizer que já migraram pra tabela `dados_robo`. Achado à parte, fora do escopo — não mexido neste plano.

---

### Task 1: Schema Supabase — tabela `oportunidades_abertas`

**Files:**
- Create: `supabase/schema_oportunidades.sql`

**Interfaces:**
- Produces: tabela `public.oportunidades_abertas` com colunas `chave text primary key, numero_controle_pncp text, objeto text not null default '', uf text, publicacao date, encerramento date, dado jsonb not null, atualizado_em timestamptz not null default now()`. Consumida por Task 3 (`upsertEmLotes("oportunidades_abertas", ...)`) e Task 5 (`window.__sbClient.from("oportunidades_abertas")`).

- [ ] **Step 1: Escrever o schema**

```sql
-- ============================================================================
-- LicitaPlena — tirar data/oportunidades_abertas.json (~14,6 MB) e
-- data/boletim/{UF}.json (27 arquivos, ~6,7 MB) do controle de versão do
-- site e mover pro banco (Supabase/Postgres), mesmo padrão de
-- supabase/schema_dados_mercado.sql.
--
-- Por quê: o robô comita esses arquivos TODO DIA (e a cada recuperação de
-- 3h), e cada commit dispara um "Production deploy" completo no Netlify —
-- consumindo crédito de build sem relação nenhuma com mudança de código.
-- Com os dados no Supabase, o robô só grava/atualiza linhas (sem novo
-- deploy) e o painel consulta só o pedaço filtrado que precisa (por UF,
-- quando aplicável) em vez de baixar o arquivo nacional inteiro sempre.
--
-- Rode este arquivo inteiro no Supabase: painel do projeto → SQL Editor →
-- New query → colar tudo → Run. Idempotente (pode rodar de novo sem medo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Oportunidades abertas (propostas em andamento no PNCP, nacional, todas UFs)
--    Fonte: scripts/atualizar_dados.js -> coletarOportunidadesAbertas()
--    "chave" replica a mesma lógica de deduplicação que já existia em memória
--    no arquivo JSON (numeroControlePNCP, ou "objeto|orgao|uf" quando o PNCP
--    não devolve numeroControlePNCP pra uma oportunidade) — ver chaveOportunidade()
--    em scripts/atualizar_dados.js. "dado" guarda o registro inteiro, igual
--    ao padrão de "contratos"/"mercado_atas".
-- ----------------------------------------------------------------------------
create table if not exists public.oportunidades_abertas (
  chave text primary key,
  numero_controle_pncp text,
  objeto text not null default '',
  uf text,
  publicacao date,
  encerramento date,
  dado jsonb not null,
  atualizado_em timestamptz not null default now()
);

create index if not exists oportunidades_abertas_uf_idx on public.oportunidades_abertas (uf);
create index if not exists oportunidades_abertas_publicacao_idx on public.oportunidades_abertas (publicacao);
create index if not exists oportunidades_abertas_encerramento_idx on public.oportunidades_abertas (encerramento);

alter table public.oportunidades_abertas enable row level security;

drop policy if exists "oportunidades_abertas_select_autenticado" on public.oportunidades_abertas;
create policy "oportunidades_abertas_select_autenticado"
  on public.oportunidades_abertas for select
  using (auth.role() = 'authenticated');

-- Escrita só pelo robô, via SUPABASE_SERVICE_ROLE_KEY (que ignora RLS) — nenhuma
-- policy de insert/update/delete é criada aqui de propósito, então o navegador do
-- cliente (chave anon) nunca consegue alterar essa tabela, só ler.

-- ============================================================================
-- Depois de rodar: Table Editor deve mostrar "oportunidades_abertas" com RLS
-- "Enabled". O backfill inicial (scripts/migrar_dados_supabase.js) e as
-- próximas execuções do robô (scripts/atualizar_dados.js) populam essa tabela
-- automaticamente — não precisa inserir nada manualmente aqui.
-- ============================================================================
```

- [ ] **Step 2: Rodar no Supabase (manual, uma vez)**

Painel do projeto Supabase → SQL Editor → New query → colar o conteúdo de `supabase/schema_oportunidades.sql` → Run. Confirmar no Table Editor que `oportunidades_abertas` aparece com RLS "Enabled" e 0 linhas.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema_oportunidades.sql
git commit -m "feat(supabase): schema da tabela oportunidades_abertas"
```

---

### Task 2: `scripts/atualizar_dados.js` — hidratar/sincronizar oportunidades no Supabase

**Files:**
- Modify: `scripts/atualizar_dados.js:1101-1258` (bloco de funções Supabase + `main()`) — localize pelo texto exato citado em cada passo, não só pelo número de linha.
- Modify: `.gitignore`
- Test: `scripts/atualizar_dados.test.js`

**Interfaces:**
- Consumes: `upsertEmLotes`, `baixarTodasAsLinhas`, `removerMaisAntigosQue` de `./supabase_dados` (já importados na linha 1102); `lerJsonExistente(caminho)` (já existe, linha 161); `coletarOportunidadesAbertas(caminhoArquivo)` (já existe, linha 478, **assinatura e retorno não mudam**); `RETENCAO_DIAS_OPORTUNIDADES` (já existe, linha 442).
- Produces: `chaveOportunidade(r)`, `hidratarOportunidadesDoSupabase(caminhoArquivo, caminhoMeta)`, `sincronizarOportunidadesNoSupabase(oportunidades)` — usados só dentro de `main()`. `data/oportunidades_meta.json` (git-tracked) com o mesmo shape de metadado que antes vivia dentro de `oportunidades_abertas.json` (tudo exceto `registros`): `{atualizadoEm, ultimaTentativaEm, retencaoDias, totalRegistros, ufsComFalha, ufsOk, ufsOkNaExecucao, coberturaPorUf, saudeFonte}` — é o arquivo que `painel.html` (Task 5) passa a ler em `carregarMeta()`.

- [ ] **Step 1: Adicionar `chaveOportunidade`, `hidratarOportunidadesDoSupabase` e `sincronizarOportunidadesNoSupabase`**

Inserir logo depois de `sincronizarMercadoNoSupabase` (depois da linha 1181, antes de `async function main() {`):

```javascript
// Mesma chave de deduplicação que coletarOportunidadesAbertas() já usa em memória
// (linha "const chave = (r) => ..." dentro dela) — precisa ser idêntica, senão o
// upsert no Supabase cria linhas duplicadas pro mesmo registro.
function chaveOportunidade(r) {
  return r.numeroControlePNCP || `${r.objeto}|${r.orgao}|${r.uf}`;
}

async function hidratarOportunidadesDoSupabase(caminhoArquivo, caminhoMeta) {
  const meta = await lerJsonExistente(caminhoMeta);
  if (!meta) {
    console.log("[supabase] Sem metadado anterior de oportunidades — tratando como 1ª execução.");
    return;
  }
  try {
    const linhas = await baixarTodasAsLinhas("oportunidades_abertas", "dado");
    const registros = linhas.map((l) => l.dado);
    const fs = await import("node:fs/promises");
    await fs.writeFile(caminhoArquivo, JSON.stringify({ ...meta, registros }), "utf8");
    console.log(`[supabase] Hidratada(s) ${registros.length} oportunidade(s) do Supabase pra continuar o incremental.`);
  } catch (e) {
    console.log(`[supabase] Falha ao baixar oportunidades existentes (${e && e.message}) — seguindo sem hidratar (pode reprocessar mais do que o normal desta vez).`);
  }
}

async function sincronizarOportunidadesNoSupabase(oportunidades) {
  const linhas = (oportunidades.registros || []).map((r) => ({
    chave: chaveOportunidade(r),
    numero_controle_pncp: r.numeroControlePNCP || null,
    objeto: r.objeto || "",
    uf: r.uf || null,
    publicacao: r.publicacao ? String(r.publicacao).slice(0, 10) : null,
    encerramento: r.encerramento ? String(r.encerramento).slice(0, 10) : null,
    dado: r,
  }));
  try {
    const enviadas = await upsertEmLotes("oportunidades_abertas", linhas, "chave");
    console.log(`[supabase] ${enviadas} oportunidade(s) sincronizada(s) na tabela "oportunidades_abertas".`);
    // Poda pela mesma retenção que já era aplicada em memória. Só considera "publicacao"
    // (quase sempre presente nos dados do PNCP) — um registro sem publicacao mas com
    // encerramento antigo pode sobreviver aqui; mesma limitação que "contratos" já aceita
    // (removerMaisAntigosQue só compara 1 coluna). Não é regressão: o arquivo antigo também
    // não tinha uma segunda passada dedicada só pra esse caso raro.
    const limiteRetencaoIso = new Date(Date.now() - RETENCAO_DIAS_OPORTUNIDADES * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await removerMaisAntigosQue("oportunidades_abertas", "publicacao", limiteRetencaoIso);
  } catch (e) {
    console.log(`[supabase] Falha ao sincronizar oportunidades (${e && e.message}) — dados continuam só no arquivo local desta execução.`);
  }
}
```

- [ ] **Step 2: Rewire `main()` — hidratar antes, gravar meta pequeno + sincronizar, remover a projeção por UF**

Substituir o bloco atual (`scripts/atualizar_dados.js:1207-1212`):

```javascript
  const caminhoOportunidades = path.join(dirDados, "oportunidades_abertas.json");
  const oportunidades = await coletarOportunidadesAbertas(caminhoOportunidades);
  await fs.writeFile(caminhoOportunidades, JSON.stringify(oportunidades), "utf8");
  console.log("Gravado data/oportunidades_abertas.json");
  await gravarBoletinsPorUf(fs, path, path.join(dirDados, "boletim"), oportunidades);
  console.log("Gravados data/boletim/{UF}.json para abertura rápida do painel");
```

por:

```javascript
  const caminhoOportunidades = path.join(dirDados, "oportunidades_abertas.json");
  const caminhoOportunidadesMeta = path.join(dirDados, "oportunidades_meta.json");
  await hidratarOportunidadesDoSupabase(caminhoOportunidades, caminhoOportunidadesMeta);
  const oportunidades = await coletarOportunidadesAbertas(caminhoOportunidades);
  // O arquivo local continua sendo escrito (gitignored, ver .gitignore) porque
  // scripts/preparar_dossies_editais.js roda depois, no mesmo job, e lê esse
  // caminho — mesmo padrão que contratos_recentes.json/mercado_segmentos.json já
  // usam. O que muda é que ele NUNCA mais é comitado (ver Achado #2 do plano).
  await fs.writeFile(caminhoOportunidades, JSON.stringify(oportunidades), "utf8");
  const { registros: _registrosOportunidades, ...oportunidadesMeta } = oportunidades;
  await fs.writeFile(caminhoOportunidadesMeta, JSON.stringify(oportunidadesMeta), "utf8");
  console.log("Gravado data/oportunidades_meta.json (metadado leve, vai pro git)");
  // "semPendencias" (ver coletarOportunidadesAbertas) significa que a recuperação de
  // 3h não tinha UF nenhuma pra atualizar — reenviar as ~17 mil linhas pro Supabase
  // nesse caso seria puro desperdício de escrita, 8x/dia, sem mudança nenhuma.
  if (!oportunidades.semPendencias) {
    await sincronizarOportunidadesNoSupabase(oportunidades);
  } else {
    console.log("[supabase] Sem UFs pendentes nesta recuperação — sincronização com o Supabase pulada.");
  }
```

Remover a função `gravarBoletinsPorUf` inteira (`scripts/atualizar_dados.js:681-708`, incluindo o comentário acima dela) — as 27 projeções por UF deixam de existir; `painel.html` passa a filtrar por UF direto na consulta ao Supabase (Task 5).

- [ ] **Step 3: `.gitignore` — parar de comitar os dois caminhos**

Editar o bloco já existente em `.gitignore` (o que já cita `contratos_recentes.json`/`mercado_segmentos.json`):

```gitignore
# Arquivos de dados grandes do robô — agora vivem no Supabase (tabelas contratos,
# mercado_atas e oportunidades_abertas), não mais no git. Ver scripts/atualizar_dados.js e
# supabase/schema_dados_mercado.sql / supabase/schema_oportunidades.sql. Só o metadado
# pequeno (contratos_meta.json / mercado_meta.json / oportunidades_meta.json) continua
# versionado.
data/contratos_recentes.json
data/mercado_segmentos.json
data/oportunidades_abertas.json
data/boletim/
```

- [ ] **Step 4: Destravar os arquivos já versionados do git (uma vez)**

```bash
git rm --cached data/oportunidades_abertas.json
git rm --cached -r data/boletim/
```

- [ ] **Step 5: Atualizar `scripts/atualizar_dados.test.js` — remover o teste de `gravarBoletinsPorUf`**

Remover o teste inteiro (linhas 52-63, "projeção usa frescor da UF e deixa cobertura desconhecida como null") — a função que ele testa não existe mais.

- [ ] **Step 6: Escrever teste novo pra `chaveOportunidade` e pro mapeamento de linha**

Adicionar ao final de `scripts/atualizar_dados.test.js`:

```javascript
test("chaveOportunidade usa numeroControlePNCP quando existe, senão objeto+orgao+uf", () => {
  const inicioChave = codigo.indexOf("function chaveOportunidade(");
  const fimChave = codigo.indexOf("\n}", inicioChave) + 2;
  const ambiente = vm.createContext({});
  vm.runInContext(codigo.slice(inicioChave, fimChave), ambiente);
  assert.equal(ambiente.chaveOportunidade({ numeroControlePNCP: "123-1-000001/2026", objeto: "x", orgao: "y", uf: "AM" }), "123-1-000001/2026");
  assert.equal(ambiente.chaveOportunidade({ numeroControlePNCP: null, objeto: "Pregão", orgao: "Prefeitura", uf: "AM" }), "Pregão|Prefeitura|AM");
});
```

- [ ] **Step 7: Rodar os testes**

Run: `node --test scripts/atualizar_dados.test.js`
Expected: todos os testes passam (0 falhas — ver Achado #3, o baseline deste worktree já é 100% verde).

- [ ] **Step 8: Commit**

```bash
git add scripts/atualizar_dados.js scripts/atualizar_dados.test.js .gitignore
git rm --cached data/oportunidades_abertas.json
git rm --cached -r data/boletim/
git commit -m "feat(robo): sincronizar oportunidades_abertas no Supabase em vez de comitar no git"
```

---

### Task 3: Backfill único — `scripts/migrar_dados_supabase.js`

**Files:**
- Modify: `scripts/migrar_dados_supabase.js`

**Interfaces:**
- Consumes: `upsertEmLotes` de `./supabase_dados` (já importado); `chaveOportunidade` de `./atualizar_dados.js` — **precisa exportar** essa função (Task 2 não a exporta hoje porque `atualizar_dados.js` não tem `module.exports`; mais simples duplicar a mesma linha aqui do que introduzir um `require` cruzado entre dois scripts que hoje não se importam — 1 linha idêntica, risco de divergência baixo e documentado no comentário).

- [ ] **Step 1: Adicionar a seção de backfill de oportunidades**

Inserir antes da linha final (`console.log("\nBackfill concluído...")`, `scripts/migrar_dados_supabase.js:66`):

```javascript
  console.log("\n== Migrando oportunidades_abertas.json ==");
  const oportunidadesPath = path.join(dirDados, "oportunidades_abertas.json");
  const oportunidades = JSON.parse(await fs.readFile(oportunidadesPath, "utf8"));
  // Mesma lógica de scripts/atualizar_dados.js:chaveOportunidade() — duplicada aqui de
  // propósito porque este script não importa atualizar_dados.js (é um backfill único,
  // roda uma vez e não faz parte do pipeline diário). Se um dia chaveOportunidade()
  // mudar lá, replicar a mudança aqui também.
  const chaveOportunidade = (r) => r.numeroControlePNCP || `${r.objeto}|${r.orgao}|${r.uf}`;
  const linhasOportunidades = oportunidades.registros.map((r) => ({
    chave: chaveOportunidade(r),
    numero_controle_pncp: r.numeroControlePNCP || null,
    objeto: r.objeto || "",
    uf: r.uf || null,
    publicacao: r.publicacao ? String(r.publicacao).slice(0, 10) : null,
    encerramento: r.encerramento ? String(r.encerramento).slice(0, 10) : null,
    dado: r,
  }));
  console.log(`Enviando ${linhasOportunidades.length} oportunidade(s)...`);
  const enviadasOportunidades = await upsertEmLotes("oportunidades_abertas", linhasOportunidades, "chave");
  console.log(`OK — ${enviadasOportunidades} linha(s) na tabela "oportunidades_abertas".`);

  const { registros: _ro, ...oportunidadesMeta } = oportunidades;
  await fs.writeFile(path.join(dirDados, "oportunidades_meta.json"), JSON.stringify(oportunidadesMeta), "utf8");
  console.log("Gravado data/oportunidades_meta.json");
```

Atualizar a linha final pra citar os três arquivos:

```javascript
  console.log("\nBackfill concluído. Agora pode remover contratos_recentes.json, mercado_segmentos.json,");
  console.log("oportunidades_abertas.json e boletim/ do git (git rm --cached).");
```

- [ ] **Step 2: Rodar o backfill (manual, uma vez, depois da Task 1 e antes de publicar a Task 2)**

Run: `SUPABASE_SERVICE_ROLE_KEY="<service role key>" node scripts/migrar_dados_supabase.js`
Expected: log final mostra `OK — 17331 linha(s) na tabela "oportunidades_abertas".` (ou o total atual de `data/oportunidades_abertas.json` na hora de rodar) e `data/oportunidades_meta.json` aparece no diretório com `atualizadoEm`/`coberturaPorUf`/etc., sem a chave `registros`.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrar_dados_supabase.js data/oportunidades_meta.json
git commit -m "feat(supabase): backfill de oportunidades_abertas + oportunidades_meta.json"
```

---

### Task 4: `painel.html` — consultar Supabase em vez de `data/oportunidades_abertas.json` / `data/boletim/{UF}.json`

**Files:**
- Modify: `painel.html:2444` (FONTES_STATUS)
- Modify: `painel.html:5740-5756` (`carregarBaseDoRoboParaBoletim`, novo helper `carregarOportunidadesSupabase`)
- Modify: `painel.html:6020` (complemento da busca de Oportunidades)
- Modify: `painel.html:7199` (complemento do Diagnóstico de Mercado)
- Modify: `painel.html:8655` (dashboard "novas hoje")
- Test: `scripts/frescor_boletim.test.js`

Números de linha conferidos direto no worktree limpo (`git worktree`, branch a partir de `main`) — se o seu checkout mostrar linhas diferentes, localize pelo texto exato citado em cada passo abaixo, nunca pelo número.

**Interfaces:**
- Consumes: `window.__sbClient` (cliente Supabase já inicializado no painel), `aguardarSupabaseAutenticado()` (já existe, `painel.html:4733`), `carregarMeta(caminho)` (já existe, `painel.html:4716`).
- Produces: `async function carregarOportunidadesSupabase(estados = [])` → `Promise<{registros: object[]} | null>`, mesmo contrato de retorno que `carregarCache()` já tinha (null em erro, `{registros: [...]}` em sucesso) — **nenhum outro código consumidor muda**.

- [ ] **Step 1: Adicionar `carregarOportunidadesSupabase`**

Inserir logo depois de `carregarBlobSupabase` (`painel.html:4756`, antes de `sanitizarParaIlike`):

```javascript
    // Teto de segurança pra não pedir a tabela inteira sem fim caso a retenção de
    // 120 dias (ver RETENCAO_DIAS_OPORTUNIDADES em scripts/atualizar_dados.js) cresça
    // muito no futuro — hoje (set/2026) a base tem ~17 mil linhas.
    // ponytail: teto fixo, subir se a base nacional passar disso com frequência.
    const LIMITE_OPORTUNIDADES_SUPABASE = 20000;

    // Substitui data/oportunidades_abertas.json (nacional) e data/boletim/{UF}.json (por
    // estado) — ambos vinham de arquivos comitados a cada execução do robô, o que disparava
    // um deploy completo no Netlify por commit. Mesmo contrato de retorno que
    // carregarCache() tinha ({registros: [...]} ou null em erro), pra não mudar nenhum
    // consumidor. Sem "estados", devolve a base nacional inteira (mesmo comportamento do
    // antigo data/oportunidades_abertas.json); com "estados", filtra por UF E pela mesma
    // janela de recência que data/boletim/{UF}.json usava (publicado nos últimos 3 dias OU
    // ainda com proposta aberta) — ver gravarBoletinsPorUf, removida de scripts/atualizar_dados.js.
    async function carregarOportunidadesSupabase(estados = []) {
      try {
        await aguardarSupabaseAutenticado();
        let query = window.__sbClient.from("oportunidades_abertas").select("dado").limit(LIMITE_OPORTUNIDADES_SUPABASE);
        if (estados.length > 0) {
          query = query.in("uf", estados);
          const cortePublicacaoIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const agoraIso = new Date().toISOString().slice(0, 10);
          query = query.or(`publicacao.gte.${cortePublicacaoIso},publicacao.is.null,encerramento.gte.${agoraIso}`);
        }
        const { data, error } = await query;
        if (error) {
          console.error("[oportunidades_abertas] erro na consulta:", error);
          return null;
        }
        return { registros: (data || []).map((linha) => linha.dado) };
      } catch (e) {
        return null;
      }
    }
```

- [ ] **Step 2: Reescrever `carregarBaseDoRoboParaBoletim`**

Substituir (`painel.html:5762-5778`):

```javascript
  async function carregarBaseDoRoboParaBoletim(ufs) {
    const estados = normalizarUfs(ufs);
    // Cada UF tem uma projeção leve criada pelo robô. Isso evita baixar os ~10 MB da
    // base nacional para abrir um boletim de AM, RR ou qualquer outro filtro específico.
    if (estados.length > 0) {
      const bases = await Promise.all(estados.map((uf) => carregarCache(`data/boletim/${uf}.json`)));
      return {
        registros: bases.flatMap((base) => (base && Array.isArray(base.registros) ? base.registros : [])),
        coberturaPorUf: Object.fromEntries(estados.map((uf, i) => [uf, {
          atualizadoEm: bases[i]?.coberturaPorUf?.[uf]?.atualizadoEm || bases[i]?.atualizadoEm || null,
        }])),
      };
    }
    // Sem estado é uma busca nacional propositalmente mais ampla; preserva a cobertura
    // completa para esse caso excepcional, sem penalizar o fluxo normal com UF definida.
    return carregarCache("data/oportunidades_abertas.json");
  }
```

por:

```javascript
  async function carregarBaseDoRoboParaBoletim(ufs) {
    const estados = normalizarUfs(ufs);
    // O robô grava um metadado pequeno (coberturaPorUf, atualizadoEm) versionado no git —
    // data/oportunidades_meta.json — e os registros completos ficam no Supabase, filtrados
    // por UF + recência direto na consulta (ver carregarOportunidadesSupabase).
    const [meta, oportunidades] = await Promise.all([
      carregarMeta("data/oportunidades_meta.json"),
      carregarOportunidadesSupabase(estados),
    ]);
    if (estados.length > 0) {
      return {
        registros: (oportunidades && Array.isArray(oportunidades.registros)) ? oportunidades.registros : [],
        coberturaPorUf: Object.fromEntries(estados.map((uf) => [uf, {
          atualizadoEm: meta?.coberturaPorUf?.[uf]?.atualizadoEm || meta?.atualizadoEm || null,
        }])),
      };
    }
    // Sem estado é uma busca nacional propositalmente mais ampla; preserva a cobertura
    // completa para esse caso excepcional, sem penalizar o fluxo normal com UF definida.
    if (!oportunidades) return null;
    return { ...oportunidades, atualizadoEm: meta?.atualizadoEm || null, coberturaPorUf: meta?.coberturaPorUf || {} };
  }
```

- [ ] **Step 3: Trocar os 3 usos diretos do arquivo nacional**

`painel.html:6020` — de:
```javascript
      const cache = await carregarCache("data/oportunidades_abertas.json");
```
para:
```javascript
      const cache = await carregarOportunidadesSupabase();
```

`painel.html:7199` — de:
```javascript
      const cacheOpPromise = carregarCache("data/oportunidades_abertas.json");
```
para:
```javascript
      const cacheOpPromise = carregarOportunidadesSupabase();
```

`painel.html:8655` — de:
```javascript
    const novasHojePromise = carregarCache("data/oportunidades_abertas.json").then((cache) => {
```
para:
```javascript
    const novasHojePromise = carregarOportunidadesSupabase().then((cache) => {
```

(o corpo do `.then(...)` não muda — continua lendo `cache.registros`.)

- [ ] **Step 4: Apontar o card de status pro metadado novo**

`painel.html:2448` — de:
```javascript
    { arquivo: "data/oportunidades_abertas.json", nome: "Editais e licitações (PNCP)", icone: "<svg class='icone-ph'><use href='#ph-clipboard-text'></use></svg>" },
```
para:
```javascript
    { arquivo: "data/oportunidades_meta.json", nome: "Editais e licitações (PNCP)", icone: "<svg class='icone-ph'><use href='#ph-clipboard-text'></use></svg>" },
```

- [ ] **Step 5: Atualizar o mock de `scripts/frescor_boletim.test.js`**

O harness de teste (`criarContexto`, linhas 18-46) extrai as funções reais de `painel.html` por regex e roda num `vm.createContext`. Ele mocka `carregarCache` (linha 33) — como `carregarBaseDoRoboParaBoletim` deixa de chamar `carregarCache` e passa a chamar `carregarOportunidadesSupabase` + `carregarMeta`, o mock precisa mudar junto. Substituir (`scripts/frescor_boletim.test.js:32-33`):

```javascript
    lerCacheResultadoBoletim: () => cache,
    carregarCache: async () => base,
```

por:

```javascript
    lerCacheResultadoBoletim: () => cache,
    carregarMeta: async () => (base ? { atualizadoEm: base.atualizadoEm, ultimaTentativaEm: base.ultimaTentativaEm, coberturaPorUf: base.coberturaPorUf } : null),
    carregarOportunidadesSupabase: async (estados) => (base ? { registros: base.registros } : null),
```

A lista de funções extraídas de `painel.html` (`scripts/frescor_boletim.test.js:42`, `for (const nome of [...])`) **não muda** — `carregarOportunidadesSupabase` e `carregarMeta` são mocks injetados no contexto, nunca extraídos do HTML, exatamente como `carregarCache` já era.

- [ ] **Step 6: Rodar os testes**

Run: `node --test scripts/frescor_boletim.test.js`
Expected: todos os testes passam (0 falhas — baseline deste worktree já é 100% verde, ver Achado #3).

Run: `node --test scripts/verificar_painel.test.js` (ou o teste que valida "painel mantém todos os scripts inline sintaticamente válidos")
Expected: PASS — confirma que o JavaScript inline de `painel.html` continua sintaticamente válido depois da edição.

- [ ] **Step 7: Commit**

```bash
git add painel.html scripts/frescor_boletim.test.js
git commit -m "feat(painel): consultar oportunidades_abertas no Supabase em vez do JSON estático"
```

---

### Task 5: Workflows — parar de comitar, ajustar segredos/permissões

**Files:**
- Modify: `.github/workflows/recuperar-oportunidades-pncp.yml`
- Modify: `.github/workflows/atualizar-dados.yml` (comentário only, ver abaixo)

**Interfaces:**
- Consumes: `SUPABASE_SERVICE_ROLE_KEY` (secret já existe no repo, já usado em `atualizar-dados.yml`).

- [ ] **Step 1: `recuperar-oportunidades-pncp.yml` — remover o step de commit/push e adicionar o segredo do Supabase**

Este workflow roda `SOMENTE_OPORTUNIDADES=1`, que (depois da Task 2) já sincroniza direto no Supabase dentro do próprio `node scripts/atualizar_dados.js` — sobra nada pra comitar. Remover o step inteiro `Publicar recuperação válida` (linhas 55-79 do arquivo atual) e adicionar `SUPABASE_SERVICE_ROLE_KEY` ao env do step `Recuperar somente UFs pendentes` (essa env var não existia nesse workflow porque, antes, `SOMENTE_OPORTUNIDADES=1` nunca tocava o Supabase).

De:
```yaml
      - name: Recuperar somente UFs pendentes
        env:
          SOMENTE_OPORTUNIDADES: "1"
          RECUPERAR_UFS_PENDENTES: "1"
          LIMITE_MINUTOS_OPORTUNIDADES: "28"
          CONCORRENCIA_UF_OPORTUNIDADES: "2"
          INTERVALO_MS_OPORTUNIDADES: "900"
          MIN_UFS_OK_OPORTUNIDADES: "1"
        run: node scripts/atualizar_dados.js
```
Para:
```yaml
      - name: Recuperar somente UFs pendentes
        env:
          SOMENTE_OPORTUNIDADES: "1"
          RECUPERAR_UFS_PENDENTES: "1"
          LIMITE_MINUTOS_OPORTUNIDADES: "28"
          CONCORRENCIA_UF_OPORTUNIDADES: "2"
          INTERVALO_MS_OPORTUNIDADES: "900"
          MIN_UFS_OK_OPORTUNIDADES: "1"
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: node scripts/atualizar_dados.js
```

E remover inteiramente (depois do step "Preparar dossiês recém-coletados"):
```yaml
      - name: Publicar recuperação válida
        run: |
          git config user.name "hc-licitacoes-bot"
          git config user.email "actions@github.com"
          git add data/oportunidades_abertas.json data/boletim/
          if git diff --cached --quiet; then
            echo "Nenhuma UF recuperada nesta tentativa."
            exit 0
          fi
          git commit -m "Recuperação automática de UFs pendentes do PNCP - $(date -u +'%Y-%m-%d %H:%M UTC')"
          for tentativa in 1 2 3; do
            if git push; then
              break
            fi
            echo "Push rejeitado (tentativa $tentativa) — atualizando com o remoto e tentando de novo."
            git fetch origin main
            git rebase origin/main || { git rebase --abort; git merge -X ours origin/main -m "Merge automático da recuperação"; }
            if [ "$tentativa" = "3" ]; then
              echo "Não foi possível publicar a recuperação após 3 tentativas."
              exit 1
            fi
          done
```

Trocar `permissions: contents: write` por `permissions: contents: read` no topo do arquivo (nada mais neste workflow escreve no repositório).

- [ ] **Step 2: `atualizar-dados.yml` — comentário de clareza (sem mudança funcional)**

O step final `Commitar e enviar dados atualizados` faz `git add data/` (sem citar arquivos específicos) — depois da Task 2, `data/oportunidades_abertas.json` e `data/boletim/` já não aparecem mais ali por causa do `.gitignore`, então **não precisa de edição funcional**. Adicionar só um comentário, no mesmo estilo do comentário já existente sobre `empresas.json`/`fornecedores/` logo abaixo (`.github/workflows/atualizar-dados.yml`, step "Commitar e enviar dados atualizados"):

De:
```yaml
      - name: Commitar e enviar dados atualizados
        run: |
          git config user.name "hc-licitacoes-bot"
          git config user.email "actions@github.com"
          git add data/
```
Para:
```yaml
      - name: Commitar e enviar dados atualizados
        run: |
          git config user.name "hc-licitacoes-bot"
          git config user.email "actions@github.com"
          # oportunidades_abertas.json e boletim/ estão no .gitignore (vivem no Supabase
          # agora, ver scripts/atualizar_dados.js) — "git add data/" nunca mais os inclui.
          git add data/
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/recuperar-oportunidades-pncp.yml .github/workflows/atualizar-dados.yml
git commit -m "ci: parar de comitar oportunidades_abertas/boletim, sincronização já é via Supabase"
```

---

### Task 6: Documentação — `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md:82-125` (seção "Data flow" e "Robots")

- [ ] **Step 1: Atualizar a lista de tiers**

Em `CLAUDE.md:84`, remover `oportunidades_abertas.json` do exemplo do tier 1 e trocar por `oportunidades_meta.json`:

De:
```markdown
1. **Small, versioned JSON in `data/`** (`contratos_meta.json`, `mercado_meta.json`, `oportunidades_abertas.json`,
   etc.) — committed to git, served as static files, cached 5 min / stale-while-revalidate 1h per
   `netlify.toml`. `painel.html` fetches these directly.
2. **Large/growing data in Supabase Postgres** (`contratos`, `mercado_atas` tables — see
   `supabase/schema_dados_mercado.sql`) — queried live from `painel.html` using the Supabase client with the
   public anon key (RLS restricts `SELECT` to `authenticated` users only; writes are service-role-only, from
   the robot). This replaced committing multi-MB JSON files (`contratos_recentes.json`,
   `mercado_segmentos.json` — now gitignored) directly to git, because every commit to those files triggered a
   full Netlify production redeploy.
```
Para:
```markdown
1. **Small, versioned JSON in `data/`** (`contratos_meta.json`, `mercado_meta.json`, `oportunidades_meta.json`,
   etc.) — committed to git, served as static files, cached 5 min / stale-while-revalidate 1h per
   `netlify.toml`. `painel.html` fetches these directly.
2. **Large/growing data in Supabase Postgres** (`contratos`, `mercado_atas`, `oportunidades_abertas` tables —
   see `supabase/schema_dados_mercado.sql` / `supabase/schema_oportunidades.sql`) — queried live from
   `painel.html` using the Supabase client with the public anon key (RLS restricts `SELECT` to `authenticated`
   users only; writes are service-role-only, from the robot). This replaced committing multi-MB JSON files
   (`contratos_recentes.json`, `mercado_segmentos.json`, `oportunidades_abertas.json`, `boletim/*.json` — now
   gitignored) directly to git, because every commit to those files triggered a full Netlify production
   redeploy.
```

- [ ] **Step 2: Atualizar o parágrafo do robô**

Em `CLAUDE.md:106-113`, acrescentar uma frase depois de "...prunes anything older than `RETENCAO_DIAS`":

De:
```markdown
- `atualizar_dados.js` — main PNCP collector. **Incremental**, not a full re-scrape: reads existing data,
  fetches only what's new since last run (with a small overlap window for late publications), merges, and
  prunes anything older than `RETENCAO_DIAS` (730 days default). Has two independently time-boxed phases
```
Para:
```markdown
- `atualizar_dados.js` — main PNCP collector. **Incremental**, not a full re-scrape: reads existing data,
  fetches only what's new since last run (with a small overlap window for late publications), merges, and
  prunes anything older than `RETENCAO_DIAS` (730 days default; open opportunities use `RETENCAO_DIAS_OPORTUNIDADES`,
  120 days, and sync to the `oportunidades_abertas` Supabase table the same way `contratos`/`mercado_atas` do —
  see the Data flow section above). Has two independently time-boxed phases
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: atualizar Data flow pra refletir oportunidades_abertas no Supabase"
```

---

### Task 7: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Rodar a suíte inteira**

Run: `npm run verify`
Expected: 100% verde (baseline deste worktree já é 185/185 — ver Achado #3), nenhuma falha.

- [ ] **Step 2: Confirmar que não sobrou referência aos caminhos antigos**

Run: `grep -rn "data/boletim\|oportunidades_abertas.json" --include="*.js" --include="*.html" --include="*.yml" --include="*.py" .`
Expected: só aparecem `data/oportunidades_abertas.json` como caminho de arquivo LOCAL (gitignored) em `scripts/atualizar_dados.js` (Task 2) e `scripts/preparar_dossies_editais.js` (Achado #2, não mexido) — nenhuma referência em `painel.html`, nenhum `data/boletim/` restante em lugar nenhum.

- [ ] **Step 3: Confirmar que os arquivos saíram do índice do git**

Run: `git ls-files data/ | grep -E "oportunidades_abertas.json|^data/boletim/"`
Expected: saída vazia.

- [ ] **Step 4: Push**

```bash
git push origin main
```

Expected: workflows `.github/workflows/atualizar-dados.yml` e `.github/workflows/recuperar-oportunidades-pncp.yml` continuam rodando sem erro na próxima execução agendada (ou disparar manualmente via `workflow_dispatch` pra confirmar antes de esperar o cron).
