# Recuperação local de contratos e atas — resultado e pendências

28/10/2026 UTC. **Janela de contratos e cinco atas selecionadas recuperadas localmente, sem publicar.** A execução só começou após a liberação explícita da origem pelo agente de oportunidades. Ao terminar, a fonte foi devolvida para a última tentativa do Paraná; não houve coletas simultâneas.

## Resultado executado

Evidência: [recuperacao-contratos-atas-evidencias.json](recuperacao-contratos-atas-evidencias.json). Respostas integrais, fila original e manifesto estão em `C:/Users/harre/AppData/Local/LicitaPlena/recuperacao-contratos-atas-20261028`, fora do repositório e de qualquer publicação.

| Verificação | Resultado |
|---|---|
| Contratos publicados na janela `20261024–20261027` | **15.348 IDs únicos, 31/31 páginas**, com até 500 registros/página |
| Contagem e consistência | Total distinto igual ao declarado; primeira página reconferida |
| Atas selecionadas | **5/5** consultadas e vinculadas às quatro compras corretas |
| Itens e resultados | **59 itens** consultados, distribuídos em 13, 1, 41 e 4 itens por compra |
| Resultados disponíveis | **19 linhas de resultado em 17 itens**; 42 itens sem resultado retornado |
| Cadência e orçamento | **110 chamadas**, concorrência 1, mínimo de 7 segundos entre tentativas; teto de 350 não atingido |
| Integridade local | **107 arquivos, 26.588.535 bytes** conferidos por SHA-256, sem novas chamadas externas |
| Processo | Código de saída 0; seleção concluída no manifesto |

Dos 42 itens sem resultados, a própria fonte informa **41 “Em andamento” e um “Fracassado”**. A rotina não fabricou vencedor nem transformou ausência de resultado em certeza sobre o desfecho. A compra de 41 itens foi consultada integralmente, ultrapassando o limite de 30 que mantinha o coletor anterior pendente. Os resultados são da compra/item; não se infere que cada vencedor esteja vinculado a todas as atas daquela compra.

As cinco atas retornaram `cancelado=false` e datas finais de vigência futuras no corte adotado. `concluida-local` significa conclusão das consultas da seleção, não publicação, homologação jurídica, recuperação de todo o histórico ou resolução do timeout do banco remoto. **459 atas históricas**, a janela de backfill e os potenciais reparos de UF descritos abaixo continuam pendentes.

## Estado confirmado

Foram preservados os metadados atuais do GitHub e o log da execução `40526185296` em `C:/Users/harre/AppData/Local/LicitaPlena/diagnostico-contratos-atas-20261028`, fora do repositório. O checkout local tinha metadados de 23/10; usar esses arquivos antigos como checkpoint esconderia pendências mais recentes.

| Conjunto | Evidência de 27/10 | Consequência |
|---|---|---|
| Contratos nacionais | Janela de publicação `20261024–20261027`; 8 de 110 páginas de 100, 800 registros novos | As páginas restantes da janela não foram coletadas naquela execução |
| Persistência de contratos | 150.497 registros hidratados; 100.324 após retenção; upsert devolveu SQL `57014` | O metadado antigo avançou apesar da falha; não comprova que os 800 novos registros estejam no banco |
| Atas | 464 referências únicas na fila, ligadas a 289 compras distintas | Repetir a leitura de itens/resultados para cada ata desperdiça chamadas quando a compra é a mesma |
| Vigência da fila de atas | 5 vigentes em 28/10, 459 já encerradas | Recuperar primeiro as cinco vigentes dá valor imediato; as demais continuam úteis como histórico |
| Backfill de atas | Janela pendente `20260803–20261004` | Processar apenas a fila de 464 não conclui a descoberta histórica dessa janela |

O código em homologação já impede avanço de checkpoint sem persistência confirmada e mantém atas incompletas na fila. Ainda há limite explícito de 30 itens no enriquecimento atual e busca apenas da primeira página de itens; executar a função original novamente não elimina essa limitação.

## Menor caminho seguro

### 1. Recuperar a janela nacional de contratos

Reutilizar `fetchComRetentativa` exportado pelo coletor. O roteiro local separado consulta `/api/consulta/v1/contratos` para a janela exata `20261024–20261027`, com **500 registros por página**, concorrência 1 e intervalo mínimo de 7 segundos incluindo retentativas. O máximo de 500 foi confirmado no [Swagger oficial de consulta](https://pncp.gov.br/api/consulta/v3/api-docs). Não chamar `main()` nem a sincronização com Supabase.

Salvar cada resposta integral e manifesto por gravação temporária seguida de rename, em pasta isolada. Rebuscar desde a página 1, pois não há cópia confiável das oito páginas daquela execução. Validar número de páginas, IDs únicos, total declarado e a primeira página novamente antes de marcar conclusão. Variação de paginação/total/IDs ou falha persistente mantém a janela pendente; guardar o progresso e parar a rodada. A cadência deve iniciar somente depois do término ou pausa coordenada da coleta de oportunidades.

A referência de 110 páginas de 100 corresponde a aproximadamente 22 páginas de 500, cerca de três minutos de espaçamento, mais conferência, latência e eventual backoff. Isso é estimativa com base no log; a quantidade atual pode mudar. Recuperar essa janela não equivale a recuperar todo o histórico de 730 dias.

### 2. Recuperar primeiro as atas vigentes da fila conhecida

Agrupar as 464 referências pelas 289 compras, preservando cada identidade de ata. Usar cache local de respostas por compra e por item; dados de uma compra nunca podem ser associados a outra. Consultar a própria ata, a compra, todas as páginas de itens e resultados de cada item, guardando as respostas integrais. O [Swagger oficial da API principal](https://pncp.gov.br/api/pncp/v3/api-docs) confirma paginação de itens e lista integral de resultados por item, sem parâmetro de página. O roteiro usa 100 itens por página, exige término, rejeita repetição e confere novamente a primeira página. Uma lista limitada sem prova de término não é cobertura integral.

O limite de 30 itens não deve ser transplantado ao roteiro de recuperação. A referência permanece pendente enquanto existir página, item ou resultado não confirmado. O enriquecimento opcional de marca no Compras.gov.br deve ter situação separada, sem transformar ausência de marca em ausência de cobertura PNCP nem inventar informação.

No conjunto completo, somente compra + primeira página de itens demandam pelo menos 578 chamadas, cerca de 68 minutos a 7 segundos. Acrescenta-se uma chamada de resultado por item e páginas adicionais, além de revalidação. Portanto, o conjunto pode exigir horas; não é correto prometer prazo antes de conhecer a quantidade de itens. As cinco atas vigentes podem ser a primeira fatia verificável, mantendo as outras 459 claramente pendentes.

As cinco atas vigentes correspondem a quatro compras distintas. O vínculo dos resultados consultados é com a compra e o item; o pacote não infere que todos esses vencedores participem de cada ata. Marca comercial não é consultada nesta recuperação.

### Inventário histórico preservado e custo ainda desconhecido

As **459 atas encerradas** da fila correspondem a **286 compras distintas**. Uma dessas compras também aparece entre as quatro vigentes; o cache da rodada vigente pode evitar sua repetição. Há até 11 atas ligadas à mesma compra. Nenhuma dessas 459 referências está sem ID de compra, e a lista completa permanece no snapshot e na cópia de origem do diretório de recuperação.

Se for adotada a mesma reconferência da ata individual usada na rodada vigente, restam no mínimo 459 consultas de ata + 285 compras + 285 primeiras páginas de itens + 285 reconferências = **1.314 chamadas**, aproximadamente **2h33 de espaçamento**, além de resultados por item, páginas adicionais, latência e retentativas. Esse número é limite inferior, não orçamento total: a quantidade de itens ainda não foi consultada. Reutilizar a referência histórica do snapshot em vez de reconferir cada ata pode reduzir chamadas, mas deve preservar sua data de origem e não alegar atualização corrente.

Outra pendência é distinta dessa fila: o log remoto informa que **26 de 524 atas antigas sem UF foram corrigidas**, deixando **498 potenciais reparos de UF**. Os IDs dessas 498 não constam no metadado disponível; dependem de leitura autorizada da base de atas ou nova descoberta pública. Não é possível certificar seu reparo a partir da fila de 464 referências.

O backfill de vigência `20260803–20261004` não possui contagem total no snapshot. Antes de uma varredura histórica nova, é necessário obter a paginação/volume da fonte, serialmente e com orçamento definido. Não será iniciado nesta homologação um percurso histórico sem dimensão conhecida. O escopo executado permanece a janela diária de contratos e as cinco atas selecionadas; histórico e reparos de UF continuam explicitamente pendentes.

### 3. Tratar descoberta histórica e sincronização separadamente

Depois da fila conhecida, a janela de descoberta de atas `20260803–20261004` ainda precisa de paginação própria. Seus resultados podem acrescentar novas pendências. Não anunciar cobertura global concluída apenas porque as 13 UFs de oportunidades ou a fila de 464 foram processadas.

A importação exige outro passo: validar os arquivos recuperados, usar upsert idempotente e confirmar a escrita antes de avançar metadados. Uma carga repetida no PostgreSQL/PostgREST local pode comprovar transformação, idempotência e persistência com o schema versionado. Pode medir lotes de 500/100 nesse ambiente, mas não demonstra por si só que o timeout `57014` remoto foi resolvido; a causa precisa de evidência do banco remoto.

## O que não depende de chave de produção

- Recuperar e validar respostas públicas do PNCP em arquivos locais.
- Conferir paginação, contagem distinta, vínculo compra/ata/item e revalidação de páginas.
- Gerar um inventário exato de concluídos, pendentes e falhas.
- Ensaiar transformação e persistência idempotente no banco fictício local.

Não é possível, sem acesso apropriado e uma etapa autorizada de sincronização, declarar que a produção recebeu os dados, que o metadado remoto está correto ou que o timeout de seu banco foi eliminado. Nenhum deploy, workflow, e-mail ou robô de boletins faz parte desse roteiro.

## Roteiro preparado

`scripts/recuperar_contratos_atas_local.js` implementa essa fatia. A saída fica fora do repositório, com respostas integrais por URL, pacotes por compra, manifesto e cópia completa da fila de origem. Hashes verificam integridade dos arquivos inclusive na retomada de uma seleção já concluída. Cada pasta pertence a uma consulta imutável de até seis horas; existe trava com PID. O orçamento padrão é 350 chamadas por execução, contando retentativas; atingir o orçamento mantém a pendência e preserva páginas.

Executar somente após a liberação da coleta de oportunidades, na raiz do worktree:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node scripts/recuperar_contratos_atas_local.js 'C:\Users\harre\AppData\Local\LicitaPlena\recuperacao-contratos-atas-20261028' 'C:\Users\harre\AppData\Local\LicitaPlena\diagnostico-contratos-atas-20261028\mercado_meta.json' 20261024 20261027 2026-10-28
```

O comando padrão seleciona somente as cinco atas vigentes do snapshot. Para uma próxima fatia histórica, usar outra pasta e o sexto argumento com uma lista explícita de IDs de atas, separada por vírgulas; nunca se inicia automaticamente a fila inteira. A janela de descoberta histórica continua fora desta fatia. Uma trava remanescente de encerramento forçado só pode ser removida após verificar que seu PID terminou, preservando todos os demais arquivos.

Os 11 testes em `scripts/recuperar_contratos_atas_local.test.js` verificam retomada, mais de 30 itens, paginação com 101 itens, cache por compra, histórico pendente, duplicações, mudança de página, resultados cruzados, orçamento no helper real, vazio contraditório, trava, seleção incorreta e integridade após conclusão. Revisão independente encerrada; ESLint/Biome desses arquivos sem erros ou avisos. Gate consolidado: 713 testes, 709 aprovados, quatro ignorados e zero falhas; lint sem erros, com 50 avisos preexistentes. Log em `verify-final-homologacao-20261028.log`.
