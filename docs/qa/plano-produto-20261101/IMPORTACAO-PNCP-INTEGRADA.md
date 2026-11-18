# Importação PNCP integrada — estado local

01/11/2026. Handler `importar-item-pncp.js` e ação real de `processos.html` integrados. Nova entrada explícita no roteador Cloudflare; nenhuma publicação. Feature gate `IMPORTACAO_PNCP_LOCAL=1` permanece necessária e não foi ativada. Chave de serviço vem do mecanismo de ambiente já usado pela persistência; nenhum segredo foi lido ou criado neste trabalho.

Percurso: operador seleciona item na lista pública existente → tela envia somente empresa/processo/número → servidor autentica e autoriza → deriva referência candidata do processo → reserva cadência global7s por RPC → GET em origem fixa PNCP de item individual → valida número, descrição, quantidade representável e unidade → RPC transacional cria UUID interno e origem/snapshot ou observa alteração → lista do processo é recarregada e o kit usa esse UUID normalmente. Cadastro manual permanece; colisão com número manual exige revisão, nunca é ligada silenciosamente.

`supabase/importacao_item_pncp.sql` PREPARADO/NÃO APLICADO: origem, observações por hash e cadência; RLS de leitura de origem; RPCs de escrita exclusivas service_role com revalidação do usuário/empresa/processo. Retificação não sobrescreve oferta, marca/modelo, texto ou quantidade existentes. Kit, sob mesmo gate, consulta estado da origem com contagem exata antes de preparar/revisar/exportar e bloqueia alteração. Não há ação automática de aceitar retificação neste incremento: permanece pendência a resolver com revisão dedicada. Reserva de7s cobre este fluxo, não afirma coordenar outros coletores PNCP já existentes.

Limites: fonte é item PNCP observado nessa URL, não comprovação da compra no Compras.gov ou catálogo completo. Número do item nunca vira IDportal. Hash representa integridade da observação, não assinatura do PNCP. Uma resposta pode ser reordenada pelo serviço e gerar observação nova, de forma conservadora. Cadência/migração/idempotência real ainda requerem ensaioSQL isolado. Timeout10s, respostaPNCP128KiB, requisição do cliente2KiB. Sem preço estimado convertido em oferta.

Testes locais (fetch/RPC fictícios):5 casos importação incluindo callback real extraído da tela (seletores→handler→refresh, texto forjado do navegador ignorado);5 casos escala/helper incluindo bloqueio fontealterada. Todos10 passaram. Script inline de processos foi parseado sem erro. Teste de callback não equivale a UX completa headless nem prova de transação real.

Fonte pública oficial consultada, sem API de dados: https://pncp.gov.br/manual/pt-br/2.5/contratacao/consultar_item_de_uma_contratacao.html confirma GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens/{numeroItem}. Contrato de `pncp-itens.js` permaneceu intacto. Nenhuma mudança em auth/resumo/e-mail/boletim/templates.

Arquivos: novo handler/teste/plano/SQL; processos.html; router import+allowlist; helper do kit e chamada de verificação antes de operação de revisão/exportação. QA harness de outros agentes não alterado. Revisão independente solicitada.

## Contrato para QA (sem editar harness)

Rota nova POST `/api/importar-item-pncp`, body somente `{empresaId,processoId,numeroItem}`; gate `IMPORTACAO_PNCP_LOCAL=1` e credencial de persistência existentes devem ser fornecidos apenas em configuração isolada revisada. Reuso de `_auth`/contexto significa que destino real ainda herda configuração atual desses helpers; **não ativar no deploy de homologação até confirmar coerência auth/dados**.

Mocks necessários: leitura membros com usuario_id/org/empresa/papel; processo com id/empresa/org/url_origem/origem_externa_id/numero. RPC `reservar_importacao_pncp` boolean; GET PNCP individual numeroItem/descricao/quantidade/unidadeMedida; RPC `gravar_importacao_pncp` resultado `{itemId,estado,hash,observadoEm}`. Projeção normalizada do item é numero/descricao/quantidade textual/unidade; preçoestimado não vira oferta. Nova tabela de leitura `operacao_origens_pncp` no kit: filtros organização/processo/item_id in IDsselecionados, select item_id/organizacao_id/processo_id/estado, limit50, Prefer count=exact e headers Content-Range/Preference-Applied obrigatórios. Gate desligado preserva queries anteriores do kit.

Ensaio SQL `supabase/testar_importacao_pncp.sql` preparado e NÃOEXECUTADO: cria empresas/processos fictícios com emails obrigatórios, verifica idempotência, histórico da fonte, preservação de descrição/quantidade/oferta/marca/modelo, colisão manual, usuário estrangeiro, ACL e reserva7s; rollback ao final. Não equivale a teste RLS/HTTP e precisa revisão antes de executar.

Negativos ampliados: origem não oficial/processo estrangeiro, objeto do cliente, item/compra divergente, quantidade4casas, HTTP503, redirect, timeoutabort e resposta>128KiB; nenhum persiste. Retificação relata pendência sem escrever campos de oferta.8/8 testes handler passaram; sem chamadas reais. Revisor independente ainda está avaliando artefatos.

## Correções da revisão independente

Colisão agora distingue tipo: lote manual98 não bloqueia itemPNCP98. Item manual de mesmo número continua recusado. Para essa colisão conhecida, RPC retorna estado `colisao_manual` somente depois de validar escopo, sem gravar nada; handler traduz em409 com orientação fixa. Não foi criado outro transporte RPC ou configuração de destino. Outras falhas409 no helper compartilhado ainda podem virar503 genérico — limitação explícita, sem expor detalhesSQL.

Abertura de peça revisada também consulta origem antes de declarar revisão vigente: retificação/indisponibilidade devolve false e aviso preservando rascunho.9/9 testes importação e16/16 endpointkit passaram após ajustes. EnsaioSQL atualizado lote/item e colisão; continua NÃOEXECUTADO.
