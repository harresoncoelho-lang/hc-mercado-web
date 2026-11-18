# Recuperação local das 14 UFs e histórico — 28/10/2026

Escopo autorizado: recuperar dados públicos em disco, sem publicação, sem Supabase, sem SMTP e sem alterar o robô agendado ou o resumo por e-mail. As evidências anteriores permanecem preservadas.

## Oportunidades abertas — 27 UFs consolidadas localmente

**Resultado: 27/27 UFs, 698 páginas e 34.209 IDs únicos, sem duplicatas entre UFs.** A rodada complementar concluiu 14/14 UFs, 253 páginas e 12.265 registros. A consolidação incorporou os 21.944 registros das 445 páginas anteriores, após comparar seus hashes e payloads com as origens.

- Início: `2026-10-28T04:27:57.018Z` (01h27 de 28/10 em Brasília).
- Última conferência da rodada complementar na fonte: `2026-10-28T04:59:01.652Z` (01h59 em Brasília). Todas as 14 UFs estão `concluida` no manifesto preservado.
- UFs desta rodada: AC, AP, AM, MA, MT, MS, PI, RN, RO, RR, SC, SP, SE e TO. Conferidas como complemento das 13 UFs anteriores: AL, BA, CE, DF, ES, GO, MG, PA, PB, PR, PE, RJ e RS.
- Fonte: `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta`, com `dataFinal=20271028`, 50 registros por página, uma chamada por vez e intervalo mínimo de 7 segundos, inclusive nas tentativas.
- Pasta nova: `C:\Users\harre\AppData\Local\LicitaPlena\recuperacao-pncp-20261028-14ufs`.
- Executor: `scripts/recuperar_cobertura_local.js`, sem alteração. Os 10 testes focados passaram antes da execução.
- Critério de conclusão: todas as páginas presentes, IDs distintos iguais ao total declarado pela fonte e primeira página reconferida com os mesmos IDs e ordem. Mudanças de total, duplicações ou falhas preservam o checkpoint e impedem conclusão.
- As 13 UFs anteriores foram relidas em disco, sem novo acesso ao PNCP. O conjunto nacional conserva horários distintos por UF, sem alegar snapshot transacional único.

Esta consulta contém oportunidades que a fonte considera abertas no momento da leitura, com encerramento até 28/10/2027. Não representa o histórico completo de publicações nem recupera contratos ou atas.

## Evidência nacional e integridade

Pasta nova, fora do OneDrive e do repositório: `C:\Users\harre\AppData\Local\LicitaPlena\recuperacao-pncp-20261028-27ufs`.

- [oportunidades-pncp-bruto.json](<C:/Users/harre/AppData/Local/LicitaPlena/recuperacao-pncp-20261028-27ufs/oportunidades-pncp-bruto.json>): 34.209 registros, 90.100.855 bytes. Mantém `ufConsulta` e o payload original `dado`; deduplicação nacional por `numeroControlePNCP`.
- [conferencia.json](<C:/Users/harre/AppData/Local/LicitaPlena/recuperacao-pncp-20261028-27ufs/conferencia.json>): consulta, contagens, datas por UF, cinco manifestos originais, páginas, SHA-256 e limites da evidência.
- [verificacao.json](<C:/Users/harre/AppData/Local/LicitaPlena/recuperacao-pncp-20261028-27ufs/verificacao.json>): resultado da única verificação final, às `2026-10-28T16:01:11.311782Z` (13h01 em Brasília). Releu 706 arquivos de origem e as duas saídas: **708 arquivos sem divergência**, incluindo as 698 páginas. As origens não foram alteradas.
- Consolidação: `2026-10-28T16:01:07.580262Z`. Período das coletas incorporadas: `2026-10-28T02:00:12.878Z` a `2026-10-28T04:59:01.652Z`; em Brasília, de 27/10 às 23h00 a 28/10 às 01h59. A auditoria de disco não renovou essas datas.

Nas 13 UFs, todos os 450 hashes do certificado anterior foram comparados: 445 páginas, quatro manifestos e o bruto consolidado. Também foram comparados semanticamente todos os 21.944 payloads com as páginas de origem. O hash do certificado anterior foi conferido com o registro de pré-checagem preservado na pasta das 14 UFs.

Nas 14 UFs, este é o primeiro certificado SHA-256 das 253 páginas. Todas foram lidas, conferidas contra o manifesto e relidas na verificação final. A auditoria validou sequência e tamanho das páginas, totais, IDs preenchidos, ausência de repetição dentro de cada UF e igualdade entre IDs distintos e total declarado. A primeira página reconferida na fonte é uma evidência do executor registrada nos manifestos; não houve nova consulta à fonte nesta consolidação.

O auxiliar temporário de consolidação usou somente a biblioteca padrão do Python, fora do aplicativo. Dois autotestes negativos confirmaram a rejeição de total alterado e IDs repetidos. Não houve alteração em coletores, testes do produto, resumo, e-mail ou boletim nesta etapa.

| Saída | SHA-256 |
|---|---|
| `oportunidades-pncp-bruto.json` | `bdd85c3ae2769c05bc85f51893ed96b7facfb6510b9cc6c97eb6af106b3c1e7a` |
| `conferencia.json` | `b695be63bf684c234485b7ea6a53c57201de2c76fa13bb4ee81e13653d33d637` |

## Contagens e datas por UF

Todos os horários abaixo são UTC de 28/10/2026. Indicam a conferência na fonte durante a coleta, preservada no manifesto; não o horário da auditoria posterior em disco.

| UF | Páginas | IDs únicos | Conferência na fonte (UTC) |
|---|---:|---:|---|
| AC | 3 | 128 | 04:28:18.717 |
| AL | 6 | 284 | 02:01:26.294 |
| AM | 6 | 296 | 04:29:28.781 |
| AP | 2 | 52 | 04:28:39.779 |
| BA | 52 | 2.572 | 02:09:25.131 |
| CE | 24 | 1.179 | 02:12:20.543 |
| DF | 11 | 518 | 02:13:44.061 |
| ES | 13 | 623 | 02:15:21.697 |
| GO | 27 | 1.330 | 02:18:39.290 |
| MA | 9 | 404 | 04:30:38.813 |
| MG | 103 | 5.137 | 02:30:47.293 |
| MS | 9 | 434 | 04:33:13.049 |
| MT | 11 | 519 | 04:32:02.683 |
| PA | 12 | 572 | 02:32:17.645 |
| PB | 12 | 590 | 02:33:48.965 |
| PE | 20 | 990 | 02:46:41.607 |
| PI | 9 | 410 | 04:34:23.005 |
| PR | 69 | 3.410 | 03:22:47.240 |
| RJ | 31 | 1.502 | 02:50:25.793 |
| RN | 12 | 585 | 04:35:54.097 |
| RO | 8 | 374 | 04:36:57.010 |
| RR | 2 | 75 | 04:37:18.302 |
| RS | 65 | 3.237 | 02:58:08.666 |
| SC | 50 | 2.465 | 04:43:16.288 |
| SE | 5 | 229 | 04:58:05.388 |
| SP | 120 | 5.953 | 04:57:23.447 |
| TO | 7 | 341 | 04:59:01.652 |
| **Total** | **698** | **34.209** | — |

## Alcance temporal e limites

As publicações observadas vão de `2023-06-21T14:30:36` a `2026-10-28T01:32:28`; os encerramentos, de `2026-10-27T23:59:00` a `2027-10-28T23:59:00`. São valores originais do PNCP, sem conversão de fuso. Nenhum registro ficou sem essas duas datas. Há **5.990 publicações anteriores a 30/06/2026**, corte de 120 dias usado no diagnóstico anterior.

O certificado preserva a observação histórica concluída, mesmo após transcorrerem horas desde a coleta. Não comprova que todas as oportunidades continuam abertas no momento da auditoria. Não foi reiniciada a coleta nem aplicado o prazo de retomada de checkpoints incompletos às UFs já concluídas.

O PNCP não fornece um snapshot nacional transacional nesta consulta; a reconferência da primeira página e dos totais detecta deslocamentos comuns, mas não prova ausência de mudanças intermediárias. As tentativas parciais anteriores de PR continuam preservadas, sem registros incorporados por essas tentativas. A [evidência das 13 UFs](recuperacao-cobertura-local.md) permanece como registro da rodada original.

O bruto ainda exige normalização e validação de importação antes do uso no modelo do produto. Esta etapa não acessou rede, Supabase, SMTP ou produção; não publicou arquivos nem executou deploy ou commit.

## Histórico

Seção reservada à recuperação de contratos/atas, coordenada separadamente para não concorrer com a origem PNCP.
