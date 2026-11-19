# Pregão gravado — contrato para integrar ("Licitação anterior")

Base compartilhada de pregões lidos pela extensão no navegador do próprio usuário (modo **Gravar pregão no LicitaPlena**,
`extensao-leitura/`). Dado público: participantes, valores, marca/fabricante/modelo, lances e chat do pregoeiro. Uma vez
gravado, qualquer cliente logado lê sem abrir o portal de novo.

- SQL: `supabase/pregoes_gravados.sql` (teste: `supabase/testar_pregoes_gravados.sql`).
- Endpoint: `netlify/functions/pregao-gravado.js`, rota `/api/pregao-gravado` (`functions/api/[nome].js`).
- Nada é coletado por robô: a parte atrás de captcha só existe aqui se algum usuário abriu e gravou aquele pregão.

## Identificador da compra

`id_compra` = 17 dígitos = UASG (6) + modalidade (2, pregão = `05`) + número (5) + ano (4). É o mesmo `idCompra` do
Compras.gov / `id_compra` do arquivo de propostas e de `historico_compras`.
Ex.: SUFRAMA UASG 193028, PE 90008/2025 → `19302805900082025`. Pregões antigos do ComprasNet seguem a mesma regra
(IFAM 158142, PE 23/2022 → `15814205000232022`).

## Confiança: lido por usuário, não verificado (revisão de segurança 19/11/2026)

Quem grava é um cliente, não o robô: um cliente mal-intencionado poderia "envenenar" a base (trocar vencedor, valor,
marca ou inventar desclassificação). Por isso:
- só cliente com cadastro **aprovado** (`clientes.status`) grava ou lê; conta pendente/suspensa recebe 403;
- cada usuário grava a **própria leitura** (`pregoes_gravados_leituras`, uma linha por compra/item/proposta e usuário;
  mensagens: `pregoes_gravados_mensagens_leitores`). Nenhuma leitura apaga a de outro;
- o valor exibido é **consolidado** campo a campo: vence o valor que mais organizações (`operacao_membros`, ou o
  próprio usuário sem organização) leram; empate fica com o lido primeiro. Uma leitura posterior isolada nunca troca
  um valor já gravado; trocar exige 2+ organizações concordando; campo vazio é preenchido pela primeira leitura;
- tudo sai com `origem: "usuario"`, `leituras_concordantes` (organizações cuja leitura não contradiz o consolidado)
  e, no endpoint, `verificado` (= `leituras_concordantes >= 2`). **Mostre "lido por usuário, não verificado"
  enquanto `verificado` for falso** (a Análise por CNPJ já mostra; a tela "Licitação anterior" ainda não lê esta base);
- conta abusiva: `select public.expurgar_pregoes_gravados_por('<uuid>')` (só service_role / SQL Editor) tira as
  leituras e as mensagens que só ela trouxe e recalcula o resto.

## Ata do ComprasNet em http (B6)

A ata antiga (`comprasnet.gov.br/livre/pregao/AtaEletronico.asp`) só existe em http; por isso a extensão e o servidor
aceitam http **apenas** para `comprasnet.gov.br` (Compras.gov novo continua só https). Risco: numa rede hostil a página
pode ser alterada no caminho antes de a extensão ler. A leitura fica marcada (`sem_https` na leitura,
`fonte_sem_https: true` no pregão) e a tela deve avisar "fonte sem HTTPS".

## Leitura — `GET /api/pregao-gravado?compra=<17 dígitos>[&item=<n>]`

Cabeçalho `Authorization: Bearer <access_token do Supabase>` (o mesmo do `sb.auth.getSession()`). Cota diária
`pregao-gravado-leitura` = 2000 leituras por usuário. Até 2000 propostas e 2000 mensagens por chamada; com
`truncado: true` peça item a item (`&item=N`).

| Status | Corpo |
|---|---|
| 200 | `{ ok: true, pregao: null }` — ninguém gravou ainda |
| 200 | `{ ok: true, pregao: {...} }` (abaixo) |
| 400 | compra/item fora do formato · 401 sem sessão · 403 cadastro não aprovado · 429 cota · 503 sem chave de serviço · 502 banco indisponível |

```jsonc
{
  "id_compra": "19302805900082025", "fonte": "comprasgov",   // ou "comprasnet" (ata antiga)
  "url": "https://cnetmobile.estaleiro.serpro.gov.br/.../acompanhamento-compra/item/1?compra=19302805900082025",
  "uasg": "193028", "orgao": "SUPERINTENDENCIA DA ZONA FRANCA DE MANAUS/AM", "numero": "90008", "ano": 2025,
  "modalidade": "Pregão Eletrônico",
  "itens": { "1": { "descricao": "Álcool etílico...", "situacao": "Homologado", "quantidade": 50,
                    "valor_estimado": 11.87, "unidade": "Litro", "propostas_lidas_em": "2026-11-19T..." } },
  "origem": "usuario", "fonte_sem_https": false, "leituras_concordantes": 1, "verificado": false, "truncado": false,
  "gravado_em": "...", "atualizado_em": "...",
  "propostas": [ {
    "numero_item": 1, "fornecedor_chave": "33442649000111", "cnpj": "33442649000111",
    "nome": "MAX DISTRIBUIDORA ...", "uf": "AM", "me_epp": true, "situacao": "Adjudicada",
    "valor_ofertado": 10, "valor_negociado": null, "valor_proposta": 10, "valor_total": 500, "quantidade": 50,
    "marca": "santa cruz", "fabricante": null, "modelo": "liquido",
    "lances": [ { "valor": 10.5, "dataHora": "2022-12-06T09:10:11", "excluido": false } ],   // só ComprasNet
    "chat_lido": true, "proposta_lida": true, "origem": "usuario", "leituras_concordantes": 1, "verificado": false, "atualizado_em": "..."
  } ],
  "mensagens": [ {
    "numero_item": 1,                 // 0 = mensagem da sessão, sem item
    "fornecedor_chave": "22333444000181", "data_hora": "2026-01-07T09:44:00",   // horário de Brasília, sem fuso
    "autor": "orgao",                 // orgao | fornecedor | sistema | Pregoeiro | Sistema (ComprasNet)
    "texto": "...", "tipo": "recusa", // recusa | desclassificacao | inabilitacao | convocacao | habilitacao | adjudicacao | aceite | outro
    "motivo": "texto depois de 'Motivo:' ou 'Justificativa:'"
  } ]
}
```

Como mostrar no cartão:
- **Destaque**: mensagens com `tipo` em `recusa`, `desclassificacao`, `inabilitacao` e o `motivo`.
- `proposta_lida = false` → marca/modelo **não lidos** (não "sem marca"). `chat_lido = false` → chat não lido.
- `itens["N"]` ausente ou sem `propostas_lidas_em` → item não aberto: mostrar "Gravar com a extensão (abra o item N)".
  Link para abrir: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/N?compra=<id>`.
- `fornecedor_chave` `pf:<n>` = pessoa física: sem documento, nome sempre "Pessoa física". Nunca há CPF na base.
- Valores em reais; `valor_ofertado`/`valor_negociado` são unitários (Compras.gov); `valor_proposta`/`valor_total` da proposta.

Alternativa sem endpoint: o client Supabase do navegador pode ler direto as três tabelas, **só as colunas públicas**
(grant por coluna para `authenticated`; `gravado_por`/`atualizado_por` e as tabelas de leituras ficam só no
service_role). Nomeie as colunas no `select` (`select=*` é recusado).

## Gravação — `POST /api/pregao-gravado` (só a extensão usa)

Mesmo cabeçalho de sessão e cadastro aprovado; cota diária `pregao-gravado` = 400 gravações por usuário. Corpo ≤ 2 MB: a saída de
`lerPaginaPregao` sem `status`/`pendentes`:

```jsonc
{ "versao": 1, "fonte": "comprasgov|comprasnet", "compra": "<17 dígitos>", "url": "...",
  "cabecalho": { "uasg", "orgao", "numero", "ano", "modalidade" },
  "itens": [ { "numero", "descricao", "situacao", "quantidade", "valorEstimado", "unidade", "propostasLidas",
               "propostas": [ { "chave", "cnpj", "nome", "uf", "meEpp", "situacao", "valorOfertado", "valorNegociado",
                                "valorProposta", "valorTotal", "quantidade", "marca", "fabricante", "modelo",
                                "lances": [ { "valor", "dataHora", "excluido" } ], "chatLido", "propostaLida" } ],
               "mensagens": [ { "fornecedor", "dataHora", "autor", "texto", "tipo", "motivo" } ] } ],
  "mensagens": [ /* da sessão, item 0 */ ] }
```

Resposta 200: `{ ok: true, compra, propostas: <linhas gravadas/atualizadas>, mensagens_novas: <inseridas> }`.
400 com o campo inválido (CNPJ com dígito errado, CPF, compra fora do formato, tamanho, tipo), 413 corpo grande, 429 cota.

Regras do servidor (`validarPregao` + RPC `gravar_pregao_gravado`):
- `chave` = CNPJ válido de 14 dígitos (igual a `cnpj`) ou `pf:<n>` com `cnpj` nulo; nome de pessoa física é trocado por "Pessoa física".
- CPF em texto livre (com ou sem pontuação, com espaço ou "/") é mascarado de novo (`_cpf.js`); os CHECKs recusam CPF em nome, texto e motivo mesmo vindo do service_role.
- URL guarda só origem, caminho e `compra` (nada de token de captcha).
- Mescla sem apagar: a leitura nova do usuário mescla com a anterior DELE; o consolidado segue a regra de confiança acima; `chat_lido`/`proposta_lida` só passam a verdadeiro.
- Mensagens deduplicadas por `md5(compra|item|fornecedor|data_hora|texto)`.
- Autoria: `gravado_por/gravado_em` (primeira leitura) e `atualizado_por/atualizado_em` (última); por leitura em `pregoes_gravados_leituras`. Dados anteriores a 19/11 viraram uma leitura de quem gravou primeiro.
