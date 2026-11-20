# Segurança, cobertura e primeiro kit documental

## Objetivo aprovado
Corrigir permissões e cobertura antes de iniciar documentos e propostas. Reutilizar cofre, processos, identificação confirmada e itens existentes. Trabalho local; a publicação e a execução de migrações remotas não fazem parte desta etapa.

## Global Constraints
- Preservar resumo do edital, seções principais abertas, conteúdo e envio do e-mail e robô de boletins; não mudar modelos, provedores, credenciais ou agendamentos.
- Não executar coletores reais, enviar mensagens, alterar produção ou acessar CNPJ Proprio.
- Manter isolamento por organização e CNPJ. Leitor consulta; proprietário e operador autorizados alteram dados do próprio escopo.
- Nenhum dado de outra empresa pode entrar em um documento. Dados ausentes devem bloquear a geração, nunca ser inventados.
- Não criar outro framework, SaaS ou cobrança. Não adicionar dependências sem necessidade comprovada.
- Usar testes de comportamento, incluindo SQL real local e falhas de persistência. Baseline: 642 passam, 4 ignorados; lint 0 erros/50 avisos.
- Worktree: C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um; base f76be11. Não fazer commits nos implementadores nem sobrescrever trabalho alheio.

## Task 1: Corrigir autorização operacional
Files: supabase/seguranca_operacao.sql (novo), docs/qa/testar-seguranca-operacao-local.cjs (novo), docs/qa/seguranca-operacao.md (novo); outros SQL existentes apenas se indispensável e comunicado.
Depends-on: none

Ler acesso_empresa_convites.sql, schema_operacional.sql e demais migrações operacionais e RPCs. Demonstrar com SQL real que leitor não pode inserir, atualizar ou excluir empresas/documentos/processos/contratos/itens nem objetos privados. Preservar consulta e escrita legítima do operador/proprietário. Fechar escopo cruzado entre organização e empresa, inclusive referências processo/documento. Auditar mutações SECURITY DEFINER e grants relevantes: corrigir bypass comprovado com o menor patch compatível. Migração incremental, idempotente, transacional e sem apagar dados. Não mexer na geração de resumo nem no robô.

Usar PGlite instalado em C:/Users/harre/AppData/Local/LicitaPlena/qa-postgres/node_modules/@electric-sql/pglite e padrão docs/qa/testar-decisao-local.cjs. Escrever primeiro casos de regressão, provar RED contra SQL atual e GREEN após migração, incluindo leitor, operador, proprietário, anônimo, outra empresa/organização, rejeição de referência cruzada e repetição da migração. Documentar ordem de aplicação, efeitos e limitações. Se achados exigirem arquivos fora do escopo, perguntar ao controlador antes de editar.

## Task 2: Corrigir checkpoints e cobertura de coleta
Files: scripts/atualizar_dados.js, scripts/atualizar_dados.test.js, scripts/supabase_dados.js, scripts/supabase_dados.test.js (se necessário), docs/qa/cobertura-persistencia.md (novo); integração: .github/workflows/atualizar-dados.yml e teste/helper de staging estritamente necessários.
Depends-on: none

Rastrear chamadas e reproduzir erro de persistência. Checkpoint/cursor e metadados de sucesso só podem avançar após gravação confirmada. Em timeout/falha parcial, preservar base anterior e cursor recuperável; execução deve sinalizar erro, não sucesso verde. UFs não concluídas continuam pendentes e cobertura não pode alegar total sem evidência. Reutilizar helpers atuais e não mexer no agendamento, boletim, email ou políticas de retenção sem necessidade. Verificar também caminhos de contratos e oportunidades.

TDD com rede/DB simulados nas fronteiras: sucesso, timeout no upsert, falha após lote parcial, falha de metadados, recuperação/repetição e UFs pendentes. Não executar coletor real. Rodar testes focados e relatar verificação completa. Documentar comportamento e o que ainda depende de dados remotos reais.

Integração confirmada durante a revisão: código de erro não pode impedir a persistência dos checkpoints locais já confirmados. Executar publicação final também após coleta incompleta, mantendo job em falha; nesse caminho adicionar somente os metadados exatos de contratos/mercado. Nunca publicar temporários ou base bruta/privada. No sucesso preservar publicação anterior. Não publicar se coleta não iniciou ou job foi cancelado. Testar seleção real de arquivos em repositório temporário local; preservar cron e credenciais.

## Task 3: Backend de documentos e propostas
Files: netlify/functions/kit-documentos.js, netlify/functions/_kit_documentos.js, netlify/functions/_empresa_identificacao_contexto.js, netlify/functions/empresa-identificacao.js (extração compatível), netlify/functions/gerar-checklist.js (exportação mínima), functions/api/[nome].js, testes correspondentes em netlify/functions/__tests__/ e scripts/kit_documentos.test.js, docs/qa/kit-documentos-backend.md.
Depends-on: 1, 2

Implementar exatamente o contrato em docs/superpowers/plans/2026-10-27-kit-contrato.md. Ler mapa-kit.md na pasta SDD como orientação, decisões pendentes já resolvidas no contrato. Identidade/proveniência validada deve ser compartilhada com fluxo existente sem duplicação nem chamada de handler como biblioteca. Menor extração possível. Autorização explícita por papel, empresa/processo/itens no servidor. Geração da declaração parametrizada e proposta com decimal exato, hash de revisão, exportação DOCX. Sem migração nova para kit nem persistência de rascunhos. Não tocar UI (Task4), SQL (Task1), coleta (Task2) ou resumo/e-mail/boletim.

TDD de sessão, papel, CNPJ cruzado, referências divergentes, gate/identificação inválida, hash alterado, decimais e overflow, XML e variáveis desconhecidas, DOCX, checklist/minuta legado. Ler contrato antes de perguntar ambiguidades. Relatar evidência e fronteiras não testadas.

## Task 4: Fluxo visual de documentos e propostas
Files: kit-documentos-ui.js, processos.html, kit-documentos.css (somente se necessário), scripts/kit_documentos_ui.test.js, docs/qa/kit-documentos-preview.html, docs/qa/servir-kit-documentos-local.cjs, docs/qa/verificar-kit-documentos.cjs, docs/qa/kit-documentos-ui.md e imagens/fixtures locais do kit.
Depends-on: 1, 2

Implementar o contrato fixado em docs/superpowers/plans/2026-10-27-kit-contrato.md. Pode trabalhar em paralelo com backend porque interface está definida, arquivos disjuntos; avisar controlador se interface mudar. Integrar no dossiê real de processos, usando sessão e contexto de empresa/proceso ativos. Não editar o acompanhamento nem resumo. API retorna a prévia e DOCX; UI não calcula preço nem fabrica identidade. Testes de ações, pendências e revisão invalidada, teclado, resposta tardia após troca A→B→A/fechamento. Criar demonstração local com dados fictícios explícitos, reutilizando componente real e endpoints locais sem rede externa. Mostrar temas claro/escuro e descarga DOCX. Não reutilizar credenciais de produção. Todos scripts/servidores devem limitar acesso a localhost e arquivos autorizados; nenhum servidor genérico de diretório privado.

## Task 5: Integração e comprovação
Files: docs/qa/seguranca-cobertura-kit-relatorio.md (novo); ajustes somente nos arquivos anteriores.
Depends-on: 1, 2, 3, 4

Revisão independente por tarefa (especificação e qualidade). Rodar npm run verify, build público, SQL local e testes críticos do resumo/email/boletim. Registrar arquivos, comandos, resultados, riscos e etapas de homologação. Conferir diff para garantir que robô, modelos e corpo do resumo não mudaram. Mostrar demonstração fictícia explicitamente. Nenhuma afirmação de segurança/cobertura de produção sem verificação remota.
