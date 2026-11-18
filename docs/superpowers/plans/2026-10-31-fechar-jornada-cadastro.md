# Fechar cadastro empresarial e preparação de homologação

> **For agentic workers:** Use superpowers:subagent-driven-development. Sem commit, deploy ou alteração remota.

**Goal:** Remover o bloqueio de cadastro fora da jornada e criar uma verificação explícita da segurança das peças salvas antes da integração em ambiente real.

**Architecture:** Reutilizar EmpresaIdentificacaoUI e o endpoint existente na Central Operacional; não duplicar identificação nem alterar a Central de Defesa. O kit oferece um caminho seguro para o cadastro e retorno ao processo. Acrescentar um verificador SQL somente leitura para a configuração do kit, executado em testes locais antes de futura aplicação em ambiente isolado.

**Tech Stack:** HTML/CSS/JavaScript existentes, Node test, Playwright headless já instalado, PostgreSQL/PGlite local. Sem dependências novas.

**Spec:** Pedidos do usuário nesta conversa: um SaaS para Empresa e Assessoria, documentos/propostas por CNPJ, Design System canônico azul claro/escuro, execução autônoma local sem publicação; plano kit-persistente e HOMOLOGACAO.md. Este incremento implementa a identificação já desenhada no catálogo, não um novo layout geral.

## Decisões e autorização

O usuário já aprovou a evolução modular, o fluxo de cadastro/documentos e execução autônoma. Reutilizar o cadastro existente é a menor solução completa; criar outro formulário duplicaria regras e acessar a Defesa continuaria interrompendo a jornada. Não é necessário repetir a aprovação de abordagem.

O ambiente Docker de homologação existe, mas o daemon está parado. Não iniciar aplicativos nativos para este trabalho. Preparar e testar localmente o que independe dele, registrando a homologação autenticada real como pendência, sem simular sua conclusão.

## Global Constraints

- Worktree local/design-modulo-um-20261026, alterações anteriores preservadas. Baseline fora do worktree.
- Não alterar resumo, e-mail, robô de boletins, autenticação, modelos, painel.html ou helpers protegidos.
- Não produção, SMTP, PNCP, CNPJ Proprio, nova cobrança/API/proxy, instalação ou desktop nativo.
- Mesmo Design System privado do Claude; não gerar outro catálogo. Persistência demonstrativa não equivale ao backend.
- Identidade só escolhida entre empresas autorizadas já carregadas. URL é navegação, nunca autorização. Sem URL arbitrária de retorno, tokens ou dados pessoais na URL/storage.
- Confirmar identificação não confirma revisão de proposta. Campos/documentos não são enviados à IA.

## Review Focus

- CNPJ A→B→A, sessão trocada e resposta tardia não escrevem nem apresentam dados em outro contexto.
- Abrir cadastro não perde silenciosamente rascunho de proposta; retorno é local e restrito a empresa/processo autorizados.
- Leitor/pendente e empresa inválida falham com segurança usando o endpoint existente.
- O formulário reutilizado preserva comportamento e textos padrão na Defesa; sua nova modalidade não mostra ação de minuta.
- Gate SQL detecta RLS desligada, policy adicional/permissiva, grants indevidos e EXECUTE público da RPC; ele não impede acesso direto se alguém já desconfigurou o banco.

## T1 — Identificação na jornada por CNPJ

**Files:** operacao.html; novo operacao-identificacao.js e CSS se necessário; empresa-identificacao-ui.js apenas opção de uso sem minuta e padrões retrocompatíveis; kit-documentos-ui.js apenas acesso seguro ao cadastro; processos.html apenas seleção/abertura de contexto de retorno se necessário; testes scripts/operacao_identificacao.test.js e harness docs/qa/jornada-cadastro-20261031/. Não escrever arquivos de T2.

**Interface:** reutilizar EmpresaIdentificacaoUI.renderizar(host,{empresaId,solicitar,ativo,atualizado,aplicar}) e /api/empresa-identificacao. Extensões opcionais devem manter defaults da Defesa. Capturar usuário/empresa e invalidar operações antes/depois de cada await; autorização continua no servidor. Reusar obterSessao e fetch de mesma origem, nunca Supabase service key no navegador.

- [x] RED: cadastro acessível fora da Defesa; CNPJ selecionado autorizado; link inválido não cai silenciosamente em outra empresa; retorno ao contexto correto; sessão e respostas tardias; leitor; salvar e atualizar identificação; fluxo de rascunho preservado.
- [x] Integrar aba Dados da empresa na Central Operacional com estado vazio/carregando/erro/repetir; cadastro aberto no acesso direto apropriado. Atalho do kit abre cadastro em aba separada com noopener ou mecanismo equivalente que preserve rascunho atual; retorno local validado sem redirecionamento aberto.
- [x] As mensagens são de cadastro/documentos, não minuta. Usar paleta existente, foco visível, labels e uso em 375/704/1280.
- [x] GREEN: unitários e navegador local sem rede externa, duas empresas, confirmação explícita, leitura/erro, A→B→A e sessão; executar regressões da UI compartilhada e do kit afetado. Sem alegar teste com banco real.
- [x] Relatório de implementação, diff da baseline, revisão independente e correções.

## T2 — Gate SQL pré-homologação do kit

**Files:** novo supabase/verificar_kit_prepublicacao.sql; docs/qa/testar-kit-persistencia-local.cjs (extensão dos casos reais locais); documentação/artefatos próprios em docs/qa/jornada-cadastro-20261031/. Não editar migração kit, auth, handler, helper ou arquivos T1.

**Interface:** SQL somente leitura, executável pelo dono da base local após kit_documentos.sql. Sucesso explícito se tabela, RLS, policy conhecida sem adicionais, grants e assinaturas/permissões das RPC/triggers exigidos estão presentes; erro útil sem dados de cliente ao divergir. Não corrigir silenciosamente nem aplicar GRANT/ALTER/DROP. Não afirmar que o gate elimina exposição direta após desconfiguração.

- [x] RED: provar lacuna da verificação atual em banco efêmero; criar assert para novo gate seguro e condições deliberadamente inseguras.
- [x] Implementar verificador com catálogo PostgreSQL existente, fail-closed e sem dependências extras.
- [x] GREEN: migração idempotente, gate baseline, RLS off, policy adicional, DML e EXECUTE indevidos, restauração somente da fixture de teste e gate novamente verde. Relatório registra limites de catalog checks.
- [x] Revisão independente da segurança, ausência de escrita no verificador e evidências.

## T3 — Consolidação da prontidão

**Files:** docs/qa/jornada-cadastro-20261031/PRONTIDAO.md e ledger desta execução.

- [x] Matriz do produto com evidência: funcional, apenas demonstrado, falta construir e integração pendente. Separar planos/assinatura, gestão da assessoria, pacote/timbrado/planilha, IA, cobertura, operações e implantação.
- [x] Regressões relevantes e gate geral uma vez após código estabilizado; 20 protegidos iguais à baseline.
- [x] Registrar impeditivo concreto de Docker parado e o roteiro real já existente, sem iniciar app nativo ou declarar homologação concluída.
- [x] Entregar resultado e próxima sequência, com limites honestos, sem prometer que resta apenas configurar chaves.
