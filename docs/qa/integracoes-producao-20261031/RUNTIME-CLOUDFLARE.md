# Cloudflare: bundle completo validado localmente

31/10/2026 UTC. `rodada-04-leitor-pdf/runtime-03` concluiu com **exit 0, 14 verificações e nenhum erro**. Nenhuma publicação, escrita em produção, SMTP, resumo, robô, modelo ou autenticação existente foi alterado.

## O que foi comprovado

O **bundle completo das Pages Functions**, minificado pelo Wrangler instalado, executou em workerd por Miniflare com a data `2025-09-01` e a flag `nodejs_compat` do projeto. Não se substituiu handler nem se retirou rota protegida para obter sucesso.

| Verificação | Resultado observado |
|---|---|
| Módulo desligado e falta de sessão | As duas rotas retornaram 503/401 antes de consultar serviços externos. |
| Aprovação, gate e papel | Conta não aprovada, gate fechado e papel de leitura foram recusados. |
| Escopo empresarial | Empresa fora da fixture não foi acessada; cadastro e kit mantiveram o CNPJ esperado. |
| PDF empresarial | O PDF sintético passou a retornar sugestões com quatro evidências e hash correto. **Fallback manual não contou como aprovação.** |
| Confirmação | CNPJ divergente foi recusado; dados fictícios revisados foram confirmados. |
| Documentos e propostas | Consulta, salvar, reabrir e listar duas peças persistidas nas fixtures. |
| Revisão | Prévia integral disponível antes da confirmação; exportar sem revisão própria foi recusado; mudança de preço invalidou a revisão anterior. |
| Cálculo e conteúdo | Quantidades e preços decimais produziram R$ 3,71; item não selecionado ficou fora da proposta. |
| Exportação | Dois DOCX ZIP válidos, com CNPJ, representante e conteúdo esperado. |

**Auth, REST e Storage foram fixtures fictícias em memória.** Esta rodada comprova a execução do código compilado e seu contrato com esses serviços. Complementa a homologação anterior com banco, autenticação e Storage reais em teste; não substitui prova de SQL/RLS, migrações, credenciais ou operação em produção.

## Correção que permitiu a leitura

O primeiro smoke funcional (`rodada-03-revisada/runtime-02`) revelou recursão no caminho browser de node-ensure usado pelo PDF.js empacotado. A falha foi preservada, reproduzida offline e revisada. O patch ficou em `_empresa_documentos.js` e no helper novo `_empresa_pdf_leitor.js`: usa `LoopbackPort`/worker explícito da mesma biblioteca já instalada, com import sob demanda e cleanup em finally. Não modifica globals, require.ensure, aliases, loader, dependências ou parser do resumo. Detalhes, hashes anteriores e diff estão em `diagnostico-pdf-worker.md` e `empresa-documentos.diff`.

Permanecem 2 MiB/oito páginas para extração, aviso manual nos casos não legíveis e contrato de sugestões/evidências. O novo limite cooperativo de dez segundos não preempta CPU síncrona. A biblioteca conserva seus efeitos internos de inicialização preexistentes; o patch contorna a invocação do loader, sem afirmar que PDF.js seja isento de efeitos internos.

## Integridade, contenção e encerramento

- 239 chamadas às fixtures; **zero saída não declarada e zero conexão externa do host**. Somente `empresa-identificacao` e `kit-documentos` foram invocadas. A configuração serializada foi auditada antes de cada spawn.
- Auth/REST/Storage ficam atrás de auxiliar QA sem passthrough TCP. ASSETS tem auxiliar separado que recusa literalmente qualquer requisição. Ambos sem acesso de encaminhamento à internet pelo código de QA. DNS/UDP externos e sockets host externos foram bloqueados.
- Os processos próprios workerd 23168 e 21176 encerraram depois de `dispose()`; eventos de encerramento SIGKILL estão registrados. Não houve acionamento do fallback de kill do harness. A consulta real posterior encontrou **nenhum workerd ativo**. Não foram encerrados processos alheios.
- Os **20 arquivos protegidos** conservaram os hashes antes/depois. A suíte `npm run verify`, executada pela coordenação após o patch, passou: 843 testes, 839 aprovados, quatro skips, zero falhas; lint zero erros e 58 avisos preexistentes. Log `verify-final.log`. Nenhum código foi alterado depois dessa suíte; depois dela houve apenas build, smoke e documentação.

## Artefato local preparado

Pasta: `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-04-leitor-pdf`.

| Item | Medida |
|---|---|
| Worker JS completo | 8.099.878 bytes |
| Gzip local | 2.798.537 bytes |
| SHA-256 Worker | `dab78768da8bab84401ed92051cd8dc462e2838df97f3263f9e098a444ba925d` |
| Estáticos | 44 arquivos: 39 da raiz e cinco JSON públicos |
| Inputs reais | 430 arquivos com tamanho comparado ao metafile e hashes registrados após compilação |
| Declaração DOCX fictícia | 2.675 bytes; SHA `dcf88151494a012a81ccb5c3c92650f42ef3c5a89d56aa1f285871c9dee5b9aa` |
| Proposta DOCX fictícia | 2.796 bytes; SHA `aee2b220d4382f7da17edefd3c5ccfd61cc17f9590331fed2d6eaa2b3e7cf115` |

O pacote **não inclui `editais_vistos.json`**, histórico privado por destinatário. Os pacotes 01/02 anteriores continuam privados, não publicáveis, preservados como evidência. Não foi apagado ou modificado o histórico de envio do robô. O builder corrigido por outro especialista usa a mesma seleção explícita dos cinco JSON públicos.

Arquivos de prova: `comando-build.json`, `manifesto-worker.json`, `manifesto-estaticos.json`, `fontes-build.json`, `protegidos-antes.json`, `protegidos-depois.json`, `build.*.log`, `runtime-03-exec.json`, `runtime-03.*.log`, snapshots de processos e `runtime-03/resultado.json`. Cada check tem JSON próprio; DOCX fictícios preservados em `runtime-03/`.

## Limites antes de produção

Este resultado não mede CPU/inicialização nas cotas remotas, não prova a política de minificação do CI nem ativa tabelas, RPCs, gates ou segredo em produção. O projeto remoto precisa de inventário/migração controlada e etapa explícita de minificação do bundle homologado. Plano/billing, deploy automático, autenticação e configurações remotas não foram modificados. Nenhum teste de resumo, e-mail ou robô foi invocado nesta rodada.
