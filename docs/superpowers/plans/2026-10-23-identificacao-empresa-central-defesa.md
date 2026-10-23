# Identificação privada da empresa na Central de Defesa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Status:** aprovado, implementado e homologado LOCALMENTE; sem publicação em produção.

**Goal:** Reusar anexos privados por empresa e confirmar identificação complementar para minutas, sem enviar dados à IA.

**Architecture:** Uma rota autenticada reaproveita Storage/documentos atuais com JWT e RLS. Uma tabela de perfil confirmado é escrita exclusivamente pelo backend através de RPC restrita; cadastro canônico não é sobrescrito. Confirmação e extração são independentes: arquivo ilegível ou grande pode permanecer anexado e seguir com dados manuais.

**Tech Stack:** JavaScript existente, pdf-parse instalado, Supabase Postgres/Storage e SQL idempotente local.

**Spec:** `docs/superpowers/specs/2026-10-23-identificacao-empresa-central-defesa-design.md`

## Global Constraints

- Somente candidate-empresa-local e banco local; sem produção, publicação, IA real, modelos, e-mails ou serviços de CNPJ.
- Bucket privado existente; sem chave de serviço no navegador; nenhuma alteração de autenticação atual.
- Razão social/CNPJ canônicos; divergência exige conferência, nunca sobrescrita silenciosa.
- Upload PDF até 4 MiB; extração nativa até 2 MiB e 8 páginas; ilegível/limite retorna modo manual sem apagar anexo.
- CPF não é campo do perfil nem sugestão de extração.
- Não modificar painel/defesa-ui/defesa-licitante nesta tarefa.

## Review Focus

- Usuário/empresa sem acesso: não listar, baixar, anexar ou confirmar.
- Mesmo usuário com duas empresas: impedir caminho/documento/perfil cruzados.
- Arquivo alterado/excluído fora da Central: invalidar confirmação e recusar hash antigo.
- PDF malicioso, protegido, escaneado ou extenso: limitar antes do parser; não chamar OCR/IA nem liberar falso resultado completo.
- Confirmação direta no REST/RPC: authenticated não escreve perfil nem falsifica usuário/hash verificado.

### Task 1: Migração e contrato autenticado

**Files:** Create `supabase/identificacao_empresa.sql`, `netlify/functions/empresa-identificacao.js`, `netlify/functions/_empresa_identificacao.js`; modify only route registration in `functions/api/[nome].js`.

- [x] Criar testes negativos da API antes do código.
- [x] Implementar ações `consultar`, `anexar`, `extrair`, `confirmar` em POST com empresaId.
- [x] Validar login aprovado e migração/políticas seguras antes de acessar documentos.
- [x] Ler empresa/documentos/arquivo com JWT do usuário; gravar confirmação por RPC restrita ao service_role no backend.
- [x] Reverter apenas objeto recém-criado se registro do anexo falhar.

### Task 2: Extração e confirmação determinísticas

**Files:** Create `netlify/functions/_empresa_documentos.js`, `netlify/functions/__tests__/empresa-identificacao.test.js`, `netlify/functions/__tests__/empresa-documentos.test.js`.

- [x] Testar PDF nativo fictício, limite de tamanho, leitura ilegível, divergência cadastral e confirmação manual; limite de páginas mantido no extrator.
- [x] Extrair somente candidatos estruturados; campos não identificados ficam em branco para confirmação manual.
- [x] Anexos existentes continuam privados; nenhuma URL arbitrária é aceita.
- [x] Confirmar endereço/representante/cargo com proveniência e validação de caminho/hash pelo servidor.
- [x] Retornar cadastro canônico + dados confirmados; não alterar razão social/CNPJ.

### Task 3: Segurança SQL local e integração

**Files:** Create `docs/qa/testar-identificacao-empresa-local.sql` e relatório de testes sem credenciais.

- [x] Aplicar SQL apenas no banco local já existente.
- [x] Transação com empresas/usuários fictícios: leituras permitidas/negadas, escrita direta negada, RPC restrita, invalidação em operacao_documentos/storage e isolamento de convidados.
- [x] Rollback de todos os dados fictícios do teste.
- [x] Gate focado e compilação do router; coordenar API com a UI em tarefa separada.

## Interface para a UI

POST `/api/empresa-identificacao`, Bearer da sessão:

- `{acao:'consultar',empresaId}` → `{empresa:{id,organizacao_id,razao_social,cnpj},documentos:[...],perfil}`.
- `{acao:'anexar',empresaId,tipo:'contrato_social'|'cartao_cnpj',nome,conteudoBase64}` → `{documento}`.
- `{acao:'extrair',empresaId,documentoId}` → `{documentoId,hash,modo:'sugestoes'|'manual',sugestoes,avisos}`.
- `{acao:'confirmar',empresaId,revisado:true,razaoSocial,cnpj,dados:{endereco,representante,cargo},proveniencia:[{documentoId,hash,campos,pagina,trecho}]}` → `{empresa,perfil}`.

Proveniência vazia significa preenchimento manual declarado; arquivo pode existir sem extração. Upload e confirmação não liberam exportação jurídica automaticamente. Chave de serviço e conteúdo integral do contrato não entram nas respostas nem na IA.

## Registro de execução

- Validação inicial: teste falhou por módulo inexistente e passou após implementação.
- Implementados handler autenticado, limites, extração nativa sem IA, armazenamento privado existente e confirmação com proveniência.
- A configuração `IDENTIFICACAO_EMPRESA_LOCAL=1` é exclusiva da homologação; ausente, retorna 503. Sem migração ou gate de isolamento, falha fechada.
- Migração aplicada apenas ao banco local `licitaplena_qa_ui_v2`; reaplicação verificada. Teste transacional fictício cobre isolamento por empresa, proibição de escrita direta/RPC privilegiada por usuário e invalidação por cadastro, documento e objeto Storage; rollback concluído.
- Sete testes Node passaram. Parser recebe cópia Uint8Array para não depender do offset interno de Buffer; biblioteca/versão preservadas.
- Servidor local independente em `http://127.0.0.1:8792/login.html`: login 200, endpoint sem sessão 401, IA 503. Porta 8791 preservada.
- Revisão HTTP real e revisão independente de segurança concluídas sem P1. Não publicar esta feature.
- Limitação deliberada: extração por rótulos explícitos; contrato narrativo, imagem ou campos ambíguos exigem preenchimento manual revisado. Dados canônicos de razão social/CNPJ nunca são sobrescritos.

### Congelamento backend local

- Contrato final: até 3 ocorrências de proveniência, no máximo 2 documentos distintos, com hash/página/trecho/valor validados. Três campos podem estar em páginas diferentes.
- Oito testes focados passaram. Migração reaplicada e roteiro SQL transacional final passou, incluindo invalidações e rollback.
- Revisão independente HTTP real repetida após SQL final: três ocorrências em dois documentos aceitas, terceiro documento rejeitado; demais guardas verdes.
- Tokens anon/service de homologação expirados foram renovados com autorização explícita, preservando o mesmo secret, roles, issuer/audience e TTL. Nenhum segredo ou senha foi emitido em relatório. Porta 8792 reiniciada; demais serviços preservados.
- Conta preview nova e empresa fictícia mantidas para revisão pelo usuário. Credenciais exclusivamente em arquivo privado externo ao repositório.


## Fechamento da homologação local

- [x] Cadastro canônico preservado; divergência de documento bloqueada no navegador, sem afrouxar validadores.
- [x] Login, logout e novo login reais no ambiente isolado.
- [x] Upload privado, extração PDF nativa, revisão, confirmação, reabertura do perfil e aplicação na minuta pela interface real.
- [x] Auth/RLS/Storage reais: isolamento entre organizações e convidados, hashes, substituição de objeto, invalidação, confirmação manual e bloqueio de escrita direta/RPC pelo usuário.
- [x] Três ocorrências de proveniência em até dois documentos distintos aceitas; três documentos distintos rejeitados.
- [x] Gate final: 633 testes, 629 passaram, 4 ignorados, zero falhas. Build estático com 30 arquivos raiz e Worker compilado.
- [x] Testes descartáveis limpos; conta e empresa fictícias do preview preservadas intencionalmente para revisão do usuário.

Limites: extração automática somente de PDF com texto nativo, até 2 MiB e 8 páginas, por rótulos explícitos. Upload até 4 MiB permanece anexado mesmo quando a extração exige preenchimento manual. Não há OCR novo, IA de extração, coleta de CPF ou envio de documentos empresariais à IA jurídica. Razão social/CNPJ do cadastro não são sobrescritos. O custo de CPU desta NOVA feature em Worker remoto ainda não foi medido; a compilação não substitui esse teste. O perfil e a migração existem somente no ambiente local: não anunciar disponibilidade em produção.
