# Integração ComprasNet (Módulo Legado) — item 11 do diagnóstico Effecti

Status: aprovado para implementação (revisão 2 — objetivo e arquitetura mudaram)
Data original: 2026-08-20 · Revisado: 2026-08-20

## Histórico desta spec

A primeira versão deste documento (commit `979626a`) desenhava isso como
**mais uma fonte de oportunidades ao vivo pro Boletim** (só pregões com
proposta ainda aberta, últimos 60 dias, mesmo padrão do Sistema S/AM).
Depois de aprovada, dois fatos novos invalidaram essa versão:

1. **O objetivo real do Harreson não é Boletim, é análise histórica de
   mercado** — entender o que uma empresa já ganhou, onde, como, e estudar
   o histórico de UASGs, desde antes da mudança pra Lei 14.133/2021. Isso é
   um objetivo completamente diferente de "oportunidade aberta agora".
2. **Testando a API real**, o endpoint de Pregão (`3_consultarPregoes`)
   está com **zero registros em todo 2025 e 2026** — a atividade no sistema
   Legado parou na virada de ano. Não faz sentido construir um robô de
   "oportunidades abertas" pra uma fonte que não gera nada novo. Em
   compensação, o endpoint genérico de Licitação (`1_consultarLicitacao`)
   tem volume histórico real e enorme (dezenas de milhares de registros por
   ano, desde pelo menos 1999) — é isso que serve pro objetivo real.

Esta revisão substitui a anterior por completo. Não há código implementado
da primeira versão (só a spec foi commitada).

## Contexto

O diagnóstico comparativo com o Effecti apontou o ComprasNet como fonte que
o LicitaPlena ainda não cobre. Investigando a fundo, o valor real não está
em "oportunidades novas" (o sistema Legado, Lei 8.666/93, está inativo
desde 2025/2026 — tudo migrou pro PNCP, que já cobrimos 100%), mas no
**lastro histórico**: décadas de licitações, UASGs e empresas vencedoras
que só existem nesse acervo antigo, e que valem pra estudar o histórico de
mercado de uma empresa ou órgão comprador — exatamente o que já é o
propósito de Diagnóstico de Mercado e Analisar Empresa hoje.

### Pesquisa que fundamenta este design

**API**: `https://dadosabertos.compras.gov.br`, sem autenticação, sem
cadastro. Manual oficial: "Manual do Usuário – API do Compras.gov.br"
v2.0/fev-2026.

**Volume real testado direto na API** (não só documentação — chamadas
reais feitas durante esta pesquisa):

| Endpoint | Achado |
|---|---|
| `modulo-legado/3_consultarPregoes` (Pregão) | 0 registros em 2025 e 2026 — **inativo** |
| `modulo-legado/5_consultarComprasSemLicitacao` (Dispensa/Inexigibilidade) | 24.382 registros em 2025, 0 em 2026 — mesmo padrão de corte |
| `modulo-legado/1_consultarLicitacao` (genérico, todas modalidades) | 27.558 (2024) até 63.814 (2013), dados confirmados desde **1999** (7.801 registros nesse ano) |

**Decisão de escopo**: usar `1_consultarLicitacao` (o genérico), janela
**2015-2026** (10 anos) — estimativa de **~380 mil licitações**, baseada na
média amostrada de anos testados (~37,8 mil/ano × 10). Foi cogitado ir até
1999 (~984 mil licitações no total), mas o custo de armazenamento/
enriquecimento não compensa pra esse alcance nesta primeira leva — ver
"Fora de escopo" no fim.

**Vencedor (CNPJ) não vem junto** — precisa de uma chamada por licitação no
endpoint irmão `2_consultarItemLicitacao` (campo `cnpj_fornecedor`,
confirmado no manual, seção 9.2). Pra 380 mil licitações, isso é 380 mil
chamadas extras — não cabe num robô diário de ~15 min de uma vez. Ver
"Fase 2" abaixo.

**UF não vem direto** na Licitação — só `uasg`/dados do UASG. Precisa de
`modulo-uasg/1_consultarUasg` (`codigoUasg`, `siglaUf`, `nomeMunicipioIbge`)
pra traduzir — mesma necessidade já identificada na primeira versão da
spec.

### Restrição de armazenamento (achado crítico, mudou a arquitetura)

Testado direto no Supabase do projeto: banco em **254 MB de um limite de
500 MB** (plano gratuito), sendo **226 MB só a tabela `contratos`** (103.825
linhas, ~2.282 bytes/linha em média). Guardar ~380 mil licitações no mesmo
formato estouraria o espaço disponível em mais de 3x. Aumentar o plano
pago do Supabase foi cogitado e descartado a favor de uma opção sem custo.

**Cloudflare R2** foi avaliado como storage externo (10 GB grátis, sem taxa
de saída) e **descartado**: confirmado que a Cloudflare exige cartão de
crédito cadastrado pra sequer *ativar* o R2 na conta, mesmo ficando 100%
dentro do limite gratuito — o Harreson pediu explicitamente pra não criar
contas/cadastros que envolvam risco de cobrança sem aprovação prévia.

**Decisão final**: **GitHub (repositório novo, dedicado) + jsDelivr CDN**.
- Zero cadastro novo — o projeto já vive no GitHub.
- Zero cartão, zero risco de cobrança.
- jsDelivr serve qualquer arquivo de um repo público GitHub via
  `cdn.jsdelivr.net/gh/{usuario}/{repo}@{branch}/{caminho}`, sem login.

> **Atualização 2026-08-20 (pós-aprovação da Fase 1)**: antes do primeiro
> push de dados reais, uma checagem de termos de uso encontrou uma tensão
> não resolvida entre o Decreto 8.777/2016 (permite reuso irrestrito dos
> dados abertos, só exige crédito de fonte) e a licença Creative Commons
> Atribuição-SemDerivações (CC BY-ND) que aparece no rodapé de
> gov.br/compras (mais restritiva — tecnicamente não permite obra
> derivada, e este pipeline reformata/reagrupa os dados). Não foi
> encontrada nenhuma fonte que resolva explicitamente qual prevalece.
> Decisão do Harreson: manter o repositório de dados **privado** até essa
> questão ser esclarecida. Isso não afeta a Fase 1 (coleta/escrita
> funciona igual em repo privado), mas **bloqueia o consumo via jsDelivr**
> descrito nesta seção — jsDelivr só serve repositório público. A Fase 2
> (consumo no painel) precisa reavaliar isso quando chegar a hora: ou a
> questão de licença se resolve e o repo abre pra público, ou o desenho de
> distribuição muda pra algo que funcione com repo privado (ex: proxy via
> Netlify Function lendo a API de Contents do GitHub no servidor).
- Limite confirmado: **50 MB por arquivo** servido pelo jsDelivr. Resolve
  particionando os dados em muitos arquivos pequenos (por CNPJ/UASG), que é
  exatamente o desenho que já fazia sentido pro "carregar sob demanda".
- Cache de até 7 dias por branch, mas com purge imediato via API
  (`POST https://purge.jsdelivr.net/gh/...`) depois de cada push do robô.
- **Repositório separado do `hc-mercado-web`**, sem Netlify conectado —
  commits de backfill não disparam rebuild do site (era exatamente o
  problema que a migração pro Supabase já resolveu pros dados do PNCP; um
  repo novo evita reintroduzir isso).
- Fallback documentado se o jsDelivr der problema na prática: Backblaze B2
  (10 GB grátis, confirmado sem exigência de cartão) — não implementado
  nesta leva, só registrado como plano B.

## Decisões consolidadas

1. Endpoint fonte: `modulo-legado/1_consultarLicitacao` (não mais Pregão).
2. Janela: 2015-2026 (~380 mil licitações estimadas).
3. Vencedor (CNPJ) via `2_consultarItemLicitacao`, em fase separada de
   enriquecimento incremental (não bloqueia a coleta ampla).
4. UASG→UF resolvido no robô (mantido da v1), cache de UASGs.
5. Armazenamento: GitHub (repo novo dedicado) + jsDelivr CDN pros dados
   volumosos; Supabase `dados_robo` continua guardando só o estado
   operacional pequeno (progresso do backfill, cache de UASG — esses sim
   cabem tranquilamente no espaço que sobra).
6. Consumo no painel: **não é mais o Boletim** — é uma nova seção dentro de
   **Analisar Empresa** (`#empresa`, ao lado de "Participações"/"Sanções"),
   buscando sob demanda quando o cliente pesquisa um CNPJ específico. UASGs
   ficam disponíveis como um dataset consultável (uso exato na UI é uma
   decisão de uma leva futura — ver "Fora de escopo").

## Arquitetura

```
GitHub Actions (cron, novo workflow)
  → scripts/coletar_comprasnet_legado.js  (Fase 1 — coleta ampla)
      1. Atualiza cache de UASGs (Supabase dados_robo/comprasnet_uasg,
         só se tiver mais de 7 dias)
      2. Varre modulo-legado/1_consultarLicitacao, paginado, por ano
         (2015→2026), com um cursor de progresso salvo em
         dados_robo/comprasnet_progresso (pra continuar de onde parou a
         cada execução, igual ao padrão de fila persistente já usado nas
         atas de mercado)
      3. Resolve UF/município via cache de UASG
      4. Agrupa por ano e escreve/atualiza
         licitacoes/{ano}.json no repo de dados (git commit + push)
      5. Atualiza uasgs/{codigoUasg}.json (lista de licitações daquela
         UASG) — não depende de vencedor, pode ser preenchido já na Fase 1

  → scripts/enriquecer_comprasnet_legado.js  (Fase 2 — vencedor, mais lento)
      1. Lê o cursor de progresso (dados_robo/comprasnet_progresso),
         pega o próximo lote de licitações ainda sem vencedor
      2. Busca 2_consultarItemLicitacao pra cada uma (cnpj_fornecedor)
      3. Agrupa por CNPJ vencedor e atualiza empresas/{cnpj}.json no repo
         de dados (append/merge, não reescreve o arquivo todo do zero
         sempre que possível)
      4. git commit + push + purge jsDelivr dos arquivos alterados

  → painel.html (Analisar Empresa, #empresa)
      - Nova função assíncrona, disparada junto com "Participações" ao
        clicar "Analisar empresa": busca
        https://cdn.jsdelivr.net/gh/{usuario}/{repo-dados}@main/empresas/{cnpj}.json
      - Novo acordeon "Histórico ComprasNet (pré-2021)" — mesmo padrão
        visual de montarAcordeon() já usado pra Sanções/Participações
      - Sem resultado (arquivo 404): trata como "sem histórico legado
        encontrado", não é erro
```

## Componentes

### 1. `scripts/coletar_comprasnet_legado.js` (novo)

Modelo: paginação/janela por ano (como `atualizar_dados.js`), fila
persistente entre execuções (como `coletarMercadoSegmentos`), grava
progresso pequeno no Supabase (como os outros robôs), mas grava o **volume
de dados** como arquivos no repo de dados via `git` (checkout, commit,
push) em vez de linha em tabela.

**Coleta de Licitações**
- Endpoint: `GET https://dadosabertos.compras.gov.br/modulo-legado/1_consultarLicitacao`
- Parâmetros: `pagina`, `tamanhoPagina=500` (confirmado: mínimo 10, máximo
  500), `data_publicacao_inicial`, `data_publicacao_final` (obrigatórios,
  formato `YYYY-MM-DD`, confirmado por teste real — **não** o formato do
  PNCP, que é `YYYYMMDD`), limitado a uma janela de no máximo 365 dias por
  chamada (documentado) — varre ano a ano, de 2015 até o ano corrente.
- Campos usados: `id_compra`, `numero_processo`, `uasg`, `modalidade`,
  `nome_modalidade`, `situacao_aviso`, `objeto`, `valor_estimado_total`,
  `valor_homologado_total`, `data_publicacao`, `data_abertura_proposta`,
  `dt_alteracao`.
- Progresso salvo em `dados_robo/comprasnet_progresso`:
  `{ anoAtual, paginaAtual, anosCompletos: [...] }` — cada execução
  continua de onde parou, dentro do orçamento de tempo (`LIMITE_MINUTOS`,
  default 12 min).

**Cache de UASG → UF/Município**: igual à v1 desta spec — endpoint
`modulo-uasg/1_consultarUasg`, `statusUasg=true`, cache em
`dados_robo/comprasnet_uasg`, refeito só se tiver mais de 7 dias. UASG não
encontrada → registro entra com `uf`/`municipio` vazios, não é erro fatal.

**Escrita no repositório de dados**
- Repo novo dedicado (nome sugerido: `hc-licitacoes-dados-historicos`, sob
  a mesma conta `harresoncoelho-lang` — nome final é decisão do Harreson na
  hora de criar o repo).
- `licitacoes/{ano}.json`: array de licitações daquele ano (formato acima),
  reescrito/atualizado conforme o robô avança dentro daquele ano.
- `uasgs/{codigoUasg}.json`: lista enxuta de licitações daquela UASG
  (`idCompra`, `objeto`, `situacao`, `valorEstimado`, `valorHomologado`,
  `dataPublicacao`, `ano`) — atualizado toda vez que uma licitação nova
  daquela UASG é coletada.
- Um commit por execução do robô (todos os arquivos alterados juntos),
  `git push`, depois uma chamada de purge no jsDelivr pra cada arquivo que
  mudou.
- Autenticação do robô no GitHub: token (`GITHUB_TOKEN` de Actions com
  permissão de escrita no repo de dados, ou um PAT dedicado salvo como
  secret) — a definir na implementação, mesmo mecanismo de secrets já usado
  pros outros robôs.

### 2. `scripts/enriquecer_comprasnet_legado.js` (novo)

Modelo: mesma divisão "coletar" vs "enriquecer" já usada em
`coletar_empresas.js`/`enriquecer_empresas.js` neste projeto.

- Lê `dados_robo/comprasnet_progresso` pra saber quais licitações (de
  `licitacoes/{ano}.json`, já coletadas na Fase 1) ainda não têm vencedor
  resolvido.
- Pra cada uma (dentro do orçamento de tempo da execução):
  `GET modulo-legado/2_consultarItemLicitacao?uasg={uasg}&numero_aviso={numero_aviso}&modalidade={modalidade}`
  — vínculo confirmado por teste real (não é por `id_compra`, que dá 404;
  é pela combinação `uasg`+`numero_aviso`+`modalidade`, os três presentes
  em cada registro de `licitacoes/{ano}.json`). Extrai `cnpj_fornecedor` e
  `nome_fornecedor` de cada item retornado.
- Confirmado com dado real (licitação UASG 250061, aviso 4/2018): o campo
  `cnpj_fornecedor` vem preenchido pra itens com resultado homologado
  (ex: `58763350000190 OXY-SYSTEM EQUIPAMENTOS MEDICOS LTDA.`) e `null`
  pra itens sem vencedor (deserto/fracassado, ou processo ainda em
  andamento) — confirma que a Fase 2 é viável e que "sem vencedor" é
  resultado normal, não falha da chamada.
- Agrupa por CNPJ vencedor, atualiza (append, não reescreve do zero)
  `empresas/{cnpj}.json`: lista de
  `{ idCompra, objeto, orgao, uf, municipio, dataResultado, valorHomologado, itens: [...] }`.
- Prioriza licitações mais recentes primeiro (2026 → 2015) — é o que mais
  importa pra empresas ainda ativas hoje.
- Mesmo mecanismo de commit+push+purge da Fase 1.

### 3. Workflows (`.github/workflows/`)

Dois arquivos novos, mesmo modelo de `coletar-sistema-s-am.yml`:
- `coletar-comprasnet-legado.yml`: `cron: "0 12 * * *"` (meio-dia UTC,
  depois dos outros robôs) + `workflow_dispatch`, `timeout-minutes: 15`.
- `enriquecer-comprasnet-legado.yml`: `cron: "0 13 * * *"` +
  `workflow_dispatch`, `timeout-minutes: 15`. Roda depois da coleta, pra
  sempre ter licitação nova disponível pra enriquecer no mesmo dia.

Ambos precisam de um novo secret de escrita no repo de dados (nome a
definir, ex: `DADOS_HISTORICOS_TOKEN`), além do `SUPABASE_SERVICE_ROLE_KEY`
já usado pelos outros robôs.

### 4. `painel.html`

- `netlify.toml`: adiciona `https://cdn.jsdelivr.net` em `connect-src` da
  CSP (já está liberado em `script-src`, falta em `connect-src`, que é o
  que controla `fetch()`).
- Nova função `carregarHistoricoComprasnet(cnpj)`: `fetch()` direto em
  `https://cdn.jsdelivr.net/gh/{usuario}/{repo-dados}@main/empresas/{cnpj}.json`,
  trata 404 como "sem histórico" (não é erro).
- Disparada junto com o carregamento de "Participações" no handler de
  `#emp-buscar` (por volta da linha 5066 de `painel.html` na versão atual),
  populando um novo `montarAcordeon("emp-comprasnet", ..., "Histórico
  ComprasNet (pré-2021)", ...)`, mesmo padrão assíncrono já usado pra
  "Sanções" (carrega depois, atualiza o acordeon quando responde).

## Tratamento de erros

- Página HTTP com erro/timeout na API do Compras.gov.br: loga, para a
  paginação daquele ano, mantém progresso do que já foi salvo — próxima
  execução retoma dali.
- UASG não encontrada: registro entra com uf/município vazios.
- Item de licitação sem `cnpj_fornecedor` (licitação fracassada/deserta,
  ou dado ausente): não gera entrada em nenhum `empresas/{cnpj}.json`,
  não é erro.
- Falha ao dar push no repo de dados (conflito, token expirado): loga erro
  claro, `process.exit(1)` — mesmo padrão dos outros robôs, falha visível
  no GitHub Actions em vez de mascarar.
- `fetch` do painel pro jsDelivr falhando (rede, 404, arquivo ainda não
  purgado): acordeon mostra "Sem histórico ComprasNet encontrado para este
  CNPJ" — nunca trava o resto da tela de Analisar Empresa.

## Testes

1. `node --check` nos dois scripts novos.
2. Execução manual local de `coletar_comprasnet_legado.js` contra a API
   real, um ano pequeno primeiro (ex: 2024) — confirma paginação, formato
   de data, escrita correta em `licitacoes/2024.json` e `uasgs/*.json`.
3. Execução manual local de `enriquecer_comprasnet_legado.js` sobre o
   resultado do teste acima — confirma o vínculo licitação→item→vencedor e
   a escrita em `empresas/{cnpj}.json`.
4. Teste de leitura: `curl` direto na URL do jsDelivr depois do primeiro
   push, confirma que o arquivo é servido corretamente.
5. Teste visual no painel: `#empresa`, buscar um CNPJ que apareça no
   backfill de teste, confirmar que o acordeon novo aparece com os dados
   certos — e que um CNPJ sem histórico mostra a mensagem de "sem
   histórico", não erro.
6. `node --check` no `<script>` inline de `painel.html` (extração +
   validação, processo já usado neste projeto).

## Fora de escopo (explicitamente adiado)

- Histórico anterior a 2015 (dados existem desde 1999, ~984 mil
  licitações no total) — avaliar depender do quanto a leva 2015-2026 se
  mostrar útil na prática.
- UI dedicada de "consultar UASG" (hoje os dados de `uasgs/{codigo}.json`
  são coletados e ficam disponíveis, mas não há tela nova pra explorá-los
  isoladamente — só entram indiretamente via o histórico de empresa).
  Prováveis usos futuros: uma aba "Histórico de UASG" em Diagnóstico de
  Mercado, ou cruzamento automático "quais UASGs essa empresa já venceu".
- Backblaze B2 como storage — só documentado como plano B, não
  implementado, a menos que o GitHub+jsDelivr apresente problema real de
  cache/purge/limite em produção.
- Merge desse histórico com a tabela `contratos` do Supabase — ficam
  como fontes de dado separadas (uma no Postgres, uma no jsDelivr), sem
  tentativa de unificação nesta leva.
