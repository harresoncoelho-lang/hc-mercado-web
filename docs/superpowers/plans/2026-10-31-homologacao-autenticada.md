# Homologação autenticada de documentos e propostas

**Goal:** Verificar a jornada existente com PostgreSQL, GoTrue, PostgREST e Storage reais no ambiente local de teste, sem publicação nem alteração de produto protegido.

**Architecture:** Reutilizar Compose `licitaplena-qa-real`, banco `licitaplena_qa_ui_v2`, servidor HTTP local que redireciona somente os destinos autorizados para loopback e harnesses já existentes. Ampliar apenas a prova de peças persistidas e cadastro integrado. Dados fictícios segregados; preservar conteúdo preexistente e volumes.

**Tech Stack:** Versões instaladas de Docker/Supabase, Node, Playwright headless, testes SQL. Sem instalação, pull, billing, serviço remoto ou alteração do cliente/modelo/autenticação do usuário.

**Spec:** Pedido atual do usuário; `docs/qa/jornada-cadastro-20261031/PRONTIDAO.md`, `docs/qa/HOMOLOGACAO-KIT-REAL.md` e plano do kit persistente.

## Restrições e decisões

- Sem produção, publicação, SMTP, PNCP, CNPJ Proprio, edição de resumo/e-mail/boletins/auth/modelos ou controle de mouse/teclado/desktop.
- Reutilizar worktree existente; sem commit/merge/cleanup. Baseline/hash dos protegidos antes/depois.
- Serviços só em 127.0.0.1. Sem recriar/atualizar imagens ou volumes; backup antes de migração local. Verificar identidade do banco e bindings antes de escrever.
- Credenciais locais somente em memória/arquivos privados fora do repositório; não imprimir tokens/senhas. Renovação de JWT exclusivamente do ambiente fictício com mesmo segredo/papéis e prazo limitado, se expirar.
- O CLI `docker desktop start --detach` abriu um painel inesperado; foi encerrado sem iniciar containers. O help do backend também continuou inicializando e foi interrompido. A opção instalada `-with-frontend=false` permite tentar somente backend, com logs privados e processo oculto. Verificar ausência de janelas antes de prosseguir; parar ao não conseguir preservar esse requisito. Não alterar preferências do Docker.
- Encerrar somente processos/containers iniciados nesta rodada ao terminar, preservar volumes. Não parar serviços alheios.

## Etapas e critérios

- [x] Preflight de serviços reais e identidade local, backup verificável, configuração/policies; aplicar `kit_documentos.sql` somente no banco de teste e executar `verificar_kit_prepublicacao.sql` com ON_ERROR_STOP.
- [x] Login por GoTrue real e usuários fictícios separados: gestor, leitor, pendente, operador restrito e outra organização. Provar isolamento no handler e em REST/RLS/RPC diretos.
- [x] Salvar/listar/abrir peças por empresa e processo; reabrir via outra sessão HTTP; versões/conflitos; alterar prévia/dados invalida revisão; confirmação explícita antes de DOCX; documento contém somente CNPJ/itens selecionados.
- [x] Identificação manual e por documento do Storage real; origem/hash/alterações. Preservar suíte legada útil. Interface real com SDK e tokens do Auth real, sem mocks de persistência/autorização.
- [x] Rever evidências, limpar apenas fixtures criadas por esta execução e conferir integridade/contagens preexistentes. SQL gate separado do gate Node.
- [x] Relatório com resultados, comandos reproduzíveis, limites e mapa exato de dados locais/serviços preservados. Revisão independente antes de declarar homologação aprovada.

## Limites da aprovação

Schema local reconstruído não é clone autoritativo de produção. A homologação pode aprovar os cenários verificados; não certifica configuração remota, capacidade de produção, cobrança, planos ou cobertura PNCP. Nenhum sucesso local autoriza publicar.

