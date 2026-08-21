# Integração ComprasNet (Módulo Legado) — item 11 do diagnóstico Effecti

Status: aprovado para implementação
Data: 2026-08-20

## Contexto

O diagnóstico comparativo com o Effecti (`Diagnostico_Effecti_Comparativo.docx`)
apontou que o Effecti consegue captar oportunidades do ComprasNet, além do PNCP.
Hoje o LicitaPlena só cobre PNCP (fonte principal) e Sistema S/AM (SENAC/SESC,
via scraping). Este documento registra o design da terceira fonte: o módulo
"Legado" da API pública do Compras.gov.br (sucessor do ComprasNet), que cobre
processos sob a Lei 8.666/93 — não migrados para o PNCP.

### Pesquisa que fundamenta este design

- API pública em `https://dadosabertos.compras.gov.br`, **sem autenticação**
  (confirmado no manual oficial: exemplos de `curl` não têm header de token).
  Rate limit não é documentado — mesma cautela adotada hoje com o PNCP (retry
  com backoff, respeitar erros 429/5xx).
- O módulo "Contratações PNCP 14133" dessa mesma API é um espelho do que já
  vem direto do PNCP (filtra por `dataPublicacaoPncpInicial/Final`) —
  **redundante**, não vamos captar isso.
- O módulo **"Legado"** (`modulo-legado/*`) cobre processos sob a Lei 8.666/93,
  com um parâmetro `pertence14133` que permite excluir explicitamente o que já
  está no regime novo (PNCP). Esse é o dado realmente novo.
- Dentro do Legado, o endpoint `3_consultarPregoes` é a modalidade dominante,
  com datas de proposta claras (`dt_inicio_proposta`/`dt_fim_proposta`).
- UF não vem direto no Pregão — só `co_uasg`/`no_orgao`. Precisa de tradução
  via `modulo-uasg/1_consultarUasg` (`codigoUasg`, `siglaUf`,
  `nomeMunicipioIbge`).
- Manual fonte: `https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-dados-abertos/manual-api-compras.pdf`
  (Manual do Usuário – API do Compras.gov.br, v2.0, fev/2026).

### Decisões já tomadas (aprovadas em conversa)

1. **Onde aparece**: misturado no mesmo Boletim/Encontrar Licitações que já
   mostra PNCP + Sistema S/AM, com badge de fonte "ComprasNet" — mesmo padrão
   já usado pro Sistema S/AM (`r.fonte`).
2. **Escopo desta 1ª versão**: só **Pregão** (`3_consultarPregoes`). Compra sem
   Licitação (dispensa/inexigibilidade) e RDC ficam para uma leva futura, se
   esta primeira entrega funcionar bem.
3. **UASG → UF**: resolvido **dentro do robô**, antes de gravar no Supabase —
   painel.html recebe `uf`/`municipio` já prontos, sem chamada de rede extra
   no navegador do cliente. Mesma divisão de responsabilidade já usada hoje
   (robô traduz, painel só exibe).

## Arquitetura

Cópia estrutural do padrão já usado no Sistema S/AM — robô dedicado, workflow
próprio, blob separado no Supabase, merge no painel — só trocando scraping de
HTML por chamadas a uma API JSON de verdade (mecânica de paginação/filtro por
data mais parecida com o robô do PNCP).

```
GitHub Actions (cron diário, novo workflow)
  → scripts/coletar_comprasnet.js
      1. Atualiza cache de UASGs (só se tiver mais de 7 dias)
      2. Busca Pregões do módulo Legado, paginado, pertence14133=0 + janela de data
      3. Filtra só pregões com proposta ainda aberta (dt_fim_proposta >= hoje)
      4. Resolve UF/município via cache de UASG
      5. Funde com o blob existente (mantém o que não expirou)
      6. Grava no Supabase (dados_robo / comprasnet)
  → painel.html
      - buscarExtrasComprasnet(uf, palavras): carrega o blob, filtra
      - normalizarComprasnet(r): traduz pro formato comum
      - entra no Boletim/Encontrar Licitações do mesmo jeito que
        buscarExtrasSistemaS já entra hoje
      - FONTES_STATUS ganha "ComprasNet (Legado)"
```

Nenhum código existente muda de comportamento, exceto a correção pontual
descrita em "Correção de escopo" abaixo.

## Componentes

### 1. `scripts/coletar_comprasnet.js` (novo)

Modelo: mistura o "orçamento de tempo + paginação + janela de data" do
`atualizar_dados.js` (`coletarOportunidadesAbertas`) com o "script dedicado +
grava blob via `supabase_dados.js`" do `coletar_sistema_s_am.js`.

**Coleta de Pregões**
- Endpoint: `GET https://dadosabertos.compras.gov.br/modulo-legado/3_consultarPregoes`
- Parâmetros: `pagina`, `tamanhoPagina=500` (máximo permitido),
  `pertence14133=0`, `dt_data_edital_inicial`, `dt_data_edital_final`
  (ambos obrigatórios pela API — janela móvel dos últimos 60 dias de
  disponibilização do edital, contados a partir de hoje, configurável via env
  var `DIAS_JANELA_COMPRASNET`, default 60).
- Campos de retorno usados: `id_compra`, `co_processo`, `co_uasg`, `no_orgao`,
  `co_orgao`, `numero`, `ds_situacao_pregao`, `tx_objeto`,
  `valorEstimadoTotal`, `valorHomologadoTotal`, `dt_data_edital`,
  `dt_inicio_proposta`, `dt_fim_proposta`.
- Filtro pós-busca: mantém só registros com `dt_fim_proposta >= hoje`
  (oportunidade ainda aberta — mesmo espírito do "oportunidades abertas" do
  PNCP, não lista histórico morto no Boletim).

**Cache de UASG → UF/Município**
- Endpoint: `GET https://dadosabertos.compras.gov.br/modulo-uasg/1_consultarUasg`
- Parâmetros: `pagina`, `tamanhoPagina=500`, `statusUasg=true` (só UASGs
  ativas).
- Campos usados: `codigoUasg`, `nomeUasg`, `siglaUf`, `nomeMunicipioIbge`.
- Persistido em blob próprio (`dados_robo/comprasnet_uasg`), com
  `atualizadoEm`. No início de cada execução, o robô verifica a idade desse
  cache: se tiver **mais de 7 dias** (ou não existir), rebusca a tabela
  inteira (paginada); senão, reaproveita o que já tem. UASGs raramente mudam,
  então não vale gastar orçamento de execução com isso todo dia.
- Se um `co_uasg` de um pregão não for encontrado no cache (UASG nova, ainda
  não vista), o registro entra mesmo assim, com `uf`/`municipio` vazios — não
  derruba a execução inteira por isso (mesmo espírito *best-effort* do resto
  do robô).

**Merge e gravação**
- Chave única: `id_compra` (papel equivalente ao `numeroControlePNCP` do
  PNCP).
- Funde com o blob existente: mantém registros antigos que ainda não
  expiraram (mesma lógica de retenção por data já usada em
  `coletarOportunidadesAbertas`), sobrescreve com o que veio de novo.
- Grava via `salvarBlob("dados_robo", "comprasnet", resultado)` (helper já
  existente em `scripts/supabase_dados.js`, usado pelo Sistema S/AM).

**Orçamento de tempo**: `LIMITE_MINUTOS` (env var, default 12 min — cobre
paginação de Pregões +, quando necessário, o refresh do cache de UASG,
com folga sob o `timeout-minutes: 15` do workflow).

**Sem link direto pro processo**: o manual da API não documenta um padrão de
URL pública pro processo individual (diferente do PNCP, que tem
`numeroControlePNCP` mapeável deterministicamente por `linkPncp()`). Por
segurança, esta versão **não inventa uma URL** — os registros de ComprasNet
não terão o botão "Ver edital completo" no card (mesmo comportamento que o
Sistema S/AM já tem quando `r.link` vem vazio). Fica como item para revisitar
se descobrirmos o padrão de URL correto depois.

### 2. `.github/workflows/coletar-comprasnet.yml` (novo)

Mesmo modelo de `coletar-sistema-s-am.yml`: `schedule` diário
(`cron: "0 11 * * *"` — 11h UTC, depois do Sistema S/AM às 10h UTC) +
`workflow_dispatch`, `timeout-minutes: 15`, roda
`node scripts/coletar_comprasnet.js` com `SUPABASE_SERVICE_ROLE_KEY` do
secrets.

### 3. Supabase

Nenhuma migration de schema — a tabela `dados_robo` (`chave text, dado
jsonb`) já é genérica o suficiente. Só dois novos valores de `chave`:
`"comprasnet"` (dados dos pregões) e `"comprasnet_uasg"` (cache de UASGs).

### 4. `painel.html`

- `normalizarComprasnet(r)`: traduz pro formato comum usado em todo o
  Boletim/Encontrar Licitações:
  ```js
  {
    objeto: r.objeto,
    orgao: r.orgao,
    municipio: r.municipio || "",
    uf: r.uf || "",
    encerramento: r.encerramento,       // dt_fim_proposta
    publicacao: r.publicacao,           // dt_data_edital
    numeroControlePNCP: r.idCompra,     // reaproveita o campo, como o Sistema S já faz
    link: null,                         // sem link direto nesta versão
    fonte: "ComprasNet",
  }
  ```
- `buscarExtrasComprasnet(uf, palavras)`: mesmo molde de
  `buscarExtrasSistemaS` — carrega o blob via `carregarBlobSupabase`, filtra
  por UF e por `bateComSegmento(objeto, palavras)`, mapeia com o
  normalizador acima.
- Chamado nos dois mesmos pontos onde `buscarExtrasSistemaS(uf, palavras)` já
  é chamado hoje (Boletim e Encontrar Licitações).
- Nova entrada em `FONTES_STATUS`: `{ supabase: "comprasnet", nome:
  "ComprasNet (Legado)", icone: "<svg class='icone-ph'><use
  href='#ph-bank'></use></svg>" }` (ou ícone equivalente já disponível no
  sprite).

### 5. Correção de escopo (pré-existente, afeta diretamente este trabalho)

Em `montarCardsBoletim`, os botões "Ver Itens" e "Acompanhamento" hoje
checam só `r.numeroControlePNCP`, sem checar `r.fonte` — ou seja, cards de
fontes externas (Sistema S/AM hoje, ComprasNet a partir desta mudança)
mostram esses botões e, se clicados, chamam funções Netlify específicas do
PNCP (`pncp-itens.js`, `pncp-arquivos.js`) com um ID que não é do PNCP,
falhando silenciosamente. Correção: as duas condições passam a exigir
`r.numeroControlePNCP && !r.fonte`.

## Tratamento de erros

- Página HTTP com erro (não-200) ou timeout: loga e para a paginação
  daquele endpoint, mantém o que já coletou até ali (mesmo padrão do PNCP).
- `co_uasg` não encontrado no cache: registro entra com `uf`/`municipio`
  vazios, não é erro fatal.
- Zero registros coletados na execução: loga aviso ("verifique se a
  estrutura da API mudou"), não é erro fatal — mesmo padrão do Sistema S/AM.
- Falha total (exceção não tratada): `process.exit(1)`, mesmo padrão dos
  outros scripts — o workflow falha visivelmente no GitHub Actions em vez de
  silenciosamente não atualizar nada.

## Testes

1. `node --check scripts/coletar_comprasnet.js` — sintaxe.
2. Execução manual local (`node scripts/coletar_comprasnet.js`) contra a API
   real do Compras.gov.br, antes de plugar no workflow — confirma que os
   endpoints/campos documentados no manual batem com a resposta real.
3. Teste visual no painel: cópia de `painel.html` em scratch, com
   `window.__sbClient` mockado retornando alguns registros de exemplo (mesmo
   processo usado nas features anteriores desta sessão) — confirma
   renderização do card, badge de fonte, e que os botões "Ver Itens"/
   "Acompanhamento" NÃO aparecem nesses cards.
4. `node --check` no `<script>` inline de `painel.html` (extração +
   validação, mesmo processo já usado neste projeto).

## Fora de escopo (explicitamente adiado)

- Compra sem Licitação (dispensa/inexigibilidade) e RDC do módulo Legado —
  possível leva futura.
- Link direto pro processo no ComprasNet (padrão de URL não confirmado).
- Merge/dedupe cruzado contra PNCP por outro critério além de
  `pertence14133=0` (não deveria ser necessário, já que esse filtro existe
  exatamente pra isso).
