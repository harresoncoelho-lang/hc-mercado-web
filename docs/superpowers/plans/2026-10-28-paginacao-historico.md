# Paginação e retomada do coletor PNCP

Escopo autorizado: corrigir cortes de cobertura no coletor, mantendo orçamento de tempo, backoff, cadência, retenção e persistência antes dos checkpoints. Sem execução real do coletor, publicação, Supabase remoto, SMTP ou alterações no resumo/boletim.

Files: `scripts/atualizar_dados.js`, `scripts/atualizar_dados.test.js`.
Depends-on: nenhum. Os recuperadores locais pertencem a outros agentes e são referências de paginação/validação.

1. Registrar testes que reproduzem o limite de 20 páginas de oportunidades e 30 itens/primeira página de atas. Verificar falha antes de implementar.
2. Remover cortes e guardar progresso suficiente para a próxima execução não reiniciar indefinidamente. Escopar cursores por consulta e revalidar a primeira página/contagens antes de retomar; alteração da fonte invalida o cursor.
3. Conferir contratos nacionais e janelas de atas para a mesma causa: páginas repetidas sem avanço. Preservar o histórico acumulado e a indicação de coleta parcial.
4. Rodar testes focados de coleta, persistência e recuperadores locais. Revisão e `npm run verify` final ficam com o orquestrador após estabilizar os arquivos dos demais agentes.

Aceite: 21 ou mais páginas coletadas; ata com 31 ou mais itens e múltiplas páginas enriquecida apenas após todos os resultados; interrupção retoma progresso; fonte alterada reinicia o trecho; falha de gravação não confirma checkpoint. Nenhuma chamada real à rede nos testes.

Baseline anterior à rodada: `%TEMP%/licitaplena-paginacao-baseline-20261028/` contém os dois arquivos e o diff inicial.

## Decisões e limites

- Oportunidades: cursor por UF e data final, IDs acumulados, primeira página e contagens revalidados. A consulta de propostas muda continuamente; cursores vencem após seis horas, compatível com a recuperação horária existente.
- Contratos nacionais e janelas de atas: consulta fixa, cursor por página e reconferência da primeira página. Não expiram por relógio: a retomada após 24 horas foi testada. Mudança observável na fonte invalida o cursor. O incremental só avança a data após completar a janela.
- Complemento de contratos por UF: o teto de seis páginas permanece como lote por execução. O próximo lote começa na página seguinte após revalidar a primeira página. Novas publicações podem invalidar o cursor desse endpoint ordenado por data; o scan nacional fixo continua sendo a fonte principal do histórico.
- Atas: todas as páginas de itens, resultados pendentes retomáveis, identidade da compra e dos resultados conferida. Alteração na compra ou na primeira página reinicia o enriquecimento. O estado pesado fica no blob `dados_robo/mercado_coleta_pendente`, ligado ao checkpoint e protegido por SHA-256 canônico, tolerante à ordenação de chaves do JSONB. Falha de gravação não confirma o metadado; conclusão remove o progresso da ata.
- Custo adicional: uma reconferência da primeira página por unidade concluída e uma leitura da primeira página ao retomar. O blob cresce com os itens e resultados das atas ainda pendentes; não há cópia desse payload no metadado versionado. Nenhum fornecedor, dependência, autenticação ou agendamento foi alterado.
- A poda anterior `MAX_REGISTROS = 250000` de contratos foi preservada. Completar páginas não significa conservar todo o acervo após essa poda e a retenção configurada. O endpoint de propostas não fornece retrospectivamente editais já fechados nunca coletados.
- A revalidação detecta mudança de totais, primeira página e versão da compra, mas a fonte não oferece snapshot transacional: alteração isolada em página intermediária com contagens estáveis continua sendo uma limitação da API.

Nenhuma execução de `main`, chamada real PNCP/Supabase, SMTP, deploy, commit ou mudança de UI/boletim nesta tarefa.
