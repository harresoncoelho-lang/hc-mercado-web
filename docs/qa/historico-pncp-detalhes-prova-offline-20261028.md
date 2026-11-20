# Prova offline de detalhes por referências explícitas — 28/10/2026

**Resultado: suporte parcial; não está pronto para executar as 459 pendências com todos os requisitos.** A prova confirmou seleção sem catálogo e retomada de resultados, mas também confirmou ausência de importação dos certificados e de validade independente por compra nesse caminho. Nenhuma correção foi implementada.

## Execução reproduzível e isolamento

[Script diagnóstico](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/prova-detalhes-offline-20261028/prova.test.js), fora do repositório e do gate:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node --test 'C:\Users\harre\AppData\Local\LicitaPlena\historico-pncp-20261028\prova-detalhes-offline-20261028\prova.test.js'
```

Foram reaproveitados os padrões `preparar`/`fonte` e de retomada por orçamento dos testes existentes. O script selecionou duas referências pendentes da fila real: uma cuja compra já está entre as cinco atas concluídas e outra de compra distinta. Identidades reais serviram apenas como chaves; contratos, itens e resultados foram inteiramente fictícios. A origem certificada de fixture contém cinco atas concluídas e as duas referências ainda pendentes. Todos os diretórios de execução ficam sob a pasta diagnóstica, separados dos certificados e brutos reais.

O código de produção foi chamado por `recuperar()` com `historico: false`, `ataIds`, `snapshotAnterior` de fixture e `renovarParciais: false`. `buscarRemoto` simulou todas as respostas, `Date.now` simulou o relógio, e `global.fetch` foi bloqueado. **Zero tentativas de rede.** A prova completou em aproximadamente 0,88 segundo.

Resultados: [JSON completo](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/prova-detalhes-offline-20261028/execucao-1793219020271/resultado.json) e [log](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/prova-detalhes-offline-20261028/execucao.log). Cada repetição cria outra pasta `execucao-*`.

## Condições verificadas

| Condição desejada | Observação no código atual | Conclusão |
| --- | --- | --- |
| Detalhar somente duas referências, sem catálogo | As duas concluíram; nenhuma consulta de descoberta ocorreu. | Suportado. |
| Reutilizar contratos e compra já certificados | `snapshotAnterior` não foi importado: houve três consultas de contratos — duas páginas e conferência — e nova consulta da compra já concluída na fixture. | Não atendido. |
| Manter cinco atas concluídas | A origem de fixture e todos os seus artefatos permaneceram idênticos. No destino, as cinco referências não selecionadas ficaram pendentes; zero estados concluídos foram importados. | Preservação atendida. A prova não demonstra uma consolidação que referencie os estados anteriores, mas a ausência no destino não prova perda nem impõe copiá-los. |
| Retomar resultados faltantes após orçamento | Com duas chamadas por rodada, concluiu em 11 rodadas simuladas; seis resultados foram consultados uma vez cada. Houve nove consultas de itens, incluindo reconferências. | Suportado dentro da validade global; não significa zero releituras de validação. |
| Recusar compra parcial vencida sem invalidar outras | O modo não criou `snapshot` por compra. Após avançar sete horas, recusou o checkpoint inteiro com `Checkpoint antigo; use pasta nova.`, sem chamadas e sem alterar o manifesto da fixture. | Não demonstra a guarda independente por compra; requisito não atendido. |

O runner de testes informou **quatro testes aprovados, zero falhas**: um teste de contexto e três casos. Esses testes afirmam o comportamento observado, inclusive as limitações esperadas. **Esse resultado não aprova a funcionalidade completa nem representa testes de aceitação dos requisitos ausentes passando.** Nenhum teste permanentemente falho foi inserido no gate.

## Preservação e menor ajuste futuro comprovadamente necessário

Os hashes de **249 arquivos reais** foram comparados antes e depois: 242 artefatos do inventário e sete arquivos de controle, código e logs. Todos permaneceram idênticos. O JSON registra os dois inventários completos. Manifesto real: `09416da77e0ddcfffe05e922ab9339089cf04d40df45d933f9a6aae57fcf0d23`; core: `c5af81ca893d0c6a2d5c8e8080b1c0aaabf6ba93732e5f3adefdecdcb686d8c1`; testes de produção: `46e82a6b061c811fd0788cbf60a4b6d08cce7f04d24a4a715d7c35115f636fcb`; runner: `8f3a338441188b9b8b34983f099ba012617c9b1867bfca1dc95954b578e91d6c`.

A causa está delimitada: `modoRetomavel` só contempla histórico ou catálogo, controlando a importação e os snapshots por compra. A combinação já recebida pela função, `ataIds` com `snapshotAnterior`, permanece no modo comum. O menor ajuste futuro a avaliar é reconhecer essa combinação como detalhes retomáveis com origem explicitamente validada, reutilizando `importarCertificados` e `buscarNoSnapshot`, sem acionar descoberta e sem liberar catálogo incompleto. Depois, a mesma prova deve exigir reutilização verificável dos certificados, preservação e referência às cinco concluídas — na origem ou no destino, sem impor cópia desnecessária —, nenhuma reconsulta de conteúdo já certificado e recusa por compra parcial vencida. **Esse ajuste não foi implementado, e nenhuma execução real está liberada por este relatório.** A estratégia do catálogo mutável permanece fora desta prova.

Revisão independente somente leitura aprovou o uso como diagnóstico, sem P1/P2, mantendo essas ressalvas. O bloqueio de `fetch` e os mocks pertencem ao processo isolado do harness; não validam operação real. Os quatro testes aprovados incluem um teste contêiner e três cenários. A revisão não repetiu a execução nem fez chamadas externas.
