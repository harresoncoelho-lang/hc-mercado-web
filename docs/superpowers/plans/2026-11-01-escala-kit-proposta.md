# Escala do kit de propostas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir propostas acima de 50 itens com seleção paginada, leitura completa dos itens selecionados e revisão/exportação consistentes, sob limites mensurados.

**Architecture:** Preservar o endpoint do kit, formatos do rascunho, hash de revisão, cálculos BigInt e DOCX. Acrescentar listagem paginada explícita e carregar somente seleções em lotes; política de tamanho compartilhada e migração SQL correspondente permanecem locais até homologação aprovada.

**Tech Stack:** JavaScript CommonJS/DOM existente, node:test, PostgreSQL/RPC existente, gerador DOCX já instalado. Nenhuma dependência nova.

**Spec:** `docs/qa/plano-produto-20261101/ESCALA-KIT-PROPOSTA.md`.

## Global Constraints

- Não publicar, aplicar SQL, consultar produção, enviar SMTP ou realizar propostas/lances.
- Não alterar autenticação, resumo, e-mail, boletins ou templates compartilhados.
- Mudança da lógica de proposta em `_kit_documentos.js` é escopo autorizado; registrar diff específico. Não atualizar baseline genérica para esconder alteração detectada.
- Quantidade não é ilimitada. 51, 200 e 1.000 são cenários de teste; 1.000 não é capacidade comercial certificada.
- Banco mantém autorização, isolamento e CAS/revisão; nenhuma validação é removida por eficiência.
- Worktree existente: `C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um`. Sem processos pesados ou dependências instaladas.

## Review Focus

- Cap menor do serviço retorna página curta: nunca interpretar ausência de mais dados sem metadados confiáveis.
- Item selecionado fora da página atual: não apagar seleção/unidade nem marcar ausente sem verificar seu ID.
- Texto multibyte e serialização JSONB: orçamento precisa ser explícito, não comparação incompatível entre caracteres JS e PostgreSQL.
- Alteração no lote final durante revisão/exportação: negar resultado antigo, não exportar peça parcialmente validada.
- Cenário máximo de texto não é cenário típico: rejeitar excesso com explicação antes de confirmar revisão, mantendo rascunho.

## Arquivos e responsabilidades

Modificar somente quando executar: `kit-documentos-ui.js` (estado selecionado/paginação), CSS do kit apenas se controles exigirem; `netlify/functions/kit-documentos.js` (orquestração); `_kit_documentos.js` (seleção/Map e orçamento de proposta); `_kit_documentos_persistencia.js` (limite/coerência); testes correspondentes em scripts e netlify/functions/__tests__.

Criar `_kit_proposta_limites.js` para política comum JS; `_kit_proposta_itens.js` para consultas paginadas/lotes com validação e testes próprios. Criar migração `supabase/kit_documentos_escala_proposta.sql`, sem sobrescrever a migração original. Não editar `_auth.js`, `_empresa_identificacao_contexto.js` ou gerador compartilhado: contexto existente já fornece `request` e `rest`.

## Task 1 — Fixar contrato e medir orçamento sem alterar limites ativos

- [ ] Acrescentar fixture sintética determinística reutilizável para 51/200/1.000 UUIDs, descrições típicas de 120 e 500 caracteres, unidade 8, marca/modelo 30; um caso extremo com descrição 10.000 por item. Nunca dados reais.
- [ ] Criar teste inicialmente vermelho para política de proposta independente: quantidade candidata 1.000, rascunho normalizado 524.288 bytes, envelope HTTP 786.432 bytes, prévia 1.000.000 caracteres **e** 2.000.000 bytes UTF-8. Valores são candidatos de homologação, não anúncio de plano. Declarações mantêm regras anteriores.
- [x] Definir orçamento do rascunho como bytes UTF-8 da soma dos valores normalizados (IDs, unidades, condições) mais overhead fixo conservador por item de 128 bytes, mesma fórmula JS/SQL. Esse orçamento semântico é separado do envelope; evita depender da diferença de espaços/ordem entre JSON.stringify e jsonb::text. Usar Buffer.byteLength no servidor e octet_length(convert_to(text,'UTF8')) no SQL, com fixtures equivalentes.
- [x] Medir em processo Node separado e curto a preparação/DOCX de fixtures após implementação de teste da política: elapsed, heapUsed/RSS antes/depois, bytes prévia, DOCX e base64. Sem loops de carga. Registrar resultados em `docs/qa/plano-produto-20261101/ESCALA-KIT-MEDICAO.md`.
- [ ] Gate local provisório: caso típico 1.000/120 e 1.000/500 gera íntegro em até 3 segundos e crescimento de RSS até 64 MiB; envelope e prévia dentro dos budgets. Falha exige diagnóstico/redução do candidato ou outra arquitetura, nunca elevar limite automaticamente. Passar localmente não certifica runtime Cloudflare/concor­rência; orçamento remoto precisa medição isolada posterior.

## Task 2 — Leitura paginada e seleção em lotes com escopo preservado

- [ ] Escrever testes vermelhos do helper: 101 itens/page100; cap servidor50; item estranho, duplicado, faltante no lote final; falha intermediária; conjunto vazio; UUID inválido; nenhuma query sem org/processo.
- [x] Implementar `listarPaginaItens({request, organizacaoId, processoId, afterId, limit=100})`: UUID cursor, limit1..100, order=id.asc, id=gt.cursor quando houver, filtros org/processo; solicitar limit+1 com contagem exata e conferir Content-Range/Preference-Applied. Resposta `{itens,hasMore,nextCursor}`; metadados ausentes/incoerentes ou cap abaixo do necessário => indisponível, não fim falso. Nunca offset cumulativo em coleção mutável.
- [x] Implementar `carregarItensSelecionados({rest, organizacaoId, processoId, itemIds})`: normalizar/deduplicar, lotes de até50, query id=in.(UUIDs), mesma projeção decimal como texto, filtros em todos os lotes; conferir conjunto exato e identidades antes de agregar. Uma resposta curta é erro, não remoção silenciosa. Map por ID.
- [x] Separar carregarEscopo em autorização/contexto primeiro e carga de itens conforme ação. `salvar` usa IDs enviados validados; `preparar/confirmarRevisao/exportar` de peça persistida usam IDs do documento salvo. Nunca confiar em preço/descrição do cliente. Listar/abrir peças não deve carregar todos os itens do processo sem necessidade.
- [x] Acrescentar ação `listarItens` ao endpoint existente. Preservar ações/campos anteriores. Para consulta inicial, cliente novo envia `itensPaginados:true`: mantém shape de itens e acrescenta `paginacaoItens`; cliente legado sem flag só recebe coleção quando completude for comprovada sob limite legado; acima dele retorna erro explícito de atualização, nunca lista truncada aparentemente completa.
- [x] Rodar helper e testes endpoint. Revalidar autorização em toda chamada, sem cache de carteira no navegador considerado autoridade.

## Task 3 — Seleção UI independente do DOM

- [ ] Escrever testes vermelhos de navegar página1→2→1 com seleção/unidade; abrir rascunho com ID fora da primeira página; resposta atrasada após trocar CNPJ/processo; cursor falho e recuperação; controles por teclado.
- [x] Substituir `lerCampos` baseado só em `[data-item]:checked` por Map de seleção/unidades no estado da peça. Eventos da página atual atualizam Map; `preencher` restaura Map integral; trocar contexto descarta somente após fluxo existente de mudanças não salvas.
- [ ] Usar listarItens com cursor e botão “Carregar mais”/paginação explícita; manter no máximo100 controles DOM simultâneos. Mostrar contagem selecionada e condição “mais itens disponíveis”, sem inventar total global. Voltar página usa cursores observados, não índices inferidos.
- [x] Não usar ausência na página para concluir “Item indisponível”. IDs salvos devem ser resolvidos pelo backend em lotes e somente ausências comprovadas exibidas para correção; não desmarcar automaticamente.
- [x] Manter prévia integral antes da aprovação e confirmação explícita. O limite da seleção é entregue pela política do servidor; UI nunca pode ser única barreira.
- [ ] Rodar `scripts/kit_documentos_ui.test.js` e testes novos; verificar foco, aria-busy e mensagens sem substituir HTML com conteúdo não escapado.

## Task 4 — Gerador, persistência e migração local compatíveis

- [ ] Testes vermelhos 51/200/1.000, orçamento+1, duplicata case-insensitive, BigInt, último item, total, XML escapado, ordem/hash estável e revisão antiga409.
- [x] Trocar find repetido por Map e teto50 pela política de proposta aprovada no gate; manter assinatura `preparar`, retorno `{previa,revisaoHash,titulo}`, identificação, fontes e DOCX. Não modificar ramo de declaração nem template do resumo.
- [x] Aplicar budgets calculados antes de serializar hash/DOCX e antes de RPC, com mensagem específica sobre tamanho; não cortar descrições. Manter teto existente de 1 milhão de caracteres e adicionar orçamento UTF-8. Preservar inteiro em memória nesta etapa limitada.
- [x] Alterar validação do rascunho e envelope só para proposta; testar formulário incompleto ainda salvável. IDs/unit map têm mesmo limite JS/SQL.
- [x] Escrever migração nova da RPC preservando todas as checagens atuais, grants, SECURITY DEFINER/search_path, CAS, escopo/usuário, revisão e auditoria. Substituir somente validações de quantidade/tamanho de proposta pela fórmula definida. Não aplicar.
- [x] Escrever SQL de ensaio em transação com fixtures fictícias/rollback para51/1.000/excesso, bytes, CNPJ alheio e revisão/CAS. Marcar **NÃO EXECUTADO** até existir ambiente isolado autorizado; leitura estática não equivale a teste SQL.
- [x] Rodar scripts/kit_documentos.test.js, scripts/kit_documentos_persistencia.test.js e netlify/functions/__tests__/kit-documentos.test.js. Extração ZIP deve provar primeiro/último item e número exato de itens, não apenas tamanho do arquivo.

## Task 5 — Revisão independente e gate de integração

- [x] Comparar diff dos arquivos protegidos; registrar explicitamente mudança somente em proposta e testes. Se checagem genérica reprovar `_kit_documentos.js`, apresentar motivo e evidência específica; não renovar hash de baseline para ficar verde.
- [ ] Testar composição UI/API/revisão/DOCX com servidor fictício e processo de1.000 itens, inclusive erro no último lote e troca CNPJ. Nenhum teste realiza cadastro no portal externo.
- [ ] Revisor independente verifica filtros de cada lote, prevenção de truncamento, carteira/escopo, cursor, budgets, consistência JS/SQL e versão revisada.
- [x] Emitir relatório distinguindo: testes locais passados, SQL somente preparado, medição local e pendência de homologação remota. Não anunciar pronto para vender ou 1.000 itens homologados antes de todos os gates.

## Limites deliberados e rollback

Leituras por cursor/lotes não formam snapshot transacional. Exportação continua recalculando hash e recusando divergência observada; garantia atômica exigiria snapshot persistido próprio em etapa posterior. Nenhuma coleta parcial vira documento válido. Documento muito grande mantém rascunho e recebe erro acionável; geração assíncrona/streaming/arquivos privados fica fora deste incremento.

Rollback não deve simplesmente reinstalar RPC de50 depois de salvar rascunhos maiores: isso tornaria peças existentes ineditáveis. Antes de implantação futura, manter suporte de leitura dos novos rascunhos e desativar apenas criação acima do limite por gate; planejar rollback compatível com dados e versões. Como esta tarefa entrega apenas plano, nenhum rollback operacional é necessário agora.

## Estado de execução local — 01/11/2026

As caixas marcadas registram trabalho local feito, não publicação. Tasks1–4 implementadas;32 testes locais e ensaio UI headless de200 itens passaram. Fixtures51/200/1000 geram DOCX e endpoint1000 foi exercitado com fetch fictício; medição em ESCALA-KIT-MEDICAO.md. Ensaio UI real ainda não cobre composição1000 nem teclado completo, portanto o gate amplo da Task5 continua aberto. Passos de testes que agrupam casos não integralmente exercitados permanecem desmarcados.

Revisão independente detectou e corrigiu descarte silencioso de seleção fora DOM e aviso de itens não verificados; headless repetido confirmou. SQL da migração e ensaios bytes/RPC estão somente preparados, NÃO EXECUTADOS. Ensaio RPC inclui email sintético obrigatório em clientes. Homologação SQL/RLS/CAS remota, runtime/capacidade e gate comercial continuam pendentes. Não houve renovação de baseline; comparação específica declaração/docx com snapshot histórico30/10 registrada no relatório.
