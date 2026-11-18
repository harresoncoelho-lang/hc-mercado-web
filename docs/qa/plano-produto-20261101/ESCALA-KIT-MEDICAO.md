# Escala do kit — medição e implementação local

01/11/2026. Nenhuma publicação, banco remoto, SMTP ou chamada ao portal. SQL preparado, NÃO APLICADO. Usado Node instalado, sem nova dependência.

## Resultado local

32/32 testes node:test passaram: gerador, persistência, UI estado, endpoint e helpers. Cenários 51/200/1.000 validam itens integrais no DOCX; fluxo endpoint de1.000 salva/prepara/confirma/exporta e retorna409 após alteração do último item. Teste UI headless real (uma página, zero rede) passou: página1→2→1 preserva unidades/seleção, visão selecionados e salvamento. Isso não é homologação da infraestrutura.

Implementados página cursor100 com contagem exata/checagem de cap e lotes50 para conjunto selecionado. Map substitui busca repetida; seleção UI fora DOM, visão selecionados paginada permite retirar IDs não presentes no catálogo visível. Abertura com leitura de itens não comprovada preserva rascunho e informa itensNaoVerificados, não acusa todos ausentes. Revisão/exportação continua falhando se não puder obter conjunto exato.

## Medição curta (processos Node separados)

| 1.000 itens | Tempo | Delta RSS observado | Prévia UTF8 | DOCX | Base64 |
|---|---:|---:|---:|---:|---:|
| descrição120 caracteres |50,4ms|12.918.784B|317.121B|14.688B|19.584B|
| descrição500 caracteres |69,0ms|16.646.144B|697.121B|14.926B|19.904B|
| descrição10.000 caracteres |188,3ms|55.226.368B|rejeitada422|não gerado|não gerado|

Strings sintéticas repetitivas comprimem muito: tamanho DOCX não representa pior caso real. Delta RSS antes/depois não é pico medido contínuo. Casos típicos ficaram abaixo do gate local provisório3s/64MiB; não certifica concorrência nem plano remoto. Caso extremo é recusado sem truncar. Capacidade comercial continua pendente de runtime isolado e dados representativos.

Budgets candidatos: 1.000 itens; envelope786.432 bytes; rascunho semântico524.288 bytes; prévia mantém1.000.000 caracteres e adiciona2.000.000 bytes UTF8. Fórmula comum JS/SQL:128 + N*128 + bytes das3condições + soma(bytesID+bytesUnidade de cada selecionado). Declarações mantêm50k do envelope e limites anteriores. Fluxo local novo precisa da RPC nova antes de funcionar com banco; NÃO anunciar deploy pronto.

## Arquivos / proteção

Modificados apenas kit UI/backend/validação/testes e novos helper/policy/migração/ensaios. `_kit_documentos.js` mudou exclusivamente seleção e budgets de proposta, preservando ramo declaração e montagemDOCX compartilhada. Baseline genérica NÃO foi atualizada. Autenticação, resumo, e-mail, robô, templates compartilhados intactos por escopo; revisão de diff independente ainda requerida.

`supabase/kit_documentos_escala_proposta.sql` substitui somente função existente, mantendo isolamento, CAS e grants existentes. `supabase/testar_kit_escala_bytes.sql` prepara ensaio rollback da fórmula. SQL não executado; RLS/CAS real e integração da migração precisam homologação isolada. Leitura por lotes não é snapshot transacional; exportação recalcula hash e detecta divergência observada.

Comandos: `node --test scripts/kit_proposta_escala.test.js scripts/kit_documentos.test.js scripts/kit_documentos_persistencia.test.js scripts/kit_documentos_ui.test.js netlify/functions/__tests__/kit-documentos.test.js`; `node scripts/kit_proposta_ui_escala.cjs`; `node scripts/medir_kit_proposta.cjs 120` (e500/10000).

## Adendo de revisão

Corrigidos: guarda de descarte agora considera seleção Map fora da páginaDOM; abertura com itensNaoVerificados exibe aviso explícito sem acusar todos IDs ausentes. Ensaio UI headless ampliado confirma ambos. Novo `supabase/testar_kit_escala_rpc.sql` prepara fixtures sintéticas rollback para51/1000, revisão/CAS, usuário/empresa/item estrangeiro e1001 recusado; NÃO EXECUTADO. Não equivale a testeHTTP/RLS real.

Evidência de preservação específica: snapshot histórico `C:/Users/harre/AppData/Local/LicitaPlena/kit-persistente-baseline-20261030/netlify/functions/_kit_documentos.js`, SHA2566ef11fd484adf708d258d825606250959dec71c639784b1ddd9016ce1e57a725. Funções `declaracao` e `docx` comparadas com fonte atual normalizando CRLF são iguais. É snapshot de30/10, não captura imediatamente antes da edição atual. O arquivo `_kit_documentos.js`, listado na proteção genérica, FOI alterado no ramo proposta autorizado; nenhuma baseline foi renovada para ocultar isso.
