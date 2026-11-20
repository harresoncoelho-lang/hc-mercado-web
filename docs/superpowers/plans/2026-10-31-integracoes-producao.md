# Integrações de documentos e propostas — preparação de produção

> Executar por especialistas nesta conversa, com revisão independente. Preservar o cliente/modelo/autenticação atuais; sem commit, publicação ou limpeza de evidências.

**Goal:** Deixar a integração do módulo homologado verificável e preparada localmente, com lacunas remotas identificadas sem alterar produção.

**Architecture:** Cloudflare Pages existente, handlers CommonJS atuais e mesmo Supabase de autenticação. Compilação real em destino isolado e teste local de Workers com fixtures explícitas nas saídas externas. Migração e configuração remotas ficam como passos futuros não executados.

**Tech Stack:** Node existente, Wrangler 4.151.1 e dependências já instaladas no cache, PostgreSQL/Supabase do projeto, JavaScript e SQL atuais.

**Spec:** `docs/superpowers/specs/2026-10-31-integracoes-producao-design.md`.

## Restrições globais

Sem publicação, escrita remota, SMTP, PNCP, IA externa, CNPJ Proprio, UI do desktop, Docker, instalação, nova autenticação ou mudança de modelo. Protegidos 20/20 devem permanecer iguais. Não executar o builder que remove `publico/` no worktree. Logs sem credenciais e saída privada nova. Consultas de documentação pública não recebem conteúdo privado.

## Foco da revisão

- Resposta 200 com HTML de fallback não pode contar como asset JavaScript válido.
- Autenticação e adapters precisam continuar no mesmo projeto Supabase.
- O pacote não pode incluir credenciais, evidências privadas, QA ou brutos fora da seleção publicada.
- Testes locais devem bloquear destinos externos, fechar processos e declarar explicitamente as fixtures.
- Migrações de base redefinem helpers/policies: preparar inventário e deltas, sem prescrever reaplicação cega da cadeia inteira.

## Tarefa 1 — Inventário de produção e configuração

**Arquivos:** `docs/qa/integracoes-producao-20261031/auditoria-publica.md`, `configuracao-banco.md`, `mapa-runtime.md` e evidências sanitizadas.

- [x] Conferir rotas/arquivos públicos e DNS com consultas limitadas sem sessão.
- [x] Inventariar projeto/deployments e nomes de configurações usando apenas autenticação administrativa existente ou login manual do usuário, sem imprimir valores ou iniciar OAuth pelo agente.
- [x] Mapear dependências de SQL, Storage, papéis, gates e kill switch; separar comprovado, ausente na superfície observada e não comprovado. Metadados no IAB não substituem catálogo completo nem execução futura dos gates.

## Tarefa 2 — Preparação e prova do runtime

**Arquivos novos:** `docs/qa/integracoes-producao-20261031/preparar-cloudflare.cjs`, `testar-worker.cjs`, testes focados e relatórios. Produto só poderá mudar se um defeito concreto exigir decisão explícita da coordenação.

- [x] Criar preparação que exige destino novo, utiliza o manifesto do builder existente e verifica a seleção estática; não chama sua remoção de `publico/`. Builder corrigido e revisado para excluir o histórico privado.
- [x] Verificar em teste os limites de destino/arquivos e scanner de credenciais; arquivar hashes das fontes usadas. Scanner não certifica classificação semântica de todos os dados.
- [x] Compilar Pages Functions com Wrangler instalado e os mesmos `2025-09-01`/`nodejs_compat`, sem comandos de deploy, download, login ou update. Rodada 03 revisada, 44 estáticos e Worker minificado integral.
- [x] Executar o bundle real em Miniflare instalado, com rede externa bloqueada. Rodada 04/runtime-03: 14 verificações, leitura PDF, revisão e duas exportações; somente as duas rotas novas e fixtures.
- [x] Guardar logs, tamanho bruto/comprimido, diferenças e limites; encerrar todos os processos próprios. Falhas anteriores preservadas; leitor empresarial corrigido/revisado sem alterar protegidos. Zero workerd ativo confirmado.

## Tarefa 3 — Entrega e revisão

- [x] Consolidar sequência de preparação/implantação futura e rollback em PREPARACAO.md, sem escrita remota ou promessa de comercialização já concluída.
- [x] Revisar independentemente scripts, artefatos, builder e leitor PDF; corrigir os achados no escopo e comprovar o runtime após a revisão.
- [x] Conferir 20/20 hashes e executar npm run verify após a correção real do leitor: 839 aprovados, quatro skips, zero falhas; lint zero erros/58 avisos preexistentes. Reutilizada a homologação real anterior.
- [x] Atualizar continuidade, prontidão e relatório final. Pacote final rodada-04-leitor-pdf; implantação remota continua não executada.
