# Cobertura e persistência do coletor

O coletor confirma os dados antes de avançar seus checkpoints. Contratos e atas fazem upsert antes de publicar o JSON local e seus metadados; oportunidades fazem upsert antes de salvar `oportunidades_meta` no Supabase e publicar o JSON local. Escritas locais da execução usam arquivo temporário e rename para não truncar o checkpoint anterior em falha de disco.

Falha de leitura da base anterior, timeout, falha de lote, poda ou gravação de metadados propaga erro e impede sucesso verde. Requisições REST têm prazo de 30 segundos. Lotes já confirmados permanecem no banco; não existe rollback distribuído entre lotes. O checkpoint anterior permite repetir os upserts pelas mesmas chaves, sem duplicação. A revisão posterior da retenção de oportunidades está descrita abaixo; contratos e atas mantêm sua política anterior.

Uma página nacional perdida torna contratos parciais; a janela anterior é repetida (na primeira execução, o início seguro da janela). A complementação por UF só marca conclusão após chegar ao fim da busca e obter os detalhes dos contratos; orçamento esgotado, limite de páginas ou falha de detalhe deixam a UF pendente em `ufsComFalha`.

Oportunidades só atualizam `coberturaPorUf` após todas as páginas da UF: chegar ao teto de 20 páginas com páginas restantes não confirma cobertura. UFs não tentadas, com timeout ou incompletas continuam pendentes. A cobertura confirmada anteriormente continua disponível. Recuperação sem pendências não regrava metadados nem reenvia a base.

Progresso parcial válido pode ser persistido com pendências explícitas. Ao fim da rodada, qualquer fase incompleta causa erro; o log final de sucesso só aparece sem pendências. Falha de persistência aborta imediatamente. Agendamentos, boletim, e-mail, credenciais e modelos não foram alterados.

## Verificação local

`node --test scripts/atualizar_dados.test.js scripts/supabase_dados.test.js`

Os testes usam VM com rede, arquivos e banco simulados nas fronteiras. Cobrem ordenação de gravação, timeout, segundo lote com falha, repetição idempotente, falha de metadado remoto/local, hidratação interrompida, janela nacional incompleta e UFs pendentes. Não executam o coletor real.

## Limites

Os testes não comprovam nem recompõem cobertura remota. Dados históricos perdidos em execuções antigas dependem de reconsulta autorizada à fonte. Com a paginação limitada, uma UF com mais de 20 páginas permanece pendente; não foi criado novo algoritmo de paginação. O banco pode conter lotes novos ao lado da base anterior após falha parcial, mas o checkpoint não confirma a rodada incompleta. Falha após gravação remota de metadados e antes da publicação local exige nova hidratação, que lê o estado remoto já confirmado. Execuções concorrentes não foram adicionadas nem coordenadas por este patch.

A etapa seguinte adicionou uma recuperação **local separada**, com páginas persistidas e retomada sem teto de 20 páginas. Ela não altera o coletor publicado nem seus checkpoints remotos. Procedimento, evidências e limites: [recuperacao-cobertura-local.md](recuperacao-cobertura-local.md).

## Editais antigos ainda abertos

A recuperação encontrou oportunidades que continuam abertas apesar de publicadas há mais de 120 dias. O filtro anterior usava a publicação como referência e podia eliminá-las da memória e do banco. A versão em homologação só remove oportunidades com **encerramento comprovado anterior a 120 dias**. Publicação antiga, encerramento recente/futuro e encerramento desconhecido não provocam poda.

A mesma data civil `YYYY-MM-DD` é usada em memória e na coluna `encerramento` do Supabase. Datas inválidas ficam como `null` nessa coluna, mantendo o valor original no JSON `dado` para diagnóstico. O DELETE usa `encerramento < limite`, que preserva os valores null. A coluna já possui índice no schema existente. Os testes verificam oportunidades vindas do cache e do PNCP, antigas abertas, antigas encerradas, recentes encerradas, desconhecidas e a fronteira dos 120 dias. Nenhum DELETE remoto foi executado na homologação.

## Atas incompletas

Enriquecimento só confirma `enriquecida` e `situacaoColetada` após consultar itens e resultados de todos os itens elegíveis da ata. Falha de consulta, resposta inválida, falta de orçamento, resposta que indica páginas restantes ou mais de 30 itens deixam a referência na `filaPendente`; a rodada permanece parcial. Lista vazia recebida com sucesso continua distinta de falha de rede. O teto de 30 itens foi preservado: atas maiores continuam pendentes até uma implementação autorizada de paginação retomável; este patch não afirma cobri-las nem descarta essa pendência.

## Publicação dos checkpoints entre runners

O workflow identifica a coleta por `id: coleta`. A publicação final executa após sucesso ou falha dessa coleta, desde que não haja cancelamento; não executa se a coleta foi ignorada/não iniciou. Se a coleta falhar, `preparar_commit_dados.js` adiciona somente `data/contratos_meta.json` e `data/mercado_meta.json` por caminhos exatos. Como esses arquivos só são publicados por rename após persistência confirmada, progresso parcial seguro sobrevive ao runner. Arquivos `.tmp`, bases brutas e privadas ficam fora dessa publicação de falha. Se o upsert falha, o checkpoint anterior não muda e não há avanço para adicionar. No sucesso, permanece o staging anterior de `data/` com exclusão de empresas/fornecedores. Commit/push existentes são reaproveitados; a falha da coleta permanece no resultado do job. Cancelamento ou término forçado ainda podem perder metadados locais.
