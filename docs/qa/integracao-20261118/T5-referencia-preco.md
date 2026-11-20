# T5 — Referência de preço (Pesquisa de Preços do Compras.gov)

Teste real em 18/11/2026, sem login, contra a API usada por `netlify/functions/comprasgov-precos.js`:
`https://pesqpreco.estaleiro.serpro.gov.br/pesquisa-precos-backend-semlogin/api/itens-compra/buscar`.
Catálogo: `https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1`. Itens: `https://pncp.gov.br/api/pncp/v1`.

## Resposta curta

| Pergunta | Resposta |
|---|---|
| A consulta aceita a chamada sem `siglaUnidadeFornecimento`? | **Aceita, mas não serve.** Responde HTTP 200 com `itens: []` e `quantidadePrecos: null`, em silêncio. Com a sigla certa, o mesmo item devolve preços. Na prática, a sigla é obrigatória. Sem `tipoItem`, a API responde 400. |
| O `codigo_catalogo` (CATMAT) do item do PNCP serve direto? | **Sim, quando existe.** O `catalogoCodigoItem` do PNCP é o código CATMAT do Compras.gov (texto, ex.: `"622254"`) e entra direto em `codigoItemCatalogo`. Ele só vem preenchido em compras publicadas pelo Compras.gov.br. |

O proxy atual já devolve 400 quando falta a sigla. Esse comportamento está certo e **não precisa mudar**. Por isso o
`comprasgov-precos.js` não foi alterado.

## Evidências

### 1. Sem sigla, o resultado vem vazio em silêncio

Teste com o CATMAT 622254 (caneta permanente):

| Parâmetros | HTTP | Preços | Mediana |
|---|---|---|---|
| `codigoItemCatalogo=622254&tipoItem=M` | 200 | 0 | null |
| `+ siglaUnidadeFornecimento=UN` | 200 | 50 | 7,70 |
| `+ siglaUnidadeFornecimento=un` (minúscula) | 200 | 0 | null |
| `+ siglaUnidadeFornecimento=UNIDADE` (nome, não sigla) | 200 | 0 | null |
| `+ siglaUnidadeFornecimento=CX` (unidade errada) | 200 | 0 | null |
| `codigoItemCatalogo=622254` (sem `tipoItem`) | 400 | — | — |

O mesmo padrão apareceu em outros 6 itens do PDM 4416: zero preços sem sigla e 8 a 50 preços com `UN`.

A sigla precisa estar exata e em maiúsculas. Para embalagem, também é preciso informar a capacidade e a sigla da
medida. Exemplo: o CATMAT 637468 (caneta esferográfica) dá 50 preços em `UN` (mediana 2,195). Em `CX` + capacidade
50 + `UN`, dá 50 preços (mediana 31,33). Em `CX` + capacidade 50 sem a sigla da medida, dá 0 preços.

Observação: a API devolve no máximo 50 registros por chamada. Nas consultas com muitos preços, a mediana sai desses 50.

### 2. CATMAT do PNCP

O item 40 da compra `03567753000171/2026/25` traz `catalogoCodigoItem: "622254"` e
`catalogo.nome: "Catálogo do Compras.gov.br"`. Esse é o mesmo código que a Pesquisa de Preços devolve em
`codigoItemCatalogo`, com `link` para esse mesmo edital no PNCP. Ele serve direto.

Taxa de preenchimento em itens de material de pregões (modalidade 6):

| Amostra | Sistema que publicou | Itens de material | Com CATMAT |
|---|---|---|---|
| 01–05/11/2026 (30 compras) | Compras.gov.br | 95 | 95 (100%) |
| 01–05/11/2026 | ECustomize, Licitar Digital, BNC, SEAP-PR, PROCERGS e outros | 542 | 0 |
| 10–14/11/2026 (30 compras) | Compras.gov.br (federal, estadual e municipal) | 596 | 596 (100%) |
| 10–14/11/2026 | Pública Tecnologia, PROCERGS | 86 | 0 |
| 01–05/09/2026 (40 compras federais) | Compras.gov.br | 761 | 0 |

O CATMAT existe só para compras do Compras.gov.br, e nem sempre (a amostra de setembro veio sem ele). Sem CATMAT,
a tela precisa da busca manual por categoria que já existe (`acao=categorias` → `itens` → `precos`).

### 3. A unidade do PNCP é texto livre

O `unidadeMedida` do PNCP vem como nome por extenso, às vezes com a capacidade e a medida. Valores reais:
`Unidade`, `Unidade    ` (com espaços), `Caixa 50 UN`, `Caixa UN`, `Ampola 2 ML`, `Frasco 250.0 ML`,
`Rolo 100 M`, `Pacote 100 UN`, `Galão 3.6 L`, `Embalagem 500 FL`, `Frasco-Ampola`, `Metro Cúbico`, `Comprimido`.
Formato: `<nome da unidade de fornecimento> [capacidade] [sigla da medida]`.

## Tabela proposta: unidade do PNCP → sigla

Fonte: pares reais `nomeUnidadeFornecimento → siglaUnidadeFornecimento` devolvidos por
`unidadeFornecimentoPorCodigoPdm` em 153 PDMs (o número entre parênteses é em quantos PDMs o par apareceu).

| Nome no PNCP (sem acento e caixa) | Sigla | | Nome no PNCP | Sigla |
|---|---|---|---|---|
| UNIDADE (116) | UN | | BOMBONA (7) | BOM |
| EMBALAGEM (83) | EMB | | GALÃO (7) | GL |
| FRASCO (71) | FR | | PEÇA (5) | PC |
| CAIXA (57) | CX | | CONJUNTO (5) | CJ |
| ROLO (44) | RO | | SACHÊ (5) | SAC |
| PACOTE (35) | PCT | | CENTENA (5) | C |
| SACO (34) | SC | | BALDE (4) | BD |
| QUILOGRAMA (21) | KG | | PAR (4) | PAR |
| BOBINA (14) | BOB | | POTE (4) | POTE |
| GRAMA (14) | G | | BISNAGA (4) | BIS |
| LITRO (13) | L | | FRASCO-AMPOLA (4) | FR-AM |
| MILILITRO (11) | ML | | BARRA (4) | BR |
| AMPOLA (10) | AM | | TAMBOR (3) | TB |
| LATA (9) | LT | | MILHEIRO (3) | MIL |
| METRO (9) | M | | GARRAFA (3) | GRF |
| SERINGA (8) | SER (atenção: 3 PDMs usam SER-O) | | DÚZIA (2) | DZ |
| METRO CÚBICO (2) | M3 | | METRO QUADRADO (1) | M2 |
| FOLHA (1) | FL | | RESMA (1) | RES |
| JOGO (1) | JG | | COMPRIMIDO (1) | COMPR |
| CÁPSULA (1) | CAPS | | TUBO (1) | TBO |
| CARTELA (2) | CTE | | | |

Fora da tabela (sem sigla confirmada): `Fardo`, `Lenço`, `Teste`, `Envelope`. Nesses casos, a tela deve pedir que o
licitante escolha a unidade na lista do catálogo.

### Regra de uso (para o T6)

1. Normalizar o texto: tirar espaços nas pontas e duplicados, e passar para maiúsculas.
2. Separar o texto em `nome`, `capacidade` (número) e `medida` (sigla final).
   Se `nome + medida` estiver na tabela (`Metro Cúbico`), usar o nome inteiro.
3. Com capacidade e medida (`Caixa 50 UN`), mandar `siglaUnidadeFornecimento=CX`, `capacidadeUnidadeFornecimento=50`
   e `siglaUnidadeMedida=UN`. Os três campos são obrigatórios: sem a medida, o resultado vem vazio.
4. Embalagem sem capacidade (`Caixa UN`, `Pacote UN`) **não tem resultado confiável**. Testamos 4 itens: `CX`/`PCT`
   sozinho e com `siglaUnidadeMedida` deram 0 preços. Só com a capacidade certa vieram preços (ex.: `CX`/100/`UN`:
   22 preços). Nesse caso, oferecer as capacidades do catálogo (`acao=itens` já traz `unidades`) ou a consulta em `UN`,
   avisando que esse é o **preço por unidade**, não por caixa.
5. Resultado vazio não significa "sem mercado": mostrar "Sem preços para esta unidade. Tente outra unidade do catálogo."

Validação da tabela com 70 itens reais de novembro (CATMAT do PNCP + sigla mapeada):

- Unidades simples deram preços em quase todos os casos: Unidade 3/3, Litro 3/3, Quilograma 3/3, Comprimido 3/3 e
  Frasco-Ampola 2/2.
- Ampola com capacidade deu 5/5 com os três campos.
- Embalagem sem capacidade deu 0/16.
- Unidades raras (Par, Grama) deram 1/3. É falta de preço registrado, não erro de sigla.

## O que não foi verificado

- Itens de serviço (`tipoItem=S`, CATSER). Só foi testado material.
- Paginação além de 50 registros e limite de chamadas da API pública.
- Por que a amostra de setembro de 2026 veio sem CATMAT, mesmo sendo do Compras.gov.br.
