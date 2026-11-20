# Reconciliação histórica PNCP — diagnóstico offline de 28/10/2026

Análise concluída às 19:55 UTC sobre arquivos já preservados. **Nenhuma chamada externa, retomada ou alteração do coletor, runner, manifesto, logs ou brutos.** Permanecem 230 páginas aceitas, 115.000 IDs únicos, cinco atas concluídas e 459 pendências de detalhes. O catálogo está incompleto.

## O que o contrato preservado garante

Fontes: [Swagger Consulta](C:/Users/harre/AppData/Local/LicitaPlena/diagnostico-contratos-atas-20261028/swagger-consulta.json), SHA-256 `5bdb13bc7c54c547c00487c0bb1c8ac1acde6cacdcdbf6b7a417552541943262`; [Swagger PNCP](C:/Users/harre/AppData/Local/LicitaPlena/diagnostico-contratos-atas-20261028/swagger-pncp.json), SHA-256 `0a4ffde808637c58bfbe8cec7967070a9c60121c96606cf5734aaa064251ccee`.

| Rota GET documentada | Escopo e parâmetros |
| --- | --- |
| `/v1/atas` | Período de vigência. Exige `dataInicial`, `dataFinal` (`yyyyMMdd`) e `pagina` ≥ 1. Opcionais: `idUsuario`, `cnpj`, `codigoUnidadeAdministrativa`, `tamanhoPagina` entre 10 e 500. |
| `/v1/atas/atualizacao` | Período de atualização global, com os mesmos parâmetros. Não foi consultada nesta investigação. |
| `/v1/orgaos/{cnpj}/compras/{anoCompra}/{sequencialCompra}/atas/{sequencialAta}` | Consulta individual por referência conhecida; não exige descobrir previamente o catálogo nacional. |

O schema de resposta dos dois endpoints descreve `data`, `totalRegistros`, `totalPaginas`, `numeroPagina`, `paginasRestantes` e `empty`, sem marcá-los como `required`. **Não documenta ordenação, cursor, chave de continuação, versão de snapshot, monotonicidade do total ou estabilidade entre páginas.** Tampouco define a inclusividade das datas além do formato. `dataAtualizacao` e `dataAtualizacaoGlobal` aparecem no DTO, mas isso não promete ordenação por esses campos. A rota de atualização global pode apoiar uma estratégia futura; não é prova de exportação estável ou substituição equivalente da consulta de vigência. Filtrar por órgão/unidade também não comprova, por si só, cobertura de todas as partições.

## Sobreposições e lacunas observáveis

Foram examinadas **251 capturas preservadas**, validando os hashes das fontes. As páginas repetidas 1, 101, 102, 200, 201, 209, 219 e 231 mantiveram uma versão dos registros nas capturas disponíveis. A página 1 teve nove capturas entre 16:01 e 19:42 UTC, enquanto o total variou de 588.331 a 588.349. A página 230 teve três capturas e **duas versões dos registros**. Isso mostra por que estabilidade da primeira página não comprova estabilidade global.

O prefixo aceito contém 115.000 IDs sem duplicação, vinculados a 38.142 compras. A página 231 rejeitada contém 500 IDs distintos, sem sobreposição com esse prefixo; a união observada tem 115.500 IDs, **mas os 500 adicionais não estão aceitos**. Não há evidência de todas as posições posteriores nem da posição atual desses registros.

Na fronteira alterada, a nova página 230 contém o último ID da página 229 antiga, seguido pelos primeiros 499 registros da página 230 antiga. Os 499 compartilhados conservam ordem e campos. Uma montagem hipotética que substituísse somente essa página teria **115.000 linhas, 114.999 IDs únicos, uma duplicação e um ID do conjunto anterior omitido**: `15126437000305-1-001972/2025-000005`. Essa omissão é da montagem inconsistente, não prova de exclusão na fonte. Nenhuma montagem foi aplicada.

Evidência primária: [comparação da fronteira](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/incidente-fronteira-1793216616258/comparacao-local.json), com nomes, horários e hashes dos brutos. A análise das versões leu os 242 artefatos do manifesto e nove corpos das três sondas já preservadas; não contou cópias dos incidentes como novas capturas.

## Cruzamento das 459 pendências

**459 de 459 referências foram observadas**, com as **286 compras esperadas** e nenhuma divergência de vínculo. Há zero referências não observadas nesta amostra. Isso confirma o mapeamento; **os detalhes continuam pendentes**.

| Fonte aceita | Pendências encontradas | SHA-256 do bruto |
| --- | ---: | --- |
| [Página 8](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/coleta/resposta-3a55c668c8b2219a123d22110d907e3d37bb0f061046a31b882b5d3bb7f327e5.json) | 458 | `303faa7e364e379671eab4a9cc625dbadefd4e5bc8617718b7ec9c6fbd36bbd3` |
| [Página 9](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/coleta/resposta-5451be60ad0cd1045ea26ecbc61409fbff888bdaddc78f746acbe8b1c03ecea4.json) | 1 | `e6d0c6896012081dddca2564e21ede73be61fe6c6a1b5b2b1dd203634e95969a` |

A fila de origem é [mercado_meta.json](C:/Users/harre/AppData/Local/LicitaPlena/diagnostico-contratos-atas-20261028/mercado_meta.json), SHA-256 `983f3d2b825216cd75338f2a65ad5f8c605cd3b4c0e3bb8e8b0811ede2d70fe7`, idêntico à cópia `coleta/fila-origem-mercado.json`. O manifesto examinado tem SHA-256 `09416da77e0ddcfffe05e922ab9339089cf04d40df45d933f9a6aae57fcf0d23`. O cruzamento usou os IDs selecionados ainda pendentes do manifesto contra `numeroControlePNCPAta` dos brutos aceitos, conferindo também `numeroControlePNCPCompra`. Em outros cruzamentos, “não observado no catálogo parcial” deve permanecer distinto de “ausente na fonte”.

## Menor próximo passo testável

O código já aceita `ataIds` explícitos, inclusive referências encerradas, e só executa a descoberta quando `historico` é verdadeiro ([seleção](C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um/scripts/recuperar_contratos_atas_local.js:194), [descoberta condicional](C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um/scripts/recuperar_contratos_atas_local.js:268)). Porém, o modo comum **não importa certificados anteriores**: `modoRetomavel` só é verdadeiro em histórico ou catálogo, e controla a importação e o prazo por compra. O modo comum conserva prazo global de seis horas. Já `--catalogo` exige catálogo concluído; não pode ser usado para legitimar o parcial ([guardas](C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um/scripts/recuperar_contratos_atas_local.js:208), [importação](C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um/scripts/recuperar_contratos_atas_local.js:307)). Portanto, o caminho por IDs existe, mas ainda não está demonstrado como execução independente que preserve toda a reutilização e retomada exigidas.

Próxima prova proposta, **somente offline e antes de qualquer adaptação**: usar duas referências originais e certificados de teste, exigir zero chamadas ao catálogo e aos contratos já certificados, interrupção por orçamento com retomada apenas dos itens/resultados faltantes, cinco atas anteriores preservadas, compra vencida recusada e diretório histórico intacto. Essa prova delimita a menor extensão necessária para detalhar somente as 459 já autorizadas, sem desbloquear o catálogo nem ampliar para 115 mil/588 mil atas. Não foi implementada ou executada nesta análise. A reconciliação nacional permanece uma decisão separada; descartar duplicados ou aceitar totais oscilantes automaticamente não resolve as omissões.
