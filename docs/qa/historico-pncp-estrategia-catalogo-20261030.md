# Estratégia mínima para reconciliar o catálogo PNCP — 30/10/2026

## Decisão proposta e limite da entrega

Recomenda-se uma **operação separada de observação e reconciliação**, com passagens completas versionadas da mesma consulta nacional por vigência. Ela preserva todas as ocorrências, compara IDs, versões e posições e encerra com resultado verificável, inclusive quando não consegue estabilizar. O catálogo histórico existente não deve receber páginas substitutas nem ter suas guardas relaxadas.

O melhor resultado possível neste contrato é um **catálogo observado reconciliado em duas passagens completas coincidentes**, com intervalo de leitura explícito. Isso não é snapshot transacional nem prova de ausência de omissões na fonte. Se a exigência continuar sendo inventário nacional completo em um único instante, o contrato preservado não fornece evidência suficiente para certificá-lo.

Este documento é um projeto, sem implementação, execução de testes ou autorização de coleta. Foram lidos os relatórios e o Swagger já locais. Nenhuma chamada externa, UI, coletor, runner, certificado, manifesto histórico ou bruto foi alterado. O diagnóstico do deslocamento p229→p230 é premissa concluída; não foi repetido.

## Base e escopo exatos

Fontes principais: [diagnóstico offline](historico-pncp-reconciliacao-offline-20261028.md), [histórico da execução](historico-pncp-20261028.md) e [Swagger Consulta preservado](C:/Users/harre/AppData/Local/LicitaPlena/diagnostico-contratos-atas-20261028/swagger-consulta.json), SHA-256 `5bdb13bc7c54c547c00487c0bb1c8ac1acde6cacdcdbf6b7a417552541943262`.

- Consulta-mãe: `GET /v1/atas`, `dataInicial=20260803`, `dataFinal=20261004`, `tamanhoPagina=500`, `pagina>=1`, sem filtro de órgão, unidade ou usuário. “Nacional” designa essa janela de vigência, não todos os anos de retenção.
- Preservado: 230 páginas aceitas e 115.000 IDs únicos. A página 231 rejeitada contém outros 500 IDs observados; esses registros continuam sem aceitação no catálogo histórico. Há cinco atas concluídas e 459 detalhes pendentes; esta estratégia não amplia nem executa esse enriquecimento.
- Total histórico aceito: 588.343; últimas âncoras: 588.349, com 1.177 páginas. São observações datadas, não uma meta fixa válida hoje. A diferença aritmética de 473.349 IDs não identifica quais IDs faltam.
- O manifesto histórico lido conserva SHA-256 `09416da77e0ddcfffe05e922ab9339089cf04d40df45d933f9a6aae57fcf0d23`. Os horários e os estados anteriores continuam vinculados aos seus arquivos originais.
- O contrato documenta paginação numérica e os filtros acima. Não documenta cursor, ordenação estável, versão de snapshot ou inclusividade das datas. Os metadados de paginação não são `required` no schema; ausência deles impede certificação pelo protocolo proposto.

`/v1/atas/atualizacao` consulta outro eixo temporal. Não deve substituir a descoberta por vigência nem ser tratado como log completo de inserções, exclusões ou mudanças. A consulta individual serve a referências conhecidas; não descobre IDs omitidos. Nenhuma das duas entra no caminho mínimo escolhido.

## Somente duas opções viáveis

| Opção | Trabalho e evidência | Custo e risco |
| --- | --- | --- |
| **A — passagens nacionais versionadas, escolhida** | Ler integralmente a consulta-mãe; repetir em outra passagem; conciliar cada ocorrência e comparar as sequências completas. Reservar uma terceira passagem apenas para tentar formar um par consecutivo coincidente. | Não depende de hipótese nova sobre filtros. Tem custo previsível pela paginação observada. Pode terminar parcial se a fonte continuar mudando; a evidência acumulada permanece utilizável. |
| **B — sub-janelas de vigência sobrepostas, com conferência nacional** | Dividir a janela em intervalos menores, com fronteiras sobrepostas; versionar cada consulta; reconciliar ocorrências entre intervalos; conferir a união contra passagens completas da consulta-mãe. | Pode reduzir o intervalo de leitura de cada consulta pequena. Porém, vigências podem cruzar várias sub-janelas e a semântica das bordas não é contratualmente definida. A soma dos totais não vale como total nacional. Exige mais chamadas, controle de sobreposições e conferência nacional adicional. |

Escolhe-se A por menor custo seguro de implementação e verificação. B é executável como exploração observacional, mas não tem garantia de economia: sem a conferência da consulta-mãe, apenas produz vários catálogos parciais de semântica não demonstrada. Não se propõe uma terceira alternativa baseada em filtro por CNPJ, pois falta uma lista nacional completa de partições e isso não resolve a paginação interna.

## Unidade versionada e reconciliação

A futura operação deve usar diretório novo fora do repositório e fora de `historico-pncp-20261028`, com identificador próprio, parâmetros, versão do protocolo, hashes das fontes importadas e limites congelados. “Versão” abaixo é um identificador local do conteúdo observado, sem pretensão de versão oficial do PNCP.

São necessários apenas três tipos lógicos de artefato, todos verificáveis e retomáveis:

1. **Captura imutável:** corpo bruto, status/cabeçalhos disponíveis, pedido exato, início/fim UTC, tentativa, passagem, página, hash SHA-256 e classificação. Cada tentativa recebe registro próprio. Corpo idêntico pode compartilhar armazenamento por hash, mas duas capturas nunca viram uma só observação.
2. **Ocorrências e versões:** para cada registro, guardar `numeroControlePNCPAta`, `numeroControlePNCPCompra`, hash de todos os campos do registro, versão da canonicalização, captura e posição `(passagem, página, índice)`. Canonicalizar apenas a representação JSON de objetos; não ordenar arrays, normalizar valores ou retirar campos desconhecidos. O bruto permanece a autoridade para auditoria. O ordinal calculado é posição observada naquela consulta, nunca posição universal do ID.
3. **Índice e relatório de reconciliação:** apontadores para capturas selecionadas de cada passagem, inventário de hashes, páginas previstas/obtidas, totais declarados, contagens de linhas e IDs, diferenças e estado final. Gravação atômica deve impedir checkpoint que aponte para corpo não preservado.

A comparação deve produzir, explicitamente: ID novo; mesmo ID/conteúdo em outra posição; mesmo ID com conteúdo diferente; múltiplas ocorrências na mesma passagem; ID antigo não reencontrado; e divergência de vínculo com compra. Metadados de total são comparados separadamente dos campos dos registros. Mesmo total com IDs trocados é divergência.

Um índice por ID é permitido para consulta, mas deve apontar para **todas** as ocorrências e versões. Contagem distinta é uma métrica, não uma instrução para eliminar linhas. Não eleger automaticamente “a versão mais recente” por `dataAtualizacaoGlobal` ou horário de recebimento: o contrato não garante ordenação de versões, e campos iguais de data podem acompanhar conteúdos diferentes.

Duplicação, mudança de campos, deslocamento e queda do total geram eventos de reconciliação e impedem o selo de coincidência; não autorizam substituir o certificado histórico. Uma consulta posterior não apaga uma anterior. Não reencontrar um ID significa apenas “não reencontrado nas passagens indicadas”; não comprova exclusão, cancelamento, ausência na fonte ou erro do certificado antigo.

## Uso do prefixo preservado

Importar somente referências verificadas por hash, sem regravar manifesto, horários, páginas, certificados ou estados anteriores. O prefixo fornece uma base histórica de 115.000 IDs e versões; os demais brutos fornecem observações adicionais com sua classificação original. Os 500 IDs da página 231 não devem ser promovidos silenciosamente a aceitos.

O prefixo pode antecipar índices locais, apontar referências já conhecidas e permitir comparar o conjunto antigo com cada nova passagem. Também permite evitar novo detalhe de uma ata ou compra já certificada quando outro fluxo autorizado fizer esse trabalho. **Não economiza as 230 primeiras páginas da nova passagem:** recomeçar na 231 ou juntar o prefixo antigo à cauda nova repetiria a hipótese de posição estável já refutada. Reconsultar somente p1 e p230 não revalida as 228 páginas intermediárias.

Manter duas visões nomeadas: união histórica das observações, com proveniência; e conjunto de uma passagem candidata. A união nunca ocupa o lugar da passagem atual, nem sua contagem pode ser comparada diretamente com um total remoto como prova de cobertura.

## Plano mínimo executável, ainda não autorizado

1. Construir primeiro um candidato isolado e seu reconciliador offline, sem importar o coletor com efeitos de execução. Validar o formato e a preservação dos arquivos usando as falhas abaixo. Não integrar esse protocolo ao core histórico neste incidente.
2. Antes de qualquer execução futura, congelar diretório e limites e obter a liberação explícita da origem compartilhada. Preservar serialização com a recuperação das 14 UFs, lock, cadência mínima de sete segundos, orçamento de 350 tentativas por rodada, prazo de catálogo de 60 segundos e limite de quatro tentativas por pedido. Não renovar certificados ou compras parciais vencidas.
3. Na passagem A, consultar p1 e registrar o total e a quantidade inicial de páginas. Ler uma sequência de páginas no diretório novo; nunca completar posições a partir do prefixo antigo. Uma retomada registra nova verificação de p1 e da última página lida. Revalidações são capturas adicionais, sem substituir os apontadores originais da passagem. Fechar com nova captura de p1 e da última página.
4. Registrar oscilações ou sobreposições como observações. Elas tornam a passagem divergente, mesmo que a leitura prossiga apenas para ampliar a evidência. Não reclassificar essas páginas como certificadas. Se o total crescer, estender a cauda somente dentro dos limites congelados; se cair, preservar as posições já observadas e a contradição. Não remover páginas para fazer a conta fechar. Metadados ausentes/inválidos ou falha de integridade interrompem a operação com estado explícito.
5. Fazer passagem B independente desde p1. Comparar todos os IDs, vínculos, conteúdos e posições, além das métricas. Se A/B forem completas e coincidentes, emitir o relatório observado e parar. Caso contrário, uma passagem C pode comparar B/C. A/C coincidentes com B diferente não constituem par consecutivo estável.
6. Encerrar sempre com índice, eventos, contagens e motivo. Não executar detalhes automaticamente, não acionar o runner antigo e não converter o manifesto histórico para concluído. Integração futura requer decisão própria sobre como um consumidor reconhecerá esse novo tipo de evidência.

Proposta de limites: **três passagens, até 1.200 páginas de dados por passagem, 3.600 tentativas totais e 350 por rodada**, valendo o primeiro limite atingido. Âncoras e retentativas consomem o mesmo orçamento. Os 1.200 são teto operacional, não limite da fonte; se o PNCP informar mais páginas, o resultado será parcial por orçamento. Um pedido sem sucesso após quatro tentativas encerra a rodada como falha, sem encadeamento automático. `Retry-After`, se presente, deve ser respeitado; espera não concede novas tentativas. Pausas de orçamento permitem retomada explícita na mesma operação, sem iniciar nova passagem silenciosamente.

Se o par A/B divergir, C é a única reserva; se B/C não coincidir, ou qualquer teto for alcançado, **parar como observado parcial e exigir nova decisão**. Não prolongar a operação indefinidamente até obter totais convenientes. O tempo de validade das validações e certificados existentes continua sujeito às regras atuais; o novo carimbo de leitura não renova essas evidências.

## Critério de saída honesto

O estado `observado_reconciliado` exige duas passagens consecutivas completas da mesma consulta, cada uma com sequência contínua de páginas, todos os hashes válidos, IDs válidos, ausência de duplicação dentro da passagem, total de linhas igual ao de IDs distintos e metadados presentes/coerentes. Cada passagem e suas verificações de encerramento devem concordar quanto a total e páginas; as duas passagens devem coincidir em IDs, posições, vínculos e todos os campos. Para 500 por página, conferir cardinalidade das páginas cheias, cardinalidade da última e coerência com o total. Mudanças em páginas intermediárias também impedem o selo.

Todas as diferenças em relação ao prefixo antigo devem aparecer no relatório. Um ID antigo não reencontrado pode permanecer como fato histórico explícito, sem inventar causa ou exclusão. Duas passagens atuais coincidentes não invalidam essa evidência antiga. Se não houver par completo coincidente, o estado é `observado_parcial`, com páginas faltantes e divergências identificadas. Campo de validação ausente gera validação insuficiente, nunca zero implícito.

**Não marcar cobertura completa** por atingir 588.349 IDs, alcançar p1177, obter p1/final iguais, somar partições, unir passagens, descartar duplicados, aceitar oscilação do total ou concluir uma rodada de 350 chamadas. Também não marcar quando houver páginas faltantes, resposta 204 isolada, schema insuficiente, hashes divergentes, orçamento esgotado ou posições/conteúdos divergentes. Uma resposta vazia após páginas válidas não comprova sozinha o fim; o contrato não define essa combinação como certificado de término.

Mesmo no melhor estado, não emitir `catalogoConcluido` para satisfazer a guarda existente de `--catalogo`. A garantia continua sendo coincidência observada durante intervalos documentados. Mudanças entre pedidos podem escapar a duas varreduras idênticas; o relatório deve conservar essa limitação. Completude transacional exigiria garantia adicional da fonte que não está no Swagger local.

## Chamadas e tempo

Com os **1.177** blocos observados, uma passagem custa pelo menos 1.177 chamadas; duas custam **2.354**. A sete segundos por tentativa, o piso de cadência é **4h34m38s**. Acrescentando duas reconferências de encerramento por passagem e duas âncoras em cada uma de seis retomadas, seriam aproximadamente **2.370 chamadas e 4h36m30s** de piso, sem retentativas ou crescimento. Essa organização usa quatro rodadas por passagem com teto de 350, portanto oito rodadas; não é autorização para encadeá-las.

O piso não inclui tempo de resposta. As evidências registram páginas na ordem de **24–47 segundos**, além de outras respostas mais rápidas. Se cada uma das 2.354 chamadas consumisse 24–47 segundos e mais sete segundos de intervalo serial, a projeção seria aproximadamente **20h16–35h19**, antes de reconferências, pausas e retentativas. Isso é cenário ilustrativo, não distribuição medida nem prazo prometido. Com teto de 60 segundos, falhas repetidas consomem orçamento sem produzir páginas.

Três passagens estáveis teriam 3.531 chamadas de dados; o teto global de **3.600** deixa somente 69 tentativas para controles e falhas. Seu piso de cadência é sete horas, sem promessa de conclusão. Totais maiores ou muita retentativa podem esgotá-lo antes da terceira passagem.

Na opção B, para `K` sub-janelas e `Pj` páginas por sub-janela, duas passagens locais e a mesma conferência nacional custariam ao menos `2 × soma(Pj) + 2 × 1.177`, mais controles. Como cada ata pode reaparecer em várias vigências consultadas, `soma(Pj)` é desconhecida e não pode ser estimada pela simples divisão de 1.177 por K. Nem se promete ganho de tempo, nem se reduz o orçamento ignorando essa repetição.

## Falhas e provas offline obrigatórias antes de implementar coleta

Nenhuma prova abaixo foi executada nesta entrega. Usar fixtures pequenas e as evidências locais somente por leitura; HTTP e relógio devem ser simulados, com bloqueio que falhe diante de qualquer tentativa real de rede.

| Caso | Resultado exigido |
| --- | --- |
| Duas passagens pequenas idênticas, inclusive página final parcial | Estado observado reconciliado, sequências e totais conferidos; nenhum certificado histórico alterado. |
| Mudança em página intermediária com p1/final iguais | Divergência detectada; somente âncoras nunca bastam. |
| Deslocamento já documentado da fronteira, como fixture pronta | Duas ocorrências/posições preservadas, ID não reencontrado reportado; nenhum conserto por remoção de duplicado. Não refazer o diagnóstico real. |
| Inserção/remoção compensadas, total constante | Diferença de IDs detectada; contagem igual não produz selo. |
| Mesmo ID com campos ou compra diferentes; campos novos e mesma data de atualização | Versões e conflito preservados, sem sobrescrita ou escolha silenciosa. |
| Total cresce, cai ou oscila; última página muda | Eventos explícitos; extensão limitada pelo orçamento; nenhuma página antiga eliminada para conciliar total. |
| Total/página ausentes, incoerentes, número incorreto, ID vazio, duplicação, JSON inválido ou 204 no meio | Validação insuficiente ou falha explícita, preservando o bruto e sem concluir. |
| Queda entre corpo, hash e checkpoint; retomada após 350 tentativas | Recuperação determinística, hash conferido, sem arquivo certificado incompleto e sem repetir capturas como se fossem a mesma tentativa. |
| Âncora mudou na retomada ou validação envelheceu | Nova observação sem renovar horários antigos; passagem divergente ou validação pendente, sem aproveitar posição antiga automaticamente. |
| Timeout, quatro falhas, 429 com `Retry-After`, relógio e lock compartilhado | Limites, espera, cadência entre rodadas, preservação e liberação de lock testados; zero loop de retentativas. |
| A/B diferentes; B/C iguais; A/C iguais e B diferente | Só o par consecutivo B/C pode reconciliar; limite de três respeitado. |
| Teto de 1.200 páginas ou 3.600 tentativas; nova execução sem liberação | Estado parcial e parada; nenhum encadeamento automático. Liberação externa é pré-condição, não inferência do teste. |
| Importação de prefixo aceito, bruto rejeitado, cinco atas e certificados anteriores | Classificações/horários originais e hashes intactos; rejeitado não vira aceito; nenhuma consulta de detalhes disparada. |
| Sub-janelas com bordas e atas sobrepostas | Ocorrências preservadas, soma não usada como total nacional; opção B não ganha cobertura sem conferência da consulta-mãe. |

A futura revisão deve conferir diferença restrita ao candidato, testes relevantes, zero rede no ensaio e hashes dos arquivos históricos antes/depois. Somente depois cabe decidir implementação e uma eventual coleta pública. Esta entrega encerra no relatório.
