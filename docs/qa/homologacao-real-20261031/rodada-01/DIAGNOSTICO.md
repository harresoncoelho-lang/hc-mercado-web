# Rodada-01 — falha do harness e recuperação concluída

Execução real autorizada iniciada em `2026-10-31T02:24:18.370Z`, usando o servidor QA existente. Node v24.22.0 terminou com exit 1. Os logs originais permanecem em `harness.stdout.log` e `harness.stderr.log`; nenhum artefato da rodada foi substituído.

## Resultado alcançado

O fluxo chegou à UI depois dos testes HTTP de peças persistidas, idempotência, versão/conflito concorrente, revisão por usuário/hash, recusa RLS/RPC/DML, propostas decimais, identificação e substituição de fonte no Storage. Há seis DOCX de API preservados, das exportações persistidas e legadas. O cadastro B também foi confirmado e recarregado no navegador real, com capturas em 375 e 1280 px.

A rodada não foi aprovada. O primeiro DOCX da UI não foi produzido, e não há relatório final do harness. As assertions anteriores são evidência de percurso parcial, não substituem a execução completa após correção.

## Causa confirmada

1. O teste substituiu o PDF de origem e confirmou que a revisão anterior ficou inválida.
2. Restaurar os bytes do PDF não remove `invalidado_em`. O trigger real `identificacao_arquivo_alterado`, em `supabase/identificacao_empresa.sql`, mantém a identificação invalidada até uma confirmação explícita.
3. A consulta SQL somente leitura encontrou a identificação A com `invalidado_em=2026-10-31T02:24:32.901606Z`, posterior à confirmação `2026-10-31T02:24:32.418705Z`. A peça `Declaração UI real` foi salva em versão 1 e não tem revisão. A identificação B está confirmada.
4. O harness chamou `revisar()` após salvar/recarregar/abrir a peça A. A UI bloqueia corretamente Preparar prévia quando há pendência cadastral.
5. O helper abriu `waitForResponse` e aguardou o clique antes de anexar o tratamento da promessa de resposta. O timeout de 15 segundos rejeitou essa promessa sem tratamento; o Node encerrou o processo antes dos `finally` da UI e do harness. O mesmo padrão existia na espera de download.

Não foi identificado bug de produto neste percurso. O bloqueio do cadastro corresponde à regra de segurança existente. Nenhum arquivo de produto foi editado.

## Propriedade das fixtures e contenção

A inspeção somente leitura encontrou quatro usuários QA criados entre `02:24:25.922768Z` e `02:24:27.195571Z`, duas organizações com esses owners, três empresas, quatro peças e um objeto privado. A janela foi limitada a dois minutos a partir do marcador de início. IDs e vínculos estão em `recuperacao-preflight.json`, sem e-mail, senha ou tokens.

Ao excluir exclusivamente esses UUIDs, organizações e objeto na consulta de comparação, todas as 33 contagens e hashes coincidem com `baseline-dados.json`. Isso comprova que o restante da base coincide com a baseline; ainda não comprova remoção das fixtures.

O processo `homologar-kit-real-local.cjs` não está ativo. A consulta de processos Edge que combinam `--headless` e perfil temporário Playwright retornou zero; não foi encerrado nenhum navegador do usuário. O servidor e os containers QA permaneceram ativos, sob coordenação do agente principal.

## Correções preparadas

- Harness: provar que restaurar bytes conserva o bloqueio, reconfirmar os dados e a proveniência pelo endpoint real, e só então iniciar a UI.
- Esperas: anexar imediatamente as duas promessas via `Promise.all`, incluindo download. Erros continuam sendo propagados ao `finally`.
- Próximas execuções: diário exclusivo `fixtures.jsonl`, contendo somente tipo, UUID e timestamp logo após criação confirmada.
- Recuperação dirigida: inventário imutável, IDs sobreviventes validados, ausências aceitas, objeto localizado sem depender do documento e interrupção antes de apagar vínculos quando o Storage falha. Revisão independente e liberação separada ainda necessárias.

Os relatórios de correção ficam em `../harness-fix2.md` e `../recuperacao-fix1.md`. Nenhuma nova rodada real nem DELETE ocorreu durante este diagnóstico.

## Recuperação executada após revisão e liberação

O coordenador aprovou uma tentativa dirigida após o re-review independente. O SHA-256 do script foi reconferido antes da execução. `recuperar-limpeza-rodada-01.cjs --limpar` terminou com exit 0, seis etapas concluídas e zero erros.

`recuperacao-limpeza-2026-10-31T02-34-48-267Z.json` registra igualdade integral das contagens e hashes das 33 tabelas com a baseline inicial. A consulta adicional `owned-ids-ausentes.json` confirmou zero usuários, organizações, empresas, peças, documento de origem e objeto Storage para os IDs exatos da rodada.

Logs exclusivos: `recuperacao-cleanup-01.stdout.log` e `recuperacao-cleanup-01.stderr.log`; stderr vazio. A recuperação não aprova a homologação interrompida. Servidor e containers continuam sob coordenação; nenhuma nova rodada foi iniciada por esta recuperação.
