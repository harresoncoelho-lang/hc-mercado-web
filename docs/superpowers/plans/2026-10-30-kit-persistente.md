# Documentos persistentes por CNPJ — plano de implementação

> **For agentic workers:** Use superpowers:subagent-driven-development. Executar sem commit/publicação; especialistas com propriedade exclusiva de arquivos e revisão independente.

**Goal:** Salvar, reabrir, revisar e exportar declarações/propostas do mesmo processo, sem perder o trabalho ou misturar empresas.

**Architecture:** Reutilizar o módulo montado em processos.html e o contrato de geração DOCX existente. Acrescentar peças versionadas no banco, escrita por RPC restrita e revisão vinculada ao usuário/conteúdo. O mesmo Design System privado do Claude representa os estados e comportamento; a implementação local usa os contratos reais.

**Tech Stack:** JavaScript/CommonJS, HTML/CSS, PostgreSQL/RLS e harnesses locais existentes; nenhuma dependência nova.

**Spec:** Pedidos do usuário nesta conversa, realinhamento de 30/10 e autorização para avançar; docs/qa/retomada-design-ai-studio-20261030.md descreve base e limites.

## Global Constraints

- Worktree existente local/design-modulo-um-20261026, HEAD f76be11182107c8261ebb8d890555cf1852b7f6a, alterações anteriores preservadas.
- Não publicar, fazer importação/migração remota, SMTP, retomar PNCP, acessar CNPJ Proprio ou alterar resumo/e-mail/robô/auth/modelos.
- Trabalho visual no mesmo Design System privado 2c37c3c7-4bb3-474d-85e2-24267a3e1435, paleta azul claro/escuro. Não criar outro catálogo.
- Preservar gerador DOCX, hash legado com userId, validação de identificação e cálculo monetário. Autorização sempre no servidor, não por hash do protótipo.
- Rascunhos não ficam em localStorage. Revisão de uma peça não aprova outra. Prévia integral visível antes de confirmar.
- Nova fatia: declaração/proposta e DOCX individual persistentes. Timbrado/logo, biblioteca, preço assistido, pacote ZIP e IA produtiva continuam contratos posteriores, sem alegação de integração.
- Contas/modelos/autenticação nativos preservados; agentes herdam modelo da sessão. Não habilitar billing/proxies/chaves.

## Review Focus

- Respostas tardias depois de trocar CNPJ, processo ou usuário não alteram a nova tela.
- Outra aba não sobrescreve uma versão mais nova; falha de salvamento conserva campos locais e nunca mostra sucesso.
- Repetir criação após timeout não duplica documento; usar UUID estável por intenção.
- Alteração de dados/fontes/itens ou revisão de outro usuário bloqueia exportação antiga.
- IDs de organização/empresa/processo e revisor não podem ser forjados; escrita direta authenticated/anon proibida.

## T1 — Backend e persistência

**Files:** supabase/kit_documentos.sql (novo), netlify/functions/_kit_documentos_persistencia.js (novo), netlify/functions/kit-documentos.js, netlify/functions/__tests__/kit-documentos.test.js, testes novos específicos em scripts/kit_documentos_persistencia.test.js e docs/qa/testar-kit-persistencia-local.cjs.
**Depends-on:** none.
**Resources:** somente testes unitários/PGlite local; sem porta fixa ou rede. Relatório em .superpowers/sdd/2026-10-30-kit-persistente/t1-report.md.

Tabela operacao_kit_documentos: UUID por peça, organização/empresa/processo/tipo imutáveis, dados JSON permitidos, versão, autores/datas, revisão/hash/prévia e revisor/data. FK composta garante processo pertencente à empresa e organização. SELECT com RLS; nenhum INSERT/UPDATE/DELETE para anon/authenticated. RPCs somente service_role, com verificação de cliente aprovado, empresa ativa e membro gestor/operador no escopo, search_path seguro e controle de versão atômico. Sem DELETE.

Contrato adicional em /api/kit-documentos, sempre com empresaId/processoId:
- listar retorna {documentos:[metadados]}.
- abrir recebe documentoId e retorna {documento:{id,tipo,dados,versao,...}, revisaoVigente}; revisão registrada é informação, não autoriza download da UI recém-aberta.
- salvar recebe documentoId UUID estável, versaoEsperada (0 novo), tipo e declaracao/proposta; retorna {documento:{id,tipo,dados,versao,...}}. Validar estrutura/limites mesmo incompleto, sem aceitar identidade/preços/revisor enviados. Nova gravação limpa revisão. Repetição idêntica da criação já concluída retorna a peça original, sem duplicação; conflitos retornam409.
- preparar com documentoId/versaoEsperada carrega somente payload persistido, recompõe e retorna previa/revisaoHash. Preservar preparar sem documentoId para compatibilidade.
- confirmarRevisao recebe documentoId/versaoEsperada/revisado:true/revisaoHash; recompõe, compara e grava revisão atomicamente; retorna documento atualizado.
- exportar com documentoId/versaoEsperada exige revisão persistida válida pelo usuário atual e recomposição atual igual ao hash; retorna DOCX existente. Preservar exportação legada.

O autor da revisão permanece parte do hash: outro operador precisa preparar e confirmar a própria revisão. Abrir não habilita exportação automaticamente. Rascunho incompleto pode ser salvo; não pode gerar/revisar/exportar. Erros de conflito409 não devem virar503 pelo helper REST compartilhado; não alterar esse helper global.

- [ ] RED: salvar/reabrir, várias peças, criação idempotente, conflito, isolamento, leitor/pendente e escrita direta; alteração de fonte, usuário, preço e perfil bloqueia exportação antiga.
- [ ] Implementar migração idempotente e extensão compatível do handler.
- [ ] GREEN: testes focados e SQL local aplicado duas vezes; comandos/saídas preservados. Documentar interface exata para T3.
- [ ] Revisão independente de contratos, SQL/RLS e JS; corrigir achados antes da integração.

## T2 — Estados no Design System nativo

**Files:** apenas KitProposta/preview.html e README do mesmo catálogo, gerador próprio e testes correspondentes no Claude.
**Depends-on:** none; contrato visual acima fixado.
**Resources:** Claude nativo exclusivo da coordenação, fixtures sem dados reais. Sem conexão com backend/produção.

- [ ] Registrar baseline; proteger ResumoCompleto, SummaryFull, JornadaIntegrada, BoletimOportunidades, InteligenciaHub, tokens.json e design-system.json.
- [ ] Representar documentos salvos por contexto, versão, edição não salva, salvar/abrir, prévia integral e confirmação, falha de salvar e conflito sem perda do conteúdo.
- [ ] Refinar só o módulo segundo tokens existentes: hierarquia, lista legível, estado e ação principal, claro/escuro, foco, 375/704/1280.
- [ ] Testar duas peças, A→B→A, cancelar/reabrir, alteração invalidando revisão, falha/conflito e teclado. Persistência de demonstração deve ser identificada no README; não apresentar TXT como DOCX produtivo.
- [ ] Salvar versão privada, baixar evidências, conferir UI e hashes. Sem novo catálogo.

## T3 — Integração UI e homologação local

**Files:** kit-documentos-ui.js, kit-documentos.css, scripts/kit_documentos_ui.test.js, docs/qa/servir-kit-documentos-local.cjs, docs/qa/verificar-kit-documentos.cjs, docs/qa/verificar-kit-processos.cjs (somente adaptação necessária), novo docs/qa/kit-persistente-20261030/.
**Depends-on:** T1 e contrato visual T2; não alterar processos.html se API montar permanecer suficiente.
**Resources:** fixtures/harness loopback exclusivo da tarefa, portas livres observadas; nenhum cliente real. Relatório t3-report.md.

Preservar montar({alvo,contexto,obterSessao,requisitar}) e fechar(). UI lista peças, cria UUID estável, salva explicitamente, reabre campos, pede prévia integral e confirmação atual. Versão esperada acompanha toda ação. Em erro/conflito conservar campos; recarregar versão do servidor exige ação explícita. Separar revisão histórica e conferência desta abertura. Edição invalida imediatamente a autorização. Contexto/sessão invalidam respostas tardias. Não incluir dados empresariais em storage do navegador.

- [ ] RED e GREEN: salvar/fechar/reabrir/recarregar, duas declarações/proposta isoladas, conflito duas abas, erro de rede, resposta tardia de salvar/abrir/revisar, usuário trocado e sessão expirada.
- [ ] Conferir DOCX pelo handler real, preview integral, teclado/foco e claro/escuro em375/704/1280.
- [ ] Rodar testes SQL/RLS locais e npm run verify; distinguir mocks, banco local e produção.
- [ ] Revisão independente, hashes protegidos e continuidade atualizada; sem commit/deploy ou afirmação de ferramenta comercial inteira pronta.

## Preflight e autorização

O usuário aprovou avançar na direção proposta e pediu agentes para acelerar. Isso autoriza implementação e decisões rotineiras locais; não exige uma nova aprovação do plano. T1 e T2 têm arquivos/recursos separados. T3 depende do contrato real de T1 e não escreve enquanto T1 estiver modificando os mesmos harnesses. Commits e ledger têm dono único (coordenação). O estado inicial contém arquivos já modificados/não rastreados; usar snapshot de trabalho, não apenas git diff contra HEAD, na revisão.
